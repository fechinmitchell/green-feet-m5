import { Link, NavLink } from 'react-router-dom';
import { useHub } from '../hooks.js';

export function Layout({ children }) {
  const hub = useHub();
  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Green Feet
        </Link>
        <div className="top-sticks" aria-label="Stick status">
          {['L', 'R'].map((side) => {
            const s = hub.bySide(side);
            return (
              <Link to="/connect" key={side} className={`pill ${s ? 'on' : ''}`}>
                <span className="dot" /> {side}
                {s?.battery != null && <small>{s.battery}%</small>}
              </Link>
            );
          })}
        </div>
      </header>
      {hub.demo && <div className="demo-banner">Demo mode · simulated sticks</div>}
      <main className="page">{children}</main>
      <nav className="tabs">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/putt">Putt</NavLink>
        <NavLink to="/progress">Progress</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </div>
  );
}

export function Chips({ options, value, onChange, label }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === o.value}
          key={String(o.value)}
          className={`chip ${value === o.value ? 'on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bubble level for one foot. cross/along in percent. */
export function Level({ label, data }) {
  const max = 5; // % at the edge of the circle
  const x = data?.cross != null ? Math.max(-1, Math.min(1, data.cross / max)) : 0;
  const y = data?.along != null ? Math.max(-1, Math.min(1, data.along / max)) : 0;
  const moving = (data?.motion ?? 1) > 0.025;
  return (
    <figure className="level">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" className="lv-ring" />
        <circle cx="50" cy="50" r="18" className="lv-mid" />
        <line x1="50" y1="6" x2="50" y2="94" className="lv-mid" />
        <line x1="6" y1="50" x2="94" y2="50" className="lv-mid" />
        {data?.cross != null && <circle cx={50 + x * 40} cy={50 - y * 40} r="9" className={`lv-bubble ${moving ? 'moving' : ''}`} />}
      </svg>
      <figcaption>
        <b>{label}</b>
        <span className="mono">{data?.cross != null ? `${fmt(data.cross)}% side · ${fmt(data.along)}% toe` : data ? 'not calibrated' : 'no stick'}</span>
      </figcaption>
    </figure>
  );
}

/** Fingers held against the hole, stacked toward the high side. */
export function Fingers({ count, highSide }) {
  const n = Math.max(0, Math.min(6, count));
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  const w = 16, gap = 2;
  const holeX = 110;
  const dir = highSide === 'left' ? -1 : 1;
  const fingers = [];
  for (let i = 0; i < whole + (half ? 1 : 0); i++) {
    const isHalf = half && i === whole;
    const fw = isHalf ? w / 2 : w;
    const x = dir > 0 ? holeX + i * (w + gap) : holeX - i * (w + gap) - fw;
    fingers.push(<rect key={i} x={x} y="14" width={fw} height="66" rx={isHalf ? 3 : 7} className="finger" />);
  }
  const span = whole * (w + gap) + (half ? w / 2 : 0);
  const aimX = n === 0 ? holeX : dir > 0 ? holeX + span : holeX - span;
  return (
    <svg viewBox="0 0 220 110" className="fingers" role="img" aria-label={`${count} fingers, aim at the ${highSide || 'centre'} edge`}>
      <ellipse cx={holeX} cy="92" rx="14" ry="5" className="hole" />
      <line x1={holeX} y1="84" x2={holeX} y2="100" className="hole-c" />
      {fingers}
      <line x1={aimX} y1="2" x2={aimX} y2="104" className="aim" />
      <text x={aimX + (dir > 0 ? 4 : -4)} y="10" textAnchor={dir > 0 ? 'start' : 'end'} className="aim-t">
        aim here
      </text>
    </svg>
  );
}

export function fmt(x) {
  return (Math.round(x * 10) / 10).toFixed(1);
}
