// Must match firmware/src/main.cpp
export const SERVICE = '6a4e0001-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const TILT = '6a4e0002-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const EVENT = '6a4e0003-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const CMD = '6a4e0004-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const INFO = '6a4e0005-6f1d-4b8e-9f33-6f72e3f2a7c1';
export const BATT = '6a4e0006-6f1d-4b8e-9f33-6f72e3f2a7c1'; // firmware 1.3.0+
export const NAME_PREFIX = 'GreenFeet';

/** 20-byte tilt packet -> { up: [x,y,z], motion, battery, charging, seq } */
export function parseTilt(dataView) {
  const le = true;
  return {
    up: [dataView.getFloat32(0, le), dataView.getFloat32(4, le), dataView.getFloat32(8, le)],
    motion: dataView.getFloat32(12, le),
    battery: dataView.getUint8(16),
    charging: (dataView.getUint8(17) & 2) !== 0,
    accurate: (dataView.getUint8(17) & 4) !== 0, // firmware 1.6.0+: % from the charge counter
    seq: dataView.getUint16(18, le),
  };
}

/** 16-byte battery packet -> { v, ma (negative = draining), mah (charge counter), pct, charging } */
export function parseBatt(dataView) {
  const le = true;
  return {
    v: dataView.getFloat32(0, le),
    ma: dataView.getFloat32(4, le),
    mah: dataView.getFloat32(8, le),
    pct: dataView.getUint8(12),
    charging: (dataView.getUint8(13) & 2) !== 0,
    screenOn: (dataView.getUint8(13) & 4) !== 0, // firmware 1.4.0+
    fast: (dataView.getUint8(13) & 8) !== 0,
    accurate: (dataView.getUint8(13) & 16) !== 0,
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
