'use strict';

/**
 * section-svc：river-gauge 汇总接口
 *  - 断面 / 本地河道简图（坐标全在自己库，不接在线地图）
 *  - 巡测读数（水位标尺、水色、目估流速）
 *  - 简图标注（漂浮物 / 疑似排污口 + 一句话备注 + 照片）
 *  - 同一断面相邻两次水位差 > 阈值（默认 0.30m，差正好 0.30m 不算）自动挑出，供追问是否抄串
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const JUMP_THRESHOLD_M = Number(process.env.JUMP_THRESHOLD_M || 0.3);
const EVENT_KINDS = new Set(['debris', 'outfall']);
const READING_FIELDS = ['walked_at', 'level_m', 'water_color', 'flow_ms', 'note'];

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'river_gauge',
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4',
  // DATETIME 按字符串往返（'YYYY-MM-DD HH:MM:SS'），避免容器时区换算把本子时间搞乱
  dateStrings: true,
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg) => res.status(400).json({ error: msg });
const badRequest = (msg) => Object.assign(new Error(msg), { statusCode: 400 });
const round3 = (n) => Math.round(n * 1000) / 1000;

// ---------- 小工具 ----------

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 'YYYY-MM-DDTHH:MM' 或 'YYYY-MM-DD HH:MM[:SS]' → 'YYYY-MM-DD HH:MM:SS'，不合法返回 null */
function normDateTime(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(String(s || '').trim());
  return m ? `${m[1]} ${m[2]}${m[3] || ':00'}` : null;
}

function str(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

/** DECIMAL 列在 mysql2 里出来是字符串，这里统一转回数字 */
function normalizeReading(r) {
  return {
    ...r,
    level_m: Number(r.level_m),
    flow_ms: r.flow_ms === null ? null : Number(r.flow_ms),
    verified: Boolean(r.verified),
    is_void: Boolean(r.is_void),
  };
}

function normalizeEvent(e) {
  return { ...e, x: Number(e.x), y: Number(e.y) };
}

/** 按断面分组、按时间排序的读数；跳变计算只取有效记录，历史回看连作废条一起返回 */
async function fetchReadingsOrdered(sectionId, { includeVoided = true } = {}) {
  let sql = `
    SELECT r.id, r.section_id, s.code AS section_code, s.name AS section_name,
           r.walked_at, r.walked_by, r.level_m, r.water_color, r.flow_ms, r.note,
           r.verified, r.verify_note, r.verified_at,
           r.is_void, r.void_reason, r.voided_at, r.voided_by,
           r.revised_at, r.revised_by, r.created_at
    FROM readings r
    JOIN sections s ON s.id = r.section_id`;
  const params = [];
  if (sectionId) {
    sql += ' WHERE r.section_id = ?';
    params.push(Number(sectionId));
    if (!includeVoided) sql += ' AND r.is_void = 0';
  } else if (!includeVoided) {
    sql += ' WHERE r.is_void = 0';
  }
  sql += ' ORDER BY r.section_id, r.walked_at, r.id';
  const [rows] = await pool.query(sql, params);
  return rows.map(normalizeReading);
}

/** 给每行补上 prev_level_m / delta_m / jump（与同一断面上一次有效读数比） */
function annotateJumps(rows, threshold) {
  let prev = null;
  for (const r of rows) {
    if (r.is_void || !prev || prev.section_id !== r.section_id) {
      if (!r.is_void) {
        r.prev_level_m = null;
        r.delta_m = null;
        r.jump = false;
      }
    } else {
      r.prev_level_m = prev.level_m;
      r.delta_m = round3(r.level_m - prev.level_m);
      r.jump = Math.abs(r.delta_m) > threshold; // 差正好等于阈值不算跳变
    }
    if (!r.is_void) prev = r;
  }
  return rows;
}

/** 老库没有迁移目录，启动时幂等补齐“作废 / 修改留痕”结构 */
async function ensureSchema() {
  const columns = [
    ['is_void', "TINYINT(1) NOT NULL DEFAULT 0"],
    ['void_reason', "VARCHAR(200) NOT NULL DEFAULT ''"],
    ['voided_at', 'DATETIME DEFAULT NULL'],
    ['voided_by', 'VARCHAR(20) DEFAULT NULL'],
    ['revised_at', 'DATETIME DEFAULT NULL'],
    ['revised_by', 'VARCHAR(20) DEFAULT NULL'],
  ];
  for (const [name, ddl] of columns) {
    const [found] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readings' AND COLUMN_NAME = ?`,
      [name]
    );
    if (!found.length) await pool.query(`ALTER TABLE readings ADD COLUMN ${name} ${ddl}`);
  }

  const [idx] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'readings' AND INDEX_NAME = 'idx_section_valid'`
  );
  if (!idx.length) {
    await pool.query('ALTER TABLE readings ADD INDEX idx_section_valid (section_id, is_void, walked_at)');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reading_revisions (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      reading_id     INT NOT NULL,
      action         VARCHAR(20) NOT NULL,
      changed_fields JSON DEFAULT NULL,
      reason         VARCHAR(200) NOT NULL DEFAULT '',
      revised_by     VARCHAR(20) NOT NULL,
      revised_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reading_time (reading_id, id),
      FOREIGN KEY (reading_id) REFERENCES readings(id)
    )
  `);
}

