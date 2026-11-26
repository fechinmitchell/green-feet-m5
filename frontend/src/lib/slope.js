// Slope maths for Green Feet.
//
// Each stick reports the direction of "up" (the accelerometer's reaction to
// gravity) in its own sensor frame. A stick is clipped to the shoe at some
// unknown angle, so calibration works out three axes in the sensor frame:
//
//   u  which way is up when the foot sits on level ground
//   f  which way the toe points
//   r  which way is to the right of the foot  (r = f x u)
//
// Calibration (standing on the same spot):
//   1. stand still facing any direction        -> a1   (both feet)
//   2. lift one heel at a time, onto the ball  -> h    (gives the toe direction)
//      (older flow: lift both toes instead, passed as `heels`)
//   3. turn 180 degrees, stand still           -> a2   (both feet)
//
// Turning around flips the ground slope but not the mounting error, so the
// average of a1 and a2 is "up on level ground", whatever the slope you stood on.

export const vec = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  mean: (list) => {
    const s = list.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]);
    return [s[0] / list.length, s[1] / list.length, s[2] / list.length];
  },
};

/** Work out a stick's axes from the three calibration poses. Throws with a plain-English message if a step looks wrong. */
export function solveCalibration({ flat, heels, heelUp, turned }) {
  const a1 = vec.norm(flat);
  const a2 = vec.norm(turned);
  const h = vec.norm(heelUp || heels);

  const u = vec.norm(vec.add(a1, a2));

  // How far apart the two standing readings are tells us the slope at the
  // calibration spot. More than ~12% means the turn probably wasn't 180°
  // on the same spot, or the stick moved.
  const spotSlopePct = (Math.tan(Math.acos(Math.min(1, vec.dot(a1, a2))) / 2) * 100);
  if (spotSlopePct > 12) {
    throw new Error('The two standing readings are too different. Turn around on exactly the same spot and check the sticks are tight on your shoes.');
  }

  // Lifting the toes tips "up" toward the toe in the foot's frame; lifting the
  // heel tips it toward the heel.
  const d = vec.sub(h, a1);
  const dPerp = vec.sub(d, vec.scale(u, vec.dot(d, u)));
  if (vec.len(dPerp) < 0.05) {
    throw new Error(
      heelUp
        ? 'Not enough heel lift. Rise onto the ball of that foot, heel about 5 cm up, and hold for a second.'
        : 'Not enough heel rock. Lift your toes higher (about a hand-width) and hold still.'
    );
  }
  const f = heelUp ? vec.scale(vec.norm(dPerp), -1) : vec.norm(dPerp);
  const r = vec.norm(vec.cross(f, u));
  return { u, f, r, spotSlopePct: round1(spotSlopePct), at: Date.now() };
}

/**
 * Slope under one foot, in percent grade.
 *   cross > 0  ground is higher on the right of the foot
 *   along > 0  ground is higher toward the toe (facing uphill)
 */
export function footSlope(cal, up) {
  const a = vec.norm(up);
  const z = vec.dot(a, cal.u);
  return {
    cross: (vec.dot(a, cal.r) / z) * 100,
    along: (vec.dot(a, cal.f) / z) * 100,
  };
}

/** Average the feet that have a reading. Each item: { cal, up }. */
export function standSlope(feet) {
  const parts = feet.filter((x) => x && x.cal && x.up).map((x) => footSlope(x.cal, x.up));
  if (!parts.length) return null;
  const cross = parts.reduce((s, p) => s + p.cross, 0) / parts.length;
  const along = parts.reduce((s, p) => s + p.along, 0) / parts.length;
  const spread = parts.length === 2 ? Math.abs(parts[0].cross - parts[1].cross) : 0;
  return { cross, along, feet: parts.length, spread };
}

export const SPEEDS = {
  slow: { label: 'Slow', stimp: 8, factor: 0.8 },
  medium: { label: 'Medium', stimp: 10, factor: 1.0 },
  fast: { label: 'Fast', stimp: 12, factor: 1.25 },
};

/**
 * Combine one or two readings into an aim.
 *
 * Readings are taken standing on the line facing the hole, so a positive cross
 * slope means the right side is high and the ball breaks to the LEFT.
 *
 * One reading: used as is.
 * Two readings (ball half, hole half): the hole half counts for 2/3 because the
 * ball is slowest there. This weighting is a starting point, tweak in settings.
 *
 * Fingers: starts at 1 finger per 1% on a medium green (AimPoint Express style),
 * scaled for green speed, nudged down uphill / up downhill, rounded to 1/2.
 */
