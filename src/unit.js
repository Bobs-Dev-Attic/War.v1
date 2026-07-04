import * as THREE from 'three';
import { buildHumanoid, ROMAN_CONFIG, BARBARIAN_CONFIG } from './humanoid.js';
import { rollAttributes, deriveStats, pickName, rankFor, PROFILES } from './attributes.js';
import { MOVES, pickCombo } from './moves.js';
import { UNIT_TYPES } from './unitTypes.js';

let _uid = 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The fastest a foot soldier can ever be: the best possible Speed roll times the
// quickest infantry type's speed bonus. Derived from the data so it stays right
// if attributes or unit types change.
const _MAX_SPD_ATTR = Math.max(...Object.values(PROFILES).map((p) => p.spd[1]));
const _TOP_FOOT_TYPE_MUL = Math.max(1, ...Object.values(UNIT_TYPES)
  .filter((t) => t.role !== 'siege' && !(t.cfg && t.cfg.mounted))
  .map((t) => (t.stat && t.stat.speed) || 1));
const TOP_FOOT_SPEED = deriveStats({ str: 18, dex: 18, con: 18, spd: _MAX_SPD_ATTR, exp: 18 }).speed * _TOP_FOOT_TYPE_MUL;
// A mount at full health moves AT LEAST twice as fast as the fastest foot soldier.
const MOUNTED_MIN_SPEED = 2 * TOP_FOOT_SPEED;

