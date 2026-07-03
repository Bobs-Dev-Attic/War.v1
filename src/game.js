import * as THREE from 'three';
import { Unit } from './unit.js';
import { DEFAULT_ARMY, UNIT_TYPES } from './unitTypes.js';
import { formationOffsets, rotateSlots, DEFAULT_FORMATION, PLACEMENT_BOUNDS } from './formations.js';
import { ENVIRONMENTS, DEFAULT_ENV } from './environments.js';

// A deployment is a list of GROUPS per side; each group is a block of one unit
// type with its own count, formation and anchor position on the field. The
// default lays one group per type, spread along the muster line.
export function defaultGroups() {
  const build = (army, side) => {
    const keys = Object.keys(army);
    const dz = side === 'roman' ? 9 : -9;
    return keys.map((k, i) => ({
      typeKey: k, count: army[k], formation: DEFAULT_FORMATION, rot: 0,
      x: Math.round((i - (keys.length - 1) / 2) * 7), z: dz,
    }));
  };
  return { roman: build(DEFAULT_ARMY.roman, 'roman'), barbarian: build(DEFAULT_ARMY.barbarian, 'barbarian') };
}

export class Game {
  constructor(world, ui) {
    this.world = world;
    this.ui = ui;
    this.units = [];
    this.selected = new Set();
    this.sparks = [];
    this.markers = [];
    this.floaters = [];
    this.projectiles = [];
    this.gibs = [];              // severed limbs / dropped gear tumbling to ground
    this.blood = [];             // airborne blood droplets
    this.dust = [];              // dust puffs kicked up as fighters clash
    this.decals = [];            // blood splatter & puddles on the ground
    this.bleeders = [];          // stumps squirting blood over time
    this.hoveredEnemy = null;
    this._texCache = new Map();
    this.over = false;

    // Shared assets for gore effects.
    this._dropGeo = new THREE.CircleGeometry(1, 14);
    this._dropGeo.rotateX(-Math.PI / 2);
    this._bloodDrop = new THREE.SphereGeometry(0.05, 5, 4);

    // Chosen battlefield and each side's deployment groups (editable via the
    // New Battle screen). Each group: { typeKey, count, formation, x, z }.
    this.environment = DEFAULT_ENV;
    this.groups = defaultGroups();
    if (world.applyEnvironment) world.applyEnvironment(ENVIRONMENTS[this.environment]);

    this.group = new THREE.Group();
    world.scene.add(this.group);

    this._moveMarkerGeo = new THREE.RingGeometry(0.25, 0.4, 20);
    this._moveMarkerGeo.rotateX(-Math.PI / 2);

    // No battle on load — the title screen opens straight to the setup, which
    // starts the first battle. The empty field is the title backdrop.
  }

  spawnArmies() {
    for (const grp of this.groups.roman) this._placeGroup(grp, 'roman');
    for (const grp of this.groups.barbarian) this._placeGroup(grp, 'barbarian');
    this.ui.updateTally(this);
  }

