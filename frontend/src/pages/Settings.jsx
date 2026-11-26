import { Link } from 'react-router-dom';
import { useStore } from '../hooks.js';
import { store } from '../lib/store.js';
import { SPEEDS } from '../lib/slope.js';
import { Chips } from '../components/ui.jsx';

export default function Settings() {
  const { settings } = useStore();
  return (
    <div className="stack">
      <h1>Today’s greens</h1>

      <div className="card">
        <b>Green speed</b>
        <Chips
          label="Green speed"
          value={settings.speed}
          onChange={(speed) => store.setSettings({ speed })}
          options={Object.entries(SPEEDS).map(([value, s]) => ({ value, label: `${s.label} ${s.stimp}` }))}
        />
        <small className="hint">Faster greens break more, so the finger count goes up. Numbers are the stimpmeter reading. Most club greens are around 9–10.</small>
      </div>

      <div className="card">
        <b>Mode</b>
        <Chips
          label="Mode"
          value={settings.mode}
          onChange={(mode) => store.setSettings({ mode })}
          options={[
            { value: 'learn', label: 'Learn' },
            { value: 'read', label: 'Just read' },
          ]}
        />
        <small className="hint">Learn asks for your guess before showing the reading, so your feet get trained.</small>
      </div>

      <details className="card">
        <summary>
          <b>Fine-tuning</b>
        </summary>
        <label htmlFor="fs" className="row-between">
          <span>Finger scale</span>
          <b>{settings.fingerScale.toFixed(2)}×</b>
        </label>
        <input id="fs" type="range" min="0.6" max="1.6" step="0.05" value={settings.fingerScale} onChange={(e) => store.setSettings({ fingerScale: Number(e.target.value) })} />
        <small className="hint">If you always miss low, nudge this up. If you always miss high, nudge it down.</small>
        <label htmlFor="hw" className="row-between">
          <span>Hole-end weight (two readings)</span>
          <b>{Math.round(settings.holeWeight * 100)}%</b>
        </label>
        <input id="hw" type="range" min="0.5" max="0.85" step="0.05" value={settings.holeWeight} onChange={(e) => store.setSettings({ holeWeight: Number(e.target.value) })} />
      </details>

      <Link to="/calibrate" className="btn">
        Calibrate sticks
      </Link>
      <Link to="/admin" className="btn ghost">
        Admin: update sticks &amp; data
      </Link>
    </div>
  );
}
