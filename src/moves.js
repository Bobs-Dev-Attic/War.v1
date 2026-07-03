// Combat move library.
//
// Each move is a data-driven animation: a `pose(joints, t, unit)` function that
// articulates the humanoid's hips, knees, shoulders and elbows over normalized
// time t∈[0,1], plus metadata the sim uses:
//   type   'attack' | 'defense' | 'flinch'
//   dur    duration in seconds
//   hit    [start,end] normalized window when an attack connects (attacks only)
//   dmgMul damage multiplier
//   reach  strike distance
//   heavy  telegraphed (easier to read/dodge, can't be aborted mid-swing)
//   spin   a spinning move (rotates the whole body)
//   aoe    hits every enemy in reach (e.g. a spin)
//   stagger knocks the target back and punches through blocks (shield bash)
//
// Combos chain attack moves; pickCombo() assembles them, mixing curated
// sequences with randomly generated ones so fights never look scripted.

const TAU = Math.PI * 2;

// Piecewise-linear keyframe interpolation: frames = [[t,value], ...] sorted.
function kf(t, frames) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, v0] = frames[i];
    const [t1, v1] = frames[i + 1];
    if (t <= t1) {
      const a = (t - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * a;
    }
  }
  return frames[frames.length - 1][1];
}

const smooth = (t) => t * t * (3 - 2 * t);

// ---- Attack poses --------------------------------------------------------
// Forward is local -z. Positive shoulder.x / elbow.x reach the arm FORWARD
// toward the enemy; negatives cock it back. Strikes must land forward.

function thrustPose(j, t) {
  // Cock the arm back, then drive the point straight forward.
  const sh = kf(t, [[0, 0.15], [0.26, -0.2], [0.48, 0.9], [0.6, 1.0], [1, 0.15]]);
  const el = kf(t, [[0, 0.25], [0.26, 1.6], [0.48, 0.3], [0.6, 0.2], [1, 0.25]]);
  const twist = kf(t, [[0, 0], [0.26, -0.25], [0.5, 0.2], [1, 0]]);
  const lunge = kf(t, [[0, 0], [0.48, 0.55], [0.62, 0.5], [1, 0]]);
  const lean = kf(t, [[0, -0.05], [0.48, -0.22], [1, -0.05]]);
  j.rightShoulder.rotation.x = sh;
  j.rightElbow.rotation.x = el;
  j.chest.rotation.y = twist;
  j.chest.rotation.x = lean;
  j.leftHip.rotation.x = lunge;
  j.leftKnee.rotation.x = -Math.max(0, lunge) * 1.1;
  j.rightHip.rotation.x = -lunge * 0.4;
}

function overheadPose(j, t) {
  // Raise the weapon overhead, then chop down and forward onto the foe.
  const sh = kf(t, [[0, 0.15], [0.32, 1.85], [0.46, 1.95], [0.64, 0.35], [0.82, 0.45], [1, 0.15]]);
  const el = kf(t, [[0, 0.25], [0.32, 1.2], [0.46, 1.0], [0.64, 0.3], [1, 0.25]]);
  const lean = kf(t, [[0, -0.05], [0.32, 0.14], [0.46, 0.16], [0.64, -0.28], [1, -0.05]]);
  const step = kf(t, [[0, 0], [0.6, 0.5], [0.76, 0.45], [1, 0]]);
  j.rightShoulder.rotation.x = sh;
  j.rightElbow.rotation.x = el;
  j.chest.rotation.x = lean;
  j.leftHip.rotation.x = step;
  j.leftKnee.rotation.x = -Math.max(0, step);
  j.rightHip.rotation.x = -step * 0.5;
}

function slashPose(j, t) {
  // Weapon raised out front, sweeping horizontally across the body.
  const shx = kf(t, [[0, 0.15], [0.28, 0.75], [0.5, 0.6], [0.7, 0.5], [1, 0.15]]);
  const shy = kf(t, [[0, 0], [0.28, 0.85], [0.55, -0.9], [0.72, -0.8], [1, 0]]);
  const el = kf(t, [[0, 0.25], [0.3, 0.5], [0.55, 0.3], [1, 0.25]]);
  const twist = kf(t, [[0, 0], [0.28, 0.45], [0.6, -0.45], [1, 0]]);
  j.rightShoulder.rotation.x = shx;
  j.rightShoulder.rotation.y = shy;
  j.rightElbow.rotation.x = el;
  j.chest.rotation.y = twist;
  j.leftKnee.rotation.x = -0.15;
  j.rightKnee.rotation.x = -0.15;
}