  // Deploy one group: `count` units of one type in `formation`, anchored at
  // (x, z), with ranks extending back toward the side's own edge.
  _placeGroup(grp, faction) {
    const n = grp.count | 0;
    if (n <= 0) return;
    const spacing = faction === 'roman' ? 2.2 : 2.4;
    const rowGap = n > 24 ? 1.75 : 1.9;
    const slots = rotateSlots(formationOffsets(grp.formation || DEFAULT_FORMATION, n, spacing, rowGap), grp.rot || 0);
    const dir = faction === 'roman' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const s = slots[i] || { x: 0, depth: 0 };
      this._add(faction, new THREE.Vector3(grp.x + s.x, 0, grp.z + dir * s.depth), grp.typeKey);
    }
  }

  // Melee/pike up front (row 0, nearest the foe), ranged at the rear.
  _rankHint(typeKey) {
    return UNIT_TYPES[typeKey].role === 'ranged' ? 1 : 0;
  }

  _add(faction, pos, typeKey) {
    if (this.world.heightAt) pos.y = this.world.heightAt(pos.x, pos.z);
    const u = new Unit(faction, pos, typeKey);
    u.world = this.world;                    // so the soldier stands on the terrain
    this.units.push(u);
    this.group.add(u.root);
    return u;
  }

  get romans() { return this.units.filter((u) => u.faction === 'roman'); }
  get horde() { return this.units.filter((u) => u.faction === 'barbarian'); }

  livingRomans() { return this.romans.filter((u) => u.alive && !u.hasSurrendered); }
  livingHorde() { return this.horde.filter((u) => u.alive && !u.hasSurrendered); }

  // Every living enemy of `unit` within radius r (used by spin/AoE attacks).
  enemiesWithin(unit, r) {
    const out = [];
    for (const u of this.units) {
      if (u.faction === unit.faction) continue;
      if (!u.alive || u.hasSurrendered) continue;
      if (unit.position.distanceTo(u.position) <= r) out.push(u);
    }
    return out;
  }

  nearestEnemy(unit) {
    let best = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (u.faction === unit.faction) continue;
      if (!u.alive || u.hasSurrendered) continue;
      const d = unit.position.distanceToSquared(u.position);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  // ---- Commands (player controls the Romans) ----------------------------
  targetUnits() {
    const sel = [...this.selected].filter((u) => u.alive && !u.hasSurrendered);
    return sel.length ? sel : this.livingRomans();
  }

  command(cmd) {
    const units = this.targetUnits();
    if (!units.length) return;
    for (const u of units) {
      if (cmd === 'attack') { u.order = 'aggressive'; u.forcedTarget = null; u.moveTarget = null; }
      else if (cmd === 'stand') { u.order = 'hold'; u.moveTarget = null; u.forcedTarget = null; }
      else if (cmd === 'retreat') { u.order = 'retreat'; u.moveTarget = null; u.forcedTarget = null; }
      else if (cmd === 'surrender') { u.surrender(); }
    }
    this.ui.flashCommand(cmd);
    this.ui.updateSelectionInfo(this);
  }

  moveCommand(point) {
    const units = this.targetUnits();
    if (!units.length) return;
    // Spread the squad around the click so they don't stack.
    units.forEach((u, i) => {
      const a = (i / units.length) * Math.PI * 2;
      const off = units.length > 1 ? 1.1 : 0;
      u.order = 'hold';
      u.forcedTarget = null;
      u.moveTarget = new THREE.Vector3(
        point.x + Math.cos(a) * off, 0, point.z + Math.sin(a) * off
      );
    });
    this._spawnMarker(point, 0x4fd06a);
  }

  focusFire(enemy) {
    const units = this.targetUnits();
    if (!units.length) return;
    for (const u of units) {
      u.order = 'aggressive';
      u.forcedTarget = enemy;
      u.moveTarget = null;
    }
    this._spawnMarker(enemy.position, 0xd04f4f);
  }

  // ---- Selection ---------------------------------------------------------
  clearSelection() {
    for (const u of this.selected) u.setSelected(false);
    this.selected.clear();
    this.ui.updateSelectionInfo(this);
  }

  select(unit, additive = false) {
    if (!additive) this.clearSelection();
    if (unit && unit.faction === 'roman' && unit.alive && !unit.hasSurrendered) {
      this.selected.add(unit);
      unit.setSelected(true);
    }
    this.ui.updateSelectionInfo(this);
  }

  selectInBox(minX, minY, maxX, maxY, camera, canvas) {
    this.clearSelection();
    const v = new THREE.Vector3();
    for (const u of this.romans) {
      if (!u.alive || u.hasSurrendered) continue;
      v.copy(u.position);
      v.y = 1;
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * canvas.clientWidth;
      const sy = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        this.selected.add(u);
        u.setSelected(true);
      }
    }
    this.ui.updateSelectionInfo(this);
  }

  selectAll() {
    this.clearSelection();
    for (const u of this.livingRomans()) { this.selected.add(u); u.setSelected(true); }
    this.ui.updateSelectionInfo(this);
  }

  // ---- Effects -----------------------------------------------------------
  spawnHitSpark(pos, faction, crit = false) {
    const color = crit ? 0xffd24f : faction === 'roman' ? 0xffe08a : 0xff7a55;
    const n = crit ? 16 : 8;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(crit ? 0.06 : 0.045, 5, 4),
        new THREE.MeshBasicMaterial({ color })
      );
      m.position.set(pos.x, 1.2 + Math.random() * 0.4, pos.z);
      const spread = crit ? 6 : 4;
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * spread
      );
      this.sparks.push({ mesh: m, v, life: 0.5 });
      this.group.add(m);
    }
  }

  // Floating combat text (damage numbers, CRIT, miss) that rises and fades.
  floatingText(pos, text, color, scale = 1) {
    const tex = this._textTexture(text, color);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(pos.x + (Math.random() - 0.5) * 0.3, 2.3, pos.z);
    sp.scale.set(1.5 * scale, 0.75 * scale, 1);
    sp.renderOrder = 1000;
    this.group.add(sp);
    this.floaters.push({ sp, life: 0.9, vy: 1.3 });
  }

  _textTexture(text, color) {
    const key = `${text}|${color}`;
    if (this._texCache.has(key)) return this._texCache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const css = '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
    ctx.font = 'bold 72px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = css;
    ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._texCache.set(key, tex);
    return tex;
  }

  // ---- Projectiles (arrows & javelins) ----------------------------------
  spawnProjectile(shooter, target, kind, dmg) {
    const g = new THREE.Group();
    if (kind === 'arrow') {
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.7, 5),
        new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 })
      );
      shaft.rotation.z = Math.PI / 2;
      g.add(shaft);
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.03, 0.1, 5),
        new THREE.MeshStandardMaterial({ color: 0xcdd2d8, metalness: 0.6, roughness: 0.4 })
      );
      head.rotation.z = -Math.PI / 2;
      head.position.x = 0.4;
      g.add(head);
    } else {
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 1.0, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.85 })
      );
      shaft.rotation.z = Math.PI / 2;
      g.add(shaft);
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.16, 6),
        new THREE.MeshStandardMaterial({ color: 0xcdd2d8, metalness: 0.6, roughness: 0.4 })
      );
      head.rotation.z = -Math.PI / 2;
      head.position.x = 0.55;
      g.add(head);
    }
    // Launch from the shooter's shoulder height toward the target.
    const from = new THREE.Vector3(shooter.position.x, 1.4, shooter.position.z);
    g.position.copy(from);
    g.castShadow = true;
    this.group.add(g);
    this.projectiles.push({
      mesh: g, target, shooter, dmg,
      speed: kind === 'arrow' ? 22 : 15,
      life: 3,
    });
  }

  _updateProjectiles(dt) {
    const tmp = new THREE.Vector3();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const tgt = p.target;
      const alive = tgt && tgt.alive && !tgt.hasSurrendered;
      // Aim at the target's torso; if it's gone, keep flying straight.
      const aim = alive ? tmp.set(tgt.position.x, 1.2, tgt.position.z) : null;
      if (aim) {
        const dir = aim.clone().sub(p.mesh.position);
        const dist = dir.length();
        dir.normalize();
        p.mesh.position.addScaledVector(dir, Math.min(p.speed * dt, dist));
        p.mesh.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
        p.mesh.rotation.z = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        if (dist < 0.6) {
          tgt.receiveRanged(p.shooter, p.dmg, this);
          this._removeProjectile(i);
          continue;
        }
      } else {
        p.mesh.position.x += p.mesh.position.x * 0; // hold; just expire
      }
      if (p.life <= 0) this._removeProjectile(i);
    }
  }

  _removeProjectile(i) {
    const p = this.projectiles[i];
    this.group.remove(p.mesh);
    p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.projectiles.splice(i, 1);
  }

  // ---- Gore: blood, puddles, severed gibs, bleeding stumps ----------------
  _bloodMat() {
    return new THREE.MeshStandardMaterial({ color: 0x8a0d0d, roughness: 0.6, metalness: 0 });
  }

  // A spray of blood droplets that arc, fall and stain the ground.
  spawnBlood(pos, dir, count = 10, force = 1) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this._bloodDrop, this._bloodMat());
      m.position.set(pos.x, pos.y, pos.z);
      const spread = 2.4 * force;
      const v = new THREE.Vector3(
        (dir ? dir.x : 0) * 1.5 * force + (Math.random() - 0.5) * spread,
        Math.random() * 3 * force + 1,
        (dir ? dir.z : 0) * 1.5 * force + (Math.random() - 0.5) * spread
      );
      this.blood.push({ mesh: m, v, life: 1.2 });
      this.group.add(m);
    }
  }

  // Soft round puff texture for dust, cached once.
  _dustTex() {
    if (this._dustTexture) return this._dustTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this._dustTexture = new THREE.CanvasTexture(c);
    return this._dustTexture;
  }

  // Kick up a puff of dust (or snow) where fighters clash — tinted to the field.
  spawnDust(x, z, count = 5, force = 1) {
    if (this.dust.length > 220) return;               // keep it cheap in big melees
    const env = this.world.environment;
    const tint = new THREE.Color(env ? (env.features && env.features.snowy ? 0xf0f4fa : env.ground) : 0x9a8560);
    tint.lerp(new THREE.Color(0xffffff), 0.35);       // dust rides lighter than the soil
    const y0 = this.world.heightAt ? this.world.heightAt(x, z) : 0;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._dustTex(), color: tint, transparent: true,
        opacity: 0.32 + Math.random() * 0.2, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(x + (Math.random() - 0.5) * 0.7, y0 + 0.15 + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.7);
      const sc = 0.4 + Math.random() * 0.4;
      s.scale.setScalar(sc);
      this.group.add(s);
      this.dust.push({
        mesh: s,
        v: new THREE.Vector3((Math.random() - 0.5) * 1.2 * force, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 1.2 * force),
        life: 0.6 + Math.random() * 0.5, age: 0, grow: 1.4 + Math.random(),
      });
    }
  }

  _updateDust(dt) {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.group.remove(d.mesh);
        d.mesh.material.dispose();
        this.dust.splice(i, 1);
        continue;
      }
      d.v.y -= dt * 0.6;                    // settle
      d.v.multiplyScalar(1 - dt * 1.8);     // air drag
      d.mesh.position.addScaledVector(d.v, dt);
      const k = d.age / d.life;
      d.mesh.scale.setScalar(d.mesh.scale.x + d.grow * dt);
      d.mesh.material.opacity = (0.32 + 0.2) * (1 - k) * (1 - k);
    }
  }

  // A flat stain on the ground (splatter or a growing puddle).
  spawnDecal(x, z, radius, opacity = 0.9) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6e0a0a, transparent: true, opacity, depthWrite: false,
    });
    const d = new THREE.Mesh(this._dropGeo, mat);
    d.position.set(x, 0.02 + Math.random() * 0.01, z);
    d.scale.setScalar(radius);
    d.rotation.y = Math.random() * Math.PI;
    this.decals.push({ mesh: d, grow: 0, max: radius });
    this.group.add(d);
    // Cap the number of decals so a long grind doesn't tank the framerate.
    if (this.decals.length > 160) {
      const old = this.decals.shift();
      this.group.remove(old.mesh);
      old.mesh.material.dispose();
    }
    return d;
  }

  // Turn a detached limb / dropped item into a tumbling gib.
  addGib(obj, vel, spin) {
    this.group.attach(obj);                 // reparent, keeping its world transform
    this.gibs.push({ obj, v: vel, spin, life: 30, rest: false });
  }

  // A wound that squirts blood and pools beneath it for a while.
  addBleeder(unit, offset, duration = 2.5) {
    const puddle = this.spawnDecal(unit.position.x, unit.position.z, 0.15, 0.85);
    this.bleeders.push({ unit, offset: offset.clone(), life: duration, puddle, t: 0 });
  }

  _updateGore(dt) {
    const wp = new THREE.Vector3();
    // Blood droplets.
    for (let i = this.blood.length - 1; i >= 0; i--) {
      const b = this.blood[i];
      b.life -= dt;
      b.v.y -= 12 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      if (b.mesh.position.y <= 0.05) {
        this.spawnDecal(b.mesh.position.x, b.mesh.position.z, 0.1 + Math.random() * 0.14, 0.85);
        this._killBlood(i);
      } else if (b.life <= 0) {
        this._killBlood(i);
      }
    }
    // Bleeding stumps: squirt + grow a puddle.
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const bl = this.bleeders[i];
      bl.life -= dt; bl.t += dt;
      const u = bl.unit;
      if (!u || (!u.alive && u.state !== 'dead')) { this.bleeders.splice(i, 1); continue; }
      u.root.updateMatrixWorld();
      wp.copy(bl.offset).applyMatrix4(u.root.matrixWorld);
      if (Math.random() < 0.7) this.spawnBlood(wp, null, 2, 0.7); // squirt
      if (bl.puddle) {
        bl.puddle.position.x = u.position.x;
        bl.puddle.position.z = u.position.z;
        bl.puddle.scale.setScalar(Math.min(0.9, 0.15 + bl.t * 0.28));
      }
      if (bl.life <= 0) this.bleeders.splice(i, 1);
    }
    // Tumbling gibs.
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.life -= dt;
      if (!g.rest) {
        g.v.y -= 14 * dt;
        g.obj.position.addScaledVector(g.v, dt);
        g.obj.rotation.x += g.spin.x * dt;
        g.obj.rotation.y += g.spin.y * dt;
        g.obj.rotation.z += g.spin.z * dt;
        if (g.obj.position.y <= 0.08) {
          g.obj.position.y = 0.08;
          g.rest = true;
          this.spawnDecal(g.obj.position.x, g.obj.position.z, 0.3, 0.9);
        }
      }
      if (g.life <= 0) {
        this.group.remove(g.obj);
        g.obj.traverse((o) => { if (o.geometry && o.geometry !== this._bloodDrop) o.geometry.dispose(); });
        this.gibs.splice(i, 1);
      }
    }
  }

  _killBlood(i) {
    const b = this.blood[i];
    this.group.remove(b.mesh);
    b.mesh.material.dispose();
    this.blood.splice(i, 1);
  }

  _spawnMarker(point, color) {
    const m = new THREE.Mesh(
      this._moveMarkerGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    m.position.set(point.x, 0.08, point.z);
    this.markers.push({ mesh: m, life: 0.8 });
    this.group.add(m);
  }

  _updateEffects(dt) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.material.opacity = Math.max(0, s.life / 0.5);
      s.mesh.material.transparent = true;
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.life -= dt;
      const k = m.life / 0.8;
      m.mesh.scale.setScalar(1 + (1 - k) * 1.5);
      m.mesh.material.opacity = Math.max(0, k);
      if (m.life <= 0) {
        this.group.remove(m.mesh);
        m.mesh.material.dispose();
        this.markers.splice(i, 1);
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.sp.position.y += f.vy * dt;
      f.sp.material.opacity = Math.max(0, Math.min(1, f.life / 0.5));
      if (f.life <= 0) {
        this.group.remove(f.sp);
        f.sp.material.dispose();
        this.floaters.splice(i, 1);
      }
    }
  }

  // ---- Main tick ---------------------------------------------------------
  update(dt) {
    for (const u of this.units) u.update(dt, this);
    this._resolveCollisions();
    this._updateProjectiles(dt);
    this._updateGore(dt);
    this._updateDust(dt);
    this._updateEffects(dt);
    this.ui.updateTally(this);
    this.ui.updateStats(this._inspectUnit());
    if (!this.over) this._checkOutcome();
  }

  // Circle-vs-circle body colliders: push overlapping fighters apart so no two
  // ever occupy the same space. Fallen bodies are walked over (no collision).
  _resolveCollisions() {
    const list = this.units.filter((u) => u.state !== 'dead');
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        const min = a.radius + b.radius;
        let d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        if (d2 < 1e-6) {
          // Exactly coincident — nudge apart on a fixed axis to break the tie.
          dx = (a.id < b.id ? -1 : 1) * 0.05; dz = 0; d2 = 0.0025;
        }
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.position.x -= nx * push; a.position.z -= nz * push;
        b.position.x += nx * push; b.position.z += nz * push;
      }
    }
    for (const u of list) u._clampToField();
  }

  // Which soldier's dossier to show: a lone selected legionary, or an
  // enemy the cursor is hovering.
  _inspectUnit() {
    if (this.selected.size === 1) {
      const u = [...this.selected][0];
      if (u.alive && !u.hasSurrendered) return u;
    }
    if (this.hoveredEnemy && this.hoveredEnemy.alive && !this.hoveredEnemy.hasSurrendered) {
      return this.hoveredEnemy;
    }
    return null;
  }

  _checkOutcome() {
    if (this.units.length === 0) return;    // no battle mustered yet (title screen)
    const romans = this.livingRomans().length;
    const horde = this.livingHorde().length;
    const romansSurrendered = this.romans.every((u) => !u.alive || u.hasSurrendered);
    if (horde === 0 && romans > 0) {
      this.over = true;
      this._celebrate('roman');
      this.ui.showOutcome(true, 'The horde is broken. Rome stands triumphant!');
    } else if (romans === 0) {
      this.over = true;
      if (this.livingHorde().length > 0) this._celebrate('barbarian');
      const msg = romansSurrendered && this.romans.some((u) => u.hasSurrendered)
        ? 'The legion has laid down its arms. The field is lost.'
        : 'The legion is overrun. The eagles have fallen.';
      this.ui.showOutcome(false, msg);
    }
  }

  // The victors raise their arms and cheer.
  _celebrate(faction) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._removeProjectile(i);
    for (const u of this.units) {
      if (u.faction === faction && u.alive && !u.hasSurrendered) u.celebrate();
    }
  }

  // Start a fresh battle with the given deployment (from the setup screen).
  startBattle(settings) {
    if (settings) {
      if (settings.environment && ENVIRONMENTS[settings.environment]) this.environment = settings.environment;
      if (settings.groups) {
        this.groups = {
          roman: settings.groups.roman.map((g) => ({ ...g })),
          barbarian: settings.groups.barbarian.map((g) => ({ ...g })),
        };
      }
    }
    this.reset();
  }

  reset() {
    if (this.world.applyEnvironment) this.world.applyEnvironment(ENVIRONMENTS[this.environment]);
    for (const u of this.units) u.dispose(this.world.scene);
    this.world.scene.remove(this.group);
    this.units = [];
    this.selected.clear();
    this.sparks = [];
    this.markers = [];
    this.floaters = [];
    this.projectiles = [];
    this.gibs = [];
    this.blood = [];
    this.dust = [];
    this.decals = [];
    this.bleeders = [];
    this.hoveredEnemy = null;
    this.over = false;
    this.group = new THREE.Group();
    this.world.scene.add(this.group);
    this.spawnArmies();
    this.ui.hideOutcome();
    this.ui.updateSelectionInfo(this);
    this.ui.updateStats(null);
  }
}
