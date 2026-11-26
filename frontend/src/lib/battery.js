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
export function estimate({ pct, charging, fw, history = [], learnedRate }, now = Date.now()) {
  if (pct == null) return null;
  if (charging) return { minutes: null, charging: true };
  const m = measuredRate(history, now);
  const rate = m ?? learnedRate ?? typicalRate(fw);
  const source = m ? 'measured' : learnedRate ? 'learned' : 'typical';
  return { minutes: Math.max(0, Math.round(pct / rate)), source, rate, charging: false };
}

export function formatMinutes(min) {
  if (min == null) return '–';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  return m ? `${h} h ${m} min` : `${h} h`;
}