function spinPose(j, t, u) {
  u.spinOffset = smooth(t) * TAU;                 // one full rotation
  j.rightShoulder.rotation.set(-0.2, 0, -1.35);   // weapon arm out to the side
  j.rightElbow.rotation.x = 0.1;
  j.leftShoulder.rotation.set(-0.2, 0, 1.2);      // shield arm out for balance
  j.leftElbow.rotation.x = 0.2;
  j.chest.rotation.x = -0.12;
  const crouch = Math.sin(t * Math.PI) * 0.28;
  j.leftKnee.rotation.x = -0.2 - crouch;
  j.rightKnee.rotation.x = -0.2 - crouch;
  j.body.position.y = -crouch * 0.15;
}

function bashPose(j, t) {
  const push = kf(t, [[0, 0], [0.25, 0.25], [0.42, 1.05], [0.55, 0.95], [1, 0]]);
  j.leftShoulder.rotation.x = push;               // shield rams forward
  j.leftShoulder.rotation.z = 0.15;
  j.leftElbow.rotation.x = 1.0;
  j.rightShoulder.rotation.x = -0.4;              // weapon cocked back
  j.rightElbow.rotation.x = 1.2;
  const step = kf(t, [[0, 0], [0.42, 0.45], [0.55, 0.4], [1, 0]]);
  j.leftHip.rotation.x = step;
  j.leftKnee.rotation.x = -Math.max(0, step) * 0.8;
  j.chest.rotation.x = -0.14 * Math.sin(t * Math.PI);
}

// A hard shield shove: drive the boss into the foe to knock them back and open
// up space. Low damage, big knockback.
function shovePose(j, t) {
  const push = kf(t, [[0, 0], [0.22, 0.25], [0.38, 1.15], [0.5, 1.05], [1, 0]]);
  j.leftShoulder.rotation.x = push;            // shield rams forward
  j.leftShoulder.rotation.z = 0.1;
  j.leftElbow.rotation.x = 0.75;
  j.rightShoulder.rotation.x = 0.35 * push;    // shoulder into it
  j.rightElbow.rotation.x = 1.15;
  const step = kf(t, [[0, 0], [0.38, 0.55], [0.5, 0.5], [1, 0]]);
  j.leftHip.rotation.x = step;
  j.leftKnee.rotation.x = -Math.max(0, step) * 0.9;
  j.rightHip.rotation.x = -step * 0.3;
  j.chest.rotation.x = -0.22 * Math.sin(t * Math.PI);
}

// ---- Defense poses -------------------------------------------------------

function blockPose(j, t) {
  const raise = kf(t, [[0, 0], [0.15, 1], [0.7, 1], [1, 0]]);
  j.leftShoulder.rotation.x = 0.5 + raise * 0.4;   // shield up & forward in guard
  j.leftShoulder.rotation.z = 0.2 + raise * 0.3;
  j.leftElbow.rotation.x = 1.1 + raise * 0.4;
  j.rightShoulder.rotation.x = -0.3;               // weapon tucked behind the shield
  j.rightElbow.rotation.x = 1.0;
  j.leftKnee.rotation.x = -0.25 * raise - 0.1;     // brace low
  j.rightKnee.rotation.x = -0.25 * raise - 0.1;
  j.body.position.y = -0.08 * raise;
  j.chest.rotation.x = 0.08 * raise;               // settle behind the shield
}

