import { useStore } from '../hooks.js';
import { fmt } from '../components/ui.jsx';

export default function Progress() {
  const { putts } = useStore();
  const guessed = putts.filter((p) => p.guess && p.aim);
  const signed = (p) => (p.aim.breaks === 'straight' ? 0 : p.aim.breaks === 'left' ? 1 : -1);
  const errors = guessed.map((p) => {
    const g = p.guess.breaks === 'straight' ? 0 : p.guess.breaks === 'left' ? p.guess.pct : -p.guess.pct;
    const m = signed(p) * Math.abs(p.aim.cross);
    return Math.abs(g - m);
  });
  const dirOk = guessed.filter((p) => p.guess.breaks === p.aim.breaks || (p.aim.breaks === 'straight' && p.guess.pct <= 1)).length;
  const holed = putts.filter((p) => p.outcome === 'holed').length;
  const missHigh = putts.filter((p) => p.outcome === 'high').length;
  const missLow = putts.filter((p) => p.outcome === 'low').length;
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const recent = errors.slice(-30);

  if (!putts.length) {
    return (
      <div className="stack">
        <h1>Progress</h1>
        <p>No putts yet. Each putt you read in Learn mode shows up here, with how close your guess was.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Progress</h1>
      <div className="stats">
        <Stat label="Putts read" value={putts.length} />
        <Stat label="Avg guess miss" value={avg(errors) != null ? `±${fmt(avg(errors))}%` : '–'} />
        <Stat label="Direction right" value={guessed.length ? `${Math.round((dirOk / guessed.length) * 100)}%` : '–'} />
        <Stat label="Holed" value={`${Math.round((holed / putts.length) * 100)}%`} />
      </div>

      {recent.length > 1 && (
        <div className="card">
          <span className="mono">GUESS MISS, LAST {recent.length} PUTTS (lower is better)</span>
          <Spark values={recent} />
        </div>
      )}

      {missHigh + missLow >= 4 && (
        <div className="tip">
          {missLow > missHigh * 1.5
            ? 'Most misses are on the low side: the putts break more than the fingers say. Try setting the greens one speed faster.'
            : missHigh > missLow * 1.5
              ? 'Most misses are on the high side: the putts break less than the fingers say. Try one speed slower, or check you aren’t hitting it too firm.'
              : 'Misses are even between high and low, so your green speed setting looks right.'}
        </div>
      )}

      <div className="card">
        <b>Recent putts</b>
        <ul className="list">
          {putts
            .slice(-12)
            .reverse()
            .map((p) => (
              <li key={p.at} className="row-between">
                <span className="mono">{new Date(p.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                <span>
                  {p.aim ? `${fmt(Math.abs(p.aim.cross))}% ${p.aim.breaks}` : '–'}
                  {p.guess ? <small> · guessed {fmt(p.guess.pct)}% {p.guess.breaks}</small> : null}
                </span>
                <span className={`badge ${p.outcome}`}>{p.outcome}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="mono">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Spark({ values }) {
  const max = Math.max(2, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 196 + 2, 58 - (v / max) * 52]);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 200 62" className="spark" role="img" aria-label="Guess miss over time">
      <line x1="0" y1="58" x2="200" y2="58" className="grid" />
      <polyline points={pts.map((p) => p.join(',')).join(' ')} className="line" />
      <circle cx={last[0]} cy={last[1]} r="3.5" className="end" />
    </svg>
  );
}