const sameNullableNumber = (a, b) => (
  a === null || b === null ? a === b : Number(a) === Number(b)
);

async function addRevision(conn, readingId, action, changedFields, revisedBy, reason = '') {
  await conn.query(
    `INSERT INTO reading_revisions
       (reading_id, action, changed_fields, reason, revised_by)
     VALUES (?,?,?,?,?)`,
    [readingId, action, changedFields ? JSON.stringify(changedFields) : null, reason, revisedBy]
  );
}

/** 取某断面仍有效的相邻签名；FOR UPDATE 让同断面的保存/作废串行处理 */
async function validPairsForUpdate(conn, sectionId) {
  const [rows] = await conn.query(
    `SELECT id, walked_at, level_m, is_void
     FROM readings WHERE section_id = ?
     ORDER BY walked_at, id
     FOR UPDATE`,
    [sectionId]
  );
  const valid = rows.filter((r) => !Number(r.is_void));
  const pairs = new Map();
  valid.forEach((r, i) => {
    const prev = valid[i - 1] || null;
    pairs.set(r.id, prev
      ? `${prev.id}|${prev.walked_at}|${prev.level_m}|${r.walked_at}|${r.level_m}`
      : `first|${r.walked_at}|${r.level_m}`);
  });
  return pairs;
}

/** 保存、修改、作废/恢复后，只清“相邻配对真的变了”的旧核实勾 */
async function resetChangedVerifications(conn, sectionId, beforePairs) {
  const afterPairs = await validPairsForUpdate(conn, sectionId);
  const ids = new Set([...beforePairs.keys(), ...afterPairs.keys()]);
  const clearIds = [];
  for (const id of ids) {
    if (beforePairs.get(id) !== afterPairs.get(id)) clearIds.push(id);
  }
  if (!clearIds.length) return;
  await conn.query(
    `UPDATE readings
     SET verified = 0, verify_note = '', verified_at = NULL
     WHERE id IN (?)`,
    [clearIds]
  );
}

// ---------- 基础 ----------

app.get('/api/health', (req, res) => res.json({ ok: true }));

// 断面列表
app.get('/api/sections', asyncH(async (req, res) => {
  const [rows] = await pool.query('SELECT id, code, name, x, y FROM sections ORDER BY sort, id');
  res.json(rows.map((s) => ({ ...s, x: Number(s.x), y: Number(s.y) })));
}));

// 本地河道简图：要素 + 断面一次给全，前端 SVG 渲染
app.get('/api/sketch', asyncH(async (req, res) => {
  const [features] = await pool.query('SELECT id, ftype, label, points FROM sketch_features ORDER BY id');
  const [sections] = await pool.query('SELECT id, code, name, x, y FROM sections ORDER BY sort, id');
  res.json({
    features: features.map((f) => ({
      ...f,
      points: typeof f.points === 'string' ? JSON.parse(f.points) : f.points,
    })),
    sections: sections.map((s) => ({ ...s, x: Number(s.x), y: Number(s.y) })),
  });
}));

// 巡测人历史名单（前端 datalist 用，三个人轮流跑，名字不用维护表）
app.get('/api/walkers', asyncH(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT DISTINCT walked_by FROM readings WHERE is_void = 0 ORDER BY walked_by LIMIT 50'
  );
  res.json(rows.map((r) => r.walked_by));
}));

// ---------- 读数 ----------

