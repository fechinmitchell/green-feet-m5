import { useRef, useState } from 'react';

// Small time-series line chart: one y-axis, thin 2px lines, a recessive grid,
// direct labels at the line ends, and a crosshair tooltip on hover/touch.
// series: [{ name, cls, points: [[t, value], ...] }]

const W = 340, H = 170;
const PAD = { l: 34, r: 44, t: 10, b: 22 };

export default function LineChart({ series, yMin, yMax, unit = '', fmt = (v) => Math.round(v), label }) {
  const ref = useRef(null);
  const [hoverT, setHoverT] = useState(null);
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="hint">Not enough data yet. A point is logged every minute while a stick is connected.</p>;

  const t0 = Math.min(...all.map((p) => p[0]));
  const t1 = Math.max(...all.map((p) => p[0]));
  const ys = all.map((p) => p[1]);
  const lo = yMin ?? Math.floor(Math.min(...ys));
  const hi = yMax ?? Math.ceil(Math.max(...ys));
  const x = (t) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - PAD.t - PAD.b);
  const yTicks = [lo, lo + (hi - lo) / 2, hi];
  const xTicks = [t0, t0 + (t1 - t0) / 2, t1];
  const short = t1 - t0 < 10 * 60000;
  const clock = (t) => new Date(t).toLocaleTimeString([], short ? { hour: 'numeric', minute: '2-digit', second: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
  // End labels: keep them at least 11 px apart so close lines stay readable.
  const ends = series
    .map((s, i) => (s.points.length ? { i, y: y(s.points[s.points.length - 1][1]) + 3 } : null))
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 11) ends[k].y = ends[k - 1].y + 11;
  const labelY = Object.fromEntries(ends.map((e) => [e.i, e.y]));

  function onMove(e) {
    const box = ref.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const frac = Math.min(1, Math.max(0, (px - PAD.l) / (W - PAD.l - PAD.r)));
    setHoverT(t0 + frac * (t1 - t0));
  }
  const nearest = (pts, t) => pts.reduce((best, p) => (Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best), pts[0]);
  const hover = hoverT != null ? series.filter((s) => s.points.length).map((s) => ({ s, p: nearest(s.points, hoverT) })) : [];
  const hx = hover.length ? x(hover[0].p[0]) : null;

  return (
    <div className="chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHoverT(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="c-grid" />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="c-tick">
              {fmt(v)}
              {unit}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="c-tick">
            {clock(t)}
          </text>
        ))}
        {series.map((s, si) =>
          s.points.length ? (
            <g key={s.name}>
              <polyline points={s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} className={`c-line ${s.cls}`} />
              <text x={x(s.points[s.points.length - 1][0]) + 5} y={labelY[si]} className="c-label">
                {s.name}
              </text>
            </g>
          ) : null
        )}
        {hx != null && (
          <>
            <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} className="c-cross" />
            {hover.map(({ s, p }) => (
              <circle key={s.name} cx={x(p[0])} cy={y(p[1])} r="4" className={`c-dot ${s.cls}`} />
            ))}
          </>
        )}
      </svg>
      {hover.length > 0 && (
        <div className="c-tip" style={{ left: `${(hx / W) * 100}%` }}>
          <b>{clock(hover[0].p[0])}</b>
          {hover.map(({ s, p }) => (
            <span key={s.name}>
              <i className={`c-swatch ${s.cls}`} /> {s.name}: {fmt(p[1])}
              {unit}
            </span>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="c-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i className={`c-swatch ${s.cls}`} /> {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
