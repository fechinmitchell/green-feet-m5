// Everything is saved on the phone for now (no signal needed on the course).
// Later this can sync to the Node/Postgres backend.

const KEY = 'greenfeet.v1';

const defaults = {
  settings: { speed: 'medium', mode: 'learn', holeWeight: 2 / 3, fingerScale: 1 },
  calibration: {}, // { L: {u,f,r,at}, R: {...} }
  putts: [],
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
  clearPutts() {
    state = { ...state, putts: [] };
    write();
  },
  exportJson() {
    return JSON.stringify(state, null, 2);
  },
};
