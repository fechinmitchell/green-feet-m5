import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHub, useStickButton, useStore, useFastStream, useSticksAwake } from '../hooks.js';
import { solveCalibration, vec } from '../lib/slope.js';
import { store } from '../lib/store.js';
import { fmt } from '../components/ui.jsx';

// Heel steps record by themselves once the heel is clearly up and steady, so
// you never have to reach for a button while balancing.
const ALL_STEPS = [
  {
    key: 'flat',
    title: 'Stand still',
    text: 'Feet shoulder-width apart, weight even on both, facing any direction. Then tap Record (or press A).',
    stick: ['CAL', 'STAND', 'stand still,\nthen press A'],
    seconds: 2,
  },
  {
    key: 'heelL',
    side: 'L',
    title: 'Lift your left heel',
    text: 'Stay on the same spot. Rise onto the ball of your LEFT foot, heel about 5 cm up, right foot flat. Hold it. It records by itself.',
    stick: ['CAL', 'L HEEL', 'lift left heel\nand hold'],
    seconds: 1,
    auto: true,
  },
  {
    key: 'heelR',
    side: 'R',
    title: 'Lift your right heel',
    text: 'Left foot back down. Now rise onto the ball of your RIGHT foot and hold. It records by itself.',
    stick: ['CAL', 'R HEEL', 'lift right heel\nand hold'],
    seconds: 1,
    auto: true,
  },
  {
    key: 'turned',
    title: 'Turn around',
    text: 'Both feet flat. Turn 180° on exactly the same spot so your feet land where they were, facing the other way. Then tap Record (or press A).',
    stick: ['CAL', 'TURN', 'turn around,\nthen press A'],
    seconds: 2,
  },
];

const LIFT = 0.1; // ~6° of tilt counts as "heel up"

