import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveCalibration, footSlope, standSlope, aimFromReadings, coach } from './slope.js';
import { randomMount, calibrationPoses, sensorUp } from './sim.js';

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test('calibration recovers the true slope for crooked mounts on a sloped calibration spot', () => {
  const rand = seeded(42);
  for (let i = 0; i < 200; i++) {
    const mount = randomMount(rand, 10);
    const spot = { cross: (rand() * 2 - 1) * 5, along: (rand() * 2 - 1) * 5 };
    const cal = solveCalibration(calibrationPoses(mount, spot));
    const truth = { cross: (rand() * 2 - 1) * 5, along: (rand() * 2 - 1) * 5 };
    const got = footSlope(cal, sensorUp(mount, truth.cross, truth.along));
    assert.ok(Math.abs(got.cross - truth.cross) < 0.05, `cross ${got.cross} vs ${truth.cross}`);
    assert.ok(Math.abs(got.along - truth.along) < 0.05, `along ${got.along} vs ${truth.along}`);
  }
});

test('two feet average', () => {
  const rand = seeded(7);
  const feet = [0, 1].map(() => {
    const mount = randomMount(rand);
    const cal = solveCalibration(calibrationPoses(mount, { cross: 2, along: -1 }));
    return { cal, up: sensorUp(mount, 3, 1) };
  });
  const s = standSlope(feet);
  assert.ok(Math.abs(s.cross - 3) < 0.05);
  assert.equal(s.feet, 2);
});

test('calibration rejects a lazy heel rock', () => {
  const mount = randomMount(seeded(1));
  const poses = calibrationPoses(mount);
  poses.heels = sensorUp(mount, 0, 1);
  assert.throws(() => solveCalibration(poses), /heel rock/);
});

test('aim: right side high breaks left, fingers follow speed', () => {
  const a = aimFromReadings([{ cross: 2, along: 0 }], { speed: 'medium' });
  assert.equal(a.breaks, 'left');
  assert.equal(a.fingers, 2);
  assert.equal(aimFromReadings([{ cross: 2, along: 0 }], { speed: 'fast' }).fingers, 2.5);
  assert.equal(aimFromReadings([{ cross: -0.1, along: 0 }]).breaks, 'straight');
});

test('aim: two readings weight the hole end and spot a double breaker', () => {
  const a = aimFromReadings([{ cross: -1.5, along: 0 }, { cross: 2.5, along: 0 }]);
  assert.ok(Math.abs(a.cross - (-1.5 / 3 + 2.5 * 2 / 3)) < 1e-9);
  assert.equal(a.twoWay, true);
});

test('coach compares guess with reading', () => {
  const aim = aimFromReadings([{ cross: -2.5, along: 0 }]);
  assert.equal(coach({ pct: 2, breaks: 'right' }, aim).dirOk, true);
  assert.equal(coach({ pct: 2, breaks: 'left' }, aim).dirOk, false);
  const flat = aimFromReadings([{ cross: 0.2, along: -2 }]);
  const c = coach({ pct: 2, breaks: 'right' }, flat);
  assert.match(c.text, /nearly straight/);
  assert.doesNotMatch(c.text, /other way/);
});