// 抄一条读数：到断面先选编号，再抄水位/水色/目估流速
app.post('/api/readings', asyncH(async (req, res) => {
  const sectionId = toNum(req.body.section_id);
  const walkedAt = normDateTime(req.body.walked_at);
  const walkedBy = str(req.body.walked_by, 20);
  const level = toNum(req.body.level_m);
  const waterColor = str(req.body.water_color, 20);
  const flow = req.body.flow_ms === null || req.body.flow_ms === '' ? null : toNum(req.body.flow_ms);
  const note = str(req.body.note, 200);

  if (!sectionId) return bad(res, '先选断面编号');
  if (!walkedAt) return bad(res, '巡测时间格式不对');
  if (!walkedBy) return bad(res, '填一下巡测人');
  if (level === null || level < -10 || level > 100) return bad(res, '水位读数不对（米）');
  if (flow !== null && (flow < 0 || flow > 20)) return bad(res, '目估流速不对（m/s）');

  const [sec] = await pool.query('SELECT id FROM sections WHERE id = ?', [sectionId]);
  if (!sec.length) return bad(res, '断面不存在');

  const conn = await pool.getConnection();
  let insertId;
  try {
    await conn.beginTransaction();
    const beforePairs = await validPairsForUpdate(conn, sectionId);
    const [r] = await conn.query(
      'INSERT INTO readings (section_id, walked_at, walked_by, level_m, water_color, flow_ms, note) VALUES (?,?,?,?,?,?,?)',
      [sectionId, walkedAt, walkedBy, level, waterColor, flow, note]
    );
    insertId = r.insertId;
    await resetChangedVerifications(conn, sectionId, beforePairs);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query(
    `SELECT r.*, s.code AS section_code, s.name AS section_name
     FROM readings r JOIN sections s ON s.id = r.section_id WHERE r.id = ?`,
    [insertId]
  );
  res.status(201).json(normalizeReading(rows[0]));
}));

// 按日期 + 断面回看；每行带与上一次的差值和跳变标记，附带该次的简图标注
app.get('/api/readings', asyncH(async (req, res) => {
  const rows = annotateJumps(await fetchReadingsOrdered(req.query.section_id), JUMP_THRESHOLD_M);
  let out = rows;
  if (req.query.date) out = rows.filter((r) => r.walked_at.startsWith(req.query.date));

  if (out.length) {
    const ids = out.map((r) => r.id);
    const [evs] = await pool.query(
      'SELECT * FROM map_events WHERE reading_id IN (?) ORDER BY id',
      [ids]
    );
    const byReading = new Map();
    for (const e of evs.map(normalizeEvent)) {
      if (!byReading.has(e.reading_id)) byReading.set(e.reading_id, []);
      byReading.get(e.reading_id).push(e);
    }
    for (const r of out) r.events = byReading.get(r.id) || [];
  }
  res.json(out);
}));

// 跳变清单：同一断面相邻两次水位差 > 阈值（默认 30cm，差正好 30cm 不算），单独挑出来追问是否抄串
app.get('/api/jumps', asyncH(async (req, res) => {
  const threshold = toNum(req.query.threshold) || JUMP_THRESHOLD_M;
  const rows = await fetchReadingsOrdered(req.query.section_id, { includeVoided: false });
  const pairs = [];
  let prev = null;
  for (const r of rows) {
    if (prev && prev.section_id === r.section_id) {
      const delta = round3(r.level_m - prev.level_m);
      if (Math.abs(delta) > threshold) {
        pairs.push({
          section_id: r.section_id,
          section_code: r.section_code,
          section_name: r.section_name,
          delta_m: delta,
          prev,
          curr: r,
        });
      }
    }
    prev = r;
  }
  res.json(pairs);
}));

// 修改一条读数：只改抄录内容，不改断面和原始巡测人；配对变化时旧核实自动失效
app.patch('/api/readings/:id', asyncH(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return bad(res, '读数不存在');
  const revisedBy = str(req.body.revised_by, 20);
  if (!revisedBy) return bad(res, '填一下操作人');

  const next = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'walked_at')) {
    next.walked_at = normDateTime(req.body.walked_at);
    if (!next.walked_at) return bad(res, '巡测时间格式不对');
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'level_m')) {
    next.level_m = toNum(req.body.level_m);
    if (next.level_m === null || next.level_m < -10 || next.level_m > 100) {
      return bad(res, '水位读数不对（米）');
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'water_color')) {
    next.water_color = str(req.body.water_color, 20);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'flow_ms')) {
    next.flow_ms = req.body.flow_ms === null || req.body.flow_ms === ''
      ? null
      : toNum(req.body.flow_ms);
    if (next.flow_ms !== null && (next.flow_ms < 0 || next.flow_ms > 20)) {
      return bad(res, '目估流速不对（m/s）');
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'note')) {
    next.note = str(req.body.note, 200);
  }
  const unknown = Object.keys(req.body).filter((k) => !['walked_at', 'level_m', 'water_color', 'flow_ms', 'note', 'revised_by'].includes(k));
  if (unknown.length) return bad(res, `不能修改：${unknown.join('、')}`);
  if (!Object.keys(next).length) return bad(res, '没有要修改的内容');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.query('SELECT * FROM readings WHERE id = ? FOR UPDATE', [id]);
    if (!found.length) throw badRequest('读数不存在');
    const old = found[0];
    if (Number(old.is_void)) throw badRequest('已作废的记录不能直接修改；先恢复再改');

    const changed = {};
    if (next.walked_at !== undefined && next.walked_at !== old.walked_at) {
      changed.walked_at = { old: old.walked_at, new: next.walked_at };
    }
    if (next.level_m !== undefined && Number(next.level_m) !== Number(old.level_m)) {
      changed.level_m = { old: Number(old.level_m), new: next.level_m };
    }
    if (next.water_color !== undefined && next.water_color !== old.water_color) {
      changed.water_color = { old: old.water_color, new: next.water_color };
    }
    if (next.flow_ms !== undefined && !sameNullableNumber(next.flow_ms, old.flow_ms)) {
      changed.flow_ms = {
        old: old.flow_ms === null ? null : Number(old.flow_ms),
        new: next.flow_ms,
      };
    }
    if (next.note !== undefined && next.note !== old.note) {
      changed.note = { old: old.note, new: next.note };
    }
    if (!Object.keys(changed).length) throw badRequest('内容没有变化');

    const beforePairs = await validPairsForUpdate(conn, old.section_id);
    const fields = Object.keys(next);
    const assignments = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => next[f]);
    await conn.query(
      `UPDATE readings SET ${assignments}, revised_at = NOW(), revised_by = ? WHERE id = ?`,
      [...values, revisedBy, id]
    );
    await addRevision(conn, id, 'edit', changed, revisedBy);
    await resetChangedVerifications(conn, old.section_id, beforePairs);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.json({ ok: true });
}));

