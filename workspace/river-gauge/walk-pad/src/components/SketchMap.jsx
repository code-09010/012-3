import { useRef } from 'react';

/**
 * 本地河道简图：坐标全部来自自己库里的 sketch_features / sections，
 * 纯 SVG 渲染，不接任何在线地图。
 */

function pts(points) {
  return points.map((p) => p.join(',')).join(' ');
}

function Feature({ f }) {
  const p = f.points;
  if (f.ftype === 'centerline') {
    return <polyline points={pts(p)} fill="none" stroke="#3a86d4" strokeWidth="12"
      strokeLinecap="round" opacity="0.5" />;
  }
  if (f.ftype === 'bank') {
    return <polyline points={pts(p)} fill="none" stroke="#7d99b8" strokeWidth="2.5"
      strokeDasharray="8 5" />;
  }
  if (f.ftype === 'bridge') {
    const [[x1, y1], [x2, y2]] = p;
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#666" strokeWidth="9" />
        <text x={x1 + 8} y={(y1 + y2) / 2} className="map-label">{f.label}</text>
      </g>
    );
  }
  if (f.ftype === 'pump') {
    const [x, y] = p[0];
    return (
      <g>
        <rect x={x - 8} y={y - 8} width="16" height="16" fill="#8a6d3b" />
        <text x={x} y={y - 14} textAnchor="middle" className="map-label">{f.label}</text>
      </g>
    );
  }
  return null;
}

function EventMark({ ev }) {
  const label = ev.kind === 'outfall' ? '疑似排污口' : '漂浮物';
  return (
    <g transform={`translate(${ev.x},${ev.y})`}>
      {ev.kind === 'outfall' ? (
        <rect x="-7" y="-7" width="14" height="14" fill="#d33" stroke="#fff" strokeWidth="2" />
      ) : (
        <circle r="7" fill="#e08a00" stroke="#fff" strokeWidth="2" />
      )}
      <title>{`${label}：${ev.note || '（无备注）'}`}</title>
    </g>
  );
}

export default function SketchMap({
  features = [],
  sections = [],
  selectedId,
  onSelectSection,
  events = [],
  pending,
  onMapClick,
}) {
  const ref = useRef(null);

  // 屏幕坐标 → 简图自有坐标（viewBox 0 0 1000 620）
  function handleClick(e) {
    if (!onMapClick) return;
    const svg = ref.current;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    onMapClick({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  }

  return (
    <svg ref={ref} viewBox="0 0 1000 620" className="sketch" onClick={handleClick}>
      <rect x="0" y="0" width="1000" height="620" fill="#f4f8fb" />
      <text x="24" y="44" className="map-label">流向 →</text>

      {features.map((f) => <Feature key={f.id} f={f} />)}

      {sections.map((s) => (
        <g
          key={s.id}
          transform={`translate(${s.x},${s.y})`}
          className="sec-node"
          onClick={(e) => {
            e.stopPropagation(); // 点断面是选编号，不是落标注
            onSelectSection && onSelectSection(s.id);
          }}
        >
          <circle r="16"
            fill={s.id === selectedId ? '#ffb020' : '#fff'}
            stroke="#1f6fb2" strokeWidth="3" />
          <text y="36" textAnchor="middle" className="sec-label">{s.code}</text>
        </g>
      ))}

      {events.map((ev) => <EventMark key={ev.id} ev={ev} />)}

      {pending && (
        <g transform={`translate(${pending.x},${pending.y})`}>
          <circle r="13" fill="none" stroke="#d33" strokeWidth="3" strokeDasharray="4 3" />
        </g>
      )}
    </svg>
  );
}
