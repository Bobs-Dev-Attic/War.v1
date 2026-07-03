import * as THREE from 'three';
import { buildHumanoid, ROMAN_CONFIG, BARBARIAN_CONFIG } from './humanoid.js';
import { rollAttributes, deriveStats, pickName, rankFor } from './attributes.js';
import { MOVES, pickCombo } from './moves.js';
import { UNIT_TYPES } from './unitTypes.js';

let _uid = 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
    this.shoveCooldown = Math.random() * 1.5;
    const built = buildHumanoid(cfg);
    this.root = built.root;
    this.j = built.joints;
    this.root.position.copy(position);
    // Subtle per-soldier build: the burly stand a touch taller and broader;
    // elite champions (Praetorian, Chieftain) stand out a little more.
    const scale = (0.94 + THREE.MathUtils.clamp((this.stats.build - 11) / 12, -0.06, 0.12)) * (this.elite ? 1.08 : 1);
    this.root.scale.setScalar(scale);
    this.radius = 0.5 * scale;               // body collider (no two share a tile)
    this.root.userData.unit = this;
    this.root.traverse((o) => { o.userData.unit = this; });

    this.facing = faction === 'roman' ? 0 : Math.PI;   // face the enemy
    this.spinOffset = 0;                     // extra yaw during spin moves
    this._applyFacing();

    this.state = 'idle';                     // idle | moving | attack | defense | flinch | dead
    this.animT = Math.random() * 10;         // idle/guard phase
    this.attackCooldown = 0;
    this.hasShield = type.cfg.shield != null; // archers/berserkers carry none

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
  applyDamage(amount, fromDir, stagger = false) {
    if (!this.alive || this.hasSurrendered) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this._die(fromDir);
      return;
    }
    // Flinch if we weren't mid-move; a stagger interrupts anything we were doing.
    if (!this.move || stagger) {
      if (stagger) { this.combo = null; this.comboGap = 0; }
      this._startMove('flinch');
    }
  }

  _die(fromDir) {
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
    if (this.state === 'dead') { this._animateDeath(dt); this._billboard(game); return; }
    if (this.hasSurrendered) { this._animateSurrender(dt, game); this._billboard(game); return; }
    if (this.celebrating) { this._animateCelebrate(dt); this._clampToField(); this._billboard(game); return; }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.rangedCooldown > 0) this.rangedCooldown -= dt;
    if (this.shoveCooldown > 0) this.shoveCooldown -= dt;
    // Shield-bearers told to Stand Ground brace defensively.
    this.defensive = this.order === 'hold' && this.hasShield;

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
    if (dist > this.range) {
      if (this.order === 'hold' && dist > this.range + 0.4) {
        this._enterIdle(dt);                  // hold position, face the foe
      } else {
        this._stepToward(target.position, dt, dist > this.range + 1.6 ? 'run' : 'walk');
      }
    } else if (this.attackCooldown <= 0) {
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
      this.attackCooldown = 0.25 + Math.random() * 0.35;
    } else {
      this.attackCooldown = Math.max(this.attackCooldown, 0.12 + Math.random() * 0.18);
    }
    this.state = 'idle';
  }

  _fireProjectile(m, game) {
    const tgt = this._comboTarget;
    if (!tgt || !tgt.alive || tgt.hasSurrendered) return;
    const dmg = this.stats.dmg * (this.ranged.dmgMul || 1);
    game.spawnProjectile(this, tgt, m.projectile, dmg);
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
      tgt.applyDamage(dmg, -dir, m.stagger);
      game.spawnHitSpark(tgt.position, this.faction, crit);
      game.floatingText(
        tgt.position,
        crit ? `CRIT ${Math.round(dmg)}` : `${Math.round(dmg)}`,
        crit ? 0xffd24f : this.faction === 'roman' ? 0xffe0a0 : 0xff9a70,
        crit ? 1.35 : 1
      );
      if (m.stagger) tgt._knockback(this, m.shove ? 0.85 : 0.3);
    }
  }

  // Decide how this unit reacts to an incoming blow: 'dodge' | 'block' | 'hit'.
  _defend(attacker, m, game) {
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
    // Shield block (a bash punches straight through).
    if (this.hasShield && !m.stagger) {
      const blockP = Math.min(0.47 + 0.07 * braced, this.stats.block * (1 + 0.2 * braced) * (m.aoe ? 0.85 : 1));
      if (Math.random() < blockP) {
        this._interruptWith('block', attacker);
        const chip = attacker.stats.dmg * (m.dmgMul || 1) * 0.12;   // shields still ring
        this.hp = Math.max(0, this.hp - chip);
        game.spawnHitSpark(this.position, this.faction, false);
        game.floatingText(this.position, 'block', 0xdedede, 0.85);
        if (this.hp <= 0) this._die(0);
        return 'block';
      }
    }
    return 'hit';
  }

  // Resolve an arrow/javelin striking home.
  receiveRanged(shooter, dmg, game) {
    if (!this.alive || this.hasSurrendered) return;
    if (this.hasShield && Math.random() < this.stats.block * 0.7) {
      game.spawnHitSpark(this.position, this.faction, false);
      game.floatingText(this.position, 'block', 0xdedede, 0.75);
      return;
    }
    if (Math.random() < this.stats.dodge * 0.5) {
      game.floatingText(this.position, 'dodge', 0x8fd0ff, 0.75);
      return;
    }
    const finalDmg = dmg * (1 - this.stats.toughness) * (0.9 + Math.random() * 0.2);
    const dir = Math.sign(this.position.x - shooter.position.x) || 1;
    this.applyDamage(finalDmg, dir);
    game.spawnHitSpark(this.position, shooter.faction, false);
    game.floatingText(this.position, `${Math.round(finalDmg)}`,
      shooter.faction === 'roman' ? 0xffe0a0 : 0xff9a70, 1);
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
    const step = Math.min(this.speed * speedMul * dt, dist);
    this.position.addScaledVector(d, step);
    this.state = 'moving';
    this.gait = gait;
    const freq = gait === 'run' ? 11 : 7;
    this.stride += dt * freq;
    if (gait === 'run') this._animateRun();
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
    if (this.polearm) {
      // Level the shaft at the foe rather than raising a blade.
      this.j.rightShoulder.rotation.set(-0.16, 0, 0.12);
      this.j.rightElbow.rotation.x = 0.0;
    } else {
      this.j.rightShoulder.rotation.set(0.3, 0, 0);   // blade up at the ready
      this.j.rightElbow.rotation.x = 1.5;
    }
    this._applyHold();                                 // shield in guard
    if (this.defensive) {
      // Brace hard behind the shield: raised, crouched, weapon tucked.
      this.j.leftShoulder.rotation.set(0.7, 0, 0.34);
      this.j.leftElbow.rotation.x = 1.4;
      this.j.chest.rotation.x = -0.15;
      this.j.leftKnee.rotation.x = -0.3;
      this.j.rightKnee.rotation.x = -0.3;
      if (!this.polearm) { this.j.rightShoulder.rotation.set(0.3, 0, 0); this.j.rightElbow.rotation.x = 1.2; }
    }
    this.state = 'guard';
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
    if (this.polearm) {
      // Level the long shaft forward (near-straight arm) so it doesn't stab the
      // ground; a slight up-tilt keeps the point ahead of the foe.
      j.rightShoulder.rotation.set(-0.12, 0, 0.14);
      j.rightElbow.rotation.set(0.0, 0, 0);
    } else if (this.ranged && this.weaponKind === 'bow') {
      // Archer's draw hand rests near the string.
      j.rightShoulder.rotation.set(0.2, 0, 0);
      j.rightElbow.rotation.set(0.6, 0, 0);
    } else {
      // Weapon held READY forward (blade up at the ready), never at the ground.
      j.rightShoulder.rotation.set(0.3, 0, 0);
      j.rightElbow.rotation.set(1.5, 0, 0);
    }
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
    // Gentle breathing sway on the ready weapon arm.
    if (!this.polearm && !(this.ranged && this.weaponKind === 'bow')) {
      this.j.rightShoulder.rotation.x = 0.3 + Math.sin(this.animT * 1.6 + 1) * 0.04;
    }
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
    // Bigger bound, driving forward lean, hard arm pump.
    this.j.body.position.y = Math.abs(Math.sin(t)) * 0.12 + 0.03;
    this.j.chest.rotation.x = -0.26;
    this.j.head.rotation.x = 0.12;                 // head up, eyes on the foe
    this.j.rightShoulder.rotation.x = 0.15 + L * 0.7;
    this.j.rightElbow.rotation.x = 0.95;
    this._applyHold();
    this.j.leftShoulder.rotation.x += R * 0.3;     // shield arm pumps too
    this.j.leftElbow.rotation.x += 0.15;
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
