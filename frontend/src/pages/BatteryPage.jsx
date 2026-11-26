import { useEffect, useState } from 'react';
import { useHub, useStore, useBatteryEstimates } from '../hooks.js';
import { store } from '../lib/store.js';
import { formatMinutes, sessionSummary, avgDraw, CAPACITY_MAH, MIN_PER_HOLE } from '../lib/battery.js';
import { Battery } from '../components/ui.jsx';
import LineChart from '../components/LineChart.jsx';

const SOURCE = {
  current: 'from the stick’s measured current draw',
  measured: 'from how fast the % has dropped',
  learned: 'from this stick’s last session',
  typical: 'rough guess. It gets better after ~10 min',
};

export default function BatteryPage() {
  const hub = useHub();
  const { batteryLog, batteryCapacity } = useStore();
  const est = useBatteryEstimates();
  const [, setTick] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);

  // Live mA readings arrive every 5 s; refresh the numbers when they do.
  useEffect(() => {
    const offs = hub.sticks.map((s) => s.on('power', () => setTick((t) => t + 1)));
    return () => offs.forEach((o) => o());
  }, [hub, hub.sticks.length]);

  const sticks = hub.connected;
  const current = (id) => {
    const list = batteryLog[id] || [];
    return list[list.length - 1];
  };
  const pctSeries = sticks.map((s) => ({
    name: s.side === 'L' ? 'Left' : s.side === 'R' ? 'Right' : s.id,
    cls: s.side === 'R' ? 's-right' : 's-left',
    points: (current(s.id)?.samples || []).map((x) => [x.t, x.pct]),
  }));
  const maSeries = sticks.map((s) => ({
    name: s.side === 'L' ? 'Left' : s.side === 'R' ? 'Right' : s.id,
    cls: s.side === 'R' ? 's-right' : 's-left',
    points: (s.powerHistory || []).filter((p) => p.ma < 0).map((p) => [p.at, -p.ma]),
  }));
  const hasMa = maSeries.some((s) => s.points.length > 1);
  const pastSessions = Object.entries(batteryLog)
    .flatMap(([id, list]) => list.map((sess) => ({ id, sess, sum: sessionSummary(sess) })))
    .filter((x) => x.sum && x.sum.minutes >= 5)
    .sort((a, b) => b.sum.start - a.sum.start)
    .slice(0, 12);

  return (
    <div className="stack">
      <h1>Battery</h1>

      {!sticks.length && <p>Connect a stick to see its battery. Past sessions are listed below.</p>}

      {sticks.map((s) => {
        const e = est[s.side];
        const sess = current(s.id);
        const sum = sess && sessionSummary(sess);
        const draw = avgDraw(s.powerHistory);
        const cap = batteryCapacity[s.id];
        return (
          <section className="card" key={s.id}>
            <div className="row-between">
              <b>
                {s.side === 'L' ? 'Left' : s.side === 'R' ? 'Right' : 'Stick'} · {s.id}
              </b>
              <Battery pct={s.battery} charging={s.charging} big />
            </div>
            {e?.charging ? (
              <p className="big-num">Charging…</p>
            ) : e ? (
              <div>
                <div className="big-num">≈ {formatMinutes(e.minutes)} left</div>
                <small className="hint">
                  About {Math.floor(e.minutes / MIN_PER_HOLE)} holes · {SOURCE[e.source]}
                </small>
              </div>
            ) : null}
            <dl className="kv">
              <div>
                <dt>Draw now</dt>
                <dd>{draw ? `${Math.round(draw)} mA` : s.power ? '–' : 'needs fw 1.3'}</dd>
              </div>
              <div>
                <dt>Average this session</dt>
                <dd>{sum?.avgMa ? `${Math.round(sum.avgMa)} mA` : '–'}</dd>
              </div>
              <div>
                <dt>Stick is</dt>
                <dd>{!s.power ? '–' : s.charging ? 'charging' : [s.power.screenOn ? 'screen on' : 'screen off', s.power.fast ? 'fast updates' : 'slow updates'].join(', ')}</dd>
              </div>
              <div>
                <dt>Voltage</dt>
                <dd>{s.power ? `${s.power.v.toFixed(2)} V` : '–'}</dd>
              </div>
              <div>
                <dt>This session</dt>
                <dd>{sum ? `${formatMinutes(Math.round(sum.minutes))}, ${sum.startPct}% → ${sum.endPct}%` : '–'}</dd>
              </div>
              <div>
                <dt>Used</dt>
                <dd>{sum?.usedMah != null ? `${sum.usedMah.toFixed(1)} mAh` : '–'}</dd>
              </div>
              <div>
                <dt>Drain rate</dt>
                <dd>{sum?.rate ? `${(sum.rate * 60).toFixed(0)}% per hour` : 'after ~10 min'}</dd>
              </div>
              <div>
                <dt>Full charge lasts</dt>
                <dd>{sum?.fullLifeMin ? `≈ ${formatMinutes(Math.round(sum.fullLifeMin))}` : draw ? `≈ ${formatMinutes(Math.round(((cap ?? CAPACITY_MAH) * 60) / draw))}` : '–'}</dd>
              </div>
            </dl>
            {cap && <small className="hint">Measured capacity ≈ {cap} mAh (rated {CAPACITY_MAH}). Rough, because % is worked out from voltage.</small>}
            {!s.power && s.kind === 'real' && <div className="note">Update this stick to v1.3.0 (Admin page) to see live current draw and the charge counter. Those make the time left much more accurate.</div>}
            <button className="btn ghost" onClick={() => store.logBattery(s.id, { side: s.side, fw: s.fw }, { t: Date.now(), pct: s.battery }, { newSession: true })}>
              Start a fresh battery test
            </button>
          </section>
        );
      })}

      {sticks.length > 0 && (
        <section className="card">
          <b>Battery % this session</b>
          <LineChart series={pctSeries} yMin={0} yMax={100} unit="%" label="Battery percent over time for each stick" />
        </section>
      )}

      {hasMa && (
        <section className="card">
          <b>Current draw, last 15 min</b>
          <small className="hint">Lower is better. It goes up while the screen is on and while you’re measuring (fast updates).</small>
          <LineChart series={maSeries} yMin={0} unit=" mA" label="Current draw in milliamps over time" />
        </section>
      )}

      <section className="card">
        <b>Past sessions</b>
        {pastSessions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Stick</th>
                  <th>Length</th>
                  <th>%</th>
                  <th>Avg draw</th>
                  <th>Full charge ≈</th>
                </tr>
              </thead>
              <tbody>
                {pastSessions.map(({ id, sess, sum }) => (
                  <tr key={id + sess.id}>
                    <td>{new Date(sum.start).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td>
                      {sess.side} <small className="mono">fw {sess.fw}</small>
                    </td>
                    <td>{formatMinutes(Math.round(sum.minutes))}</td>
                    <td>
                      {sum.startPct}→{sum.endPct}
                    </td>
                    <td>{sum.avgMa ? `${Math.round(sum.avgMa)} mA` : '–'}</td>
                    <td>{sum.fullLifeMin ? formatMinutes(Math.round(sum.fullLifeMin)) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">Nothing yet. Sessions of 5 minutes or more show up here, so you can compare firmware versions and see if a battery is getting weaker.</p>
        )}
        {pastSessions.length > 0 &&
          (!confirmClear ? (
            <button className="btn ghost" onClick={() => setConfirmClear(true)}>
              Clear battery history…
            </button>
          ) : (
            <div className="row-between">
              <span>Clear all battery history?</span>
              <div className="row">
                <button className="btn ghost" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    store.clearBatteryLog();
                    setConfirmClear(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ))}
      </section>
    </div>
  );
}