export function aimFromReadings(readings, { speed = 'medium', holeWeight = 2 / 3, fingerScale = 1 } = {}) {
  const valid = readings.filter(Boolean);
  if (!valid.length) return null;
  let cross, along;
  if (valid.length === 1) {
    ({ cross, along } = valid[0]);
  } else {
    const [ball, hole] = valid;
    cross = ball.cross * (1 - holeWeight) + hole.cross * holeWeight;
    along = (ball.along + hole.along) / 2;
  }

  const speedFactor = (SPEEDS[speed] || SPEEDS.medium).factor;
  const slopeFactor = clamp(1 - 0.05 * along, 0.7, 1.3); // uphill breaks less, downhill more
  const rawFingers = Math.abs(cross) * speedFactor * slopeFactor * fingerScale;
  const fingers = Math.round(rawFingers * 2) / 2;
  const pct = Math.abs(cross);

  return {
    cross,
    along,
    pct: round1(pct),
    breaks: pct < 0.3 ? 'straight' : cross > 0 ? 'left' : 'right',
    highSide: pct < 0.3 ? null : cross > 0 ? 'right' : 'left',
    hill: Math.abs(along) < 0.75 ? 'flat' : along > 0 ? 'uphill' : 'downhill',
    fingers,
    twoWay: valid.length === 2 && Math.sign(valid[0].cross) !== Math.sign(valid[1].cross) && Math.abs(valid[0].cross) > 0.3 && Math.abs(valid[1].cross) > 0.3,
  };
}

/** A short coaching line comparing the player's guess with the measurement. */
export function coach(guess, aim) {
  if (!guess || !aim) return null;
  const measured = aim.pct;
  const diff = guess.pct - measured;
  const lines = [];
  // A nearly straight putt has no wrong direction, only an over-read.
  if (aim.breaks === 'straight') {
    const ok = guess.pct <= 1;
    lines.push(ok ? 'Spot on. It’s nearly straight. Remember what level feels like.' : `It’s nearly straight (${round1(measured)}%). You over-read it by ${round1(diff)}%. Weight even on both feet means flat.`);
    return { dirOk: ok, diff: round1(diff), text: lines.join(' ') };
  }
  const dirOk = guess.breaks === aim.breaks;
  if (!dirOk && guess.breaks === 'straight') {
    lines.push(`It breaks ${round1(measured)}% to the ${aim.breaks}. Feel for the extra pressure on your ${aim.breaks} foot.`);
  } else if (!dirOk) {
    lines.push(`Direction was the other way: it breaks to the ${aim.breaks}. Feel for which foot carries more weight. That's the low side.`);
  } else if (Math.abs(diff) <= 0.5) {
    lines.push('Spot on. Remember how that felt in your feet.');
  } else if (diff > 0) {
    lines.push(`You over-read it by ${round1(diff)}%. Gentle slopes feel bigger than they are. Try a smaller number next time.`);
  } else {
    lines.push(`You under-read it by ${round1(-diff)}%. Feel for the extra pressure on your ${aim.breaks} foot.`);
  }
  return { dirOk, diff: round1(diff), text: lines.join(' ') };
}

/** Advice after the putt, based on how it missed. */
export function missAdvice(outcome, aim, speed) {
  if (!aim) return null;
  switch (outcome) {
    case 'holed':
      return 'Holed. The read and the speed matched.';
    case 'high':
      return 'Missed on the high side: it broke less than expected. If this keeps happening, the greens are slower than set, or you hit it firmer than dying speed.';
    case 'low':
      return `Missed low: it broke more than ${aim.fingers} finger${aim.fingers === 1 ? '' : 's'}. If this keeps happening, try ${speed === 'fast' ? 'adding half a finger' : 'setting the greens one speed faster'}.`;
    case 'short':
      return 'Short putts break more. Aim for the ball to finish 30–45 cm past the hole.';
    case 'long':
      return 'Firm putts break less, so the finger read only works at dying speed. Ease off a touch.';
    default:
      return null;
  }
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
export function round1(x) {
  return Math.round(x * 10) / 10;
}
