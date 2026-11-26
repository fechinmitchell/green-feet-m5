import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHub, useLiveSlope, useStickButton, useStore } from '../hooks.js';
import { aimFromReadings, coach, missAdvice, standSlope } from '../lib/slope.js';
import { store } from '../lib/store.js';
import { Chips, Fingers, Level, fmt } from '../components/ui.jsx';

const LENGTHS = [
  { value: 'short', label: 'Under 6 ft' },
  { value: 'mid', label: '6–20 ft' },
  { value: 'long', label: '20+ ft' },
];

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
  const [guess, setGuess] = useState({ pct: 2, breaks: 'right', length: 'mid' });
  const [twoReads, setTwoReads] = useState(false);
  const [readings, setReadings] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const demoGreen = useRef(newDemoGreen());
  const abortRef = useRef(null);
  const live = useLiveSlope(calibration);

  const ready = ['L', 'R'].some((s) => calibration[s] && hub.bySide(s));
  const wantReads = twoReads ? 2 : 1;
  const aim = useMemo(() => aimFromReadings(readings, settings), [readings, settings]);
  const tip = learn && step !== 'guess' ? coach(guess, aim) : null;

  // Demo feet follow where you'd be standing.
  useEffect(() => {
    const g = demoGreen.current;
    hub.demoPose(twoReads && readings.length === 0 ? g.ball : twoReads ? g.hole : { cross: (g.ball.cross + g.hole.cross) / 2, along: g.ball.along });
  }, [hub, readings.length, twoReads, step]);

  // Keep the stick screens in step with the phone.
  useEffect(() => {
    if (step === 'guess') hub.display('PUTT ' + (putts.length + 1), 'GUESS', 'read it with\nyour feet');
    if (step === 'measure') {
      const where = twoReads ? (readings.length === 0 ? 'ball half' : 'hole half') : 'halfway';
      hub.display(twoReads ? `READ ${readings.length + 1}/2` : 'READ', 'GO', `${where},\nface hole,\npress A`);
    }
    if (step === 'result' && aim) {
      const arrow = aim.breaks === 'left' ? '<' : aim.breaks === 'right' ? '>' : '|';
      hub.display('BREAK', aim.breaks === 'left' ? `${arrow}${aim.pct}` : `${aim.pct}${arrow}`, `${aim.fingers} finger${aim.fingers === 1 ? '' : 's'}\n${aim.hill}`);
    }
  }, [step, readings.length, twoReads, aim, hub, putts.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function measure() {
    if (progress != null || step !== 'measure') return;
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
      guess: learn ? guess : null,
      readings: readings.map((r) => ({ cross: round2(r.cross), along: round2(r.along), spread: round2(r.spread) })),
      aim: aim && { cross: round2(aim.cross), along: round2(aim.along), fingers: aim.fingers, breaks: aim.breaks },
      outcome: result,
      demo: hub.demo,
    });
  }

  function nextPutt() {
    demoGreen.current = newDemoGreen();
    setStep(learn ? 'guess' : 'measure');
    setReadings([]);
    setTwoReads(false);
    setOutcome(null);
    setError('');
  }

  useStickButton((b) => {
    if (b === 'A') {
      if (step === 'guess') setStep('measure');
      else if (step === 'measure') measure();
    }
    if (b === 'B') {
      abortRef.current?.abort();
      if (step === 'measure' && readings.length) setReadings(readings.slice(0, -1));
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
          <p>
            Stand at the ball. <b>What do your feet say?</b>
          </p>
          <div className="card">
            <label className="row-between" htmlFor="guess-pct">
              <span>Slope</span>
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
            <span>Breaks</span>
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
          <div className="card">
            <span>Length</span>
            <Chips label="Putt length" value={guess.length} onChange={(v) => setGuess({ ...guess, length: v })} options={LENGTHS} />
          </div>
          <button className="btn primary big" onClick={() => {
            if (guess.length === 'long') setTwoReads(true);
            setStep('measure');
          }}>
            Lock in my read
          </button>
          <div className="tip">
            <b>Feeling it:</b> stand with your feet either side of the line. The foot that feels heavier is on the low side, and the ball breaks toward it.
          </div>
        </>
      )}

      {step === 'measure' && (
        <>
          <p>
            {twoReads ? (
              readings.length === 0 ? (
                <>
                  Walk to the <b>middle of the first half</b> of the putt. Straddle the line, face the hole, then press <b>A</b>.
                </>
              ) : (
                <>
                  Now the <b>last third, near the hole</b>. Straddle the line, face the hole, press <b>A</b>.
                </>
              )
            ) : (
              <>
                Walk to <b>halfway</b>. Straddle the line with feet shoulder-width apart, face the hole, then press <b>A</b> on either stick.
              </>
            )}
          </p>

          <div className="levels">
            <Level label="Left" data={live.L} />
            <Level label="Right" data={live.R} />
          </div>

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
              Take reading <small>or press A on a stick</small>
            </button>
          )}
          {error && <p className="error">{error}</p>}

          {readings.length === 0 && (
            <label className="toggle">
              <input type="checkbox" checked={twoReads} onChange={(e) => setTwoReads(e.target.checked)} />
              <span>
                <b>Breaks both ways, or a long putt</b>
                <small>Take two readings: one in each half. The hole end counts for more.</small>
              </span>
            </label>
          )}
          {readings.length === 1 && (
            <div className="card mono">Reading 1: {fmt(Math.abs(readings[0].cross))}% {readings[0].cross > 0.3 ? 'breaks left' : readings[0].cross < -0.3 ? 'breaks right' : 'flat'}</div>
          )}
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
              {aim.highSide ? ` · stack them to the ${aim.highSide} (high side)` : ' · aim at the centre'}
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
            <button className="btn primary big" onClick={() => setStep('log')}>
              I’ve hit it → log result
            </button>
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

function round2(x) {
  return Math.round(x * 100) / 100;
}
