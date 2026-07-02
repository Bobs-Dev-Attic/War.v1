import * as THREE from 'three';
import { buildHumanoid, ROMAN_CONFIG, BARBARIAN_CONFIG } from './humanoid.js';

const UP = new THREE.Vector3(0, 1, 0);

const STATS = {
  roman: { hp: 100, dmg: 16, range: 1.7, speed: 3.2, attackTime: 1.0, turn: 9 },
  barbarian: { hp: 125, dmg: 22, range: 1.8, speed: 3.0, attackTime: 1.25, turn: 7 },
};

let _uid = 0;

export class Unit {
  constructor(faction, position) {
    this.id = _uid++;
    this.faction = faction;                 // 'roman' | 'barbarian'
    const stats = STATS[faction];
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.dmg = stats.dmg * (0.9 + Math.random() * 0.2);
    this.range = stats.range;
    this.speed = stats.speed;
    this.attackTime = stats.attackTime;
    this.turnSpeed = stats.turn;

    // Orders: 'aggressive' | 'hold' | 'retreat' | 'surrender'
    this.order = faction === 'roman' ? 'hold' : 'aggressive';
    this.moveTarget = null;                  // Vector3 (explicit move command)
    this.forcedTarget = null;                // Unit (focus-fire command)

    const cfg = faction === 'roman' ? ROMAN_CONFIG : BARBARIAN_CONFIG;
    const built = buildHumanoid(cfg);
    this.root = built.root;
    this.j = built.joints;
    this.root.position.copy(position);
    this.root.userData.unit = this;
    this.root.traverse((o) => { o.userData.unit = this; });

    this.facing = faction === 'roman' ? 0 : Math.PI;   // face the enemy
    this.root.rotation.y = this.facing;

    this.state = 'idle';                     // idle | moving | attacking | hit | dead
    this.animT = Math.random() * 10;         // walk cycle phase
    this.attackClock = 0;
    this.attackCooldown = 0;
    this.didHit = false;
    this.hitTimer = 0;
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

  _buildHealthBar() {
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x1a0d0d })
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.09),
      new THREE.MeshBasicMaterial({ color: this.faction === 'roman' ? 0x4fd06a : 0xd0a24f })
    );
    fill.position.z = 0.001;
    this._fillFullWidth = 0.86;
    this.fill = fill;
    bar.add(bg);
    bar.add(fill);
    bar.position.y = 2.15;
    bar.renderOrder = 999;
    bg.material.depthTest = false;
    fill.material.depthTest = false;
    this.healthBar = bar;
    this.root.add(bar);
  }

  _buildSelectionRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 32),
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
  applyDamage(amount, fromDir) {
    if (!this.alive || this.hasSurrendered) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this._die(fromDir);
    } else {
      // Stagger unless mid committed swing.
      if (this.state !== 'attacking' || this.attackClock < 0.15) {
        this.state = 'hit';
        this.hitTimer = 0.28;
      }
    }
  }

  _die(fromDir) {
    this.alive = false;
    this.state = 'dead';
    this.deathT = 0;
    this._deathDir = fromDir ? Math.sign(fromDir) : (Math.random() < 0.5 ? 1 : -1);
    this.healthBar.visible = false;
    this.selectionRing.visible = false;
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

  // ---- Per-frame update --------------------------------------------------
  update(dt, game) {
    if (this.state === 'dead') { this._animateDeath(dt); this._billboard(game); return; }
    if (this.hasSurrendered) { this._animateSurrender(dt, game); this._billboard(game); return; }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Decide intent from current order.
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

    // Resolve movement / attack.
    if (this.state === 'hit') {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.state = 'idle';
      this._animateHit(dt);
      this._faceTargetInstant(target);
      this._billboard(game);
      this._updateHealthBar();
      return;
    }

    if (desiredMove) {
      this._moveToward(desiredMove, dt);
    } else if (target) {
      const dist = this.position.distanceTo(target.position);
      this._faceTarget(target, dt);
      if (dist > this.range) {
        if (this.order === 'hold' && dist > this.range + 0.4) {
          // Hold position: don't chase, just idle & face foe.
          this._enterIdle(dt);
        } else {
          this._stepToward(target.position, dt);
        }
      } else {
        this._attack(dt, target, game);
      }
    } else {
      this._enterIdle(dt);
    }

    this._clampToField();
    this._updateHealthBar();
    this._billboard(game);
  }

  _moveToward(pointV, dt) {
    const d = this._v2.copy(pointV).sub(this.position);
    d.y = 0;
    const dist = d.length();
    if (dist < 0.15) { this._enterIdle(dt); return; }
    d.normalize();
    this._desiredFacing = Math.atan2(d.x, d.z);
    this._turn(dt);
    const step = Math.min(this.speed * dt, dist);
    this.position.addScaledVector(d, step);
    this.state = 'moving';
    this.animT += dt * this.speed * 1.5;
    this._animateWalk();
  }

  _stepToward(pointV, dt) {
    this._moveToward(pointV, dt);
  }

  _attack(dt, target, game) {
    this.state = 'attacking';
    if (this.attackClock === 0 && this.attackCooldown <= 0) {
      // begin a swing
      this.didHit = false;
    }
    if (this.attackCooldown <= 0) {
      this.attackClock += dt;
      const p = this.attackClock / this.attackTime;
      // Land the blow at the apex of the swing.
      if (!this.didHit && p >= 0.42) {
        this.didHit = true;
        if (this.position.distanceTo(target.position) <= this.range + 0.5) {
          const dir = Math.sign(target.position.x - this.position.x) || 1;
          target.applyDamage(this.dmg, -dir);
          game.spawnHitSpark(target.position, this.faction);
        }
      }
      if (p >= 1) {
        this.attackClock = 0;
        this.attackCooldown = 0.35 + Math.random() * 0.2;
      }
      this._animateAttack(this.attackClock / this.attackTime);
    } else {
      this._animateIdle(dt);
    }
  }

  _enterIdle(dt) {
    this.state = 'idle';
    this.attackClock = 0;
    if (this._desiredFacing !== undefined) this._turn(dt);
    this._animateIdle(dt);
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
    this.root.rotation.y = this.facing;
  }

  _clampToField() {
    const r = Math.hypot(this.position.x, this.position.z);
    const maxR = 30;
    if (r > maxR) {
      this.position.x *= maxR / r;
      this.position.z *= maxR / r;
    }
    this.position.y = 0;
  }

  // ---- Animations --------------------------------------------------------
  _rest() {
    const j = this.j;
    j.body.position.y = 0;
    j.chest.rotation.set(0, 0, 0);
    j.head.rotation.set(0, 0, 0);
    j.leftHip.rotation.set(0, 0, 0);
    j.rightHip.rotation.set(0, 0, 0);
    j.leftKnee.rotation.set(0, 0, 0);
    j.rightKnee.rotation.set(0, 0, 0);
    // Shield arm held in guard.
    this._applyHold();
    j.rightShoulder.rotation.set(0.15, 0, 0);
    j.rightElbow.rotation.set(0.25, 0, 0);
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
    this._rest();
    const b = Math.sin(this.animT * 1.6) * 0.02;
    this.j.body.position.y = b;
    this.j.chest.rotation.x = 0.04 + Math.sin(this.animT * 1.6) * 0.02;
    // Weapon ready at side.
    this.j.rightShoulder.rotation.x = 0.2 + Math.sin(this.animT * 1.6 + 1) * 0.03;
  }

  _animateWalk() {
    this._rest();
    const t = this.animT;
    const swing = Math.sin(t * 2);
    const swing2 = Math.sin(t * 2 + Math.PI);
    // Legs
    this.j.leftHip.rotation.x = swing * 0.7;
    this.j.rightHip.rotation.x = swing2 * 0.7;
    this.j.leftKnee.rotation.x = Math.max(0, -swing) * 0.9 + 0.1;
    this.j.rightKnee.rotation.x = Math.max(0, -swing2) * 0.9 + 0.1;
    // Body bob & lean into the march
    this.j.body.position.y = Math.abs(Math.sin(t)) * 0.06;
    this.j.chest.rotation.x = 0.12;
    // Weapon arm counter-swings; shield arm stays in guard.
    this.j.rightShoulder.rotation.x = 0.2 + swing * 0.35;
    this.j.rightElbow.rotation.x = 0.5;
    this._applyHold();
  }

  _animateAttack(p) {
    this._rest();
    this.j.chest.rotation.x = 0.08;
    const j = this.j;
    if (this.faction === 'barbarian') {
      // Big overhead chop.
      if (p < 0.42) {
        const w = p / 0.42;                 // wind up
        j.rightShoulder.rotation.x = -0.2 - w * 2.6;
        j.rightElbow.rotation.x = 0.2 + w * 0.6;
        j.chest.rotation.x = 0.08 - w * 0.25;
        j.chest.rotation.y = -w * 0.3;
      } else {
        const w = (p - 0.42) / 0.58;        // strike + recover
        const s = Math.sin(Math.min(w, 1) * Math.PI * 0.5);
        j.rightShoulder.rotation.x = -2.8 + s * 3.6;
        j.rightElbow.rotation.x = 0.8 - s * 0.6;
        j.chest.rotation.x = -0.17 + s * 0.5;
        j.chest.rotation.y = -0.3 + s * 0.3;
        j.rightHip.rotation.x = -s * 0.2;
      }
    } else {
      // Roman: shield-forward gladius thrust/slash.
      if (p < 0.4) {
        const w = p / 0.4;
        j.rightShoulder.rotation.x = 0.2 + w * 0.3;
        j.rightShoulder.rotation.y = -w * 0.6;     // draw back
        j.rightElbow.rotation.x = 0.4 + w * 1.4;
        j.chest.rotation.y = w * 0.35;
      } else {
        const w = (p - 0.4) / 0.6;
        const s = Math.sin(Math.min(w, 1) * Math.PI * 0.5);
        j.rightShoulder.rotation.x = 0.5 - s * 0.2;
        j.rightShoulder.rotation.y = -0.6 + s * 0.9;  // thrust forward
        j.rightElbow.rotation.x = 1.8 - s * 1.6;
        j.chest.rotation.y = 0.35 - s * 0.55;
        j.body.position.z = 0;
      }
    }
    this._applyHold();
  }

  _animateHit(dt) {
    this._rest();
    const k = this.hitTimer / 0.28;
    this.j.chest.rotation.x = -0.35 * k;    // recoil back
    this.j.head.rotation.x = -0.2 * k;
    this.j.body.position.y = 0.02 * k;
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
    // Sink slightly so bodies rest flush with the field.
    this.root.position.y = -0.02 * ease;
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
        weapon.position.set(
          this.position.x + Math.sin(this.facing) * 0.6,
          0.08,
          this.position.z + Math.cos(this.facing) * 0.6
        );
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

  _updateHealthBar() {
    const f = this.hp / this.maxHp;
    this.fill.scale.x = Math.max(0.001, f);
    this.fill.position.x = -(this._fillFullWidth * (1 - f)) / 2;
    const c = this.fill.material.color;
    if (this.faction === 'roman') c.setHSL(0.33 * f, 0.6, 0.55);
    else c.setHSL(0.12, 0.6, 0.4 + 0.15 * f);
  }

  _billboard(game) {
    // Face health bar toward the camera.
    if (this.healthBar.visible) {
      this.healthBar.quaternion.copy(game.world.camera.quaternion);
    }
  }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
