// Must match firmware/src/main.cpp
export const SERVICE = '6a4e0001-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const TILT = '6a4e0002-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const EVENT = '6a4e0003-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const CMD = '6a4e0004-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const INFO = '6a4e0005-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const NAME_PREFIX = 'GreenFeet';

/** 20-byte tilt packet -> { up: [x,y,z], motion, battery, charging, seq } */
export function parseTilt(dataView) {
  const le = true;
  return {
    up: [dataView.getFloat32(0, le), dataView.getFloat32(4, le), dataView.getFloat32(8, le)],
    motion: dataView.getFloat32(12, le),
    battery: dataView.getUint8(16),
    charging: (dataView.getUint8(17) & 2) !== 0,
    seq: dataView.getUint16(18, le),
  };
}

/** "fw=1.0.0;side=L;id=AB12" -> { fw, side, id } */
export function parseInfo(text) {
  const out = {};
  for (const part of text.split(';')) {
    const [k, v] = part.split('=');
    if (k) out[k.trim()] = (v || '').trim();
  }
  return out;
}

/** Stick screen is 135 px wide: keep text short and ASCII. */
export function dispCommand(title = '', value = '', sub = '') {
  const clean = (s) => String(s).replace(/[|]/g, '/').replace(/[^\x20-\x7E\n]/g, '').replace(/\n/g, '\\n');
  return `disp:${clean(title).slice(0, 10)}|${clean(value).slice(0, 6)}|${clean(sub).slice(0, 60)}`;
}