// 作废 / 恢复：作废条仍在历史里，但不占“相邻两次”；原因和操作人进流水
app.patch('/api/readings/:id/void', asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const makeVoid = req.body.is_void !== false;
  const revisedBy = str(req.body.revised_by, 20);
  const reason = str(req.body.reason, 200);
  if (!id) return bad(res, '读数不存在');
  if (!revisedBy) return bad(res, '填一下操作人');
  if (makeVoid && !reason) return bad(res, '作废必须写原因');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.query('SELECT * FROM readings WHERE id = ? FOR UPDATE', [id]);
    if (!found.length) throw badRequest('读数不存在');
    const old = found[0];
    const alreadyVoid = Boolean(Number(old.is_void));
    if (makeVoid === alreadyVoid) throw badRequest(makeVoid ? '这条已经作废' : '这条不是作废状态');

    const beforePairs = await validPairsForUpdate(conn, old.section_id);
    if (makeVoid) {
      await conn.query(
        `UPDATE readings
         SET is_void = 1, void_reason = ?, voided_at = NOW(), voided_by = ?,
             verified = 0, verify_note = '', verified_at = NULL,
             revised_at = NOW(), revised_by = ?
         WHERE id = ?`,
        [reason, revisedBy, revisedBy, id]
      );
      await addRevision(conn, id, 'void', { is_void: { old: 0, new: 1 } }, revisedBy, reason);
    } else {
      await conn.query(
        `UPDATE readings
         SET is_void = 0, void_reason = '', voided_at = NULL, voided_by = NULL,
             revised_at = NOW(), revised_by = ?
         WHERE id = ?`,
        [revisedBy, id]
      );
      await addRevision(conn, id, 'restore', { is_void: { old: 1, new: 0 } }, revisedBy, reason);
    }
    await resetChangedVerifications(conn, old.section_id, beforePairs);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.json({ ok: true });
}));