function dodgePose(side) {
  return (j, t) => {
    const s = Math.sin(t * Math.PI);               // 0→1→0
    j.chest.rotation.z = side * 0.45 * s;
    j.chest.rotation.x = -0.1 * s;
    j.body.position.y = -0.12 * s;
    j.leftKnee.rotation.x = -0.45 * s - 0.1;
    j.rightKnee.rotation.x = -0.45 * s - 0.1;
    j.leftHip.rotation.x = 0.22 * s;
    j.rightHip.rotation.x = 0.22 * s;
    j.rightShoulder.rotation.x = 0.3 - 0.3 * s;
    j.rightShoulder.rotation.z = side * 0.3 * s;
  };
}

function flinchPose(j, t) {
  const s = Math.sin(Math.min(1, t * 1.6) * Math.PI);
  j.chest.rotation.x = 0.35 * s;                   // recoil back
  j.head.rotation.x = 0.25 * s;
  j.body.position.y = 0.03 * s;
  j.leftKnee.rotation.x = -0.1 * s;
  j.rightKnee.rotation.x = -0.1 * s;
  j.rightShoulder.rotation.x = 0.15 + 0.3 * s;
}

// ---- Reach & ranged poses (spear / pike / bow / javelin) -----------------
// One-handed on the weapon arm, so shield-bearers keep their guard.

// Forward is model-local -z, so a negative chest.position.z lunges the whole
// torso (and the leveled spear) straight at the foe — a true thrust rather than
// a chop. The arm holds the spear level throughout so the point never dips.
function spearThrustPose(j, t) {
  const sh = kf(t, [[0, 1.5], [0.3, 1.62], [0.5, 1.6], [0.62, 1.58], [1, 1.5]]);
  const el = kf(t, [[0, 0.08], [0.3, 0.5], [0.5, 0.0], [0.62, 0.0], [1, 0.08]]);
  const reach = kf(t, [[0, 0], [0.3, 0.18], [0.5, -0.72], [0.62, -0.64], [1, 0]]);
  const lunge = kf(t, [[0, 0], [0.3, -0.12], [0.5, 0.6], [0.64, 0.55], [1, 0]]);
  j.rightShoulder.rotation.x = sh;
  j.rightElbow.rotation.x = el;
  j.chest.position.z = reach;                       // torso drives forward
  j.chest.rotation.x = -0.04 + Math.min(0, reach) * 0.06; // a hint of lean; spear stays level
  j.leftHip.rotation.x = lunge;                     // front foot steps in
  j.leftKnee.rotation.x = -Math.max(0, lunge) * 1.05;
  j.rightHip.rotation.x = -lunge * 0.4;             // rear leg extends
}

function pikeThrustPose(j, t) {
  // Braced, measured lunge — a longer wind and a shorter step than the spear.
  const sh = kf(t, [[0, 1.45], [0.35, 1.52], [0.55, 1.46], [0.68, 1.44], [1, 1.45]]);
  const el = kf(t, [[0, 0.08], [0.35, 0.4], [0.55, 0.0], [0.68, 0.0], [1, 0.08]]);
  const reach = kf(t, [[0, 0], [0.35, 0.14], [0.55, -0.58], [0.68, -0.52], [1, 0]]);
  const brace = kf(t, [[0, 0], [0.55, 0.4], [0.68, 0.35], [1, 0]]);
  j.rightShoulder.rotation.x = sh;
  j.rightElbow.rotation.x = el;
  j.chest.position.z = reach;
  j.chest.rotation.x = -0.08 + Math.min(0, reach) * 0.1;
  j.leftHip.rotation.x = brace * 0.5;
  j.leftKnee.rotation.x = -0.2 - Math.max(0, brace) * 0.5;
  j.rightHip.rotation.x = -brace * 0.3;
}

function shootPose(j, t) {
  // Bow arm (left) stays extended via its hold; the right hand draws & looses.
  const draw = kf(t, [[0, 0], [0.5, 1], [0.58, 1], [0.68, 0], [1, 0]]);
  j.rightShoulder.rotation.x = 0.6 - draw * 0.3;
  j.rightShoulder.rotation.z = -0.3 - draw * 0.5;
  j.rightElbow.rotation.x = 0.3 + draw * 1.5;
  j.chest.rotation.y = -0.15 * draw;
  j.head.rotation.y = 0.1 * draw;
}

