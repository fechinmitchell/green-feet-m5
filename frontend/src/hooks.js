import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hub } from './ble/hub.js';
import { store } from './lib/store.js';
import { footSlope } from './lib/slope.js';
import { estimate } from './lib/battery.js';

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
  const { batteryRates } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const out = {};
  for (const s of hub.connected) {
    const e = estimate({ pct: s.battery, charging: s.charging, fw: s.fw, history: s.battHistory, learnedRate: batteryRates[s.id] });
    if (e) out[s.side] = e;
    // Remember a measured rate so tomorrow's estimate starts closer.
    if (e?.source === 'measured' && Math.abs((batteryRates[s.id] ?? 0) - e.rate) > 0.05 && s.kind === 'real') {
      queueMicrotask(() => store.setBatteryRate(s.id, e.rate));
    }
  }
  return out;
}
