import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHub, useLiveSlope, useStickButton, useStore, useFastStream, useSticksAwake } from '../hooks.js';
import { aimFromReadings, coach, missAdvice, standSlope } from '../lib/slope.js';
import { store } from '../lib/store.js';
import { Chips, Fingers, Level, fmt } from '../components/ui.jsx';

const PACE_FT = 3; // one normal walking pace is about 3 ft (0.9 m)
const paces = (ft) => Math.max(1, Math.round(ft / PACE_FT));
const metres = (ft) => (ft * 0.3048).toFixed(1);

function newDemoGreen() {
  // Demo only: a random green. Sometimes a double breaker.
  const r = () => Math.random() * 2 - 1;
  const ball = { cross: r() * 4, along: r() * 2.5 };
  const hole = Math.random() < 0.25 ? { cross: -Math.sign(ball.cross) * (1 + Math.random() * 2.5), along: ball.along } : { cross: ball.cross + r() * 0.6, along: ball.along };
  return { ball, hole };
}

export default function Putt() {
  const hub = useHub();
  const { settings, calibration, putts } = useStore();
  const learn = settings.mode === 'learn';
  const [step, setStep] = useState(learn ? 'guess' : 'measure');
  const [guess, setGuess] = useState({ pct: 2, breaks: 'right' });
  const [distance, setDistance] = useState(() => putts[putts.length - 1]?.distance ?? 12);
  const [editDistance, setEditDistance] = useState(false);
  const [guessed, setGuessed] = useState(false);
  const [twoReads, setTwoReads] = useState(false);
  const [readings, setReadings] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const demoGreen = useRef(newDemoGreen());
  const abortRef = useRef(null);
  const live = useLiveSlope(calibration);
  useFastStream(step === 'measure');
  // Sticks only need to be awake while you guess and measure; they nap after.
  useSticksAwake(step === 'guess' || step === 'measure');
  const waking = ['L', 'R'].filter((s) => calibration[s] && hub.known(s) && !hub.bySide(s));

  const ready = ['L', 'R'].some((s) => calibration[s] && hub.known(s));
  const wantReads = twoReads ? 2 : 1;
  const aim = useMemo(() => aimFromReadings(readings, settings), [readings, settings]);
  const tip = guessed && step !== 'guess' ? coach(guess, aim) : null;

  // Demo feet follow where you'd be standing.
  useEffect(() => {
    const g = demoGreen.current;
    hub.demoPose(twoReads && readings.length === 0 ? g.ball : twoReads ? g.hole : { cross: (g.ball.cross + g.hole.cross) / 2, along: g.ball.along });
  }, [hub, readings.length, twoReads, step]);

  // Keep the stick screens in step with the phone.
  useEffect(() => {
    if (step === 'guess') hub.display('PUTT ' + (putts.length + 1), 'GUESS', 'A = lock guess\nB = skip');
    if (step === 'measure') {
      const where = twoReads ? (readings.length === 0 ? 'ball half' : 'hole half') : 'halfway';
      hub.display(twoReads ? `READ ${readings.length + 1}/2` : 'READ', 'GO', `${where},\nface hole,\npress A`);
    }
    if (step === 'result' && aim) {
      const arrow = aim.breaks === 'left' ? '<' : aim.breaks === 'right' ? '>' : '|';
      hub.display('BREAK', aim.breaks === 'left' ? `${arrow}${aim.pct}` : `${aim.pct}${arrow}`, `${aim.fingers} finger${aim.fingers === 1 ? '' : 's'}\n${aim.hill}\nB = read again`);
    }
  }, [step, readings.length, twoReads, aim, hub, putts.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function measure() {
    if (progress != null || step !== 'measure') return;
    if (waking.length) {
      setError(`Still waking the ${waking.map((x) => (x === 'L' ? 'left' : 'right')).join(' and ')} stick. Press A on it, or try again in a few seconds.`);
      return;
    }
    setError('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    hub.display('READ', 'HOLD', 'stay still');
    try {
      const got = await hub.capture({ seconds: 2, signal: ctrl.signal, onProgress: (f) => setProgress(f) });
      const feet = ['L', 'R'].map((side) => (got[side] && calibration[side] ? { cal: calibration[side], up: got[side] } : null));
      const slope = standSlope(feet);
      if (!slope) throw new Error('No calibrated stick gave a reading. Calibrate first.');
      hub.beep(3400, 150);
      const next = [...readings, slope];
      setReadings(next);
      if (next.length >= wantReads) setStep('result');
    } catch (e) {
      if (e.message !== 'cancelled') {
        setError(e.message);
        hub.beep(900, 300);
      }
    } finally {
      setProgress(null);
    }
  }

  function log(result) {
    setOutcome(result);
    store.addPutt({
      at: Date.now(),
      speed: settings.speed,
      mode: settings.mode,
      guess: guessed ? guess : null,
      distance,
      readings: readings.map((r) => ({ cross: round2(r.cross), along: round2(r.along), spread: round2(r.spread) })),
      aim: aim && { cross: round2(aim.cross), along: round2(aim.along), fingers: aim.fingers, breaks: aim.breaks },
      outcome: result,
      demo: hub.demo,
    });
  }

  function readAgain() {
    abortRef.current?.abort();
    setReadings([]);
    setOutcome(null);
    setError('');
    setStep('measure');
  }

  function nextPutt() {
    demoGreen.current = newDemoGreen();
    setStep(learn ? 'guess' : 'measure');
    setReadings([]);
    setTwoReads(false);
    setGuessed(false);
    setOutcome(null);
    setError('');
  }

  useStickButton((b) => {
    if (b === 'A') {
      if (step === 'guess') {
        setGuessed(true);
        setStep('measure');
      } else if (step === 'measure') measure();
    }
    if (b === 'B' && step === 'guess') {
      setGuessed(false);
      setStep('measure');
      return;
    }
    if (b === 'B') {
      abortRef.current?.abort();
      if (step === 'measure' && readings.length) setReadings(readings.slice(0, -1));
      if (step === 'result') readAgain();
    }
  });

  if (!ready) {
    return (
      <div className="stack">
        <h1>Putt</h1>
        <p>Connect and calibrate your sticks first.</p>
        <Link to="/" className="btn primary">
          Go to setup
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Putt {putts.length + (outcome ? 0 : 1)}</h1>
        <span className="mono">
          {step === 'guess' ? 'your read' : step === 'measure' ? `reading ${readings.length + 1} of ${wantReads}` : step === 'result' ? 'the read' : ''}
        </span>
      </div>

      {step === 'guess' && (
        <>
          <ol className="howto-steps">
            <li>Stand behind the ball and look at the line.</li>
            <li>Straddle the line near the ball and <b>feel which foot has more pressure</b>. That’s the low side.</li>
            <li>Put your guess in below. Then the sticks check it.</li>
          </ol>
          <div className="card">
            <label className="row-between" htmlFor="guess-pct">
              <span>Your slope guess</span>
              <b className="big-num">{fmt(guess.pct)}%</b>
            </label>
            <input id="guess-pct" type="range" min="0" max="5" step="0.5" value={guess.pct} onChange={(e) => setGuess({ ...guess, pct: Number(e.target.value) })} />
            <div className="scale mono">
              <span>flat</span>
              <span>gentle 1–2</span>
              <span>big 4–5</span>
            </div>
          </div>
          <div className="card">
            <span>It breaks…</span>
            <Chips
              label="Break direction"
              value={guess.breaks}
              onChange={(v) => setGuess({ ...guess, breaks: v })}
              options={[
                { value: 'left', label: '← Left' },
                { value: 'straight', label: 'Straight' },
                { value: 'right', label: 'Right →' },
              ]}
            />
          </div>
          <DistanceSlider distance={distance} setDistance={setDistance} />
          <button
            className="btn primary big"
            onClick={() => {
              setTwoReads(distance > 20);
              setGuessed(true);
              setStep('measure');
            }}
          >
            Lock in my read <small>or press A on a stick</small>
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setTwoReads(distance > 20);
              setGuessed(false);
              setStep('measure');
            }}
          >
            Skip guess, just measure <small>or B on a stick</small>
          </button>
        </>
      )}

      {(step === 'guess' || step === 'measure') && waking.length > 0 && (
        <div className="info-note">
          Waking the {waking.map((x) => (x === 'L' ? 'left' : 'right')).join(' and ')} stick… usually under 15 s. Press <b>A</b> on a stick to wake it now.
        </div>
      )}

      {step === 'measure' && (
        <>
          <PuttMap distance={distance} twoReads={twoReads} readingIndex={readings.length} />

          <ol className="howto-steps">
            <li>
              {twoReads ? (
                readings.length === 0 ? (
                  <>
                    Walk <b>{paces(distance / 4)} paces</b> toward the hole, a quarter of the way.
                  </>
                ) : (
                  <>
                    Now walk on to <b>{paces((distance * 3) / 4)} paces</b> from the ball, three quarters of the way, near the hole.
                  </>
                )
              ) : (
                <>
                  Walk <b>{paces(distance / 2)} paces</b> toward the hole, to halfway ({Math.round(distance / 2)} ft).
                </>
              )}
            </li>
            <li>
              <b>Straddle the line</b>, one foot each side, shoulder-width apart, <b>facing the hole</b>.
            </li>
            {learn && (
              <li>
                <b>Feel it first:</b> which foot has more pressure? That’s the low side.
              </li>
            )}
            <li>
              Stand still and press <b>A</b> on a stick, or tap Take reading.
            </li>
          </ol>

          <LiveRead live={live} />

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
            <button className="btn primary big" onClick={measure}>
              Take reading {twoReads ? `${readings.length + 1} of 2` : ''} <small>or press A on a stick</small>
            </button>
          )}
          {error && <p className="error">{error}</p>}

          {readings.length === 1 && (
            <div className="card mono">
              Reading 1: {fmt(Math.abs(readings[0].cross))}% {readings[0].cross > 0.3 ? 'breaks left' : readings[0].cross < -0.3 ? 'breaks right' : 'flat'}
            </div>
          )}

          {readings.length === 0 && (
            <div className="card">
              {editDistance || !guessed ? (
                <DistanceSlider distance={distance} setDistance={setDistance} bare />
              ) : (
                <div className="row-between">
                  <span>
                    Putt length <b>{distance} ft</b>
                  </span>
                  <button className="chip" onClick={() => setEditDistance(true)}>
                    Change
                  </button>
                </div>
              )}
              <label className="toggle bare">
                <input type="checkbox" checked={twoReads} onChange={(e) => setTwoReads(e.target.checked)} />
                <span>
                  <b>Two readings</b>
                  <small>For long putts (on automatically over 20 ft) or ones that break both ways. The hole end counts for more.</small>
                </span>
              </label>
            </div>
          )}

          <details className="card">
            <summary>Each foot separately</summary>
            <div className="levels">
              <Level label="Left" data={live.L} />
              <Level label="Right" data={live.R} />
            </div>
          </details>
        </>
      )}

      {(step === 'result' || step === 'log') && aim && (
        <>
          <div className="result">
            <div>
              <div className="huge">{fmt(aim.pct)}%</div>
              <div className="mono">{aim.hill}{Math.abs(aim.along) >= 0.75 ? ` ${fmt(Math.abs(aim.along))}%` : ''}</div>
            </div>
            <div className="result-dir">
              {aim.breaks === 'straight' ? (
                <b>Straight</b>
              ) : (
                <>
                  breaks <b>{aim.breaks === 'left' ? '← left' : 'right →'}</b>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <Fingers count={aim.fingers} highSide={aim.highSide} />
            <p className="center">
              <b>
                {aim.fingers} finger{aim.fingers === 1 ? '' : 's'}
              </b>
              {!aim.highSide || aim.fingers === 0
                ? ' · aim at the centre of the hole'
                : aim.fingers <= 1
                  ? ` · held just ${aim.highSide} of the hole centre (the high side)`
                  : ` · stacked to the ${aim.highSide} (the high side)`}
            </p>
            <p className="hint center">Arm straight, one eye closed. Put the edge of your first finger on the centre of the hole. Aim at the outer edge of the last finger. Roll it at dying speed.</p>
          </div>

          {readings.length === 2 && (
            <div className={`note ${aim.twoWay ? 'warn' : ''}`}>
              <b>{aim.twoWay ? 'Double breaker.' : 'Two readings.'}</b> Ball half {fmt(Math.abs(readings[0].cross))}%, hole half {fmt(Math.abs(readings[1].cross))}%. The hole end counts for {Math.round(settings.holeWeight * 100)}%, because the ball is slowest there and the slope has longest to bend it.
            </div>
          )}
          {readings[0]?.feet === 2 && readings[0].spread > 1.5 && (
            <div className="note">Your two feet read {fmt(readings[0].spread)}% apart. Check one foot isn’t on a ridge or in a dip, or that a stick hasn’t moved.</div>
          )}
          {tip && <div className={`tip ${tip.dirOk ? '' : 'bad'}`}>You guessed <b>{fmt(guess.pct)}% {guess.breaks}</b>. {tip.text}</div>}

          {step === 'result' && (
            <>
              <button className="btn primary big" onClick={() => setStep('log')}>
                I’ve hit it → log result
              </button>
              <div className="pair">
                <button className="btn" onClick={readAgain}>
                  ↻ Read again <small>same putt · or B on a stick</small>
                </button>
                <button className="btn" onClick={nextPutt}>
                  New putt <small>don’t save this one</small>
                </button>
              </div>
            </>
          )}
        </>
      )}

      {step === 'log' && (
        <div className="card">
          <b>How did it go?</b>
          <button className={`btn ${outcome === 'holed' ? 'primary' : ''}`} onClick={() => log('holed')} disabled={!!outcome}>
            Holed ✓
          </button>
          <Chips
            label="Miss"
            value={outcome}
            onChange={(v) => !outcome && log(v)}
            options={[
              { value: 'high', label: 'High side' },
              { value: 'low', label: 'Low side' },
              { value: 'short', label: 'Short' },
              { value: 'long', label: 'Long' },
            ]}
          />
          {outcome && <div className="tip">{missAdvice(outcome, aim, settings.speed)}</div>}
          {outcome && (
            <button className="btn primary big" onClick={nextPutt}>
              Next putt
            </button>
          )}
          {!outcome && (
            <button className="btn ghost" onClick={() => log('skipped')}>
              Skip
            </button>
          )}
        </div>
      )}

      {hub.demo && step === 'measure' && (
        <button className="btn ghost demo-a" onClick={() => hub.demoPress()}>
          Demo: press A on stick
        </button>
      )}
    </div>
  );
}

function DistanceSlider({ distance, setDistance, bare = false }) {
  const body = (
    <>
      <label className="row-between" htmlFor="putt-dist">
        <span>Putt length</span>
        <b className="big-num">{distance} ft</b>
      </label>
      <input id="putt-dist" type="range" min="3" max="60" step="1" value={distance} onChange={(e) => setDistance(Number(e.target.value))} />
      <div className="scale mono">
        <span>3 ft</span>
        <span>
          {metres(distance)} m · about {paces(distance)} paces
        </span>
        <span>60 ft</span>
      </div>
    </>
  );
  return bare ? body : <div className="card">{body}</div>;
}

/** Top-down sketch: ball, hole, and where to stand. */
function PuttMap({ distance, twoReads, readingIndex }) {
  const x0 = 26, x1 = 314;
  const spots = twoReads ? [0.25, 0.75] : [0.5];
  const x = (f) => x0 + f * (x1 - x0);
  return (
    <svg viewBox="0 0 340 92" className="puttmap" role="img" aria-label={`Ball to hole ${distance} feet, stand ${twoReads ? 'a quarter and three quarters' : 'halfway'} along the line`}>
      <line x1={x0} y1="46" x2={x1} y2="46" className="pm-line" />
      <circle cx={x0} cy="46" r="6" className="pm-ball" />
      <text x={x0} y="74" textAnchor="middle" className="pm-t">ball</text>
      <circle cx={x1} cy="46" r="9" className="pm-hole" />
      <text x={x1} y="74" textAnchor="middle" className="pm-t">hole</text>
      {spots.map((f, i) => {
        const now = i === readingIndex;
        const done = i < readingIndex;
        return (
          <g key={f} className={now ? 'pm-now' : done ? 'pm-done' : 'pm-later'}>
            <rect x={x(f) - 8} y="24" width="16" height="9" rx="4" className="pm-foot" />
            <rect x={x(f) - 8} y="59" width="16" height="9" rx="4" className="pm-foot" />
            <text x={x(f)} y="14" textAnchor="middle" className="pm-t">
              {done ? '✓' : `${paces(distance * f)} paces`}
            </text>
          </g>
        );
      })}
      <text x={(x0 + x1) / 2} y="88" textAnchor="middle" className="pm-t">
        {distance} ft
      </text>
    </svg>
  );
}

/** One simple live number: the slope where you're standing right now. */
function LiveRead({ live }) {
  const feet = ['L', 'R'].map((s) => live[s]).filter((f) => f && f.cross != null);
  if (!feet.length) return <div className="card hint">Waiting for the sticks…</div>;
  const cross = feet.reduce((a, f) => a + f.cross, 0) / feet.length;
  const along = feet.reduce((a, f) => a + f.along, 0) / feet.length;
  const steady = feet.every((f) => (f.motion ?? 1) <= 0.025);
  const a = aimFromReadings([{ cross, along }]);
  const pos = Math.max(-1, Math.min(1, -cross / 4)); // marker toward the low side
  return (
    <div className="card live">
      <div className="row-between">
        <span className="mono">RIGHT NOW</span>
        <span className={`pill-state ${steady ? 'ok' : ''}`}>{steady ? 'Steady' : 'Moving…'}</span>
      </div>
      <div className="row-between">
        <b className="big-num">{fmt(a.pct)}%</b>
        <span>{a.breaks === 'straight' ? 'about straight' : `breaks ${a.breaks === 'left' ? '← left' : 'right →'}`}</span>
      </div>
      <div className="tiltbar" aria-hidden="true">
        <span className="tb-mid" />
        <span className="tb-dot" style={{ left: `${50 + pos * 46}%` }} />
      </div>
      <div className="scale mono">
        <span>low left</span>
        <span>{a.hill === 'flat' ? 'flat along the line' : `${a.hill} ${fmt(Math.abs(along))}%`}</span>
        <span>low right</span>
      </div>
      <div className="feet-live">
        {['L', 'R'].map((side) => {
          const f = live[side];
          if (!f || f.cross == null) return null;
          const fa = aimFromReadings([{ cross: f.cross, along: f.along }]);
          const fpos = Math.max(-1, Math.min(1, -f.cross / 4));
          return (
            <div className="foot-row" key={side}>
              <b>{side === 'L' ? 'Left' : 'Right'} foot</b>
              <div className="tiltbar small" aria-hidden="true">
                <span className="tb-mid" />
                <span className="tb-dot" style={{ left: `${50 + fpos * 46}%` }} />
              </div>
              <span className="mono">
                {fmt(fa.pct)}% {fa.breaks === 'straight' ? '' : fa.breaks === 'left' ? '←' : '→'}
              </span>
            </div>
          );
        })}
      </div>
      {feet.length === 2 && Math.abs(feet[0].cross - feet[1].cross) > 1.5 && (
        <small className="hint">Your feet read quite differently. Check one isn’t on a ridge or in a dip.</small>
      )}
    </div>
  );
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