function throwPose(j, t) {
  const wind = kf(t, [[0, 0.15], [0.4, -1.7], [0.5, -1.8], [0.62, 1.1], [0.78, 0.8], [1, 0.15]]);
  const el = kf(t, [[0, 0.25], [0.4, 1.4], [0.5, 1.3], [0.62, 0.3], [1, 0.25]]);
  const step = kf(t, [[0, 0], [0.55, 0.45], [0.7, 0.4], [1, 0]]);
  j.rightShoulder.rotation.x = wind;
  j.rightElbow.rotation.x = el;
  j.leftHip.rotation.x = step;
  j.leftKnee.rotation.x = -Math.max(0, step) * 0.9;
  j.chest.rotation.x = kf(t, [[0, -0.05], [0.4, 0.15], [0.62, -0.25], [1, -0.05]]);
}

// ---- Move table ----------------------------------------------------------
export const MOVES = {
  thrust:     { type: 'attack', dur: 0.65, hit: [0.42, 0.55], dmgMul: 1.0, reach: 1.9, pose: thrustPose },
  overhead:   { type: 'attack', dur: 0.95, hit: [0.5, 0.66], dmgMul: 1.28, reach: 1.8, heavy: true, pose: overheadPose },
  slash:      { type: 'attack', dur: 0.72, hit: [0.4, 0.62], dmgMul: 1.1, reach: 1.9, pose: slashPose },
  spin:       { type: 'attack', dur: 1.0, hit: [0.3, 0.75], dmgMul: 1.2, reach: 2.0, spin: true, aoe: true, pose: spinPose },
  shieldBash: { type: 'attack', dur: 0.6, hit: [0.35, 0.5], dmgMul: 0.55, reach: 1.6, stagger: true, pose: bashPose },
  shieldShove: { type: 'attack', dur: 0.5, hit: [0.28, 0.42], dmgMul: 0.35, reach: 1.7, stagger: true, shove: true, pose: shovePose },
  spearThrust: { type: 'attack', dur: 0.75, hit: [0.46, 0.6], dmgMul: 1.0, reach: 2.6, pose: spearThrustPose },
  pikeThrust:  { type: 'attack', dur: 1.0, hit: [0.5, 0.66], dmgMul: 1.1, reach: 3.4, pose: pikeThrustPose },
  shoot:       { type: 'ranged', dur: 0.9, release: 0.6, projectile: 'arrow', pose: shootPose },
  throwJavelin: { type: 'ranged', dur: 0.72, release: 0.55, projectile: 'javelin', pose: throwPose },
  block:      { type: 'defense', dur: 0.55, pose: blockPose },
  dodgeL:     { type: 'defense', dur: 0.5, pose: dodgePose(1) },
  dodgeR:     { type: 'defense', dur: 0.5, pose: dodgePose(-1) },
  flinch:     { type: 'flinch', dur: 0.32, pose: flinchPose },
};

// ---- Combos --------------------------------------------------------------
const COMBOS = {
  roman: [
    ['thrust', 'thrust'],
    ['thrust', 'shieldBash'],
    ['slash', 'thrust'],
    ['shieldBash', 'thrust', 'thrust'],
    ['thrust', 'slash', 'spin'],
  ],
  barbarian: [
    ['overhead'],
    ['slash', 'overhead'],
    ['overhead', 'spin'],
    ['slash', 'slash'],
    ['spin', 'overhead'],
  ],
};

const POOL = {
  roman: ['thrust', 'thrust', 'slash', 'shieldBash', 'spin'],
  barbarian: ['overhead', 'slash', 'slash', 'spin', 'overhead'],
};

function makeRandomCombo(faction) {
  const pool = POOL[faction];
  const n = 1 + Math.floor(Math.random() * 3);
  const combo = [];
  for (let i = 0; i < n; i++) combo.push(pool[Math.floor(Math.random() * pool.length)]);
  return combo;
}

// A fresh attack sequence — mostly curated, sometimes freshly assembled.
export function pickCombo(faction) {
  if (Math.random() < 0.35) return makeRandomCombo(faction);
  const list = COMBOS[faction];
  return list[Math.floor(Math.random() * list.length)].slice();
}
