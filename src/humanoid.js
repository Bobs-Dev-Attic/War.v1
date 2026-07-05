import * as THREE from 'three';

// Builds an articulated humanoid from primitives with named joints so the
// Unit animation system can drive walk cycles, weapon swings, staggers,
// deaths and surrenders procedurally.
//
// Hierarchy (all joints are Groups pivoting at anatomical points):
//   root
//    └ body            (whole-body bob/translation)
//       ├ leftHip / rightHip → thigh → knee → shin → foot
//       └ chest         (pivot at pelvis, leans for attack/death/surrender)
//          ├ head
//          ├ leftShoulder → upperArm → elbow → foreArm → hand (shield)
//          └ rightShoulder → upperArm → elbow → foreArm → hand (weapon)

function box(w, h, d, color, rough = 0.8, metal = 0.0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt, rb, h, color, seg = 10, rough = 0.8, metal = 0.0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A limb segment: a Group pivot with a mesh hanging downward from it.
function segment(length, radiusTop, radiusBot, color, metal = 0) {
  const joint = new THREE.Group();
  const mesh = cyl(radiusTop, radiusBot, length, color, 8, 0.7, metal);
  mesh.position.y = -length / 2;
  joint.add(mesh);
  joint.userData.length = length;
  return joint;
}

// A low-poly warhorse: body, neck, head, tail, saddle and four articulated
// legs (each a hip + knee group) so the Unit can drive a gallop cycle. The
// horse faces -z, matching the rider's front, so it turns with the unit.
function buildHorse(c) {
  const g = new THREE.Group();
  const hide = c.horse || 0x6b4a2e;
  const dark = 0x2a1a0e;
  const body = box(0.5, 0.52, 1.5, hide, 0.92);
  body.position.set(0, 1.02, 0.05);
  g.add(body);
  const rump = box(0.5, 0.5, 0.4, hide, 0.92); rump.position.set(0, 1.05, 0.72); g.add(rump);
  const chest = box(0.48, 0.5, 0.35, hide, 0.92); chest.position.set(0, 1.0, -0.6); g.add(chest);
  // Head + neck as one group so it can be lopped off in one piece.
  const headG = new THREE.Group();
  headG.position.set(0, 1.05, -0.55);
  g.add(headG);
  const neck = box(0.32, 0.6, 0.34, hide, 0.92); neck.position.set(0, 0.31, -0.27); neck.rotation.x = 0.62; headG.add(neck);
  const head = box(0.22, 0.24, 0.52, hide, 0.9); head.position.set(0, 0.57, -0.53); head.rotation.x = 0.28; headG.add(head);
  const muzzle = box(0.16, 0.16, 0.2, 0x4a3320, 0.9); muzzle.position.set(0, 0.45, -0.77); headG.add(muzzle);
  for (const ex of [-0.08, 0.08]) {
    const ear = box(0.06, 0.12, 0.05, hide, 0.9); ear.position.set(ex, 0.71, -0.41); ear.rotation.x = -0.2; headG.add(ear);
  }
  const mane = box(0.06, 0.62, 0.36, dark, 0.95); mane.position.set(0, 0.35, -0.23); mane.rotation.x = 0.62; headG.add(mane);
  const tail = cyl(0.06, 0.02, 0.62, dark, 6, 0.95); tail.position.set(0, 1.0, 0.95); tail.rotation.x = -0.5; g.add(tail);
  // Saddle + blanket the rider sits on.
  const blanket = box(0.56, 0.08, 0.7, c.saddleCloth || 0x8a2a2a, 0.85); blanket.position.set(0, 1.3, 0.12); g.add(blanket);
  const saddle = box(0.44, 0.14, 0.5, c.saddle || 0x4a2f1a, 0.7); saddle.position.set(0, 1.37, 0.12); g.add(saddle);

  const legs = {};
  const defs = [['fl', -0.19, -0.5], ['fr', 0.19, -0.5], ['bl', -0.19, 0.6], ['br', 0.19, 0.6]];
  for (const [key, x, z] of defs) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.96, z);
    g.add(hip);
    const upper = cyl(0.1, 0.07, 0.5, hide, 7, 0.9); upper.position.y = -0.25; hip.add(upper);
    const knee = new THREE.Group(); knee.position.y = -0.5; hip.add(knee);
    const lower = cyl(0.06, 0.045, 0.48, hide, 7, 0.9); lower.position.y = -0.24; knee.add(lower);
    const hoof = box(0.11, 0.1, 0.15, dark, 0.9); hoof.position.set(0, -0.48, 0.01); knee.add(hoof);
    legs[key] = { hip, knee };
  }
  return { group: g, legs, head: headG, body };
}

