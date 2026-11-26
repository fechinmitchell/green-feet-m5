import { Link } from 'react-router-dom';
import { useHub, useStore, useBatteryEstimates } from '../hooks.js';
import { formatMinutes, MIN_PER_HOLE } from '../lib/battery.js';
import { SPEEDS } from '../lib/slope.js';

export default function Home() {
  const hub = useHub();
  const { settings, calibration, putts } = useStore();
  const connected = hub.connected.length;
  const calibrated = ['L', 'R'].filter((s) => calibration[s]).length;
  const est = useBatteryEstimates();
  const running = Object.entries(est).filter(([, e]) => !e.charging && e.minutes != null);
  const weakest = running.sort((a, b) => a[1].minutes - b[1].minutes)[0];
  const today = putts.filter((p) => new Date(p.at).toDateString() === new Date().toDateString()).length;

  const steps = [
    { done: connected === 2, to: '/connect', title: 'Connect sticks', text: connected ? `${connected} of 2 connected` : 'Pair your left and right sticks' },
    { done: calibrated === 2, to: '/calibrate', title: 'Calibrate', text: calibrated ? `Done ${ago(Math.min(...['L', 'R'].filter((s) => calibration[s]).map((s) => calibration[s].at)))}` : 'Stand, lift toes, turn around' },
    { done: true, to: '/settings', title: 'Green speed', text: `${SPEEDS[settings.speed].label} (stimp ~${SPEEDS[settings.speed].stimp}) · ${settings.mode === 'learn' ? 'Learn mode' : 'Just read'}` },
  ];
  const ready = connected > 0 && ['L', 'R'].some((s) => calibration[s] && hub.bySide(s));

  return (
    <div className="stack">
      <section className="hero">
        <h1>Read the green with your feet.</h1>
        <p>Straddle the line, press the button on your stick, and Green Feet tells you the slope and how many fingers to aim. Guess first and your feet learn to do it without the sticks.</p>
      </section>

      <ol className="checklist">
        {steps.map((s) => (
          <li key={s.title}>
            <Link to={s.to} className={`check ${s.done ? 'done' : ''}`}>
              <span className="tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
              <span>
                <b>{s.title}</b>
                <small>{s.text}</small>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {weakest && (
        <div className={`card row-between battery-card ${weakest[1].minutes < 60 ? 'warn' : ''}`}>
          <span>
            <b>Battery: ≈ {formatMinutes(weakest[1].minutes)}</b>
            <small> · about {Math.max(0, Math.floor(weakest[1].minutes / MIN_PER_HOLE))} holes</small>
          </span>
          <span className="mono">
            {running.length > 1 ? `${weakest[0] === 'L' ? 'left' : 'right'} stick runs out first` : `${weakest[0] === 'L' ? 'left' : 'right'} stick`}
          </span>
        </div>
      )}

      <Link to="/putt" className={`btn primary big ${ready ? '' : 'disabled'}`} aria-disabled={!ready}>
        Start a putt
      </Link>
      {!ready && <p className="hint">Connect and calibrate at least one stick to start.</p>}
      {today > 0 && <p className="hint">{today} putt{today === 1 ? '' : 's'} read today.</p>}
    </div>
  );
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