export class Unit {
  constructor(faction, position, typeKey) {
    this.id = _uid++;
    this.faction = faction;                 // 'roman' | 'barbarian'
    this.typeKey = typeKey || (faction === 'roman' ? 'legionary' : 'warrior');
    const type = UNIT_TYPES[this.typeKey];
    this.type = type;
    this.role = type.role;                   // 'melee' | 'pike' | 'ranged'
    this.ranged = type.ranged || null;

    // Roll this soldier as an individual, then derive combat stats.
    this.attrs = rollAttributes(faction);
    this.stats = deriveStats(this.attrs);
    this.name = pickName(faction);
    this.rank = type.label;

    // Apply the type's specialities on top of the rolled stats.
    const m = type.stat || {};
    if (m.hp) this.stats.maxHp = Math.round(this.stats.maxHp * m.hp);
    if (m.dmg) this.stats.dmg *= m.dmg;
    if (m.speed) this.stats.speed *= m.speed;
    if (m.toughness) this.stats.toughness = clamp(this.stats.toughness + m.toughness, 0, 0.6);
    if (m.block) this.stats.block = clamp(this.stats.block + m.block, 0, 0.7);
    if (m.crit) this.stats.crit = clamp(this.stats.crit + m.crit, 0, 0.7);
    if (m.dodge) this.stats.dodge = clamp(this.stats.dodge + m.dodge, 0, 0.6);
    if (m.accuracy) this.stats.accuracy = clamp(this.stats.accuracy + m.accuracy, 0, 0.99);
    this.elite = !!m.elite;

    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.range = type.reach;
    this.speed = this.stats.speed;
    this.baseSpeed = this.stats.speed;      // healthy, rested top speed
    this.stamina = 1;                       // 1 = fresh, drains with exertion
    this.staminaRegen = 0.05 + this.attrs.con * 0.004;
    this.attackTime = this.stats.attackTime;
    this.turnSpeed = this.stats.turn;
    this.stride = Math.random() * 10;       // gait cycle phase
    this.comboList = type.combos;
    this.rangedCooldown = Math.random() * 0.8;

    // Orders: 'aggressive' | 'hold' | 'retreat' | 'surrender'
    this.order = faction === 'roman' ? 'hold' : 'aggressive';
    this.moveTarget = null;                  // Vector3 (explicit move command)
    this.forcedTarget = null;                // Unit (focus-fire command)

    const base = faction === 'roman' ? ROMAN_CONFIG : BARBARIAN_CONFIG;
    const cfg = { ...base, ...type.cfg };
    this.weaponKind = cfg.weapon;
    this.polearm = cfg.weapon === 'spear' || cfg.weapon === 'pike';
    this.twoHanded = cfg.weapon === 'greataxe' || cfg.weapon === 'maul';
    this.isBow = cfg.weapon === 'bow';
    this.mounted = !!cfg.mounted;
    this.siege = !!cfg.siege;
    this.siegeKind = cfg.siege || null;
    this.shoveCooldown = Math.random() * 1.5;
    const built = buildHumanoid(cfg);
    this.root = built.root;
    this.j = built.joints;
    this.siegeArm = built.siegeArm || null;
    this.horse = built.horse;
    this.horseLegs = built.horseLegs;
    this.horseHead = built.horseHead;
    this.horseBody = built.horseBody;
    // Mounted state: the horse is its own creature — it has its own health, its
    // legs/head can be hacked off, and it can rear, kick and jump.
    if (this.mounted) {
      this.horseMaxHp = Math.round(this.maxHp * 1.2);
      this.horseHp = this.horseMaxHp;
      this.horseAlive = true;
      this.horseParts = { head: true, fl: true, fr: true, bl: true, br: true };
      this.horseImmobile = false;
      this.mountSpeedMul = (type.stat && type.stat.speed) ? type.stat.speed : 1;
      // Speed this rider would move on foot once thrown from the saddle.
      this.footSpeed = this.stats.speed / this.mountSpeedMul;
      // Mounted at full health = at least twice the fastest foot soldier.
      this.baseSpeed = Math.max(this.stats.speed, MOUNTED_MIN_SPEED);
      this.speed = this.baseSpeed;
      this.horseMove = null;              // { kind:'rear'|'kick', t, hitDone }
      this.horseAttackCd = Math.random() * 2;
      this.pranceCd = 1 + Math.random() * 3;
      this.jumpT = -1;                    // -1 = grounded; ≥0 = in the air
      this.jumpY = 0;
      this.jumpCd = Math.random() * 3;
      this.charging = null;               // { t, dir } during a run-through charge
      this._chargeCd = Math.random() * 2;
    }
    this.root.position.copy(position);
    // Subtle per-soldier build: the burly stand a touch taller and broader;
    // elite champions (Praetorian, Chieftain) stand out a little more.
    let scale = (0.94 + THREE.MathUtils.clamp((this.stats.build - 11) / 12, -0.06, 0.12)) * (this.elite ? 1.08 : 1);
    if (this.siege) scale = 1;
    this.root.scale.setScalar(scale);
    // Cavalry — and, more so, siege engines — have a much bigger footprint.
    this.radius = (this.siege ? 1.15 : this.mounted ? 0.95 : 0.5) * scale;
    this.root.userData.unit = this;
    this.root.traverse((o) => { o.userData.unit = this; });

    this.facing = faction === 'roman' ? 0 : Math.PI;   // face the enemy
    this.spinOffset = 0;                     // extra yaw during spin moves
    this._applyFacing();

    this.state = 'idle';                     // idle | moving | attack | defense | flinch | dead
    this.animT = Math.random() * 10;         // idle/guard phase
    this.attackCooldown = 0;
    this.hasShield = type.cfg.shield != null; // archers/berserkers carry none

    // Body integrity — parts can be hacked off.
    this.parts = { head: true, leftArm: true, rightArm: true, leftLeg: true, rightLeg: true };
    this.crawling = false;
    this.disarmed = false;
    this._inWall = 0;                        // holding allies packed in alongside (shield-wall strength)
    // Knocked flat (e.g. ridden down by a charge) — prone, then scrambles up.
    this.knockedDown = false;
    this.downT = 0;
    this.getUpTime = 1.4;
    this._trampleCd = 0;                     // gap between one mount's trample hits

    // Combat move/combo state.
    this.move = null;                        // { def, name, t, hitDone } while a move plays
    this.combo = null;                       // queued attack sequence
    this.comboIndex = 0;
    this.comboGap = 0;                       // pause between strikes
    this._comboTarget = null;

    this.deathT = 0;
    this.surrenderT = 0;
    this.dropped = false;
    this.alive = true;
    this.hasSurrendered = false;

    this._buildHealthBar();
    this._buildSelectionRing();

    // Scratch vectors
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  get position() { return this.root.position; }

  // Footprint used for unit-vs-unit separation. A braced shield wall packs in
  // tighter than loose troops, letting a Stand-Ground line close its gaps.
  collisionRadius() {
    return (this.defensive && this.order === 'hold') ? this.radius * 0.78 : this.radius;
  }

  _buildHealthBar() {
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x1a0d0d, side: THREE.DoubleSide })
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.09),
      new THREE.MeshBasicMaterial({ color: this.faction === 'roman' ? 0x4fd06a : 0xe0453a, side: THREE.DoubleSide })
    );
    fill.position.z = 0.001;
    this._fillFullWidth = 0.86;
    this.fill = fill;
    bar.add(bg);
    bar.add(fill);
    bar.position.y = this.siege ? 2.7 : this.mounted ? 2.95 : 2.15;   // clear the rider's head / engine frame
    bar.renderOrder = 999;
    bg.material.depthTest = false;
    fill.material.depthTest = false;
    this.healthBar = bar;
    this.root.add(bar);
  }

  _buildSelectionRing() {
    const rr = this.siege ? 1.3 : this.mounted ? 1.05 : 0.55;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(rr, rr + 0.17, 32),
      new THREE.MeshBasicMaterial({
        color: this.faction === 'roman' ? 0x4fd06a : 0xd04f4f,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    this.selectionRing = ring;
    this.root.add(ring);
  }

  setSelected(on) {
    this.selected = on;
    if (this.faction === 'roman') this.selectionRing.visible = on && this.alive;
  }
  setHovered(on) {
    if (this.faction === 'barbarian' && this.alive) this.selectionRing.visible = on;
  }

  // ---- Combat ------------------------------------------------------------
  applyDamage(amount, fromDir, stagger = false, game) {
    if (!this.alive || this.hasSurrendered) return;
    // A blow at a mounted fighter mostly strikes the big target — the horse —
    // and only partly reaches the rider up in the saddle.
    if (this.mounted && this.horseAlive) {
      this.horseHp -= amount * 0.6;
      if (this.horseHp <= 0) {
        this.horseHp = 0;
        this._horseDown(fromDir, game);
      }
      amount *= 0.4;
    }
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this._die(fromDir, game);
      return;
    }
    // Flinch if we weren't mid-move; a stagger interrupts anything we were doing.
    if (!this.move || stagger) {
      if (stagger) { this.combo = null; this.comboGap = 0; }
      this._startMove('flinch');
    }
  }

  _die(fromDir, game) {
    this.alive = false;
    this.state = 'dead';
    this.move = null;
    this.combo = null;
    this.spinOffset = 0;
    this._applyFacing();
    this.deathT = 0;
    this._deathDir = fromDir ? Math.sign(fromDir) : (Math.random() < 0.5 ? 1 : -1);
    this.healthBar.visible = false;
    this.selectionRing.visible = false;
    if (game) {
      if (this.siege) {
        // A wrecked engine throws up a cloud of dust and splinters, not blood.
        game.spawnDust(this.position.x, this.position.z, 20, 2.4);
        game.spawnDecal(this.position.x, this.position.z, 1.0, 0.6);
      } else {
        // Drop weapon and shield, and bleed out where you fall.
        this._dropWeapon(game);
        this._dropShield(game);
        this._v.set(this.position.x, 1.1, this.position.z);
        game.spawnBlood(this._v, { x: this._deathDir, z: 0 }, 16, 1.3);
        game.spawnDecal(this.position.x, this.position.z, 0.55, 0.85);
      }
    }
  }

  // ---- Dismemberment -----------------------------------------------------
  // Hack off a body part: it flies off as a gib, leaves a bleeding stump, and
  // changes how the soldier can fight.
  sever(part, game, dir = 1) {
    if (!this.parts[part]) return;
    this.parts[part] = false;
    const MAP = {
      head: { joint: 'head', refs: ['head'] },
      leftArm: { joint: 'leftShoulder', refs: ['leftShoulder', 'leftElbow', 'leftHand'] },
      rightArm: { joint: 'rightShoulder', refs: ['rightShoulder', 'rightElbow', 'rightHand'] },
      leftLeg: { joint: 'leftHip', refs: ['leftHip', 'leftKnee'] },
      rightLeg: { joint: 'rightHip', refs: ['rightHip', 'rightKnee'] },
    };
    const info = MAP[part];
    const obj = this.j[info.joint];
    if (!obj || !obj.parent) return;
    const parent = obj.parent;
    const localPos = obj.position.clone();
    const wound = new THREE.Vector3();
    obj.getWorldPosition(wound);
    // Cap the raw socket with a dark stump.
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(part === 'head' ? 0.11 : 0.1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x6e0a0a, roughness: 0.6 })
    );
    cap.position.copy(localPos);
    parent.add(cap);
    // Fling the limb off as a gib.
    const vel = new THREE.Vector3(dir * (1 + Math.random() * 2.2), 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2);
    const spin = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
    game.addGib(obj, vel, spin);
    // Swap the now-detached joints for throwaway dummies so animation code can't
    // move the gib on the ground.
    for (const n of info.refs) this.j[n] = new THREE.Object3D();
    // Gush of blood + a bleeding stump.
    game.spawnBlood(wound, { x: dir, z: 0 }, 26, 1.7);
    game.addBleeder(this, this.root.worldToLocal(wound.clone()), 3.5);
    // Consequences.
    if (part === 'head') { if (this.alive) this._die(dir, game); }
    else if (part === 'leftLeg' || part === 'rightLeg') {
      // Losing one leg drops you to a crawl; losing the whole lower body kills.
      if (!this.parts.leftLeg && !this.parts.rightLeg) this._die(dir, game);
      else this._fallAndCrawl();
    }
    else if (part === 'rightArm') { this.disarmed = true; this.move = null; this.combo = null; }
    else if (part === 'leftArm') { this.hasShield = false; }
  }

  // On a strong or killing blow, chance to lop off a limb.
  _severRandom(killing, attacker, game) {
    const dir = Math.sign(this.position.x - attacker.position.x) || 1;
    // A mounted fighter presents the horse as the bigger target: blows are as
    // likely to hack the horse's legs or head as the rider's own limbs.
    if (this.mounted && this.horseAlive) {
      const hopts = [];
      for (const leg of ['fl', 'fr', 'bl', 'br']) if (this.horseParts[leg]) hopts.push(leg);
      if (this.horseParts.head) hopts.push('head');
      if (hopts.length && Math.random() < 0.6) {
        this._severHorse(hopts[Math.floor(Math.random() * hopts.length)], game, dir);
        return;
      }
    }
    const opts = [];
    if (this.parts.rightArm) opts.push('rightArm');
    if (this.parts.leftArm) opts.push('leftArm');
    // Don't lop off a mounted rider's legs — they're wrapped round the horse.
    if (!this.mounted && this.parts.leftLeg) opts.push('leftLeg');
    if (!this.mounted && this.parts.rightLeg) opts.push('rightLeg');
    if (killing && this.parts.head) opts.push('head', 'head');   // decapitations on kills
    if (!opts.length) return;
    this.sever(opts[Math.floor(Math.random() * opts.length)], game, dir);
  }

  // Hack a piece off the horse: a leg cripples it (immobile), the head kills it.
  _severHorse(part, game, dir = 1) {
    if (!this.mounted || !this.horseAlive || !this.horseParts[part]) return;
    this.horseParts[part] = false;
    if (part === 'head') {
      const headG = this.horseHead;
      if (headG && headG.parent) {
        const wound = new THREE.Vector3();
        headG.getWorldPosition(wound);
        const vel = new THREE.Vector3(dir * (1 + Math.random() * 2), 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2);
        game.addGib(headG, vel, new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8));
        this.horseHead = new THREE.Object3D();
        game.spawnBlood(wound, { x: dir, z: 0 }, 30, 1.9);
      }
      this._horseDown(dir, game);
      return;
    }
    // A leg: fling it off, leave a bloody stump, and the horse can no longer stand.
    const leg = this.horseLegs && this.horseLegs[part];
    if (leg && leg.hip && leg.hip.parent) {
      const wound = new THREE.Vector3();
      leg.hip.getWorldPosition(wound);
      const vel = new THREE.Vector3(dir * (0.5 + Math.random() * 1.5), 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2);
      game.addGib(leg.hip, vel, new THREE.Vector3((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7));
      this.horseLegs[part] = { hip: new THREE.Object3D(), knee: new THREE.Object3D() };
      game.spawnBlood(wound, { x: dir, z: 0 }, 22, 1.6);
    }
    // A crippled horse can't carry the fight — it collapses and throws its rider.
    this.horseImmobile = true;
    this._horseDown(dir, game);
  }

  // The horse dies: it drops, tilts onto its side, and pitches the rider off.
  _horseDown(fromDir, game) {
    if (!this.mounted || !this.horseAlive) return;
    this.horseAlive = false;
    this.horseImmobile = true;
    this.horseMove = null;
    if (this.healthBar) this.healthBar.position.y = 2.15;
    this._dismount(game, fromDir);
  }

  // The rider comes off the horse — falls to the ground but fights on foot:
  // they can still attack, defend and take orders.
  _dismount(game, fromDir = 1) {
    if (!this.mounted) return;
    this.mounted = false;
    const dir = Math.sign(fromDir) || (Math.random() < 0.5 ? 1 : -1);
    // Leave the (dead/crippled) horse behind as a carcass, tipped on its side.
    if (this.horse) {
      const hp = new THREE.Vector3();
      this.horse.getWorldPosition(hp);
      game.group.attach(this.horse);
      this.horse.position.copy(hp);
      this.horse.rotation.z = dir * (Math.PI / 2 - 0.15);
      this.horse.position.y = this.world ? this.world.heightAt(hp.x, hp.z) : 0;
    }
    // Put the rider back on their own two feet.
    this.j.body.position.y = 0;
    this.j.leftHip.rotation.set(0, 0, 0); this.j.leftKnee.rotation.x = 0;
    this.j.rightHip.rotation.set(0, 0, 0); this.j.rightKnee.rotation.x = 0;
    // Shrink the footprint back to a single soldier and reset the HUD anchors.
    const scale = this.root.scale.x;
    this.radius = 0.5 * scale;
    if (this.healthBar) this.healthBar.position.y = 2.15;
    if (this.selectionRing) this.selectionRing.geometry = new THREE.RingGeometry(0.55, 0.72, 32);
    // Lose the horse's speed entirely — back to a foot-soldier's pace.
    if (this.footSpeed) {
      this.baseSpeed = this.footSpeed;
      this.speed = this.footSpeed;
    }
    // Stumble on landing.
    if (this.alive && !this.hasSurrendered) this._startMove('flinch');
  }

  _fallAndCrawl() {
    if (this.crawling) return;
    this.crawling = true;
    this.speed = 0.5;              // a slow, agonised drag
    this.move = null;
    this.combo = null;
  }

  _dropWeapon(game) {
    if (!this.parts.rightArm || this._weaponDropped) return;
    const weapon = this.j.rightHand.children.find((c) => c.type === 'Group');
    if (!weapon) return;
    this._weaponDropped = true;
    game.addGib(weapon, new THREE.Vector3((Math.random() - 0.5) * 2, 1.6, (Math.random() - 0.5) * 2),
      new THREE.Vector3(2, 3, 1));
  }

  _dropShield(game) {
    if (!this.hasShield || this._shieldDropped) return;
    const shield = this.j.leftHand.children.find((c) => c.type === 'Group');
    if (!shield) return;
    this._shieldDropped = true;
    this.hasShield = false;
    game.addGib(shield, new THREE.Vector3((Math.random() - 0.5) * 2, 1.4, (Math.random() - 0.5) * 2),
      new THREE.Vector3(3, 1, 2));
  }

  surrender() {
    if (!this.alive || this.hasSurrendered) return;
    this.hasSurrendered = true;
    this.order = 'surrender';
    this.state = 'surrender';
    this.surrenderT = 0;
    this.forcedTarget = null;
    this.moveTarget = null;
  }

  celebrate() {
    if (!this.alive || this.hasSurrendered) return;
    this.celebrating = true;
    this.order = 'celebrate';
    this.move = null;
    this.combo = null;
  }

  // ---- Per-frame update --------------------------------------------------
  update(dt, game) {
    this._game = game;                       // current-frame ref for movement-time helpers (trample)
    if (this.state === 'dead') { this._animateDeath(dt); this._billboard(game); return; }
    if (this.hasSurrendered) { this._animateSurrender(dt, game); this._billboard(game); return; }
    if (this.celebrating) { this._animateCelebrate(dt); this._clampToField(); this._billboard(game); return; }
    if (this.knockedDown) { this._knockdownUpdate(dt, game); return; }
    if (this.crawling) { this._crawlUpdate(dt, game); return; }
    if (this._trampleCd > 0) this._trampleCd -= dt;

    // A soldier who routs to the very edge of the battlefield has fled the
    // fight for good — count them among the dead. Retreat orders halt at
    // z=±24 (well inside), so only genuine panicked flight reaches the rim.
    if (this.state !== 'dead') {
      const r2 = this.position.x * this.position.x + this.position.z * this.position.z;
      if (r2 > 28 * 28) { this._die(0, game); this._billboard(game); return; }
    }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.rangedCooldown > 0) this.rangedCooldown -= dt;
    if (this.shoveCooldown > 0) this.shoveCooldown -= dt;
    if (this.mounted && this.horseAlive && this.horseAttackCd > 0) this.horseAttackCd -= dt;
    if (this.mounted && this._chargeCd > 0) this._chargeCd -= dt;
    // Shield-bearers told to Stand Ground brace defensively.
    this.defensive = this.order === 'hold' && this.hasShield && !this.disarmed;
    if (this.order !== 'hold') this._inWall = 0;

    // Mid charge-through — drive straight on, riding down whatever's in the way.
    if (this.charging) { this._advanceCharge(dt, game); this._finishFrame(game); return; }

    // Siege engines are emplaced artillery — they hold their ground, traverse to
    // aim, and loose heavy shots. No marching, no melee.
    if (this.siege) { this._siegeUpdate(dt, game); this._finishFrame(game); return; }

    // The horse is mid-rear or mid-kick — play it out before anything else.
    if (this.horseMove) { this._advanceHorseMove(dt, game); this._finishFrame(game); return; }

    // A disarmed soldier (weapon arm gone) can't fight — they break and flee.
    if (this.disarmed) {
      const foe = game.nearestEnemy(this);
      if (foe) {
        const ax = this.position.x - foe.position.x;
        const az = this.position.z - foe.position.z;
        const len = Math.hypot(ax, az) || 1;
        this._v.set(this.position.x + (ax / len) * 4, 0, this.position.z + (az / len) * 4);
        this._moveToward(this._v, dt, 'run');
      } else {
        this._enterIdle(dt);
      }
      this._finishFrame(game);
      return;
    }

    // --- Combat action layer: a committed move (attack/defense/flinch) plays out.
    if (this.move) { this._advanceMove(dt, game); this._finishFrame(game); return; }

    // --- Mid-combo: brief guard between strikes, then the next strike.
    if (this.combo) {
      this.comboGap -= dt;
      const t = this._currentTarget(game);
      if (this.comboGap <= 0) {
        if (this.comboIndex < this.combo.length && t &&
            this.position.distanceTo(t.position) <= this.range + 0.6) {
          this._comboTarget = t;
          this._startMove(this.combo[this.comboIndex++]);
        } else {
          this.combo = null;
          this.attackCooldown = 0.4 + Math.random() * 0.5;
        }
      }
      if (t) this._faceTarget(t, dt);
      this._animateGuard(dt);
      this._finishFrame(game);
      return;
    }

    // --- Decide intent from current order.
    let target = null;
    let desiredMove = null;

    if (this.order === 'retreat') {
      const back = this.faction === 'roman' ? 24 : -24;
      desiredMove = this._v.set(this.position.x * 0.2, 0, back);
    } else if (this.moveTarget) {
      desiredMove = this._v.copy(this.moveTarget);
      if (this.position.distanceTo(this.moveTarget) < 0.6) this.moveTarget = null;
    } else if (this.order === 'aggressive' || this.order === 'hold') {
      target = this.forcedTarget && this.forcedTarget.alive && !this.forcedTarget.hasSurrendered
        ? this.forcedTarget
        : game.nearestEnemy(this);
      if (this.forcedTarget && (!this.forcedTarget.alive || this.forcedTarget.hasSurrendered)) {
        this.forcedTarget = null;
      }
    }

    if (desiredMove) {
      // Retreating soldiers run for their lives; ordered marches are a walk.
      this._moveToward(desiredMove, dt, this.order === 'retreat' ? 'run' : 'walk');
    } else if (target) {
      const dist = this.position.distanceTo(target.position);
      if (this.role === 'ranged') {
        this._rangedUpdate(dt, game, target, dist);
      } else {
        this._meleeUpdate(dt, game, target, dist);
      }
    } else {
      this._enterIdle(dt);
    }

    this._finishFrame(game);
  }

  _meleeUpdate(dt, game, target, dist) {
    this._faceTarget(target, dt);
    // Some horsemen, closing on the enemy, break into a run-through charge — riding
    // the foe down rather than pulling up to trade blows. Needs room, wind and a
    // fresh charge (off cooldown).
    if (this.mounted && this.horseAlive && !this.charging && this._chargeCd <= 0 &&
        this.order !== 'hold' && this.stamina > 0.35 && dist > 1.2 && dist < this.range + 6 &&
        Math.random() < 0.04) {
      this._startTrampleCharge(target);
      return;
    }
    if (dist > this.range) {
      if (this.order === 'hold' && dist > this.range + 0.4) {
        this._holdFormUp(dt, game);           // Stand Ground: close ranks into a shield wall
      } else if (this.order === 'aggressive' && !this.mounted && dist > this.range + 3) {
        this._advanceInLine(dt, game, target, dist > this.range + 1.6 ? 'run' : 'walk');
      } else {
        this._stepToward(target.position, dt, dist > this.range + 1.6 ? 'run' : 'walk');
      }
    } else if (this.attackCooldown <= 0) {
      // A horse rears to strike foes in front or lashes out with a hind kick —
      // a heavy, staggering blow instead of the rider's own swing.
      if (this.mounted && this.horseAlive && this.horseAttackCd <= 0 && Math.random() < 0.4) {
        this._startHorseMove(Math.random() < 0.7 ? 'rear' : 'kick', target);
        return;
      }
      // Shield-bearers holding the line shove pressing foes back to make space;
      // aggressors do it now and then to stagger a swing.
      if (this.hasShield && this.shoveCooldown <= 0 && dist <= this.range + 0.15 &&
          Math.random() < (this.order === 'hold' ? 0.18 : 0.07)) {
        this.shoveCooldown = 3.5 + Math.random() * 2.5;
        this._comboTarget = target;
        this._startMove('shieldShove');
      } else {
        this._launchCombo(target);
      }
      this._animateGuard(dt);
    } else {
      this._animateGuard(dt);                 // in reach, recovering — ready stance
    }
  }

  // Stand Ground tactic: rather than holding a lone spot, soldiers close ranks —
  // shuffling in tight with nearby holding comrades to lock a shared shield wall
  // (a Roman testudo / barbarian skjaldborg) that faces the foe. The pull is
  // biased sideways so the knot tightens laterally into a wall instead of
  // collapsing back off the line.
  _holdFormUp(dt, game) {
    const foe = game.nearestEnemy(this);
    if (foe) this._faceTarget(foe, dt);
    const allies = game.alliesWithin(this, 6.5)
      .filter((u) => u.order === 'hold' && !u.crawling && !u.disarmed && !u.mounted);
    this._inWall = allies.length;
    if (allies.length === 0) { this._enterIdle(dt); return; }
    let cx = this.position.x, cz = this.position.z;
    for (const a of allies) { cx += a.position.x; cz += a.position.z; }
    const n = allies.length + 1;
    let sx = cx / n - this.position.x, sz = cz / n - this.position.z;
    if (foe) {
      // Damp the component along the foe axis so we close side gaps, not fore/aft.
      const fx = foe.position.x - this.position.x, fz = foe.position.z - this.position.z;
      const fl = Math.hypot(fx, fz) || 1, ux = fx / fl, uz = fz / fl;
      const along = sx * ux + sz * uz;
      sx -= ux * along * 0.7; sz -= uz * along * 0.7;
    }
    const d = Math.hypot(sx, sz);
    if (d > 1.2) {
      // A slow, disciplined dressing of the ranks — never a charge.
      const step = Math.min(this._moveSpeed() * 0.4 * dt, d);
      this.position.x += (sx / d) * step;
      this.position.z += (sz / d) * step;
      this.stride += dt * 6;
      this.state = 'moving'; this.gait = 'walk';
      this._animateWalk();
    } else {
      this._animateGuard(dt);                 // packed in — brace behind the wall
    }
  }

  // Attack tactic: on the approach, advance as a battle line — steer at the foe
  // but let a little lateral cohesion dress the ranks, so troops hit together
  // instead of stringing out into a scattered rush. The closing (fore/aft) speed
  // is untouched, so charges still connect.
  _advanceInLine(dt, game, target, gait) {
    let dx = target.position.x - this.position.x, dz = target.position.z - this.position.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const allies = game.alliesWithin(this, 5)
      .filter((u) => u.order === 'aggressive' && !u.crawling && !u.disarmed && !u.mounted);
    if (allies.length) {
      let cx = 0, cz = 0;
      for (const a of allies) { cx += a.position.x; cz += a.position.z; }
      let sx = cx / allies.length - this.position.x, sz = cz / allies.length - this.position.z;
      const along = sx * dx + sz * dz;          // keep only the lateral part
      sx -= dx * along; sz -= dz * along;
      dx += sx * 0.25; dz += sz * 0.25;
      const nl = Math.hypot(dx, dz) || 1; dx /= nl; dz /= nl;
    }
    this._v.set(this.position.x + dx * 3, 0, this.position.z + dz * 3);
    this._moveToward(this._v, dt, gait);
  }

  // Archers & javelineers: keep to their band and loose volleys; flee if a foe
  // closes, or draw a sidearm when cornered.
  _rangedUpdate(dt, game, target, dist) {
    const rg = this.ranged;
    // In the endgame, stop kiting and commit so the fight actually ends.
    const endgame = (game.livingRomans().length + game.livingHorde().length) <= 3;
    if (dist <= this.range && (rg.meleeFallback || dist < rg.min * 0.6 || endgame)) {
      // Enemy is on top of us (or the field is nearly clear) — draw the sidearm.
      this._meleeUpdate(dt, game, target, dist);
      return;
    }
    if (dist < rg.min && !endgame) {
      // Too close — backpedal to reopen the range.
      const ax = this.position.x - target.position.x;
      const az = this.position.z - target.position.z;
      const len = Math.hypot(ax, az) || 1;
      const flee = this._v.set(this.position.x + (ax / len) * 2.5, 0, this.position.z + (az / len) * 2.5);
      this._moveToward(flee, dt, 'run');
      return;
    }
    if (dist > rg.max) {
      this._stepToward(target.position, dt, 'run'); // close to volley range
      return;
    }
    // In the sweet spot — hold, aim and loose.
    this._faceTarget(target, dt);
    if (this.rangedCooldown <= 0 && this.attackCooldown <= 0) {
      this._comboTarget = target;
      this._startMove(rg.projectile === 'arrow' ? 'shoot' : 'throwJavelin');
    } else {
      this._animateIdle(dt);
    }
  }

  _launchCombo(target) {
    this._comboTarget = target;
    this.combo = this._pickCombo();
    this.comboIndex = 0;
    this.comboGap = 0;
  }

  _pickCombo() {
    const c = this.comboList;
    if (c === 'roman' || c === 'barbarian') return pickCombo(c);
    return c[Math.floor(Math.random() * c.length)].slice();
  }

  _finishFrame(game) {
    this._clampToField();
    this._updateHealthBar();
    this._billboard(game);
  }

  // A soldier who lost a leg drags themselves along the ground in agony.
  _crawlUpdate(dt, game) {
    const target = game.nearestEnemy(this);
    if (target) {
      const dx = target.position.x - this.position.x;
      const dz = target.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      this._desiredFacing = Math.atan2(dx, dz);
      this._turn(dt);
      if (dist > 0.9) {
        const inv = 1 / (dist || 1);
        this.position.x += dx * inv * this.speed * dt;
        this.position.z += dz * inv * this.speed * dt;
      }
    }
    this.stride += dt * 2.2;
    this.state = 'crawl';
    this._animateCrawl();
    this._clampToField();
    this._updateHealthBar();
    this._billboard(game);
  }

  _animateCrawl() {
    this._rest();
    const t = this.stride;
    // Dragged low, torso pitched toward the dirt, head straining up.
    this.j.body.position.y = -0.55;
    this.j.chest.rotation.x = -1.0;
    this.j.head.rotation.x = -0.35;
    // Remaining leg pushes off; arms claw forward in alternation.
    if (this.parts.leftLeg) { this.j.leftHip.rotation.x = 0.3 + Math.sin(t) * 0.4; this.j.leftKnee.rotation.x = -0.9; }
    if (this.parts.rightLeg) { this.j.rightHip.rotation.x = 0.3 + Math.sin(t + Math.PI) * 0.4; this.j.rightKnee.rotation.x = -0.9; }
    if (this.parts.leftArm) { this.j.leftShoulder.rotation.set(1.5 + Math.sin(t) * 0.5, 0, 0); this.j.leftElbow.rotation.x = 0.4; }
    if (this.parts.rightArm) { this.j.rightShoulder.rotation.set(1.5 + Math.sin(t + Math.PI) * 0.5, 0, 0); this.j.rightElbow.rotation.x = 0.4; }
  }

  _currentTarget(game) {
    if (this._comboTarget && this._comboTarget.alive && !this._comboTarget.hasSurrendered) {
      return this._comboTarget;
    }
    return game.nearestEnemy(this);
  }

  // ---- Move player -------------------------------------------------------
  _startMove(name) {
    const def = MOVES[name];
    if (!def) return;
    this.move = { def, name, t: 0, hitDone: false };
    this.state = def.type;
    this.spinOffset = 0;
    // Swinging a weapon is hard work; heavy blows cost more wind.
    if (def.type === 'attack') {
      this.stamina = clamp(this.stamina - (def.heavy ? 0.06 : 0.035), 0.1, 1);
    }
  }

  _advanceMove(dt, game) {
    const mv = this.move;
    const m = mv.def;
    mv.t += dt;
    const p = Math.min(1, mv.t / m.dur);
    const target = this._comboTarget;
    // Track the foe during a normal attack; spins turn on their own.
    if (m.type === 'attack' && !m.spin && target && target.alive && !target.hasSurrendered) {
      this._faceTarget(target, dt);
    }
    if (m.type === 'ranged' && target && target.alive) this._faceTarget(target, dt);
    this._rest();
    m.pose(this.j, p, this);
    // Keep the off hand on the haft as a two-handed weapon is swung.
    if (this.twoHanded && m.type !== 'ranged') this._applyTwoHandGrip();
    // Mounted riders stay astride — keep the legs seated through the swing.
    if (this.mounted) this._seatRider();
    this._applyFacing();                       // picks up spinOffset if the pose set it
    if (m.type === 'attack' && !mv.hitDone && p >= m.hit[0]) {
      mv.hitDone = true;
      this._resolveHit(m, game);
    }
    if (m.type === 'ranged' && !mv.hitDone && p >= m.release) {
      mv.hitDone = true;
      this._fireProjectile(m, game);
    }
    if (mv.t >= m.dur) this._endMove();
  }

  _endMove() {
    const def = this.move.def;
    this.move = null;
    this.spinOffset = 0;
    this._applyFacing();
    if (def.type === 'ranged') {
      this.rangedCooldown = this.ranged.cooldown;
      this.attackCooldown = 0.2;
    } else if (def.type === 'attack' && this.combo && this.comboIndex < this.combo.length) {
      this.comboGap = 0.06 + Math.random() * 0.1;       // wind up the next strike
    } else if (def.type === 'attack') {
      this.combo = null;
      // The winded need longer to recover between flurries.
      this.attackCooldown = (0.25 + Math.random() * 0.35) * (1 + (1 - this.stamina) * 0.8);
    } else {
      this.attackCooldown = Math.max(this.attackCooldown, 0.12 + Math.random() * 0.18);
    }
    this.state = 'idle';
  }

  _fireProjectile(m, game) {
    if (this.siege) {
      // The loaded round leaves the arm — hide it until the crew reloads.
      if (this.siegeArm && this.siegeArm.userData.ammo) this.siegeArm.userData.ammo.visible = false;
      const aim = this._siegeAim || (this._comboTarget
        ? { x: this._comboTarget.position.x, z: this._comboTarget.position.z } : null);
      if (!aim) return;
      const dmg = this.stats.dmg * (this.ranged.dmgMul || 1);
      game.spawnSiegeProjectile(this, aim, m.projectile, dmg, this.ranged.aoe || 0, this._comboTarget);
      return;
    }
    const tgt = this._comboTarget;
    if (!tgt || !tgt.alive || tgt.hasSurrendered) return;
    const dmg = this.stats.dmg * (this.ranged.dmgMul || 1);
    game.spawnProjectile(this, tgt, m.projectile, dmg);
  }

  // ---- Siege engine AI ---------------------------------------------------
  _siegeUpdate(dt, game) {
    if (this.move) { this._advanceMove(dt, game); return; }
    if (this.hasSurrendered) return;
    const aim = this._pickSiegeTarget(game);
    if (aim) this._faceGround(aim.x, aim.z, dt);
    if (aim && this.rangedCooldown <= 0 && this.attackCooldown <= 0) {
      this._siegeAim = { x: aim.x, z: aim.z };
      this._comboTarget = aim.unit || null;
      this._startMove(this.siegeKind === 'ballista' ? 'ballistaFire' : 'catapultFire');
    } else {
      this._animateSiegeIdle(dt);
    }
  }

  // Choose where to shoot. Boulders favour the densest enemy knot and steer
  // clear of our own troops (no lobbing rocks into a friendly melee); bolts pick
  // the nearest foe in range.
  _pickSiegeTarget(game) {
    const rg = this.ranged;
    const aoe = rg.aoe || 0;
    const enemies = game.units.filter((u) => u.faction !== this.faction && u.alive && !u.hasSurrendered);
    if (!enemies.length) return null;
    const total = game.livingRomans().length + game.livingHorde().length;
    const endgame = total <= 4;
    const friends = aoe > 0
      ? game.units.filter((u) => u !== this && u.faction === this.faction && u.alive && !u.hasSurrendered)
      : null;
    let best = null, bestScore = -1;
    for (const e of enemies) {
      const d = Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z);
      if (d < rg.min || d > rg.max) continue;
      let score = 1;
      if (aoe > 0) {
        score = 0;
        for (const o of enemies) if (Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z) <= aoe) score++;
        if (!endgame) {
          let nearFriend = false;
          for (const f of friends) if (Math.hypot(f.position.x - e.position.x, f.position.z - e.position.z) <= aoe + 1.0) { nearFriend = true; break; }
          if (nearFriend) continue;                 // would catch our own — hold this shot
        }
      } else {
        score = 100 - d;                            // bolt: just take the nearest in range
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best ? { x: best.position.x, z: best.position.z, unit: aoe > 0 ? null : best } : null;
  }

  _faceGround(x, z, dt) {
    this._desiredFacing = Math.atan2(x - this.position.x, z - this.position.z);
    this._turn(dt);
  }

  _animateSiegeIdle(dt) {
    this.animT += dt;
    if (this.siegeArm) {
      // Ease the arm back to its loaded rest pose while the crew reloads.
      if (this.siegeKind === 'ballista') {
        this.siegeArm.position.z += (-0.15 - this.siegeArm.position.z) * Math.min(1, dt * 4);
      } else {
        this.siegeArm.rotation.x += (-1.15 - this.siegeArm.rotation.x) * Math.min(1, dt * 3);
      }
      if (this.siegeArm.userData.ammo) this.siegeArm.userData.ammo.visible = this.rangedCooldown <= 0.05;
    }
    this._recover(dt);
  }

  // Resolve an attack's impact frame against its target(s).
  _resolveHit(m, game) {
    const targets = m.aoe
      ? game.enemiesWithin(this, m.reach + 0.3)
      : (this._comboTarget ? [this._comboTarget] : []);
    for (const tgt of targets) {
      if (!tgt || !tgt.alive || tgt.hasSurrendered) continue;
      if (this.position.distanceTo(tgt.position) > m.reach + 0.4) {
        if (!m.aoe) game.floatingText(tgt.position, 'miss', 0xbfc6cf, 0.7);
        continue;
      }
      // Wild miss from attacker accuracy.
      if (Math.random() > Math.min(0.98, this.stats.accuracy + 0.12)) {
        game.floatingText(tgt.position, 'miss', 0xbfc6cf, 0.7);
        continue;
      }
      // Defender may block or dodge (unless we're punching through with a bash).
      if (tgt._defend(this, m, game) !== 'hit') continue;
      const crit = Math.random() < this.stats.crit;
      let dmg = this.stats.dmg * (m.dmgMul || 1) * (crit ? 1.9 : 1) * (1 - tgt.stats.toughness);
      dmg *= 0.9 + Math.random() * 0.2;
      const dir = Math.sign(tgt.position.x - this.position.x) || 1;
      const wasAlive = tgt.alive;
      tgt.applyDamage(dmg, -dir, m.stagger, game);
      game.spawnHitSpark(tgt.position, this.faction, crit);
      // Blood on every wound.
      this._v.set(tgt.position.x, 1.1 + Math.random() * 0.4, tgt.position.z);
      game.spawnBlood(this._v, { x: -dir, z: 0 }, crit ? 12 : 6, crit ? 1.2 : 0.8);
      game.floatingText(
        tgt.position,
        crit ? `CRIT ${Math.round(dmg)}` : `${Math.round(dmg)}`,
        crit ? 0xffd24f : this.faction === 'roman' ? 0xffe0a0 : 0xff9a70,
        crit ? 1.35 : 1
      );
      // Dust kicks up at their feet as they clash — more on heavy, shoving blows.
      if (m.heavy || m.shove || m.stagger || Math.random() < 0.5) {
        const mx = (this.position.x + tgt.position.x) / 2;
        const mz = (this.position.z + tgt.position.z) / 2;
        game.spawnDust(mx, mz, m.heavy || m.shove ? 7 : 4, m.heavy || m.shove ? 1.4 : 1);
      }
      if (m.stagger) tgt._knockback(this, m.shove ? 0.85 : 0.3);
      // Chance to hack off a limb — higher on crits, heavy blows and kills.
      const killing = wasAlive && !tgt.alive;
      let sever = (crit ? 0.16 : 0.04) + (m.heavy ? 0.1 : 0) + (killing ? 0.4 : 0);
      if (tgt.hasSurrendered) sever = 0;
      if (Math.random() < sever) tgt._severRandom(killing, this, game);
    }
  }

  // Decide how this unit reacts to an incoming blow: 'dodge' | 'block' | 'hit'.
  _defend(attacker, m, game) {
    // Flat on the ground — no dodge, no block, wide open.
    if (this.knockedDown) return 'hit';
    // Committed to your own swing — no free reactions, trade blows.
    if (this.move && this.move.def.type === 'attack') return 'hit';
    // Holding the line with a shield up = actively defending: much better reads.
    const braced = this.defensive ? 1 : 0;
    // Sidestep: nimble fighters read heavy, telegraphed attacks more easily.
    let dodgeP = Math.min(0.3 + 0.04 * braced, this.stats.dodge * (1 + 0.15 * braced) * (m.heavy ? 1.25 : 1));
    if (Math.random() < dodgeP) {
      this._interruptWith(Math.random() < 0.5 ? 'dodgeL' : 'dodgeR', attacker);
      game.floatingText(this.position, 'dodge', 0x8fd0ff, 0.85);
      return 'dodge';
    }
    // Shield block (a bash punches straight through). A locked shield wall —
    // two or more braced comrades packed alongside — is markedly harder to break.
    const wall = (this.defensive && this._inWall >= 2) ? 1 : 0;
    if (this.hasShield && !m.stagger) {
      const blockP = Math.min(0.47 + 0.07 * braced + 0.08 * wall,
        this.stats.block * (1 + 0.2 * braced + 0.15 * wall) * (m.aoe ? 0.85 : 1));
      if (Math.random() < blockP) {
        this._interruptWith('block', attacker);
        const chip = attacker.stats.dmg * (m.dmgMul || 1) * 0.12;   // shields still ring
        this.hp = Math.max(0, this.hp - chip);
        game.spawnHitSpark(this.position, this.faction, false);
        game.floatingText(this.position, 'block', 0xdedede, 0.85);
        if (this.hp <= 0) this._die(0, game);
        return 'block';
      }
    }
    return 'hit';
  }

  // Resolve an arrow/javelin striking home.
  receiveRanged(shooter, dmg, game, opts = null) {
    if (!this.alive || this.hasSurrendered) return;
    const pierce = opts && opts.pierce;               // ballista bolts punch through shields
    if (!pierce && this.hasShield && Math.random() < this.stats.block * 0.7) {
      game.spawnHitSpark(this.position, this.faction, false);
      game.floatingText(this.position, 'block', 0xdedede, 0.75);
      return;
    }
    if (!pierce && Math.random() < this.stats.dodge * 0.5) {
      game.floatingText(this.position, 'dodge', 0x8fd0ff, 0.75);
      return;
    }
    const finalDmg = dmg * (1 - this.stats.toughness) * (0.9 + Math.random() * 0.2);
    const dir = Math.sign(this.position.x - shooter.position.x) || 1;
    const wasAlive = this.alive;
    this.applyDamage(finalDmg, dir, !!pierce, game);
    game.spawnHitSpark(this.position, shooter.faction, false);
    this._v.set(this.position.x, 1.2, this.position.z);
    game.spawnBlood(this._v, { x: dir, z: 0 }, pierce ? 12 : 6, pierce ? 1.2 : 0.8);
    game.floatingText(this.position, `${Math.round(finalDmg)}`,
      shooter.faction === 'roman' ? 0xffe0a0 : 0xff9a70, 1);
    const severChance = (opts && opts.severChance) || 0.3;
    if (wasAlive && !this.alive && Math.random() < severChance) this._severRandom(true, shooter, game);
  }

  _interruptWith(name, attacker) {
    this.combo = null;
    this.comboGap = 0;
    if (attacker) {
      const dx = attacker.position.x - this.position.x;
      const dz = attacker.position.z - this.position.z;
      this.facing = Math.atan2(dx, dz);
      this._applyFacing();
      if (name.startsWith('dodge')) {
        // Hop to the side, perpendicular to the incoming attack.
        const side = name === 'dodgeL' ? 1 : -1;
        const px = -(this.position.z - attacker.position.z);
        const pz = this.position.x - attacker.position.x;
        const len = Math.hypot(px, pz) || 1;
        this.position.x += (px / len) * 0.5 * side;
        this.position.z += (pz / len) * 0.5 * side;
      }
    }
    this._startMove(name);
  }

  _knockback(attacker, amount) {
    const dx = this.position.x - attacker.position.x;
    const dz = this.position.z - attacker.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this.position.x += (dx / len) * amount;
    this.position.z += (dz / len) * amount;
  }

  // Effective movement speed: the wounded and the tired slow down. A soldier
  // near death and gasping moves at roughly a third of their fresh pace.
  _moveSpeed() {
    let s = this.baseSpeed;
    s *= 0.5 + 0.5 * (this.hp / this.maxHp);        // injury: down to half at death's door
    if (!this.parts.leftArm || !this.parts.rightArm) s *= 0.9; // maimed, off-balance
    s *= 0.65 + 0.35 * this.stamina;                // fatigue: down to ~two-thirds when spent
    return s;
  }

  // Catch your breath. Called from low-exertion states (idle, guard, hold);
  // mult tempers recovery while still braced under a shield.
  _recover(dt, mult = 1) {
    this.stamina = clamp(this.stamina + dt * this.staminaRegen * mult, 0, 1);
  }

  _moveToward(pointV, dt, gait = 'run') {
    const d = this._v2.copy(pointV).sub(this.position);
    d.y = 0;
    const dist = d.length();
    if (dist < 0.15) { this._enterIdle(dt); return; }
    d.normalize();
    this._desiredFacing = Math.atan2(d.x, d.z);
    this._turn(dt);
    // Walking is a deliberate half-speed reposition; running is a full charge.
    const speedMul = gait === 'run' ? 1 : 0.5;
    const step = Math.min(this._moveSpeed() * speedMul * dt, dist);
    this.position.addScaledVector(d, step);
    // A galloping mount rides down any foe caught in its path.
    if (this.mounted && this.horseAlive && gait === 'run' && dt > 0 && this._game) {
      this._tryTrample(this._game, d, step / dt);
    }
    // Sustained running is tiring; a walk costs far less. Sprinting drains a
    // fresh soldier in roughly half a minute of steady charging.
    this.stamina = clamp(this.stamina - dt * (gait === 'run' ? 0.045 : 0.012), 0.12, 1);
    this.state = 'moving';
    this.gait = gait;
    // Scale the gallop cadence with actual ground speed so the legs keep pace.
    const freq = this.mounted ? Math.max(14, this._moveSpeed() * 1.9) : (gait === 'run' ? 11 : 7);
    this.stride += dt * freq;
    if (this.mounted) {
      // A galloping horse now and then bounds over an obstacle.
      if (this.jumpCd > 0) this.jumpCd -= dt;
      if (this.jumpT < 0 && this.jumpCd <= 0 && gait === 'run' && Math.random() < 0.012) {
        this.jumpT = 0; this.jumpCd = 4 + Math.random() * 4;
      }
      if (this.jumpT >= 0) {
        this.jumpT += dt * 1.3;
        this.jumpY = Math.sin(Math.min(1, this.jumpT) * Math.PI) * 1.35;
        if (this.jumpT >= 1) { this.jumpT = -1; this.jumpY = 0; }
      } else this.jumpY = 0;
      this._animateGallop();
    }
    else if (gait === 'run') this._animateRun();
    else this._animateWalk();
  }

  _stepToward(pointV, dt, gait = 'run') {
    this._moveToward(pointV, dt, gait);
  }

  _enterIdle(dt) {
    this.state = 'idle';
    if (this._desiredFacing !== undefined) this._turn(dt);
    this._animateIdle(dt);
  }

  // A ready fighting stance between strikes: weapon up, shield forward, a light
  // bounce on bent knees.
  _animateGuard(dt) {
    this.animT += dt;
    this._rest();
    this.j.body.position.y = Math.sin(this.animT * 5) * 0.02;
    this.j.chest.rotation.x = -0.1;
    this.j.leftHip.rotation.x = 0.14;
    this.j.rightHip.rotation.x = -0.14;
    this.j.leftKnee.rotation.x = -0.22;
    this.j.rightKnee.rotation.x = -0.22;
    this._readyArms();                                 // weapon (and off hand) at the ready
    if (this.defensive) {
      // Brace hard behind the shield: raised, crouched, weapon tucked.
      this.j.leftShoulder.rotation.set(0.7, 0, 0.34);
      this.j.leftElbow.rotation.x = 1.4;
      this.j.chest.rotation.x = -0.15;
      this.j.leftKnee.rotation.x = -0.3;
      this.j.rightKnee.rotation.x = -0.3;
      if (!this.polearm) { this.j.rightShoulder.rotation.set(0.3, 0, 0); this.j.rightElbow.rotation.x = 1.2; }
    }
    if (this.mounted) this._seatRider(Math.sin(this.animT * 5) * 0.02);   // legs stay on the horse
    this.state = 'guard';
    this._recover(dt, 0.7);      // recover some wind while braced on guard
  }

  // ---- Facing ------------------------------------------------------------
  _faceTarget(target, dt) {
    if (!target) return;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    this._desiredFacing = Math.atan2(dx, dz);
    this._turn(dt);
  }
  _faceTargetInstant(target) {
    if (!target) return;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    this._desiredFacing = Math.atan2(dx, dz);
  }
  _turn(dt) {
    if (this._desiredFacing === undefined) return;
    let diff = this._desiredFacing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const max = this.turnSpeed * dt;
    this.facing += THREE.MathUtils.clamp(diff, -max, max);
    this._applyFacing();
  }

  // The model's combat forward is its local -z (arms, shield, weapon and, since
  // we moved the facial features there, the face). `facing` is the world angle
  // toward the target, so add PI to point that -z side at the enemy.
  _applyFacing() {
    this.root.rotation.y = this.facing + Math.PI + (this.spinOffset || 0);
  }

  _clampToField() {
    const r = Math.hypot(this.position.x, this.position.z);
    const maxR = 30;
    if (r > maxR) {
      this.position.x *= maxR / r;
      this.position.z *= maxR / r;
    }
    // Stand on the terrain surface rather than a flat plane.
    this.position.y = this.world ? this.world.heightAt(this.position.x, this.position.z) : 0;
    // A jumping horse arcs off the ground.
    if (this.mounted && this.jumpY) this.position.y += this.jumpY;
  }

  // ---- Animations --------------------------------------------------------
  _rest() {
    const j = this.j;
    j.body.position.set(0, 0, 0);         // clear any lunge/bob offset (incl. thrust)
    j.chest.position.z = 0;
    j.chest.rotation.set(0, 0, 0);
    j.head.rotation.set(0, 0, 0);
    j.leftHip.rotation.set(0, 0, 0);
    j.rightHip.rotation.set(0, 0, 0);
    j.leftKnee.rotation.set(0, 0, 0);
    j.rightKnee.rotation.set(0, 0, 0);
    // Shield/off arm held in guard, then the weapon arm at the ready.
    this._applyHold();
    this._readyArms();
    if (this.mounted) { this._standHorse(); this._seatRider(); }
  }

  // ---- Mounted: seat the rider and stand/gallop the horse ----------------
  _seatRider(bob = 0) {
    const j = this.j;
    j.body.position.y = 0.5 + bob;                 // up on the saddle
    j.leftHip.rotation.set(0.32, 0, 0.55); j.leftKnee.rotation.x = -1.25;
    j.rightHip.rotation.set(0.32, 0, -0.55); j.rightKnee.rotation.x = -1.25;
  }

  _standHorse() {
    if (this.horse) this.horse.rotation.set(0, 0, 0);
    const L = this.horseLegs; if (!L) return;
    for (const k of ['fl', 'fr', 'bl', 'br']) {
      if (this.horseParts && !this.horseParts[k]) continue;
      L[k].hip.rotation.x = 0; L[k].knee.rotation.x = -0.05;
    }
  }

  _animateGallop() {
    const t = this.stride, L = this.horseLegs;
    const has = (k) => !this.horseParts || this.horseParts[k];
    if (L) {
      if (this.jumpY > 0.1) {
        // Airborne over a jump — all four legs tuck up under the belly.
        for (const k of ['fl', 'fr', 'bl', 'br']) if (has(k)) { L[k].hip.rotation.x = 0.5; L[k].knee.rotation.x = -1.1; }
      } else {
        const swing = (ph) => Math.sin(t + ph);
        const tuck = (ph) => -0.35 + Math.max(0, Math.sin(t + ph)) * 0.7;
        // Diagonal pairs lead the gait.
        if (has('fl')) { L.fl.hip.rotation.x = swing(0) * 0.6;         L.fl.knee.rotation.x = tuck(0); }
        if (has('br')) { L.br.hip.rotation.x = swing(0.4) * 0.55;      L.br.knee.rotation.x = tuck(0.4); }
        if (has('fr')) { L.fr.hip.rotation.x = swing(Math.PI) * 0.6;   L.fr.knee.rotation.x = tuck(Math.PI); }
        if (has('bl')) { L.bl.hip.rotation.x = swing(Math.PI + 0.4) * 0.55; L.bl.knee.rotation.x = tuck(Math.PI + 0.4); }
      }
    }
    this._seatRider(Math.abs(Math.sin(t)) * 0.05);   // rider bobs with the gait
  }

  // ---- Mounted: rear, kick, prance and jump ------------------------------
  _startHorseMove(kind, target) {
    this.horseMove = { kind, t: 0, hitDone: false };
    this._comboTarget = target;
    this.state = kind;
    this.horseAttackCd = 2.5 + Math.random() * 2.5;
  }

  _advanceHorseMove(dt, game) {
    const hm = this.horseMove;
    hm.t += dt;
    const dur = 0.9;
    const p = Math.min(1, hm.t / dur);
    const target = this._comboTarget;
    if (target && target.alive && !target.hasSurrendered) this._faceTarget(target, dt);
    this._rest();
    if (hm.kind === 'rear') this._animateHorseRear(p);
    else this._animateHorseKick(p);
    this._applyFacing();
    if (!hm.hitDone && p >= 0.5) { hm.hitDone = true; this._horseStrike(hm.kind, game); }
    if (hm.t >= dur) { this.horseMove = null; this.state = 'idle'; this.attackCooldown = 0.3 + Math.random() * 0.3; }
  }

  _animateHorseRear(p) {
    const a = Math.sin(p * Math.PI);
    if (this.horse) this.horse.rotation.x = a * 0.8;       // pitch up onto the hind legs
    const L = this.horseLegs, has = (k) => this.horseParts[k];
    if (L) {
      if (has('fl')) { L.fl.hip.rotation.x = -1.2 * a; L.fl.knee.rotation.x = -1.0 * a - 0.05; }
      if (has('fr')) { L.fr.hip.rotation.x = -1.2 * a; L.fr.knee.rotation.x = -1.0 * a - 0.05; }
      if (has('bl')) { L.bl.hip.rotation.x = 0.15 * a; }
      if (has('br')) { L.br.hip.rotation.x = 0.15 * a; }
    }
    this._seatRider(0);
    this.j.chest.rotation.x = 0.22 * a;                    // rider rocks back with the rear
  }

  _animateHorseKick(p) {
    const a = Math.sin(p * Math.PI);
    if (this.horse) this.horse.rotation.x = -0.4 * a;      // pitch forward onto the fore legs
    const L = this.horseLegs, has = (k) => this.horseParts[k];
    if (L) {
      if (has('bl')) { L.bl.hip.rotation.x = -1.2 * a; L.bl.knee.rotation.x = -0.05; }
      if (has('br')) { L.br.hip.rotation.x = -1.2 * a; L.br.knee.rotation.x = -0.05; }
      if (has('fl')) { L.fl.hip.rotation.x = 0.2 * a; }
      if (has('fr')) { L.fr.hip.rotation.x = 0.2 * a; }
    }
    this._seatRider(0);
    this.j.chest.rotation.x = -0.18 * a;
  }

  // AoE hoof strike: rear hits foes in front, kick hits foes behind.
  _horseStrike(kind, game) {
    const reach = 2.3;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);   // the way the horse faces
    let hit = false;
    for (const foe of game.enemiesWithin(this, reach)) {
      if (!foe.alive || foe.hasSurrendered) continue;
      const dx = foe.position.x - this.position.x;
      const dz = foe.position.z - this.position.z;
      const dot = dx * fx + dz * fz;                 // >0 in front, <0 behind
      if (kind === 'rear' && dot < 0.3) continue;
      if (kind === 'kick' && dot > -0.3) continue;
      const dmg = this.stats.dmg * (kind === 'rear' ? 1.5 : 1.7) * (1 - foe.stats.toughness);
      const dir = Math.sign(dx) || 1;
      const wasAlive = foe.alive;
      foe.applyDamage(dmg, -dir, true, game);
      foe._knockback(this, kind === 'rear' ? 0.9 : 1.15);
      this._v.set(foe.position.x, 1.0 + Math.random() * 0.3, foe.position.z);
      game.spawnBlood(this._v, { x: -dir, z: 0 }, 9, 1.1);
      game.spawnDust(foe.position.x, foe.position.z, 6, 1.3);
      game.floatingText(foe.position, `${Math.round(dmg)}`, 0xffcaa0, 1.15);
      if (wasAlive && !foe.alive && Math.random() < 0.4) foe._severRandom(true, this, game);
      hit = true;
    }
    if (hit) game.spawnDust(this.position.x + fx * (kind === 'rear' ? 1 : -1), this.position.z + fz * (kind === 'rear' ? 1 : -1), 5, 1.2);
  }

  // Idle prance: a restless horse paws the ground with a front hoof now and then.
  _prance(dt) {
    if (!this.horseLegs) return;
    if (this._pranceT === undefined) this._pranceT = -1;
    if (this._pranceT < 0) {
      this.pranceCd -= dt;
      if (this.pranceCd <= 0) this._pranceT = 0;
      return;
    }
    const a = Math.sin(this._pranceT * Math.PI);
    const leg = this.horseParts.fl ? this.horseLegs.fl : (this.horseParts.fr ? this.horseLegs.fr : null);
    if (leg) { leg.hip.rotation.x = -0.7 * a; leg.knee.rotation.x = -0.6 * a - 0.05; }
    this._pranceT += dt * 1.6;
    if (this._pranceT >= 1) { this._pranceT = -1; this.pranceCd = 3 + Math.random() * 4; }
  }

  // ---- Charge-through: barrel forward, riding down anyone in the path ----
  _startTrampleCharge(target) {
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this.charging = { t: 0, dir: { x: dx / len, z: dz / len } };
    this._desiredFacing = Math.atan2(dx, dz);
    this._applyFacing();
  }

  _advanceCharge(dt, game) {
    const c = this.charging;
    c.t += dt;
    // Drive on past the point of contact so the mount runs clean through.
    this._v.set(this.position.x + c.dir.x * 6, 0, this.position.z + c.dir.z * 6);
    this._moveToward(this._v, dt, 'run');    // gallops, trampling foes in the path
    if (c.t >= 0.65) {
      this.charging = null;
      this._chargeCd = 3.5 + Math.random() * 3;
      this.attackCooldown = 0.3 + Math.random() * 0.3;
    }
  }

  // ---- Trample: a charging mount rides a foe down ------------------------
  _tryTrample(game, dir, speed) {
    if (this._trampleCd > 0 || speed < 4) return;      // only at a real gallop
    for (const foe of game.units) {
      if (foe.faction === this.faction || !foe.alive || foe.hasSurrendered) continue;
      if (foe.mounted || foe.siege || foe.knockedDown) continue;  // can't run down a rider/engine/already-flat
      const dx = foe.position.x - this.position.x;
      const dz = foe.position.z - this.position.z;
      const reach = this.radius + foe.radius + 0.55;
      if (dx * dx + dz * dz > reach * reach) continue;
      const dl = Math.hypot(dx, dz) || 1;
      if ((dx / dl) * dir.x + (dz / dl) * dir.z < 0.25) continue; // only foes ahead in the charge line
      this._trample(foe, dir, speed, game);
      this._trampleCd = 0.45;
      return;                                           // one body per stride
    }
  }

  _trample(foe, dir, speed, game) {
    const kdir = Math.sign(dir.x) || 1;
    // Bowling a body over hurts — damage scales with charge speed.
    const impact = 0.7 + speed * 0.13;
    const dmg = this.stats.dmg * 1.15 * impact * (1 - foe.stats.toughness);
    const wasAlive = foe.alive;
    foe.applyDamage(dmg, -kdir, true, game);
    foe._takeTrample(this, dir, game);
    this._v.set(foe.position.x, 1.0 + Math.random() * 0.3, foe.position.z);
    game.spawnBlood(this._v, { x: dir.x, z: dir.z }, 11, 1.3);
    game.spawnDust(foe.position.x, foe.position.z, 8, 1.5);
    game.floatingText(foe.position, `${Math.round(dmg)}`, 0xffcaa0, 1.25);
    if (wasAlive && !foe.alive && Math.random() < 0.5) foe._severRandom(true, this, game);
    // The collision jars the mount too — a jolt of self-damage and lost wind.
    this.stamina = clamp(this.stamina - 0.06, 0.1, 1);
    const selfDmg = 1.5 + Math.random() * 2.5;
    if (this.horseAlive) {
      this.horseHp -= selfDmg;
      if (this.horseHp <= 0) { this.horseHp = 0; this._horseDown(-kdir, game); }
    } else {
      this.applyDamage(selfDmg * 0.5, -kdir, false, game);
    }
  }

  // Ridden down: shoved along the charge and — unless footing (balance + stamina)
  // holds — knocked flat.
  _takeTrample(rider, dir, game) {
    if (!this.alive || this.hasSurrendered || this.knockedDown) return;
    const keepFeet = clamp(this.stats.balance * (0.45 + 0.55 * this.stamina), 0, 0.9);
    if (Math.random() < keepFeet) {
      this.position.x += dir.x * 0.6; this.position.z += dir.z * 0.6;   // staggered, stays up
      this.stamina = clamp(this.stamina - 0.06, 0.05, 1);
      if (!this.move || this.move.def.type !== 'attack') this._startMove('flinch');
    } else {
      this.position.x += dir.x * 0.95; this.position.z += dir.z * 0.95;
      this._knockDown(dir, game);
    }
  }

  // ---- Knockdown: flat on your back, then scramble up --------------------
  _knockDown(dir, game) {
    if (!this.alive || this.hasSurrendered || this.knockedDown || this.crawling) return;
    this.knockedDown = true;
    this.state = 'down';
    this.move = null; this.combo = null; this.comboGap = 0;
    this.downT = 0;
    this._downDir = Math.sign(dir.x) || (Math.random() < 0.5 ? 1 : -1);
    // Low balance + low stamina = longer flat on your back before you can rise.
    this.getUpTime = clamp(1.9 - this.stats.balance * 0.9 - this.stamina * 0.5, 0.7, 2.1);
    this.stamina = clamp(this.stamina - 0.12, 0.05, 1);
    if (game) game.floatingText(this.position, 'DOWN!', 0xffd24f, 1.1);
  }

  _knockdownUpdate(dt, game) {
    this.downT += dt;
    this._animateKnockdown(Math.min(1, this.downT / this.getUpTime));
    this._clampToField();
    this._updateHealthBar();
    this._billboard(game);
    if (this.downT >= this.getUpTime) {
      this.knockedDown = false;
      this.root.rotation.x = 0;
      this.state = 'idle';
      this.attackCooldown = 0.25 + Math.random() * 0.25;
    }
  }

  _animateKnockdown(p) {
    this._rest();
    // Slam flat, lie there, then rock back upright by the end.
    const lie = p < 0.22 ? p / 0.22 : (p > 0.7 ? Math.max(0, 1 - (p - 0.7) / 0.3) : 1);
    this.root.rotation.x = this._downDir * lie * (Math.PI / 2 - 0.12);
    this.j.body.position.y = -lie * 0.15;
    this.j.chest.rotation.x = 0.25 * lie;
    this.j.head.rotation.x = -0.3 * lie;
    this.j.leftHip.rotation.x = 0.5 * lie; this.j.leftKnee.rotation.x = -0.9 * lie;
    this.j.rightHip.rotation.x = 0.3 * lie; this.j.rightKnee.rotation.x = -0.6 * lie;
    // Arms flail on the way down, then push off the ground on the way up.
    const rise = p > 0.6 ? (p - 0.6) / 0.4 : 0;
    this.j.leftShoulder.rotation.x = 1.2 * lie - rise * 0.5;
    this.j.rightShoulder.rotation.x = 0.9 * lie - rise * 0.35;
  }

  // Pose the weapon arm (and, for two-handed weapons and bows, the off arm) into
  // a natural ready stance for the weapon this soldier carries.
  _readyArms() {
    const j = this.j;
    if (this.polearm) {
      // Hold the shaft level, arm out, so the point aims straight at the foe.
      j.rightShoulder.rotation.set(1.4, 0, 0.0);
      j.rightElbow.rotation.set(0.1, 0, 0);
    } else if (this.isBow) {
      // Draw hand rests near the string; the bow arm holds the bow up in front.
      j.rightShoulder.rotation.set(0.2, 0, 0);
      j.rightElbow.rotation.set(0.6, 0, 0);
      j.leftShoulder.rotation.set(0.75, 0, 0.12);
      j.leftElbow.rotation.set(0.35, 0, 0);
    } else if (this.twoHanded) {
      // Both hands on the haft, the great weapon raised at the ready.
      j.rightShoulder.rotation.set(1.2, 0, 0.15);
      j.rightElbow.rotation.set(1.7, 0, 0);
      this._applyTwoHandGrip();
    } else {
      // Weapon held READY forward (blade up at the ready), never at the ground.
      j.rightShoulder.rotation.set(0.3, 0, 0);
      j.rightElbow.rotation.set(1.5, 0, 0);
    }
  }

  // The off hand tracks the weapon hand so a two-handed weapon looks gripped by
  // both hands as it is held and swung.
  _applyTwoHandGrip() {
    const j = this.j;
    const rsx = j.rightShoulder.rotation.x;
    const rel = j.rightElbow.rotation.x;
    j.leftShoulder.rotation.set(rsx * 0.95 + 0.12, 0, -0.35);
    j.leftElbow.rotation.set(Math.max(0.9, rel * 0.9 + 0.25), 0, 0);
  }

  _applyHold() {
    const j = this.j;
    const hs = j.leftShoulder.userData.hold;
    const he = j.leftElbow.userData.hold;
    if (hs) j.leftShoulder.rotation.set(hs.x || 0, 0, hs.z || 0);
    else j.leftShoulder.rotation.set(0.15, 0, 0);
    if (he) j.leftElbow.rotation.set(he.x || 0, 0, 0);
    else j.leftElbow.rotation.set(0.25, 0, 0);
  }

  _animateIdle(dt) {
    this.animT += dt;
    this._rest();                              // keeps weapon up & shield ready
    this.j.body.position.y = Math.sin(this.animT * 1.6) * 0.02;
    this.j.chest.rotation.x = -0.04 + Math.sin(this.animT * 1.6) * 0.02;
    if (this.mounted) {
      this._seatRider(Math.sin(this.animT * 1.6) * 0.02);
      if (this.horseAlive) this._prance(dt);
    }
    // Gentle breathing sway on the one-handed ready arm only (leave the polearm,
    // bow and two-handed holds as posed by _readyArms).
    if (!this.polearm && !this.isBow && !this.twoHanded) {
      this.j.rightShoulder.rotation.x = 0.3 + Math.sin(this.animT * 1.6 + 1) * 0.04;
    }
    this._recover(dt);                         // idle: catch your breath fully
  }

  // Shared leg cycle. Forward is local -z, so a positive hip angle swings the
  // foot forward; the knee must flex BACKWARD (negative rotation → shin toward
  // +z), which is how a real knee bends. amp = stride length, flex = knee bend.
  _legs(amp, flex, baseFlex) {
    const t = this.stride;
    const L = Math.sin(t);
    const R = Math.sin(t + Math.PI);
    this.j.leftHip.rotation.x = L * amp;
    this.j.rightHip.rotation.x = R * amp;
    // Knee bends most through the swing-forward phase (cos > 0) to clear ground.
    this.j.leftKnee.rotation.x = -(baseFlex + Math.max(0, Math.cos(t)) * flex);
    this.j.rightKnee.rotation.x = -(baseFlex + Math.max(0, Math.cos(t + Math.PI)) * flex);
    return { L, R };
  }

  _animateWalk() {
    this._rest();
    const t = this.stride;
    const { L } = this._legs(0.5, 0.9, 0.1);
    // Gentle bob and a slight forward lean into the march (-x leans toward -z).
    this.j.body.position.y = Math.abs(Math.sin(t)) * 0.05;
    this.j.chest.rotation.x = -0.06;
    // Weapon arm counter-swings the left leg; shield stays in guard.
    this.j.rightShoulder.rotation.x = 0.2 + L * 0.3;
    this.j.rightElbow.rotation.x = 0.5;
    this._applyHold();
  }

  _animateRun() {
    this._rest();
    const t = this.stride;
    const { L, R } = this._legs(0.95, 1.5, 0.28);
    // Bigger bound, driving forward lean.
    this.j.body.position.y = Math.abs(Math.sin(t)) * 0.12 + 0.03;
    this.j.chest.rotation.x = -0.26;
    this.j.head.rotation.x = 0.12;                 // head up, eyes on the foe
    const j = this.j;
    const bob = L * 0.12;                          // a little life in the carry
    if (this.isBow) {
      // A bow is carried across the body as they run — leave it as-is.
      j.rightShoulder.rotation.x = 0.15 + L * 0.7;
      j.rightElbow.rotation.x = 0.95;
      this._applyHold();
      j.leftShoulder.rotation.x += R * 0.3;
      j.leftElbow.rotation.x += 0.15;
      return;
    }
    // Running soldiers carry the weapon RAISED — the elbow folds up so the
    // business end points skyward (weapons mount along the hand's local −y):
    // spear tips up, sword blades and club heads up, not levelled or trailing.
    if (this.twoHanded) {
      // Great axe / maul hefted high, head up, both hands on the haft.
      j.rightShoulder.rotation.set(0.5 + bob, 0, 0.14);
      j.rightElbow.rotation.set(2.4, 0, 0);
      this._applyTwoHandGrip();
      return;
    }
    // Spear / sword / axe / club — one hand, off hand holds the shield in guard.
    j.rightShoulder.rotation.set(0.3 + bob, 0, this.polearm ? -0.06 : 0.16);
    j.rightElbow.rotation.set(this.polearm ? 2.7 : 2.5, 0, 0);
    this._applyHold();
    j.leftShoulder.rotation.x += R * 0.3;          // shield/off arm pumps with the stride
    j.leftElbow.rotation.x += 0.15;
  }

  _animateDeath(dt) {
    this.deathT = Math.min(1, this.deathT + dt * 1.6);
    const t = this.deathT;
    const ease = 1 - Math.pow(1 - t, 3);
    this._rest();
    // Topple: fall to the ground and collapse.
    this.root.rotation.x = this._deathDir * ease * (Math.PI / 2);
    this.root.rotation.z = Math.sin(this._deathDir) * 0.1;
    this.j.body.position.y = -ease * 0.1;
    this.j.chest.rotation.x = 0.3 * ease;
    this.j.leftKnee.rotation.x = 0.8 * ease;
    this.j.rightKnee.rotation.x = 0.6 * ease;
    this.j.head.rotation.x = 0.3 * ease;
    // Sink slightly so bodies rest flush with the field (on the terrain surface).
    const groundY = this.world ? this.world.heightAt(this.position.x, this.position.z) : 0;
    this.root.position.y = groundY - 0.02 * ease;
  }

  _animateSurrender(dt, game) {
    this.surrenderT = Math.min(1, this.surrenderT + dt * 1.5);
    const t = this.surrenderT;
    const ease = 1 - Math.pow(1 - t, 2);
    this._rest();

    // Drop the weapon on the ground the moment we yield.
    if (!this.dropped && t > 0.15) {
      this.dropped = true;
      const weapon = this.j.rightHand.children.find((c) => c.type === 'Group');
      if (weapon) {
        const wp = new THREE.Vector3();
        weapon.getWorldPosition(wp);
        game.world.scene.attach(weapon);
        const wx = this.position.x + Math.sin(this.facing) * 0.6;
        const wz = this.position.z + Math.cos(this.facing) * 0.6;
        weapon.position.set(wx, (this.world ? this.world.heightAt(wx, wz) : 0) + 0.08, wz);
        weapon.rotation.set(Math.PI / 2, Math.random() * 3, 0);
      }
    }

    // Kneel on one knee, hands raised in submission.
    this.j.rightHip.rotation.x = -1.4 * ease;
    this.j.rightKnee.rotation.x = 1.9 * ease;
    this.j.leftHip.rotation.x = 0.5 * ease;
    this.j.leftKnee.rotation.x = 0.4 * ease;
    this.j.body.position.y = -0.42 * ease;
    this.j.chest.rotation.x = 0.15 * ease;
    this.j.head.rotation.x = 0.25 * ease;
    // Both arms up.
    this.j.rightShoulder.rotation.set(-2.4 * ease, 0.2 * ease, 0.3 * ease);
    this.j.rightElbow.rotation.x = 0.6 * ease;
    this.j.leftShoulder.rotation.set(-2.4 * ease, -0.2 * ease, -0.3 * ease);
    this.j.leftElbow.rotation.x = 0.6 * ease;
  }

  // Victory! Thrust weapons skyward and hop with a war-cry.
  _animateCelebrate(dt) {
    this.animT += dt;
    this._rest();
    const t = this.animT;
    const pump = (Math.sin(t * 4.5) + 1) / 2;               // 0..1 fist pump
    const hop = Math.max(0, Math.sin(t * 4.5)) * 0.14;
    this.j.rightShoulder.rotation.set(2.15 + pump * 0.55, 0, 0);  // weapon overhead
    this.j.rightElbow.rotation.x = 0.3;
    this.j.leftShoulder.rotation.set(1.95 + pump * 0.45, 0, 0.2);
    this.j.leftElbow.rotation.x = 0.4;
    this.j.body.position.y = hop;
    this.j.leftKnee.rotation.x = -hop * 1.6;
    this.j.rightKnee.rotation.x = -hop * 1.6;
    this.j.head.rotation.x = -0.12;
    this.j.chest.rotation.x = -0.05;
  }

  _updateHealthBar() {
    const f = this.hp / this.maxHp;
    this.fill.scale.x = Math.max(0.001, f);
    this.fill.position.x = -(this._fillFullWidth * (1 - f)) / 2;
    const c = this.fill.material.color;
    // Romans read green→red as they bleed; the enemy horde bars stay in a
    // distinct crimson→dark-red band so the two sides are never confused.
    if (this.faction === 'roman') c.setHSL(0.33 * f, 0.65, 0.5);
    else c.setHSL(0.0, 0.7, 0.32 + 0.2 * f);
  }

  _billboard(game) {
    // Face the health bar at the camera. The bar is a child of `root`, which is
    // rotated to face the enemy (barbarians ≈180° from Romans), so we must
    // cancel that parent rotation — otherwise the bar turns edge-/back-on to the
    // camera and vanishes (which hid the barbarians' bars entirely).
    if (this.healthBar.visible) {
      this._bbq = this._bbq || new THREE.Quaternion();
      this.root.getWorldQuaternion(this._bbq).invert();
      this._bbq.multiply(game.world.camera.quaternion);
      this.healthBar.quaternion.copy(this._bbq);
    }
  }

  dispose(scene) {
    // Units live under game.group, so detach from whatever actually holds us.
    if (this.root.parent) this.root.parent.remove(this.root);
    else scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