// A simple non-articulated crew figure to man a siege engine.
function crewFigure(c) {
  const g = new THREE.Group();
  const skin = c.skin || 0xc98a5a;
  const torso = box(0.32, 0.42, 0.2, c.torso || 0x8a6a3a, 0.8); torso.position.y = 1.0; g.add(torso);
  const head = box(0.2, 0.22, 0.2, skin, 0.6); head.position.y = 1.33; g.add(head);
  if (c.helmet) { const helm = cyl(0.12, 0.13, 0.14, c.armor || 0xb8b8c0, 10, 0.35, 0.6); helm.position.y = 1.42; g.add(helm); }
  for (const sx of [-0.11, 0.11]) { const leg = box(0.11, 0.5, 0.13, c.skirt || 0x3a2a18, 0.85); leg.position.set(sx, 0.5, 0); g.add(leg); }
  for (const sx of [-0.24, 0.24]) { const arm = box(0.1, 0.36, 0.1, skin, 0.7); arm.position.set(sx, 1.02, 0.04); arm.rotation.x = -0.5; g.add(arm); }
  return g;
}

// A siege engine: a wheeled timber frame carrying either a torsion catapult
// (onager / stone-thrower — a throwing arm that snaps up into a stop-beam and
// hurls a boulder) or a ballista (a giant horizontal bolt-thrower). The
// throwing arm / bow is a Group (`siegeArm`) the Unit animates on firing; a
// static crew figure mans the rear. It carries the standard humanoid joint
// names as detached dummies so the shared animation code never faults.
function buildSiege(c) {
  const root = new THREE.Group();
  const wood = c.frame || 0x6a4726;
  const dark = 0x3a2712;
  const kind = c.siege;                        // 'onager' | 'ballista' | 'stonethrower'

  const base = new THREE.Group(); root.add(base);
  for (const sx of [-0.42, 0.42]) { const beam = box(0.16, 0.16, 2.0, wood, 0.85); beam.position.set(sx, 0.42, 0); base.add(beam); }
  for (const z of [-0.8, 0.8]) { const cb = box(1.0, 0.14, 0.16, wood, 0.85); cb.position.set(0, 0.42, z); base.add(cb); }
  for (const sx of [-0.52, 0.52]) for (const z of [-0.7, 0.7]) {
    const wheel = cyl(0.3, 0.3, 0.12, dark, 12, 0.9); wheel.rotation.z = Math.PI / 2; wheel.position.set(sx, 0.3, z); base.add(wheel);
  }

  const siegeArm = new THREE.Group();
  if (kind === 'cannon') {
    // A field gun: an iron barrel on a wheeled carriage. The barrel (siegeArm)
    // recoils along its length when fired. The carriage crew figure stands aside.
    const trail = box(0.2, 0.16, 1.4, wood, 0.85); trail.position.set(0, 0.42, 0.55); base.add(trail);
    for (const sx of [-0.5, 0.5]) { const cheek = box(0.12, 0.5, 0.9, wood, 0.85); cheek.position.set(sx, 0.62, -0.15); base.add(cheek); }
    siegeArm.position.set(0, 0.78, 0); root.add(siegeArm);
    const barrel = cyl(0.14, 0.19, 1.35, 0x2a2c30, 14, 0.5, 0.55); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -0.35); siegeArm.add(barrel);
    const cascabel = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.55, roughness: 0.5 }));
    cascabel.position.set(0, 0, 0.42); siegeArm.add(cascabel);
    const muzzle = cyl(0.16, 0.16, 0.12, 0x1e2024, 14, 0.5, 0.55); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0, -1.0); siegeArm.add(muzzle);
    siegeArm.userData.recoil = true;
  } else if (kind === 'ballista') {
    const post = box(0.14, 0.8, 0.16, wood, 0.85); post.position.set(0, 0.85, -0.15); base.add(post);
    const trough = box(0.14, 0.1, 1.5, wood, 0.85); trough.position.set(0, 1.2, 0.35); root.add(trough);
    siegeArm.position.set(0, 1.2, -0.15); root.add(siegeArm);
    for (const sx of [-1, 1]) { const limb = box(0.07, 0.09, 0.66, dark, 0.8); limb.position.set(sx * 0.4, 0, 0); limb.rotation.y = sx * 0.3; siegeArm.add(limb); }
    const str = box(0.86, 0.035, 0.035, 0x2a2018, 0.7); str.position.set(0, 0, 0.12); siegeArm.add(str);
    const bolt = box(0.05, 0.05, 1.0, 0x8a6a3a, 0.7); bolt.position.set(0, 1.28, 0.2); root.add(bolt); siegeArm.userData.ammo = bolt;
  } else {
    const stop = box(1.0, 0.5, 0.16, wood, 0.85); stop.position.set(0, 0.95, -0.8); base.add(stop);
    const bundle = cyl(0.18, 0.18, 0.9, 0x4a3420, 10, 0.85); bundle.rotation.z = Math.PI / 2; bundle.position.set(0, 0.6, 0.7); base.add(bundle);
    siegeArm.position.set(0, 0.6, 0.7); root.add(siegeArm);
    const armBeam = box(0.13, 0.13, 1.5, wood, 0.85); armBeam.position.set(0, 0, -0.6); siegeArm.add(armBeam);
    const bucket = cyl(0.2, 0.14, 0.16, dark, 10, 0.9); bucket.position.set(0, 0.04, -1.28); siegeArm.add(bucket);
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0x8f8f95, roughness: 0.95 }));
    stone.position.set(0, 0.14, -1.28); siegeArm.add(stone); siegeArm.userData.ammo = stone;
    siegeArm.rotation.x = -1.15;                // laid back, loaded
  }

  const crew = crewFigure(c); crew.position.set(0.6, 0, 0.95); crew.rotation.y = -0.3; root.add(crew);

  root.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });

  const joints = { siegeArm };
  for (const n of ['body', 'chest', 'head', 'leftHip', 'leftKnee', 'rightHip', 'rightKnee',
    'leftShoulder', 'leftElbow', 'leftHand', 'rightShoulder', 'rightElbow', 'rightHand']) {
    joints[n] = new THREE.Group();
  }
  return { root, horse: null, horseLegs: null, horseHead: null, horseBody: null, joints, siegeArm };
}

