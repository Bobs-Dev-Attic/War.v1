import * as THREE from 'three';
import { Unit } from './unit.js';

export class Game {
  constructor(world, ui) {
    this.world = world;
    this.ui = ui;
    this.units = [];
    this.selected = new Set();
    this.sparks = [];
    this.markers = [];
    this.over = false;

    this.group = new THREE.Group();
    world.scene.add(this.group);

    this._moveMarkerGeo = new THREE.RingGeometry(0.25, 0.4, 20);
    this._moveMarkerGeo.rotateX(-Math.PI / 2);

    this.spawnArmies();
  }

  spawnArmies() {
    // Romans form up on the south edge, barbarians charge from the north.
    const romanLine = 8;
    const hordeLine = -8;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 2.4;
      this._add('roman', new THREE.Vector3(x, 0, romanLine + (i % 2) * 1.2));
    }
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 2.6;
      this._add('barbarian', new THREE.Vector3(x, 0, hordeLine - (i % 2) * 1.2));
    }
    this.ui.updateTally(this);
  }

  _add(faction, pos) {
    const u = new Unit(faction, pos);
    this.units.push(u);
    this.group.add(u.root);
    return u;
  }

  get romans() { return this.units.filter((u) => u.faction === 'roman'); }
  get horde() { return this.units.filter((u) => u.faction === 'barbarian'); }

  livingRomans() { return this.romans.filter((u) => u.alive && !u.hasSurrendered); }
  livingHorde() { return this.horde.filter((u) => u.alive && !u.hasSurrendered); }

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
  spawnHitSpark(pos, faction) {
    const color = faction === 'roman' ? 0xffe08a : 0xff7a55;
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 5, 4),
        new THREE.MeshBasicMaterial({ color })
      );
      m.position.set(pos.x, 1.2 + Math.random() * 0.4, pos.z);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      );
      this.sparks.push({ mesh: m, v, life: 0.5 });
      this.group.add(m);
    }
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
  }

  // ---- Main tick ---------------------------------------------------------
  update(dt) {
    for (const u of this.units) u.update(dt, this);
    this._updateEffects(dt);
    this.ui.updateTally(this);
    if (!this.over) this._checkOutcome();
  }

  _checkOutcome() {
    const romans = this.livingRomans().length;
    const horde = this.livingHorde().length;
    const romansSurrendered = this.romans.every((u) => !u.alive || u.hasSurrendered);
    if (horde === 0 && romans > 0) {
      this.over = true;
      this.ui.showOutcome(true, 'The horde is broken. Rome stands triumphant!');
    } else if (romans === 0) {
      this.over = true;
      const msg = romansSurrendered && this.romans.some((u) => u.hasSurrendered)
        ? 'The legion has laid down its arms. The field is lost.'
        : 'The legion is overrun. The eagles have fallen.';
      this.ui.showOutcome(false, msg);
    }
  }

  reset() {
    for (const u of this.units) u.dispose(this.world.scene);
    this.world.scene.remove(this.group);
    for (const s of this.sparks) this.group.remove(s.mesh);
    this.units = [];
    this.selected.clear();
    this.sparks = [];
    this.markers = [];
    this.over = false;
    this.group = new THREE.Group();
    this.world.scene.add(this.group);
    this.spawnArmies();
    this.ui.hideOutcome();
    this.ui.updateSelectionInfo(this);
  }
}
