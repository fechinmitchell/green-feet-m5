import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useHub, useBatteryEstimates } from '../hooks.js';
import { formatMinutes } from '../lib/battery.js';
import { Battery } from '../components/ui.jsx';

export default function Connect() {
  const hub = useHub();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const est = useBatteryEstimates();

  async function pair() {
    setError('');
    setBusy(true);
    try {
      const stick = await hub.pair();
      if (stick.side === '?') {
        // A side we don't have yet is the obvious guess.
        const free = ['L', 'R'].find((s) => !hub.bySide(s));
        if (free) stick.setSide(free);
      }
    } catch (e) {
      if (e?.name !== 'NotFoundError') setError(e.message || String(e)); // NotFoundError = picker cancelled
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Connect</h1>

      {!hub.supported && (
        <div className="note warn">
          <b>This browser can’t use Bluetooth.</b> On iPhone, install the free <b>Bluefy</b> browser from the App Store and open this page in it. You can still try the app in Demo mode.
        </div>
      )}

      {['L', 'R'].map((side) => {
        const s = hub.sticks.find((x) => x.side === side);
        return (
          <div className="card row-between" key={side}>
            <div>
              <b>{side === 'L' ? 'Left foot' : 'Right foot'}</b>
              <div className="mono">
                {s ? `${s.kind === 'demo' ? 'demo' : 'id ' + s.id} · ${s.connected ? 'connected' : 'reconnecting…'}${s.fw && s.kind !== 'demo' ? ' · fw ' + s.fw : ''}` : 'not connected'}
              </div>
              {s?.connected && est[side] && <TimeLeft e={est[side]} />}
            </div>
            <div className="row">
              {s && <Battery pct={s.battery} charging={s.charging} big />}
              <span className={`dot big ${s?.connected ? 'on' : ''}`} />
            </div>
          </div>
        );
      })}

      {hub.sticks
        .filter((s) => s.connected)
        .map((s) => (
          <div className="card" key={s.id}>
            <div className="row-between">
              <span>
                Stick <b>{s.id}</b> is on my…
              </span>
              <div className="chips">
                {['L', 'R'].map((side) => (
                  <button key={side} className={`chip ${s.side === side ? 'on' : ''}`} onClick={() => s.setSide(side)}>
                    {side === 'L' ? 'Left' : 'Right'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}

      <button className="btn primary" onClick={pair} disabled={busy || !hub.supported}>
        {busy ? 'Looking for sticks…' : '+ Pair a stick'}
      </button>
      {error && <p className="error">{error}</p>}

      <div className="tip">
        <b>Fitting the sticks:</b> clip each stick to the <b>outside</b> of the shoe, screen facing out, long side along the shoe. Make it tight. If a stick moves, calibrate again. The 4-letter id on the stick’s screen tells you which is which.
      </div>

      <div className="row-between">
        <button className="btn ghost" onClick={() => hub.startDemo()}>
          Try Demo mode
        </button>
        <Link to="/calibrate" className="btn">
          Next: calibrate →
        </Link>
      </div>
    </div>
  );
}

function TimeLeft({ e }) {
  if (e.charging) return <div className="time-left">Charging</div>;
  return (
    <div className="time-left">
      <b>≈ {formatMinutes(e.minutes)}</b> left
      <small>{e.source === 'measured' ? ' · measured' : e.source === 'learned' ? ' · from last time' : ' · rough guess until it has run 10 min'}</small>
    </div>
  );
}