export function buildHumanoid(cfg) {
  const c = cfg;
  if (c.siege) return buildSiege(c);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = c.skin;

  // ---- Chest / torso (pivot at pelvis height 0.9) ----
  const chest = new THREE.Group();
  chest.position.y = 0.9;
  body.add(chest);

  const torso = box(0.52, 0.62, 0.3, c.torso, 0.75, c.torsoMetal || 0);
  torso.position.y = 0.31;
  chest.add(torso);

  // Belt / waist
  const belt = box(0.5, 0.12, 0.32, c.belt || 0x3a2a18, 0.8);
  belt.position.y = 0.04;
  chest.add(belt);

  // Shoulder pads / cloak flair
  if (c.pauldrons) {
    for (const sx of [-1, 1]) {
      const pad = cyl(0.15, 0.16, 0.14, c.armor, 8, 0.4, 0.5);
      pad.rotation.z = Math.PI / 2;
      pad.position.set(sx * 0.28, 0.52, 0);
      chest.add(pad);
    }
  }

  // ---- Head ----
  const head = new THREE.Group();
  head.position.y = 0.62;
  chest.add(head);
  const skull = box(0.24, 0.26, 0.24, skin, 0.6);
  skull.position.y = 0.14;
  head.add(skull);
  // Simple face shadow / nose
  // Facial features live on the -z side: that is the unit's combat "forward"
  // (where the arms, shield and weapon are posed), so the face and the fight
  // point the same way — toward the enemy.
  const nose = box(0.05, 0.06, 0.06, skin, 0.6);
  nose.position.set(0, 0.12, -0.13);
  head.add(nose);

  if (c.helmet === 'roman') {
    const helm = cyl(0.15, 0.16, 0.2, c.armor, 12, 0.35, 0.6);
    helm.position.y = 0.2;
    head.add(helm);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: c.armor, metalness: 0.6, roughness: 0.35 })
    );
    dome.position.y = 0.3;
    dome.castShadow = true;
    head.add(dome);
    // Transverse crest (centurion plume)
    const crest = box(0.04, 0.14, 0.42, c.crest || 0xd43a3a, 0.9);
    crest.position.y = 0.44;
    head.add(crest);
    // Cheek guards
    for (const sx of [-1, 1]) {
      const cheek = box(0.04, 0.14, 0.1, c.armor, 0.4, 0.55);
      cheek.position.set(sx * 0.13, 0.16, -0.06);
      head.add(cheek);
    }
  } else if (c.helmet === 'barbarian') {
    // Wild hair
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshStandardMaterial({ color: c.hair || 0x5a3a1e, roughness: 1 })
    );
    hair.position.y = 0.22;
    hair.scale.y = 0.85;
    hair.castShadow = true;
    head.add(hair);
    // Horned helm band
    for (const sx of [-1, 1]) {
      const horn = cyl(0.02, 0.06, 0.26, 0xddd3b8, 6, 0.7);
      horn.position.set(sx * 0.15, 0.28, 0);
      horn.rotation.z = sx * -0.6;
      head.add(horn);
    }
    // Beard
    const beard = box(0.18, 0.14, 0.08, c.hair || 0x5a3a1e, 1);
    beard.position.set(0, 0.02, -0.1);
    head.add(beard);
    if (c.horns) {
      for (const sx of [-1, 1]) {
        const horn = cyl(0.025, 0.08, 0.34, 0xe8dcc0, 6, 0.6);
        horn.position.set(sx * 0.16, 0.34, 0);
        horn.rotation.z = sx * -0.5;
        head.add(horn);
      }
    }
  } else if (c.helmet === 'romanLight') {
    // Simple leather cap for skirmishers / archers.
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.9 })
    );
    cap.position.y = 0.24;
    cap.castShadow = true;
    head.add(cap);
  } else if (c.helmet === 'tricorne') {
    // Three-cornered hat: a low crown over a wide up-turned brim.
    const felt = c.hat || 0x1c1712;
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: felt, roughness: 0.95 })
    );
    crown.position.y = 0.2; crown.scale.y = 0.72; crown.castShadow = true; head.add(crown);
    const brim = cyl(0.28, 0.28, 0.035, felt, 3, 0.95);   // triangular brim
    brim.position.y = 0.19; brim.rotation.y = Math.PI / 2; head.add(brim);
    if (c.cockade) { const c2 = box(0.05, 0.05, 0.02, c.cockade, 0.7); c2.position.set(-0.12, 0.24, -0.02); head.add(c2); }
  } else if (c.helmet === 'bearskin') {
    // Tall grenadier bearskin cap.
    const fur = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.17, 0.38, 12),
      new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 })
    );
    fur.position.y = 0.36; fur.castShadow = true; head.add(fur);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 })
    );
    dome.position.y = 0.54; head.add(dome);
    const plate = box(0.16, 0.1, 0.02, c.plate || 0xcaa23a, 0.4, 0.6); plate.position.set(0, 0.3, -0.15); head.add(plate);
  }

  // ---- Legs ----
  const legs = {};
  for (const side of ['left', 'right']) {
    const sx = side === 'left' ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(sx * 0.13, 0.9, 0);
    body.add(hip);

    const thigh = cyl(0.11, 0.1, 0.45, c.legs, 8, 0.8);
    thigh.position.y = -0.225;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);
    const shin = cyl(0.09, 0.07, 0.45, c.legs, 8, 0.8);
    shin.position.y = -0.225;
    knee.add(shin);

    const foot = box(0.14, 0.1, 0.28, c.boots || 0x2a1c10, 0.9);
    foot.position.set(0, -0.45, 0.05);
    knee.add(foot);

    // Roman leg skirt (pteruges) hint
    legs[side] = { hip, knee };
  }

  // Roman pteruges (leather strips) at the belt
  if (c.skirt) {
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.14;
      const strip = box(0.09, 0.22, 0.04, c.skirt, 0.85);
      strip.position.set(Math.sin(a) * 0.24, -0.05, 0.16);
      strip.rotation.x = 0.15;
      chest.add(strip);
    }
  }

  // ---- Arms ----
  const arms = {};
  for (const side of ['left', 'right']) {
    const sx = side === 'left' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.3, 0.5, 0);
    chest.add(shoulder);

    const upper = cyl(0.09, 0.08, 0.3, c.arms || skin, 8, 0.7);
    upper.position.y = -0.15;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    const fore = cyl(0.075, 0.065, 0.3, c.arms || skin, 8, 0.7);
    fore.position.y = -0.15;
    elbow.add(fore);

    const hand = new THREE.Group();
    hand.position.y = -0.3;
    elbow.add(hand);
    const palm = box(0.09, 0.1, 0.11, skin, 0.6);
    hand.add(palm);

    arms[side] = { shoulder, elbow, hand };
  }

  // ---- Weapons & shield ----
  attachEquipment(c, arms);

  // Rest pose: arms slightly down at sides.
  arms.left.shoulder.rotation.x = 0.15;
  arms.right.shoulder.rotation.x = 0.15;
  arms.left.elbow.rotation.x = 0.25;
  arms.right.elbow.rotation.x = 0.25;

  // ---- Mount: seat the rider on a horse ----
  let horse = null, horseLegs = null, horseHead = null, horseBody = null;
  if (c.mounted) {
    const h = buildHorse(c);
    root.add(h.group);
    horse = h.group; horseLegs = h.legs; horseHead = h.head; horseBody = h.body;
    // Lift the rider onto the saddle and splay the legs down the horse's sides.
    body.position.y = 0.5;
    legs.left.hip.rotation.set(0.35, 0, 0.55); legs.left.knee.rotation.x = -1.25;
    legs.right.hip.rotation.set(0.35, 0, -0.55); legs.right.knee.rotation.x = -1.25;
  }

  root.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });

  return {
    root, horse, horseLegs, horseHead, horseBody,
    joints: {
      body, chest, head,
      leftHip: legs.left.hip, leftKnee: legs.left.knee,
      rightHip: legs.right.hip, rightKnee: legs.right.knee,
      leftShoulder: arms.left.shoulder, leftElbow: arms.left.elbow, leftHand: arms.left.hand,
      rightShoulder: arms.right.shoulder, rightElbow: arms.right.elbow, rightHand: arms.right.hand,
    },
  };
}

