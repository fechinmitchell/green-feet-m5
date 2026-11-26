// Simulated sticks, for Demo mode and for tests. They obey the same physics as
// the real thing: a stick clipped to a shoe at a slightly random angle, standing
// on a slope, reporting "up" in its own sensor frame.

import { vec } from './slope.js';

function rotate(v, axis, angle) {
  // Rodrigues' rotation
  const k = vec.norm(axis);
  const c = Math.cos(angle), s = Math.sin(angle);
  const kxv = vec.cross(k, v);
  const kdv = vec.dot(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kxv[i] * s + k[i] * kdv * (1 - c));
}

/** Build a mount: maps a vector in foot frame [right, toe, up] to sensor frame. */
export function randomMount(rand = Math.random, maxTiltDeg = 8) {
  // Stick on the outside of the shoe, screen facing out, long side toward the toe.
  const base = { right: [0, 0, 1], toe: [0, 1, 0], up: [-1, 0, 0] };
  const axis = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
  const angle = ((rand() * 2 - 1) * maxTiltDeg * Math.PI) / 180;
  return {
    right: rotate(base.right, axis, angle),
    toe: rotate(base.toe, axis, angle),
    up: rotate(base.up, axis, angle),
  };
}

/**
 * "Up" as the stick sees it.
 * crossPct: ground higher on the right of the foot (percent grade)
 * alongPct: ground higher toward the toe
 */
export function sensorUp(mount, crossPct, alongPct) {
  const foot = vec.norm([crossPct / 100, alongPct / 100, 1]);
  return vec.add(vec.add(vec.scale(mount.right, foot[0]), vec.scale(mount.toe, foot[1])), vec.scale(mount.up, foot[2]));
}

/** Readings for the three calibration poses at a spot with the given slope. */
export function calibrationPoses(mount, spot = { cross: 0, along: 0 }) {
  return {
    flat: sensorUp(mount, spot.cross, spot.along),
    heels: sensorUp(mount, spot.cross, spot.along + 15),
    heelUp: sensorUp(mount, spot.cross, spot.along - 25), // heel raised: toe down
    turned: sensorUp(mount, -spot.cross, -spot.along),
  };
}

export function noisy(v, sd = 0.002, rand = Math.random) {
  const g = () => (rand() + rand() + rand() - 1.5) * sd * 2;
  return [v[0] + g(), v[1] + g(), v[2] + g()];
}
