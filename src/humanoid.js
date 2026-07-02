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

export function buildHumanoid(cfg) {
  const c = cfg;
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

  root.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = true; });

  return {
    root,
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
    sword.rotation.x = -Math.PI / 2; // point forward when arm hangs
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
    axe.rotation.x = -Math.PI / 2;
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
    club.rotation.x = -Math.PI / 2;
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
    spear.rotation.x = -Math.PI / 2;
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
    axe.rotation.x = -Math.PI / 2;
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
    maul.rotation.x = -Math.PI / 2;
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
    arms.left.hand.add(bow);
    arms.left.hand.userData.isBow = true;
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
    shield.rotation.set(0.1, 0, 0);
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
