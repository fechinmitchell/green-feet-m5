import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hub } from './ble/hub.js';
import { store } from './lib/store.js';
import { footSlope } from './lib/slope.js';
import { estimate, avgDraw, sessionSummary } from './lib/battery.js';

export function useHub() {
  useSyncExternalStore(
    (fn) => hub.on('change', fn),
    () => hub.version
  );
  return hub;
}

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Call fn when button A or B is pressed on any stick. */
export function useStickButton(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => hub.on('button', (b, stick) => ref.current(b, stick)), []);
}

/**
 * While `active`, keep the sticks streaming fast (they fall back to slow on
 * their own 30 s after the last request, so a closed tab can't waste battery).
 */
export function useFastStream(active) {
  const h = useHub();
  const count = h.connected.length;
  useEffect(() => {
    if (!active || !count) return;
    hub.fast(true);
    const id = setInterval(() => hub.fast(true), 10000);
    return () => {
      clearInterval(id);
      hub.fast(false);
    };
  }, [active, count]);
}

/** Live slope per foot (percent), updated ~10x a second. */
export function useLiveSlope(calibration) {
  const [live, setLive] = useState({});
  useEffect(() => {
    const id = setInterval(() => {
      const out = {};
      for (const side of ['L', 'R']) {
        const s = hub.bySide(side);
        const cal = calibration?.[side];
        if (s?.latest && cal) out[side] = { ...footSlope(cal, s.latest.up), motion: s.latest.motion };
        else if (s?.latest) out[side] = { motion: s.latest.motion };
      }
      setLive(out);
    }, 100);
    return () => clearInterval(id);
  }, [calibration]);
  return live;
}

/** Battery time-left estimate per connected stick, refreshed each minute. */
export function useBatteryEstimates() {
  const hub = useHub();
  const { batteryRates, batteryCapacity } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const out = {};
  for (const s of hub.connected) {
    const e = estimate({
      pct: s.battery,
      charging: s.charging,
      fw: s.fw,
      history: s.battHistory,
      learnedRate: batteryRates[s.id],
      drawMa: avgDraw(s.powerHistory),
      capacityMah: batteryCapacity[s.id],
    });
    if (e) out[s.side] = e;
    // Remember a measured rate so tomorrow's estimate starts closer.
    if (e?.source === 'measured' && Math.abs((batteryRates[s.id] ?? 0) - e.rate) > 0.05 && s.kind === 'real') {
      queueMicrotask(() => store.setBatteryRate(s.id, e.rate));
    }
  }
  return out;
}

/**
 * Logs a battery sample for each connected stick once a minute, app-wide, so
 * the Battery page has a history even if you never open it during a round.
 */
export function useBatteryLogger() {
  useEffect(() => {
    const charged = new Set();
    const sample = () => {
      for (const s of hub.connected) {
        if (s.battery == null) continue;
        if (s.charging) {
          charged.add(s.id); // next sample after charging starts a fresh session
          continue;
        }
        const p = s.power && Date.now() - s.power.at < 30000 ? s.power : null;
        store.logBattery(
          s.id,
          { side: s.side, fw: s.fw },
          { t: Date.now(), pct: s.battery, v: p ? round(p.v, 3) : undefined, ma: p ? round(p.ma, 1) : undefined, mah: p ? round(p.mah, 2) : undefined },
          { newSession: charged.delete(s.id) }
        );
        // Learn this stick's real capacity once it has used 30%+ in one session.
        const sessions = store.get().batteryLog[s.id];
        const sum = sessions && sessionSummary(sessions[sessions.length - 1]);
        if (sum?.capacity && s.kind === 'real') store.setBatteryCapacity(s.id, Math.round(sum.capacity));
      }
    };
    const first = setTimeout(sample, 5000);
    const id = setInterval(sample, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
}

function round(x, d) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}
