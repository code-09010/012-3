import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const WATER_COLORS = ['清', '微浑', '浑浊', '泛黄', '发黑', '其他'];
const ACTOR_KEY = 'rg-operator';

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(3)}` : d.toFixed(3));
const toLocalInput = (s) => (s || '').slice(0, 16).replace(' ', 'T');
const fmtNum = (v) => (v === null || v === undefined || v === '' ? '空' : String(v));

const FIELD_LABELS = {
  walked_at: '巡测时间',
  level_m: '水位',
  water_color: '水色',
  flow_ms: '流速',
  note: '备注',
  is_void: '状态',
};

function formatRevision(rev) {
  const fields = rev.changed_fields ? Object.keys(rev.changed_fields) : [];
  if (rev.action === 'void') return '作废';
  if (rev.action === 'restore') return '恢复有效';
  if (!fields.length) return '修改';
  return '改了：' + fields.map((f) => FIELD_LABELS[f] || f).join('、');
}

function formatChange(rev) {
  if (!rev.changed_fields) return rev.reason || '';
  return Object.entries(rev.changed_fields).map(([key, v]) => {
    const label = FIELD_LABELS[key] || key;
    if (key === 'is_void') return `${label}：${v.old ? '作废' : '有效'} → ${v.new ? '作废' : '有效'}`;
    return `${label}：${fmtNum(v.old)} → ${fmtNum(v.new)}`;
  }).join('；');
}

export default function HistoryView({ sections }) {
  const [date, setDate] = useState(today());
  const [sectionId, setSectionId] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [actor, setActor] = useState(() => localStorage.getItem(ACTOR_KEY) || '');
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revisions, setRevisions] = useState({});
  const [auditOpen, setAuditOpen] = useState({});

  const load = useCallback(async () => {
    setErr('');
    try {
      setRows(await api.readings({ date, section_id: sectionId }));
      setEditId(null);
      setForm(null);
    } catch (e) {
      setErr(e.message);
    }
  }, [date, sectionId]);

  useEffect(() => {
    load();
  }, [load]);

  function requireActor() {
    const name = actor.trim();
    if (!name) {
      setErr('先在上方填本次操作人，再改记录或作废');
      return '';
    }
    localStorage.setItem(ACTOR_KEY, name);
    return name;
  }

  function startEdit(r) {
    const name = requireActor();
    if (!name) return;
    setErr('');
    setEditId(r.id);
    setForm({
      walked_at: toLocalInput(r.walked_at),
      level_m: String(r.level_m),
      water_color: r.water_color,
      flow_ms: r.flow_ms === null ? '' : String(r.flow_ms),
      note: r.note,
    });
  }

  async function saveEdit(id) {
    const name = requireActor();
    if (!name || !form) return;
    setBusy(true);
    setErr('');
    try {
      await api.updateReading(id, {
        walked_at: form.walked_at,
        level_m: Number(form.level_m),
        water_color: form.water_color,
        flow_ms: form.flow_ms === '' ? null : Number(form.flow_ms),
        note: form.note.trim(),
        revised_by: name,
      });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoid(r) {
    const name = requireActor();
    if (!name) return;
    setErr('');

    if (!r.is_void) {
      const reason = window.prompt(`作废 ${r.section_code} ${r.walked_at} 这条的原因：`, '');
      if (reason === null) return;
      if (!reason.trim()) return setErr('作废必须写原因');
      setBusy(true);
      try {
        await api.setVoidReading(r.id, { is_void: true, reason: reason.trim(), revised_by: name });
        await load();
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
      return;
    }

    const note = window.prompt('恢复有效时可写一句说明（可空）：', '');
    if (note === null) return;
    setBusy(true);
    try {
      await api.setVoidReading(r.id, { is_void: false, reason: note.trim(), revised_by: name });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(r) {
    const note = window.prompt('核实情况（怎么追问的、结论）：', r.verify_note || '与本人核对，读数无误');
    if (note === null) return;
    try {
      await api.verify(r.id, { verified: true, verify_note: note });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function toggleAudit(id) {
    const nextOpen = !auditOpen[id];
    setAuditOpen((x) => ({ ...x, [id]: nextOpen }));
    if (nextOpen && !revisions[id]) {
      try {
        const list = await api.revisions(id);
        setRevisions((x) => ({ ...x, [id]: list }));
      } catch (e) {
        setErr(e.message);
      }
    }
  }

  return (
    <div className="card">
      <div className="row filters">
        <label>
          日期
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          断面
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">全部断面</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.code} {s.name}</option>
            ))}
          </select>
        </label>
        <label>
          本次操作人
          <input value={actor} maxLength="20" placeholder="谁在改/作废"
            onChange={(e) => setActor(e.target.value)} />
        </label>
        <button type="button" onClick={load}>刷新</button>
      </div>

      {err && <p className="error">{err}</p>}
      {rows && rows.length === 0 && <p>这一天没有记录。</p>}

      {rows && rows.map((r) => (
        <div key={r.id} className={r.is_void ? 'reading voided' : r.jump && !r.verified ? 'reading jump' : 'reading'}>
          <div className="reading-head">
            <strong>{r.walked_at}</strong>　{r.section_code} {r.section_name}　— {r.walked_by}
            {r.is_void && <span className="badge void-badge">已作废</span>}
          </div>
          <div className="reading-body">
            水位 <strong>{r.level_m.toFixed(3)} m</strong>
            {!r.is_void && r.delta_m !== null && (
              <span className={r.jump ? 'badge danger' : 'badge'}>
                较前次 {fmtDelta(r.delta_m)} m{r.jump ? '，超 30cm，是否抄串？' : ''}
              </span>
            )}
            　水色 {r.water_color || '—'}
            {r.flow_ms !== null && <>　流速 {r.flow_ms} m/s</>}
            {r.note && <div>备注：{r.note}</div>}
            {r.is_void && <div className="void-reason">作废原因：{r.void_reason}（{r.voided_by}，{r.voided_at}）</div>}
          </div>

          {!r.is_void && r.jump && !r.verified && (
            <button type="button" className="warn" onClick={() => verify(r)}>标记已核实</button>
          )}
          {!r.is_void && r.verified && (
            <p className="ok">✓ 已核实{r.verify_note ? `：${r.verify_note}` : ''}</p>
          )}

          {editId === r.id ? (
            <div className="edit-panel">
              <strong>修改这条读数</strong>
              <div className="edit-grid">
                <label>
                  巡测时间
                  <input type="datetime-local" value={form.walked_at}
                    onChange={(e) => setForm({ ...form, walked_at: e.target.value })} />
                </label>
                <label>
                  水位标尺（米）
                  <input type="number" step="0.001" min="-10" max="100" value={form.level_m}
                    onChange={(e) => setForm({ ...form, level_m: e.target.value })} />
                </label>
                <label>
                  水色
                  <select value={form.water_color}
                    onChange={(e) => setForm({ ...form, water_color: e.target.value })}>
                    {WATER_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>
                  目估流速（m/s）
                  <input type="number" step="0.1" min="0" max="20" value={form.flow_ms}
                    onChange={(e) => setForm({ ...form, flow_ms: e.target.value })} />
                </label>
                <label className="wide">
                  备注
                  <input value={form.note} maxLength="200"
                    onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
              </div>
              <div className="row actions">
                <button type="button" className="primary" disabled={busy} onClick={() => saveEdit(r.id)}>
                  {busy ? '保存中…' : '保存修改'}
                </button>
                <button type="button" disabled={busy} onClick={() => { setEditId(null); setForm(null); }}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="row actions">
              <button type="button" disabled={busy || r.is_void} onClick={() => startEdit(r)}>修改</button>
              <button type="button" className="danger" disabled={busy} onClick={() => toggleVoid(r)}>
                {r.is_void ? '恢复有效' : '作废'}
              </button>
              <button type="button" onClick={() => toggleAudit(r.id)}>
                {auditOpen[r.id] ? '收起操作记录' : '看操作记录'}
              </button>
            </div>
          )}

          {auditOpen[r.id] && (
            <div className="audit">
              {r.revised_at && (
                <p>最后修改：{r.revised_at}，{r.revised_by || '？'}</p>
              )}
              {!revisions[r.id] && <p>操作记录加载中…</p>}
              {revisions[r.id] && revisions[r.id].length === 0 && <p>还没有修改或作废记录。</p>}
              {revisions[r.id] && revisions[r.id].map((rev) => (
                <details key={rev.id}>
                  <summary>
                    {rev.revised_at}　{rev.revised_by}　{formatRevision(rev)}
                  </summary>
                  <div>{formatChange(rev)}</div>
                  {rev.reason && <div>原因/说明：{rev.reason}</div>}
                </details>
              ))}
            </div>
          )}

          {r.events && r.events.length > 0 && (
            <ul className="event-list">
              {r.events.map((ev) => (
                <li key={ev.id}>
                  {ev.kind === 'outfall' ? '疑似排污口' : '漂浮物'}（{ev.x}, {ev.y}）：
                  {ev.note || '（无备注）'}
                  {ev.photo_path && (
                    <a href={`/uploads/${ev.photo_path}`} target="_blank" rel="noreferrer">
                      <img className="thumb" src={`/uploads/${ev.photo_path}`} alt="现场照片" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
