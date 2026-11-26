import { Link, NavLink } from 'react-router-dom';
import { useEffect } from 'react';
import { useHub, useBatteryEstimates, useBatteryLogger, useStore } from '../hooks.js';
import { formatMinutes } from '../lib/battery.js';

export function Layout({ children }) {
  const hub = useHub();
  const est = useBatteryEstimates();
  useBatteryLogger();
  const { settings } = useStore();
  useEffect(() => hub.setKeepAwake(!settings.napBetween), [hub, settings.napBetween]);
  const low = hub.connected.filter((s) => s.battery != null && !s.charging && (s.battery < 15 || (est[s.side]?.minutes ?? 999) < 30));
  const dropped = hub.sticks.filter((s) => !s.connected && s.kind === 'real' && !s.asleep && !s.napping);
  const asleep = hub.sticks.filter((s) => !s.connected && s.kind === 'real' && s.asleep);
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
              <Link to={s ? '/battery' : '/connect'} key={side} className={`pill ${s ? 'on' : ''}`} aria-label={`${side === 'L' ? 'Left' : 'Right'} stick: ${s ? `${s.battery ?? '?'}% battery${s.charging ? ', charging' : ''}` : 'not connected'}`}>
                <b>{side}</b>
                {s ? <Battery pct={s.battery} charging={s.charging} /> : hub.known(side)?.napping ? <small>napping</small> : <small>off</small>}
              </Link>
            );
          })}
        </div>
      </header>
      {hub.demo && <div className="demo-banner">Demo mode · simulated sticks</div>}
      {asleep.map((s) => (
        <div key={s.id} className="info-banner">
          {s.side === 'L' ? 'Left' : s.side === 'R' ? 'Right' : s.id} stick is off. Hold A for 1 second to turn it on, and it reconnects by itself.
        </div>
      ))}
      {dropped.map((s) => (
        <Link to="/connect" key={s.id} className="alert-banner">
          {s.side === 'L' ? 'Left' : s.side === 'R' ? 'Right' : s.id} stick lost connection, reconnecting…
        </Link>
      ))}
      {low.map((s) => (
        <Link to="/battery" key={s.id} className="alert-banner">
          {s.side === 'L' ? 'Left' : 'Right'} stick battery low: {s.battery}%, about {formatMinutes(est[s.side]?.minutes)} left. Charge it with USB-C.
        </Link>
      ))}
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

/** Small battery gauge: fill shows charge, colour warns when low. */
export function Battery({ pct, charging, big = false }) {
  const level = pct == null ? 'unknown' : charging ? 'charging' : pct < 15 ? 'low' : pct < 35 ? 'mid' : 'ok';
  const fill = pct == null ? 0 : Math.max(4, Math.min(100, pct));
  return (
    <span className={`battery ${level} ${big ? 'big' : ''}`}>
      <svg viewBox="0 0 26 14" aria-hidden="true">
        <rect x="1" y="1" width="21" height="12" rx="3" className="b-shell" />
        <rect x="23" y="4.5" width="2" height="5" rx="1" className="b-tip" />
        <rect x="3" y="3" width={(17 * fill) / 100} height="8" rx="1.5" className="b-fill" />
        {charging && <path d="M12.5 2.5 L8.5 7.6 H11.5 L10.5 11.5 L14.5 6.4 H11.5 Z" className="b-bolt" />}
      </svg>
      <small>{pct == null ? '–' : `${pct}%`}</small>
    </span>
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

/**
 * Fingers held up at arm's length (AimPoint style): the edge of the first finger
 * sits on the centre of the hole, the rest stack toward the high side, and you
 * aim at the outer edge of the last finger.
 */
export function Fingers({ count, highSide }) {
  const n = Math.max(0, Math.min(6, count));
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  const w = 16, gap = 2;
  const holeX = 120;
  const dir = highSide === 'left' ? -1 : 1;
  const fingers = [];
  let outer = holeX; // outer edge of the last finger
  for (let i = 0; i < whole + (half ? 1 : 0); i++) {
    const isHalf = half && i === whole;
    const fw = isHalf ? w / 2 : w;
    const x = dir > 0 ? holeX + i * (w + gap) : holeX - i * (w + gap) - fw;
    outer = dir > 0 ? x + fw : x;
    fingers.push(<rect key={i} x={x} y="22" width={fw} height="62" rx={isHalf ? 3 : 7} className="finger" />);
  }
  const aimX = n === 0 ? holeX : outer;
  return (
    <svg viewBox="0 0 240 132" className="fingers" role="img" aria-label={n ? `${count} fingers: first finger edge on the hole centre, stacked to the ${highSide}, aim at the outer edge` : 'Aim at the centre of the hole'}>
      {/* the cup, seen beyond your fingers */}
      <ellipse cx={holeX} cy="104" rx="18" ry="5.5" className="hole" />
      <line x1={holeX} y1="14" x2={holeX} y2="112" className="hole-c" />
      <text x={holeX} y="126" textAnchor="middle" className="cap-t">
        hole centre
      </text>
      {fingers}
      {n > 0 && (
        <>
          <line x1={aimX} y1="12" x2={aimX} y2="112" className="aim" />
          <text x={aimX + (dir > 0 ? 4 : -4)} y="10" textAnchor={dir > 0 ? 'start' : 'end'} className="aim-t">
            aim here
          </text>
        </>
      )}
    </svg>
  );
}

export function fmt(x) {
  return (Math.round(x * 10) / 10).toFixed(1);
}
