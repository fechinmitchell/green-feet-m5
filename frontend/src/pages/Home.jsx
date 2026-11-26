import { Link } from 'react-router-dom';
import { useHub, useStore } from '../hooks.js';
import { SPEEDS } from '../lib/slope.js';

export default function Home() {
  const hub = useHub();
  const { settings, calibration, putts } = useStore();
  const connected = hub.connected.length;
  const calibrated = ['L', 'R'].filter((s) => calibration[s]).length;
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
