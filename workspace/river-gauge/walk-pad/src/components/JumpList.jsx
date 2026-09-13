import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const fmtDelta = (d) => (d > 0 ? `+${d.toFixed(3)}` : d.toFixed(3));

/** 跳变清单：同一断面相邻两次水位差超过阈值（默认 30cm）的，单独挑出来 */
export default function JumpList({ sections }) {
  const [threshold, setThreshold] = useState('0.3');
  const [sectionId, setSectionId] = useState('');
  const [pairs, setPairs] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      setPairs(await api.jumps({ threshold, section_id: sectionId }));
    } catch (e) {
      setErr(e.message);
    }
  }, [threshold, sectionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function verify(p) {
    const note = window.prompt('核实情况（怎么追问的、结论）：', '与本人核对，读数无误');
    if (note === null) return;
    try {
      await api.verify(p.curr.id, { verified: true, verify_note: note });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="card">
      <div className="row filters">
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
          阈值
          <select value={threshold} onChange={(e) => setThreshold(e.target.value)}>
            <option value="0.2">20 cm</option>
            <option value="0.3">30 cm</option>
            <option value="0.5">50 cm</option>
          </select>
        </label>
        <button type="button" onClick={load}>刷新</button>
      </div>

      {err && <p className="error">{err}</p>}
      {pairs && pairs.length === 0 && <p>没有超阈值的跳变，账面对得上。</p>}

      {pairs && pairs.length > 0 && (
        <table className="jumps">
          <thead>
            <tr>
              <th>断面</th><th>前一次</th><th>后一次</th><th>水位差</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={`${p.prev.id}-${p.curr.id}`}>
                <td>{p.section_code} {p.section_name}</td>
                <td>{p.prev.walked_at}<br />{p.prev.level_m.toFixed(3)} m（{p.prev.walked_by}）</td>
                <td>{p.curr.walked_at}<br />{p.curr.level_m.toFixed(3)} m（{p.curr.walked_by}）</td>
                <td><span className="badge danger">{fmtDelta(p.delta_m)} m</span></td>
                <td>
                  {p.curr.verified
                    ? <span className="ok">✓ 已核实{p.curr.verify_note ? `：${p.curr.verify_note}` : ''}</span>
                    : <span className="warn-text">待追问</span>}
                </td>
                <td>
                  {!p.curr.verified && (
                    <button type="button" className="warn" onClick={() => verify(p)}>标记已核实</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
