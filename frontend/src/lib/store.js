// Everything is saved on the phone for now (no signal needed on the course).
// Later this can sync to the Node/Postgres backend.

const KEY = 'greenfeet.v1';

const defaults = {
  settings: { speed: 'medium', mode: 'learn', holeWeight: 2 / 3, fingerScale: 1 },
  calibration: {}, // { L: {u,f,r,at}, R: {...} }
  putts: [],
  batteryRates: {}, // stick id -> measured drain, % per minute
  batteryCapacity: {}, // stick id -> measured capacity in mAh
  batteryLog: {}, // stick id -> [{ id, side, fw, samples: [{t, pct, v, ma, mah}] }], newest last
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaults);
    const data = JSON.parse(raw);
    return { ...structuredClone(defaults), ...data, settings: { ...defaults.settings, ...data.settings } };
  } catch {
    return structuredClone(defaults);
  }
}

let state = read();
const listeners = new Set();

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  listeners.forEach((fn) => fn());
}

export const store = {
  get: () => state,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setSettings(patch) {
    state = { ...state, settings: { ...state.settings, ...patch } };
    write();
  },
  setCalibration(cal) {
    state = { ...state, calibration: cal };
    write();
  },
  addPutt(putt) {
    state = { ...state, putts: [...state.putts, putt] };
    write();
  },
  setBatteryRate(id, rate) {
    state = { ...state, batteryRates: { ...state.batteryRates, [id]: rate } };
    write();
  },
  /** Add a battery sample; starts a new session after a gap, a charge, or on request. */
  logBattery(stickId, meta, sample, { newSession = false } = {}) {
    const sessions = [...(state.batteryLog[stickId] || [])];
    const last = sessions[sessions.length - 1];
    const lastT = last?.samples[last.samples.length - 1]?.t ?? 0;
    if (newSession || !last || sample.t - lastT > 10 * 60000 || last.fw !== meta.fw) {
      sessions.push({ id: sample.t, side: meta.side, fw: meta.fw, samples: [sample] });
    } else {
      sessions[sessions.length - 1] = { ...last, side: meta.side, samples: [...last.samples, sample].slice(-600) };
    }
    state = { ...state, batteryLog: { ...state.batteryLog, [stickId]: sessions.slice(-10) } };
    write();
  },
  setBatteryCapacity(id, mah) {
    state = { ...state, batteryCapacity: { ...state.batteryCapacity, [id]: mah } };
    write();
  },
  clearBatteryLog() {
    state = { ...state, batteryLog: {} };
    write();
  },
  clearPutts() {
    state = { ...state, putts: [] };
    write();
  },
  exportJson() {
    return JSON.stringify(state, null, 2);
  },
};