export default function Calibrate() {
  const hub = useHub();
  const { calibration } = useStore();
  const [step, setStep] = useState(0);
  const [poses, setPoses] = useState({});
  const [progress, setProgress] = useState(null);
  const [lifted, setLifted] = useState(0); // 0..1 how far the heel is up
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);
  const busyRef = useRef(false);
  const spotRef = useRef({ cross: Math.random() * 4 - 2, along: Math.random() * 4 - 2 }); // demo only

  useFastStream(!result);
  useSticksAwake(true);
  const sides = hub.connected.map((s) => s.side).filter((s) => s === 'L' || s === 'R');
  // Only ask for the heels of sticks that are connected.
  const steps = ALL_STEPS.filter((s) => !s.side || sides.includes(s.side));
  const current = steps[step];

  useEffect(() => {
    if (result) hub.display('CAL', 'OK', 'all set');
    else if (current) hub.display(...current.stick);
    // Demo: put the simulated feet in the pose this step asks for.
    const spot = spotRef.current;
    if (current?.key === 'flat') hub.demoPose(spot);
    if (current?.key === 'heelL') {
      hub.demoPose(spot, 'R');
      setTimeout(() => hub.demoPose({ cross: spot.cross, along: spot.along - 25 }, 'L'), 1200);
    }
    if (current?.key === 'heelR') {
      hub.demoPose(spot, 'L');
      setTimeout(() => hub.demoPose({ cross: spot.cross, along: spot.along - 25 }, 'R'), 1200);
    }
    if (current?.key === 'turned') hub.demoPose({ cross: -spot.cross, along: -spot.along });
  }, [step, result, hub, current]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Heel steps: watch the lifted foot and record once it's clearly up.
  useEffect(() => {
    if (!current?.auto || result) return;
    const flat = poses.flat?.[current.side];
    if (!flat) return;
    const id = setInterval(() => {
      const s = hub.bySide(current.side);
      if (!s?.latest) return;
      const diff = vec.len(vec.sub(vec.norm(s.latest.up), vec.norm(flat)));
      setLifted(Math.min(1, diff / LIFT));
      if (diff >= LIFT && !busyRef.current) capture();
    }, 150);
    return () => clearInterval(id);
  });

  async function capture() {
    if (busyRef.current || !current) return;
    busyRef.current = true;
    setError('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    hub.display(current.stick[0], 'HOLD', 'stay still');
    try {
      const got = await hub.capture({
        seconds: current.seconds,
        signal: ctrl.signal,
        onProgress: (f) => setProgress(f),
        only: current.side ? [current.side] : undefined,
        still: current.auto ? 0.06 : undefined, // a little wobble is fine on one foot
        timeout: current.auto ? 8 : 15,
      });
      hub.beep(3400, 120);
      const next = { ...poses, [current.key]: got };
      setPoses(next);
      setLifted(0);
      if (step < steps.length - 1) setStep(step + 1);
      else finish(next);
    } catch (e) {
      if (e.message !== 'cancelled') {
        setError(current.auto ? 'Hold the heel up a little steadier. Try again, it records by itself.' : e.message);
        hub.beep(900, 300);
        hub.display(...current.stick);
      }
    } finally {
      setProgress(null);
      busyRef.current = false;
    }
  }

  function finish(all) {
    const cal = { ...calibration };
    const errors = [];
    const out = {};
    for (const side of sides) {
      try {
        const heelUp = (side === 'L' ? all.heelL : all.heelR)?.[side];
        cal[side] = solveCalibration({ flat: all.flat[side], heelUp, turned: all.turned[side] });
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
    setLifted(0);
  }

  useStickButton((b) => {
    if (b === 'A') capture();
    if (b === 'B') restart();
  });

  if (!hub.connected.length) {
    return (
      <div className="stack">
        <h1>Calibrate</h1>
        <p>{hub.sticks.length ? 'Waking your sticks… usually under 15 s. Press A on a stick to wake it now.' : 'Connect your sticks first.'}</p>
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
        <p className="hint">“Spot slope” is the slope where you stood. Turning around cancels it out, so calibrating on a slope is fine.</p>
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
      <p className="hint">About 20 seconds. Do it once per round, or if a stick moves on your shoe. Stay on the same spot throughout.</p>

      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.key} className={i === step ? 'now' : i < step ? 'done' : ''}>
            <span className="num">{i < step ? '✓' : i + 1}</span>
            <div>
              <b>{s.title}</b>
              {i === step && <p>{s.text}</p>}
            </div>
          </li>
        ))}
      </ol>

      <CalFigure stepKey={current?.key} />

      {progress != null ? (
        <div className="card">
          <div className="row-between">
            <span>{current?.auto ? 'Heel up, hold it…' : 'Hold still…'}</span>
            <span className="mono">{Math.round(progress * 100)}%</span>
          </div>
          <div className="meter">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : current?.auto ? (
        <div className="card">
          <div className="row-between">
            <span>{lifted >= 1 ? 'That’s it, hold…' : lifted > 0.3 ? 'A bit higher…' : `Lift your ${current.side === 'L' ? 'left' : 'right'} heel`}</span>
            <span className="mono">{Math.round(lifted * 100)}%</span>
          </div>
          <div className="meter">
            <div style={{ width: `${lifted * 100}%` }} />
          </div>
          <button className="btn ghost" onClick={capture}>
            Record now
          </button>
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

function CalFigure({ stepKey }) {
  // Top-down feet with an arrow for facing direction. The lifted heel is shaded.
  const turned = stepKey === 'turned';
  return (
    <svg viewBox="0 0 220 120" className="calfig" aria-hidden="true">
      <g transform={`rotate(${turned ? 180 : 0} 110 60)`}>
        <rect x="70" y="25" width="30" height="70" rx="14" className="foot" />
        <rect x="120" y="25" width="30" height="70" rx="14" className="foot" />
        {stepKey === 'heelL' && <rect x="72" y="62" width="26" height="31" rx="12" className="foot lift" />}
        {stepKey === 'heelR' && <rect x="122" y="62" width="26" height="31" rx="12" className="foot lift" />}
        <path d="M110 8 l-8 10 h16 z" className="arrow" />
      </g>
      {turned && <path d="M40 60 a30 30 0 1 1 10 22" className="turn" />}
      <text x="110" y="116" textAnchor="middle" className="cap">
        {stepKey === 'flat' ? 'feet flat, still' : stepKey === 'heelL' ? 'left heel up, right foot flat' : stepKey === 'heelR' ? 'right heel up, left foot flat' : 'same spot, facing back'}
      </text>
    </svg>
  );
}
