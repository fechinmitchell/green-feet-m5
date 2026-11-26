// "How long is left" for a stick's battery.
//
// Until a stick has been running long enough to measure its own drain, we use
// a typical rate. Then we fit a line through the last 30 minutes of battery
// readings and use the real rate, and remember it for next time.

// Typical drain, % per minute. These are starting guesses for a 120 mAh
// M5StickC Plus with Bluetooth on; the measured rate replaces them.
const TYPICAL = {
  saver: 100 / 180, // firmware 1.2.0+: screen sleeps, CPU at 80 MHz (~3 h)
  old: 100 / 90, // older firmware: screen always on (~1.5 h)
};

export const MIN_PER_HOLE = 15;

export function typicalRate(fw) {
  const [maj = 0, min = 0] = String(fw || '').split('.').map(Number);
  return fw === 'demo' || maj > 1 || (maj === 1 && min >= 2) ? TYPICAL.saver : TYPICAL.old;
}

/** Least-squares drain rate (% per minute) from [{t, pct}], or null if not enough data yet. */
export function measuredRate(history, now = Date.now()) {
  const pts = history.filter((h) => now - h.t <= 30 * 60000);
  if (pts.length < 3) return null;
  const span = (pts[pts.length - 1].t - pts[0].t) / 60000;
  const drop = pts[0].pct - pts[pts.length - 1].pct;
  if (span < 8 || drop < 2) return null;
  const xs = pts.map((p) => (p.t - pts[0].t) / 60000);
  const ys = pts.map((p) => p.pct);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  const rate = -num / den;
  return rate > 0 ? Math.min(3, Math.max(0.15, rate)) : null;
}

/**
 * { minutes, source: 'measured' | 'learned' | 'typical', charging } or null.
 * learnedRate is a rate measured on an earlier day for this stick.
 */
export function estimate({ pct, charging, fw, history = [], learnedRate, drawMa, capacityMah }, now = Date.now()) {
  if (pct == null) return null;
  if (charging) return { minutes: null, charging: true };
  // Best: real current draw from the stick's power chip.
  const fromDraw = minutesFromDraw(pct, drawMa, capacityMah);
  if (fromDraw != null) return { minutes: fromDraw, source: 'current', rate: pct / fromDraw, drawMa, charging: false };
  const m = measuredRate(history, now);
  const rate = m ?? learnedRate ?? typicalRate(fw);
  const source = m ? 'measured' : learnedRate ? 'learned' : 'typical';
  return { minutes: Math.max(0, Math.round(pct / rate)), source, rate, charging: false };
}

export function formatMinutes(min) {
  if (min == null) return '–';
  if (min < 60) return `${min} min`;
  const total = Math.round(min / 5) * 5;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---- Battery monitor (firmware 1.3.0+ reports mA and a charge counter) ----

export const CAPACITY_MAH = 120; // M5StickC Plus nominal; replaced by a measured value when we have one

/** Average draw in mA over the last 2 minutes of live readings, or null. */
export function avgDraw(powerHistory = [], now = Date.now()) {
  const recent = powerHistory.filter((p) => now - p.at <= 120000 && p.ma < 0);
  if (recent.length < 3) return null;
  return -recent.reduce((s, p) => s + p.ma, 0) / recent.length;
}

/** Minutes left from charge remaining and the current draw. */
export function minutesFromDraw(pct, drawMa, capacityMah = CAPACITY_MAH) {
  if (pct == null || !drawMa || drawMa < 3) return null;
  return Math.round(((pct / 100) * capacityMah * 60) / drawMa);
}

/** Summary of one logged session: [{t, pct, v?, ma?, mah?}] samples. */
export function sessionSummary(session) {
  const s = session.samples;
  if (!s.length) return null;
  const first = s[0], last = s[s.length - 1];
  const minutes = (last.t - first.t) / 60000;
  const drop = first.pct - last.pct;
  const rate = measuredRate(s, last.t); // % per minute over the last 30 min
  const draws = s.filter((x) => x.ma != null && x.ma < 0).map((x) => -x.ma);
  const avgMa = draws.length ? draws.reduce((a, b) => a + b, 0) / draws.length : null;
  // The charge counter restarts at 0 when a stick reboots, so add up the
  // drops between neighbouring samples and ignore any jump back up.
  let usedMah = null;
  for (let i = 1; i < s.length; i++) {
    if (s[i].mah == null || s[i - 1].mah == null) continue;
    const d = s[i - 1].mah - s[i].mah;
    const mins = (s[i].t - s[i - 1].t) / 60000;
    if (d >= 0 && d <= 5 * Math.max(1, mins)) usedMah = (usedMah ?? 0) + d;
  }
  const cap = usedMah != null && drop >= 30 ? usedMah / (drop / 100) : null;
  const capacity = cap && cap > 40 && cap < 250 ? cap : null; // ignore nonsense
  const overallRate = minutes >= 8 && drop >= 2 ? drop / minutes : null;
  const fullLifeMin = avgMa ? ((capacity ?? CAPACITY_MAH) * 60) / avgMa : overallRate ? 100 / overallRate : null;
  return { start: first.t, end: last.t, minutes, startPct: first.pct, endPct: last.pct, drop, rate, overallRate, avgMa, usedMah, capacity, fullLifeMin };
}
