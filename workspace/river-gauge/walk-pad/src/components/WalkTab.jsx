import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import SketchMap from './SketchMap.jsx';

const WATER_COLORS = ['清', '微浑', '浑浊', '泛黄', '发黑', '其他'];

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // datetime-local 要这个格式
}
const toSql = (dt) => dt.replace('T', ' ') + ':00';
const today = () => nowLocal().slice(0, 10);

export default function WalkTab({ sketch, walkers, onSavedReading }) {
  // 读数表单：到断面先选编号
  const [sectionId, setSectionId] = useState('');
  const [walkedAt, setWalkedAt] = useState(nowLocal());
  const [walkedBy, setWalkedBy] = useState('');
  const [level, setLevel] = useState('');
  const [color, setColor] = useState('清');
  const [flow, setFlow] = useState('');
  const [note, setNote] = useState('');

  const [reading, setReading] = useState(null); // 刚保存的读数，标注挂在它上面
  const [events, setEvents] = useState([]);     // 今天全组的标注
  const [pending, setPending] = useState(null); // 简图上刚点出来、还没保存的点
  const [kind, setKind] = useState('debris');
  const [evNote, setEvNote] = useState('');
  const [photo, setPhoto] = useState(null);

  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshEvents = useCallback(async () => {
    try {
      setEvents(await api.events({ date: today() }));
    } catch {
      /* 列表刷新失败不打断记录 */
    }
  }, []);
  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  async function saveReading(e) {
    e.preventDefault();
    if (!sectionId) return setMsg('先选断面编号');
    setBusy(true);
    setMsg('');
    try {
      const r = await api.saveReading({
        section_id: Number(sectionId),
        walked_at: toSql(walkedAt),
        walked_by: walkedBy.trim(),
        level_m: Number(level),
        water_color: color,
        flow_ms: flow === '' ? null : Number(flow),
        note: note.trim(),
      });
      setReading(r);
      setPending(null);
      setMsg(`已保存 ${r.section_code} ${r.walked_at} 的读数，可以在下面简图上点位置标注`);
      setLevel('');
      setFlow('');
      setNote('');
      setWalkedAt(nowLocal());
      onSavedReading && onSavedReading();
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function handleMapClick(p) {
    if (!reading) {
      setMsg('先保存本次读数，再在简图上标注');
      return;
    }
    setPending(p);
  }

  // 换断面（下拉框、点简图圆圈都走这里）：刚保存的读数还挂在旧断面上时，
  // 必须先解绑，否则接下来在河面落点会挂到上一次已保存的读数上
  function selectSection(id) {
    const nextId = Number(id);
    if (reading && reading.section_id !== nextId) {
      setReading(null);
      setPending(null);
      setMsg('已切换断面，先保存本次读数，再在简图上标注');
    }
    setSectionId(String(id));
  }

  async function saveEvent() {
    if (!reading || !pending) return;
    setBusy(true);
    setMsg('');
    try {
      const ev = await api.saveEvent({
        reading_id: reading.id,
        kind,
        x: pending.x,
        y: pending.y,
        note: evNote.trim(),
      });
      if (photo) await api.uploadPhoto(ev.id, photo);
      setPending(null);
      setEvNote('');
      setPhoto(null);
      setMsg('标注已保存');
      refreshEvents();
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="walk">
      <form className="card form" onSubmit={saveReading}>
        <div className="row">
          <label>
            断面编号
            <select value={sectionId} onChange={(e) => selectSection(e.target.value)} required>
              <option value="">— 先选编号 —</option>
              {sketch.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.code} {s.name}</option>
              ))}
              </select>
          </label>
          <label>
            巡测时间
            <input type="datetime-local" value={walkedAt}
              onChange={(e) => setWalkedAt(e.target.value)} required />
          </label>
          <label>
            巡测人
            <input value={walkedBy} onChange={(e) => setWalkedBy(e.target.value)}
              list="walkers" placeholder="谁跑的" required />
            <datalist id="walkers">
              {walkers.map((w) => <option key={w} value={w} />)}
            </datalist>
          </label>
        </div>
        <div className="row">
          <label>
            水位标尺（米）
            <input type="number" step="0.001" min="-10" max="100" value={level}
              onChange={(e) => setLevel(e.target.value)} placeholder="如 1.245" required />
          </label>
          <label>
            水色
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              {WATER_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            目估流速（m/s）
            <input type="number" step="0.1" min="0" max="20" value={flow}
              onChange={(e) => setFlow(e.target.value)} placeholder="可空" />
          </label>
        </div>
        <label>
          备注（一句话）
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength="200"
            placeholder="如：雨后水浑、桥墩旁有泡沫带" />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? '保存中…' : '保存读数'}
        </button>
        {msg && <p className="msg">{msg}</p>}
      </form>

      <div className="card">
        <h2>河道简图（本地坐标，不接在线地图）</h2>
        <p className="hint">
          点断面圆圈 = 选编号；{reading ? '点河面 = 标漂浮物 / 疑似排污口' : '保存读数后才能标注'}。
          橙点 = 漂浮物，红方块 = 疑似排污口。
        </p>
        <SketchMap
          features={sketch.features}
          sections={sketch.sections}
          selectedId={Number(sectionId) || (reading && reading.section_id)}
          onSelectSection={(id) => selectSection(String(id))}
          events={events}
          pending={pending}
          onMapClick={handleMapClick}
        />

        {pending && (
          <div className="event-panel">
            <strong>新标注（{pending.x}, {pending.y}）</strong>
            <div className="row">
              <label>
                <input type="radio" name="kind" checked={kind === 'debris'}
                  onChange={() => setKind('debris')} /> 漂浮物
              </label>
              <label>
                <input type="radio" name="kind" checked={kind === 'outfall'}
                  onChange={() => setKind('outfall')} /> 疑似排污口
              </label>
            </div>
            <input value={evNote} onChange={(e) => setEvNote(e.target.value)} maxLength="200"
              placeholder="一句话备注，如：桥墩旁泡沫带" />
            <input type="file" accept="image/*" capture="environment"
              onChange={(e) => setPhoto(e.target.files[0] || null)} />
            <div className="row">
              <button type="button" className="primary" onClick={saveEvent} disabled={busy}>
                保存标注{photo ? '（含照片）' : ''}
              </button>
              <button type="button" onClick={() => setPending(null)}>取消</button>
            </div>
          </div>
        )}

        {events.length > 0 && (
          <details>
            <summary>今天已标 {events.length} 处</summary>
            <ul className="event-list">
              {events.map((ev) => (
                <li key={ev.id}>
                  [{ev.section_code}] {ev.kind === 'outfall' ? '疑似排污口' : '漂浮物'}：
                  {ev.note || '（无备注）'} — {ev.walked_by || '？'}
                  {ev.photo_path && (
                    <> <a href={`/uploads/${ev.photo_path}`} target="_blank" rel="noreferrer">照片</a></>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
