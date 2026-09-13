-- river-gauge 数据库初始化
-- 只在数据卷第一次创建时执行（docker-entrypoint-initdb.d 的机制）

CREATE DATABASE IF NOT EXISTS river_gauge
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE river_gauge;

-- 断面：编号、名称、在本地简图上的坐标（0~1000 x 0~620 的自有坐标系，不接在线地图）
CREATE TABLE IF NOT EXISTS sections (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  code  VARCHAR(20) NOT NULL UNIQUE,   -- 断面编号，如 RG-02
  name  VARCHAR(50) NOT NULL,          -- 断面名称，如 老桥桥墩
  x     DECIMAL(7,1) NOT NULL,
  y     DECIMAL(7,1) NOT NULL,
  sort  INT NOT NULL DEFAULT 0
);

-- 河道简图要素：全部存在自己库里，前端用 SVG 本地渲染
-- ftype: centerline 河中线 / bank 岸线 / bridge 桥 / pump 泵站
-- points: JSON 数组 [[x,y],...]，线要素按顺序连线，点要素取第一个点
CREATE TABLE IF NOT EXISTS sketch_features (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  ftype  VARCHAR(20) NOT NULL,
  label  VARCHAR(50) DEFAULT NULL,
  points JSON NOT NULL
);

-- 巡测读数：一次到断面抄的一条记录
CREATE TABLE IF NOT EXISTS readings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  section_id  INT NOT NULL,
  walked_at   DATETIME NOT NULL,                 -- 巡测时间（可补录）
  walked_by   VARCHAR(20) NOT NULL,              -- 巡测人
  level_m     DECIMAL(6,3) NOT NULL,             -- 水位标尺读数，米
  water_color VARCHAR(20) NOT NULL DEFAULT '',   -- 水色
  flow_ms     DECIMAL(4,2) DEFAULT NULL,         -- 目估流速 m/s
  note        VARCHAR(200) NOT NULL DEFAULT '',
  verified    TINYINT(1) NOT NULL DEFAULT 0,     -- 跳变核实标记
  verify_note VARCHAR(200) NOT NULL DEFAULT '',
  verified_at DATETIME DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_section_time (section_id, walked_at),
  INDEX idx_walked_at (walked_at),
  FOREIGN KEY (section_id) REFERENCES sections(id)
);

-- 简图标注：漂浮物 / 疑似排污口，挂在某次读数上，照片存文件、库里存路径
CREATE TABLE IF NOT EXISTS map_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  reading_id INT DEFAULT NULL,
  section_id INT NOT NULL,
  kind       VARCHAR(20) NOT NULL,               -- debris 漂浮物 / outfall 疑似排污口
  x          DECIMAL(7,1) NOT NULL,
  y          DECIMAL(7,1) NOT NULL,
  note       VARCHAR(200) NOT NULL DEFAULT '',
  photo_path VARCHAR(200) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reading (reading_id),
  INDEX idx_section (section_id),
  FOREIGN KEY (reading_id) REFERENCES readings(id) ON DELETE SET NULL,
  FOREIGN KEY (section_id) REFERENCES sections(id)
);

-- ---------- 种子数据：断面（按贵站实际断面改这里，或之后用 SQL 增删） ----------
INSERT INTO sections (code, name, x, y, sort) VALUES
  ('RG-01', '上游入口',   150, 290, 1),
  ('RG-02', '老桥桥墩',   430, 330, 2),
  ('RG-03', '弯道',       700, 420, 3),
  ('RG-04', '泵站下游',   880, 428, 4);

-- ---------- 种子数据：河道简图（坐标系 0~1000 × 0~620，纯本地） ----------
INSERT INTO sketch_features (ftype, label, points) VALUES
  ('centerline', '河中线', '[[0,300],[150,290],[300,300],[430,330],[560,380],[700,420],[850,430],[1000,420]]'),
  ('bank',       '左岸',   '[[0,258],[150,248],[300,260],[430,290],[560,342],[700,384],[850,394],[1000,384]]'),
  ('bank',       '右岸',   '[[0,342],[150,332],[300,340],[430,370],[560,418],[700,456],[850,466],[1000,456]]'),
  ('bridge',     '老桥',   '[[430,282],[430,378]]'),
  ('pump',       '泵站',   '[[880,372]]');

-- 演示数据（需要时取消注释）：
-- INSERT INTO readings (section_id, walked_at, walked_by, level_m, water_color, flow_ms, note) VALUES
--   (1, '2026-09-11 08:30:00', '张三', 1.245, '清', 0.4, ''),
--   (1, '2026-09-12 08:30:00', '李四', 1.580, '微浑', 0.6, '雨后');