function attachEquipment(c, arms) {
  // Right hand = primary weapon.
  if (c.weapon === 'gladius') {
    const sword = new THREE.Group();
    const blade = box(0.06, 0.55, 0.02, 0xd8d8dc, 0.25, 0.85);
    blade.position.y = -0.32;
    sword.add(blade);
    const guard = box(0.16, 0.04, 0.05, 0xd9b45a, 0.4, 0.6);
    guard.position.y = -0.04;
    sword.add(guard);
    const grip = cyl(0.03, 0.03, 0.14, 0x5a3a1e, 6, 0.8);
    grip.position.y = 0.06;
    sword.add(grip);
    const pommel = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.6, roughness: 0.3 })
    );
    pommel.position.y = 0.14;
    sword.add(pommel);
    sword.rotation.x = 0; // blade in line with the forearm (points where the hand points)
    arms.right.hand.add(sword);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -0.55, 0);
  } else if (c.weapon === 'axe') {
    const axe = new THREE.Group();
    const haft = cyl(0.035, 0.035, 0.8, 0x5a3a1e, 8, 0.9);
    haft.position.y = -0.3;
    axe.add(haft);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.3 });
    const bladeGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 12, 1, false, -0.9, 1.8);
    const abl = new THREE.Mesh(bladeGeo, headMat);
    abl.rotation.x = Math.PI / 2;
    abl.rotation.z = Math.PI / 2;
    abl.position.set(0.08, -0.62, 0);
    abl.castShadow = true;
    axe.add(abl);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), headMat);
    spike.position.y = 0.12;
    axe.add(spike);
    axe.rotation.x = 0;
    arms.right.hand.add(axe);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -0.7, 0);
  } else if (c.weapon === 'club') {
    const club = new THREE.Group();
    const haft = cyl(0.05, 0.07, 0.7, 0x4a3018, 8, 1);
    haft.position.y = -0.35;
    club.add(haft);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.03, 0.1, 5),
        new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.6, roughness: 0.4 })
      );
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.09, -0.62, Math.sin(a) * 0.09);
      spike.rotation.z = -Math.cos(a) * 1.4;
      spike.rotation.x = Math.sin(a) * 1.4;
      club.add(spike);
    }
    club.rotation.x = 0;
    arms.right.hand.add(club);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -0.7, 0);
  } else if (c.weapon === 'spear' || c.weapon === 'pike' || c.weapon === 'javelin') {
    const len = c.weapon === 'pike' ? 3.2 : c.weapon === 'javelin' ? 1.2 : 2.1;
    const spear = new THREE.Group();
    const shaft = cyl(0.028, 0.032, len, 0x6b4a26, 8, 0.85);
    // Grip near the rear third so most of the shaft points forward.
    shaft.position.y = -(len * 0.5 - 0.25);
    spear.add(shaft);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.28, 8),
      new THREE.MeshStandardMaterial({ color: 0xcdd2d8, metalness: 0.7, roughness: 0.3 })
    );
    tip.position.y = -(len - 0.25) + 0.02;
    tip.rotation.x = Math.PI;
    tip.castShadow = true;
    spear.add(tip);
    if (c.weapon !== 'javelin') {
      const butt = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 6),
        new THREE.MeshStandardMaterial({ color: 0x9a8a5a, metalness: 0.5, roughness: 0.4 }));
      butt.position.y = 0.25;
      spear.add(butt);
    }
    // Spears and pikes mount IN-LINE with the forearm so a leveled arm points
    // the tip straight at the foe (the poses hold the arm out level). The
    // javelin stays perpendicular — it's carried, then thrown overhand.
    spear.rotation.x = c.weapon === 'javelin' ? -Math.PI / 2 : 0;
    arms.right.hand.add(spear);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -(len - 0.25), 0);
  } else if (c.weapon === 'greataxe') {
    const axe = new THREE.Group();
    const haft = cyl(0.045, 0.045, 1.05, 0x4a3018, 8, 0.9);
    haft.position.y = -0.35;
    axe.add(haft);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xaeb4ba, metalness: 0.8, roughness: 0.3 });
    for (const s of [1, -1]) {                       // double-bitted head
      const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 14, 1, false, -0.7, 1.4), headMat);
      bl.rotation.x = Math.PI / 2;
      bl.rotation.z = Math.PI / 2;
      bl.position.set(s * 0.13, -0.82, 0);
      bl.castShadow = true;
      axe.add(bl);
    }
    axe.rotation.x = 0;
    arms.right.hand.add(axe);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -0.92, 0);
    arms.left.shoulder.userData.grip = { x: 0.7, z: -0.3 }; // two-handed
    arms.left.elbow.userData.grip = { x: 1.0 };
  } else if (c.weapon === 'maul') {
    const maul = new THREE.Group();
    const haft = cyl(0.05, 0.05, 1.0, 0x4a3018, 8, 0.95);
    haft.position.y = -0.35;
    maul.add(haft);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6e, metalness: 0.6, roughness: 0.5 });
    const head = box(0.26, 0.26, 0.4, 0x6a6a6e, 0.5, 0.6);
    head.material = headMat;
    head.position.y = -0.82;
    head.castShadow = true;
    maul.add(head);
    maul.rotation.x = 0;
    arms.right.hand.add(maul);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -0.82, 0);
    arms.left.shoulder.userData.grip = { x: 0.7, z: -0.3 };
    arms.left.elbow.userData.grip = { x: 1.0 };
  } else if (c.weapon === 'bow') {
    // Bow rides in the LEFT hand; the right hand draws the string.
    const bow = new THREE.Group();
    const limb = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.02, 6, 16, Math.PI * 1.1),
      new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.7 })
    );
    limb.rotation.z = Math.PI / 2 - 0.55;
    bow.add(limb);
    const string = cyl(0.005, 0.005, 0.62, 0xe8e2d0, 4, 0.4);
    string.position.z = 0.02;
    bow.add(string);
    bow.position.set(0, -0.05, 0.1);
    bow.rotation.x = -1.15;              // stand it upright against the forward arm
    arms.left.hand.add(bow);
    arms.left.hand.userData.isBow = true;
  } else if (c.weapon === 'musket' || c.weapon === 'rifle') {
    // A flintlock muzzle-loader built along the hand's local axis: the BUTT sits
    // behind the grip (+y, to tuck into the shoulder) and the barrel runs forward
    // (−y) to a socket bayonet. Grip is at the wrist (y≈0), by the lock.
    const rifle = c.weapon === 'rifle';
    const long = rifle ? 1.55 : 1.34;          // barrel length forward of the grip
    const wood = rifle ? 0x6a4a26 : 0x5c3d20;
    const iron = 0x2b2b30, brass = 0xb08a3a;
    const gun = new THREE.Group();
    // ---- Butt & stock (behind the hand) ----
    const butt = box(0.085, 0.34, 0.13, wood, 0.82); butt.position.set(0, 0.24, 0.015); butt.rotation.x = 0.12; gun.add(butt);
    const comb = box(0.06, 0.2, 0.06, wood, 0.82); comb.position.set(0, 0.12, -0.02); gun.add(comb);       // wrist/comb
    const buttplate = box(0.09, 0.05, 0.14, brass, 0.4, 0.6); buttplate.position.set(0, 0.41, 0.02); buttplate.rotation.x = 0.12; gun.add(buttplate);
    // ---- Lock, hammer, trigger guard (at the grip) ----
    const lock = box(0.03, 0.11, 0.07, iron, 0.5, 0.55); lock.position.set(0.05, 0.0, 0); gun.add(lock);
    const hammer = box(0.02, 0.07, 0.03, iron, 0.5, 0.6); hammer.position.set(0.06, 0.05, 0.03); hammer.rotation.z = -0.6; gun.add(hammer);
    const guard = cyl(0.008, 0.008, 0.1, brass, 5, 0.4, 0.5); guard.position.set(0, -0.06, 0.03); guard.rotation.x = 0.15; gun.add(guard);
    // ---- Forestock + barrel (forward of the hand) ----
    const fore = box(0.055, long * 0.6, 0.07, wood, 0.82); fore.position.y = -(long * 0.3); gun.add(fore);
    const barrel = cyl(0.017, 0.021, long, iron, 10, 0.32, 0.65); barrel.position.y = -(long * 0.5); gun.add(barrel);
    const bands = [-0.35, -0.62, -0.86];
    for (const f of bands) { const b = cyl(0.03, 0.03, 0.035, brass, 8, 0.4, 0.5); b.position.y = long * f; gun.add(b); }
    const ramrod = cyl(0.008, 0.008, long * 0.72, 0x8a6a3a, 5, 0.7); ramrod.position.set(0, -(long * 0.42), 0.055); gun.add(ramrod);
    const muzzle = cyl(0.026, 0.026, 0.05, iron, 10, 0.35, 0.6); muzzle.position.y = -(long + 0.02); gun.add(muzzle);
    // ---- Socket bayonet ----
    const bayonet = new THREE.Mesh(
      new THREE.ConeGeometry(0.016, rifle ? 0.34 : 0.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xd2d6dc, metalness: 0.7, roughness: 0.28 })
    );
    bayonet.position.y = -(long + 0.06 + (rifle ? 0.17 : 0.2)); bayonet.rotation.x = Math.PI; bayonet.castShadow = true; gun.add(bayonet);
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    arms.right.hand.add(gun);
    arms.right.hand.userData.weaponTip = new THREE.Vector3(0, -(long + 0.3), 0);
    arms.right.hand.userData.muzzle = new THREE.Vector3(0, -(long + 0.02), 0);   // for the muzzle flash
    // Off hand cradles the forestock forward of the lock.
    arms.left.shoulder.userData.grip = { x: 0.85, z: -0.14 };
    arms.left.elbow.userData.grip = { x: 0.7 };
  }

  // Left hand = shield, bow-grip or bare.
  if (c.shield === 'scutum') {
    const shield = new THREE.Group();
    const board = box(0.5, 0.72, 0.06, 0xb02a2a, 0.7);
    shield.add(board);
    const boss = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.6, roughness: 0.3 })
    );
    boss.position.z = 0.06;
    shield.add(boss);
    // Golden wing motif bars
    for (const yy of [0.18, -0.18]) {
      const bar = box(0.4, 0.04, 0.02, 0xd9b45a, 0.5, 0.5);
      bar.position.set(0, yy, 0.035);
      shield.add(bar);
    }
    shield.position.set(0, -0.15, 0.14);
    shield.rotation.set(-Math.PI / 2, 0, 0);   // stand it upright, face to the foe
    arms.left.hand.add(shield);
    // Keep left arm bent to hold shield in front.
    arms.left.shoulder.userData.hold = { x: 0.5, z: 0.25 };
    arms.left.elbow.userData.hold = { x: 1.1 };
  } else if (c.shield === 'round') {
    const shield = new THREE.Group();
    const board = cyl(0.34, 0.34, 0.06, 0x5a3a1e, 16, 0.85);
    board.rotation.x = Math.PI / 2;
    shield.add(board);
    const boss = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.5, roughness: 0.5 })
    );
    boss.position.z = 0.06;
    shield.add(boss);
    shield.position.set(0, -0.15, 0.14);
    shield.rotation.set(-Math.PI / 2, 0, 0);   // face to the foe
    arms.left.hand.add(shield);
    arms.left.shoulder.userData.hold = { x: 0.5, z: 0.25 };
    arms.left.elbow.userData.hold = { x: 1.1 };
  } else if (c.shield === 'parma') {
    const shield = new THREE.Group();
    const board = cyl(0.24, 0.24, 0.05, 0xb02a2a, 16, 0.8);
    board.rotation.x = Math.PI / 2;
    shield.add(board);
    const boss = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.6, roughness: 0.3 })
    );
    boss.position.z = 0.05;
    shield.add(boss);
    shield.position.set(0, -0.15, 0.14);
    shield.rotation.set(-Math.PI / 2, 0, 0);   // face to the foe
    arms.left.hand.add(shield);
    arms.left.shoulder.userData.hold = { x: 0.5, z: 0.25 };
    arms.left.elbow.userData.hold = { x: 1.1 };
  }

  // Left-arm rest posture when there is no shield.
  if (arms.left.hand.userData.isBow) {
    // Extend the bow arm forward.
    arms.left.shoulder.userData.hold = { x: 1.15, z: 0.1 };
    arms.left.elbow.userData.hold = { x: 0.15 };
  } else if (arms.left.shoulder.userData.grip) {
    // Two-handed weapon: bring the off hand across to grip the haft.
    arms.left.shoulder.userData.hold = arms.left.shoulder.userData.grip;
    arms.left.elbow.userData.hold = arms.left.elbow.userData.grip;
  }
}