// 一条读数的修改/作废流水
app.get('/api/readings/:id/revisions', asyncH(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return bad(res, '读数不存在');
  const [rows] = await pool.query(
    `SELECT id, reading_id, action, changed_fields, reason, revised_by, revised_at
     FROM reading_revisions WHERE reading_id = ? ORDER BY id DESC`,
    [id]
  );
  res.json(rows.map((x) => ({
    ...x,
    changed_fields: typeof x.changed_fields === 'string' ? JSON.parse(x.changed_fields) : x.changed_fields,
  })));
}));

// 追问完了标记：已核实 / 取消核实
app.patch('/api/readings/:id/verify', asyncH(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return bad(res, '读数不存在');
  const [found] = await pool.query('SELECT id, is_void FROM readings WHERE id = ?', [id]);
  if (!found.length) return bad(res, '读数不存在');
  if (Number(found[0].is_void)) return bad(res, '作废记录不参与跳变核实');

  const verified = req.body.verified ? 1 : 0;
  const note = str(req.body.verify_note, 200);
  await pool.query(
    'UPDATE readings SET verified = ?, verify_note = ?, verified_at = IF(? = 1, NOW(), NULL) WHERE id = ?',
    [verified, note, verified, id]
  );
  res.json({ ok: true });
}));

// ---------- 简图标注 ----------

// 在简图上点一个漂浮物 / 疑似排污口，挂到刚保存的那次读数上
app.post('/api/events', asyncH(async (req, res) => {
  const readingId = toNum(req.body.reading_id);
  const kind = str(req.body.kind, 20);
  const x = toNum(req.body.x);
  const y = toNum(req.body.y);
  const note = str(req.body.note, 200);

  if (!readingId) return bad(res, '先保存本次读数，再在简图上标注');
  if (!EVENT_KINDS.has(kind)) return bad(res, '标注类型不对');
  if (x === null || y === null || x < 0 || x > 1000 || y < 0 || y > 620) {
    return bad(res, '坐标超出简图范围');
  }

  // 断面以读数为准，避免三个人各选各的导致对不齐
  const [rRows] = await pool.query('SELECT id, section_id FROM readings WHERE id = ?', [readingId]);
  if (!rRows.length) return bad(res, '读数不存在，请先保存读数');

  const [r] = await pool.query(
    'INSERT INTO map_events (reading_id, section_id, kind, x, y, note) VALUES (?,?,?,?,?,?)',
    [readingId, rRows[0].section_id, kind, x, y, note]
  );
  const [rows] = await pool.query('SELECT * FROM map_events WHERE id = ?', [r.insertId]);
  res.status(201).json(normalizeEvent(rows[0]));
}));

// 查标注（默认按读数的巡测日期过滤，巡测页用来显示“今天大家都标了啥”）
app.get('/api/events', asyncH(async (req, res) => {
  let sql = `
    SELECT e.*, s.code AS section_code, r.walked_by
    FROM map_events e
    JOIN sections s ON s.id = e.section_id
    LEFT JOIN readings r ON r.id = e.reading_id`;
  const params = [];
  if (req.query.date) {
    sql += ' WHERE DATE(COALESCE(r.walked_at, e.created_at)) = ?';
    params.push(req.query.date);
  }
  sql += ' ORDER BY e.id';
  const [rows] = await pool.query(sql, params);
  res.json(rows.map(normalizeEvent));
}));

// 给标注补照片（桥墩泡沫带那种，拍完就传，不再夹在本子里）
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('只收图片文件'));
    cb(null, true);
  },
});

app.post('/api/events/:id/photo', upload.single('photo'), asyncH(async (req, res) => {
  if (!req.file) return bad(res, '没有收到照片');
  const [r] = await pool.query('UPDATE map_events SET photo_path = ? WHERE id = ?', [
    req.file.filename,
    req.params.id,
  ]);
  if (!r.affectedRows) return bad(res, '标注不存在');
  res.json({ ok: true, photo_path: req.file.filename });
}));

// ---------- 错误兜底 ----------

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '照片超过 10M' });
  if (err && err.message === '只收图片文件') return res.status(400).json({ error: err.message });
  if (err && err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// ---------- 启动：等 MySQL 就绪再听端口 ----------

async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      console.log(`等数据库就绪 (${i}/${retries})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('数据库连不上，放弃启动');
}

waitForDb().then(async () => {
  await ensureSchema();
  app.listen(PORT, () => console.log(`section-svc 监听 :${PORT}，跳变阈值 ${JUMP_THRESHOLD_M}m`));
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
