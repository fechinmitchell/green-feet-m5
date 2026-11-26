import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, measuredRate, formatMinutes, typicalRate } from './battery.js';

const MIN = 60000;

test('typical rate depends on firmware power saving', () => {
  assert.ok(typicalRate('1.2.0') < typicalRate('1.0.0'));
  assert.equal(estimate({ pct: 50, fw: '1.2.0' }).minutes, 90);
  assert.equal(estimate({ pct: 50, fw: '1.2.0' }).source, 'typical');
});

test('measured drain replaces the typical rate once there is enough data', () => {
  const now = 20 * MIN;
  // 1% every 2 minutes for 20 minutes
  const history = Array.from({ length: 11 }, (_, i) => ({ t: i * 2 * MIN, pct: 80 - i }));
  assert.ok(Math.abs(measuredRate(history, now) - 0.5) < 1e-9);
  const e = estimate({ pct: 70, fw: '1.2.0', history }, now);
  assert.equal(e.source, 'measured');
  assert.equal(e.minutes, 140);
});

test('too little data falls back, charging shows no time', () => {
  assert.equal(measuredRate([{ t: 0, pct: 80 }, { t: MIN, pct: 79 }, { t: 2 * MIN, pct: 79 }], 2 * MIN), null);
  assert.equal(estimate({ pct: 40, charging: true }).charging, true);
  assert.equal(estimate({ pct: 40, fw: '1.2.0', learnedRate: 0.4 }).source, 'learned');
});

test('format', () => {
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(160), '2 h 40 min');
  assert.equal(formatMinutes(120), '2 h');
});
