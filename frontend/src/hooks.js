import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hub } from './ble/hub.js';
import { store } from './lib/store.js';
import { footSlope } from './lib/slope.js';

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
