import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(3)}` : d.toFixed(3));

export default function HistoryView({ sections }) {
  const [date, setDate] = useState(today());
  const [sectionId, setSectionId] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      setRows(await api.readings({ date, section_id: sectionId }));
    } catch (e) {
      setErr(e.message);
    }
  }, [date, sectionId]);

  useEffect(() => {
    load();
  }, [load]);

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
        <button type="button" onClick={load}>刷新</button>
      </div>

      {err && <p className="error">{err}</p>}
      {rows && rows.length === 0 && <p>这一天没有记录。</p>}

      {rows && rows.map((r) => (
        <div key={r.id} className={r.jump && !r.verified ? 'reading jump' : 'reading'}>
          <div className="reading-head">
            <strong>{r.walked_at}</strong>　{r.section_code} {r.section_name}　— {r.walked_by}
          </div>
          <div className="reading-body">
            水位 <strong>{r.level_m.toFixed(3)} m</strong>
            {r.delta_m !== null && (
              <span className={r.jump ? 'badge danger' : 'badge'}>
                较前次 {fmtDelta(r.delta_m)} m{r.jump ? '，超 30cm，是否抄串？' : ''}
              </span>
            )}
            　水色 {r.water_color || '—'}
            {r.flow_ms !== null && <>　流速 {r.flow_ms} m/s</>}
            {r.note && <div>备注：{r.note}</div>}
          </div>

          {r.jump && !r.verified && (
            <button type="button" className="warn" onClick={() => verify(r)}>标记已核实</button>
          )}
          {r.verified && (
            <p className="ok">✓ 已核实{r.verify_note ? `：${r.verify_note}` : ''}</p>
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
