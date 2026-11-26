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

test('current draw gives time left and session summary works', async () => {
  const { minutesFromDraw, sessionSummary } = await import('./battery.js');
  assert.equal(minutesFromDraw(50, 40, 120), 90); // 60 mAh left at 40 mA
  const samples = Array.from({ length: 31 }, (_, i) => ({ t: i * MIN, pct: 90 - i, ma: -40, mah: -(i * 1.2) })); // 30% drop
  const s = sessionSummary({ samples });
  assert.equal(s.drop, 30);
  assert.ok(Math.abs(s.usedMah - 36) < 1e-9);
  assert.ok(Math.abs(s.capacity - 120) < 1e-9);
  assert.equal(Math.round(s.fullLifeMin), 180);
});

test('charge counter reset mid-session is ignored, 115 min reads 1 h 55', async () => {
  const { sessionSummary } = await import('./battery.js');
  const samples = [
    { t: 0, pct: 90, mah: -10 },
    { t: MIN, pct: 89, mah: -11 },
    { t: 2 * MIN, pct: 89, mah: -0.2 }, // stick rebooted
    { t: 3 * MIN, pct: 88, mah: -1.2 },
  ];
  assert.ok(Math.abs(sessionSummary({ samples }).usedMah - 2) < 1e-9);
  assert.equal(formatMinutes(118), '2 h');
  assert.equal(formatMinutes(115), '1 h 55 min');
});
