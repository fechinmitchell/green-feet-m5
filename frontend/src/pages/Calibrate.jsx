import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHub, useStickButton, useStore } from '../hooks.js';
import { solveCalibration } from '../lib/slope.js';
import { store } from '../lib/store.js';
import { fmt } from '../components/ui.jsx';

const STEPS = [
  { key: 'flat', title: 'Stand still', text: 'Stand with your feet shoulder-width apart, weight even, facing any direction.', stick: ['CAL 1/3', 'STAND', 'still, then\npress A'], seconds: 2 },
  { key: 'heels', title: 'Lift your toes', text: 'Stay on the same spot. Rock back onto your heels so your toes lift about a hand-width, and hold.', stick: ['CAL 2/3', 'TOES', 'lift toes,\npress A'], seconds: 1.5 },
  { key: 'turned', title: 'Turn around', text: 'Feet flat again. Turn 180° on exactly the same spot, so your feet land where they were but facing the other way.', stick: ['CAL 3/3', 'TURN', 'turn 180,\npress A'], seconds: 2 },
];

export default function Calibrate() {
  const hub = useHub();
  const { calibration } = useStore();
  const [step, setStep] = useState(0);
  const [poses, setPoses] = useState({});
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);
  const spotRef = useRef({ cross: Math.random() * 4 - 2, along: Math.random() * 4 - 2 }); // demo only

  const current = STEPS[step];
  const sides = hub.connected.map((s) => s.side).filter((s) => s === 'L' || s === 'R');

  useEffect(() => {
    if (result) hub.display('CAL', 'OK', 'all set');
    else if (current) hub.display(...current.stick);
    // Demo: put the simulated feet in the pose this step asks for.
    const spot = spotRef.current;
    if (current?.key === 'flat') hub.demoPose(spot);
    if (current?.key === 'heels') hub.demoPose({ cross: spot.cross, along: spot.along + 15 });
    if (current?.key === 'turned') hub.demoPose({ cross: -spot.cross, along: -spot.along });
  }, [step, result, hub, current]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function capture() {
    if (progress != null || !current) return;
    setError('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    hub.display(current.stick[0], 'HOLD', 'stay still');
    try {
      const got = await hub.capture({ seconds: current.seconds, signal: ctrl.signal, onProgress: (f) => setProgress(f) });
      hub.beep(3400, 120);
      const next = { ...poses, [current.key]: got };
      setPoses(next);
      if (step < STEPS.length - 1) {
        setStep(step + 1);
      } else {
        finish(next);
      }
    } catch (e) {
      if (e.message !== 'cancelled') {
        setError(e.message);
        hub.beep(900, 300);
        hub.display(...current.stick);
      }
    } finally {
      setProgress(null);
    }
  }

  function finish(all) {
    const cal = { ...calibration };
    const errors = [];
    const out = {};
    for (const side of sides) {
      try {
        cal[side] = solveCalibration({ flat: all.flat[side], heels: all.heels[side], turned: all.turned[side] });
        out[side] = cal[side];
      } catch (e) {
        errors.push(`${side === 'L' ? 'Left' : 'Right'}: ${e.message}`);
      }
    }
    if (errors.length) {
      setError(errors.join(' '));
      setStep(0);
      setPoses({});
      return;
    }
    store.setCalibration(cal);
    setResult(out);
  }

  function restart() {
    abortRef.current?.abort();
    setStep(0);
    setPoses({});
    setResult(null);
    setError('');
  }

  useStickButton((b) => {
    if (b === 'A') capture();
    if (b === 'B') restart();
  });

  if (!hub.connected.length) {
    return (
      <div className="stack">
        <h1>Calibrate</h1>
        <p>Connect your sticks first.</p>
        <Link to="/connect" className="btn primary">
          Connect sticks
        </Link>
      </div>
    );
  }

  if (result) {
    return (
      <div className="stack">
        <h1>Calibrated ✓</h1>
        {Object.entries(result).map(([side, c]) => (
          <div className="card row-between" key={side}>
            <b>{side === 'L' ? 'Left' : 'Right'} stick</b>
            <span className="mono">spot slope {fmt(c.spotSlopePct)}%</span>
          </div>
        ))}
        <p className="hint">“Spot slope” is the slope where you stood. The sensors cancel it out, so calibrating on a slope is fine.</p>
        <Link to="/putt" className="btn primary big">
          Start a putt
        </Link>
        <button className="btn ghost" onClick={restart}>
          Calibrate again
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Calibrate</h1>
      <p className="hint">Do this once per round, or if a stick moves on your shoe. Both feet are done together.</p>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === step ? 'now' : i < step ? 'done' : ''}>
            <span className="num">{i < step ? '✓' : i + 1}</span>
            <div>
              <b>{s.title}</b>
              {i === step && <p>{s.text}</p>}
            </div>
          </li>
        ))}
      </ol>

      <CalFigure step={step} />

      {progress != null ? (
        <div className="card">
          <div className="row-between">
            <span>Hold still…</span>
            <span className="mono">{Math.round(progress * 100)}%</span>
          </div>
          <div className="meter">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : (
        <button className="btn primary big" onClick={capture}>
          Record step {step + 1} <small>or press A on a stick</small>
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {step > 0 && (
        <button className="btn ghost" onClick={restart}>
          Start over
        </button>
      )}
    </div>
  );
}

function CalFigure({ step }) {
  // Simple top-down feet with an arrow showing facing direction.
  const turned = step === 2;
  const toes = step === 1;
  return (
    <svg viewBox="0 0 220 120" className="calfig" aria-hidden="true">
      <g transform={`rotate(${turned ? 180 : 0} 110 60)`}>
        <rect x="70" y="25" width="30" height="70" rx="14" className={`foot ${toes ? 'lift' : ''}`} />
        <rect x="120" y="25" width="30" height="70" rx="14" className={`foot ${toes ? 'lift' : ''}`} />
        <path d="M110 8 l-8 10 h16 z" className="arrow" />
      </g>
      {turned && <path d="M40 60 a30 30 0 1 1 10 22" className="turn" />}
      <text x="110" y="116" textAnchor="middle" className="cap">
        {step === 0 ? 'feet flat, still' : step === 1 ? 'toes up, on heels' : 'same spot, facing back'}
      </text>
    </svg>
  );
}