// Faction presets --------------------------------------------------------
export const ROMAN_CONFIG = {
  skin: 0xc99a6a,
  torso: 0xb5b8bd,      // segmented lorica (steel)
  torsoMetal: 0.55,
  armor: 0xc9ccd2,
  arms: 0xc99a6a,
  legs: 0xc99a6a,
  belt: 0x6a4a28,
  boots: 0x3a2414,
  crest: 0xd43a3a,
  skirt: 0x7a5230,      // pteruges
  helmet: 'roman',
  pauldrons: true,
  weapon: 'gladius',
  shield: 'scutum',
};

export const BARBARIAN_CONFIG = {
  skin: 0xcaa073,
  torso: 0x8a5a34,      // bare/fur chest
  arms: 0xcaa073,
  legs: 0x5a4028,       // fur trousers
  belt: 0x2a1a0e,
  boots: 0x3a2414,
  hair: 0x6b4423,
  helmet: 'barbarian',
  weapon: 'axe',
  shield: 'round',
};

// ---- American Revolution ----
export const CONTINENTAL_CONFIG = {
  skin: 0xc99a6a,
  torso: 0x28407a,      // blue regimental coat
  arms: 0x28407a,
  legs: 0xd8d0bc,       // white breeches
  belt: 0xe6ddc8,       // crossbelts
  boots: 0x2a1c10,
  helmet: 'tricorne',
  pauldrons: false,
  weapon: 'musket',
  shield: null,
};
export const BRITISH_CONFIG = {
  skin: 0xcaa07a,
  torso: 0xa42a24,      // red coat
  arms: 0xa42a24,
  legs: 0xe0d8c4,
  belt: 0xeee6d4,
  boots: 0x1e150c,
  helmet: 'tricorne',
  pauldrons: false,
  weapon: 'musket',
  shield: null,
};

const CONFIGS = {
  antiquity: { roman: ROMAN_CONFIG, barbarian: BARBARIAN_CONFIG },
  revolution: { roman: CONTINENTAL_CONFIG, barbarian: BRITISH_CONFIG },
};

// The base humanoid config for a side in an era (a unit type's cfg layers on top).
export function baseConfig(era, faction) {
  return (CONFIGS[era] || CONFIGS.antiquity)[faction];
}
