import { ATTRS, ATTR_LABELS } from './attributes.js';
import { UNIT_TYPES, ROMAN_TYPES, BARBARIAN_TYPES } from './unitTypes.js';
import { ENVIRONMENTS, ENV_KEYS, DEFAULT_ENV } from './environments.js';
import { FORMATIONS, FORMATION_KEYS, formationOffsets, rotateSlots, PLACEMENT_BOUNDS, DEFAULT_FORMATION } from './formations.js';
import { defaultGroups } from './game.js';

// The engine handles large armies comfortably (collision/AI are cheap and the
// formation packs deep armies inside the field), so these caps are generous.
const MAX_PER_TYPE = 20;
const MAX_PER_SIDE = 40;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Thin controller over the HUD DOM: tallies, selection info, command feedback,
// the soldier dossier, the battle-setup screen and the victory/defeat banner.
export class UI {
  constructor() {
    this.romeCount = document.getElementById('rome-count');
    this.hordeCount = document.getElementById('horde-count');
    this.selInfo = document.getElementById('selection-info');
    this.stats = document.getElementById('unit-stats');
    this.outcome = document.getElementById('outcome');
    this.outcomeTitle = document.getElementById('outcome-title');
    this.outcomeSub = document.getElementById('outcome-sub');
    this.commands = document.getElementById('commands');
    this.setup = document.getElementById('setup');
    this._statKey = null;
    this._cmdEls = {};
    this.commands.querySelectorAll('.cmd').forEach((el) => {
      this._cmdEls[el.dataset.cmd] = el;
    });
  }

  bindCommands(handler) {
    this.commands.querySelectorAll('.cmd').forEach((el) => {
      el.addEventListener('click', () => handler(el.dataset.cmd));
    });
  }

  // Wire the top menu, setup screen and outcome buttons to the game.
  wire(game) {
    this.game = game;
    document.querySelectorAll('#topmenu .menu-btn').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.dataset.menu === 'new') this.openSetup();
        else if (el.dataset.menu === 'rematch') game.reset();
      });
    });
    document.getElementById('setup-cancel').addEventListener('click', () => this.closeSetup());
    document.getElementById('setup-start').addEventListener('click', () => {
      game.startBattle({ environment: this._setupEnv, groups: this._stripGroups() });
      this.closeSetup();
    });
    // Tabs: Location / Deploy Armies.
    document.querySelectorAll('#setup .setup-tab').forEach((tab) => {
      tab.addEventListener('click', () => this._showTab(tab.dataset.tab));
    });
    // Location-tab quick actions.
    document.getElementById('cfg-random').addEventListener('click', () => this._randomizeSetup());
    document.getElementById('cfg-clear').addEventListener('click', () => this._clearSetup());
    document.getElementById('cfg-default').addEventListener('click', () => this._defaultSetup());
    document.getElementById('save-btn').addEventListener('click', () => this._saveConfig());
    document.getElementById('save-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._saveConfig(); });
    document.getElementById('restart').addEventListener('click', () => game.reset());
    document.getElementById('new-battle').addEventListener('click', () => { this.hideOutcome(); this.openSetup(); });
    document.getElementById('outcome-close').addEventListener('click', () => this.hideOutcome());
    this._wireMarkerDialog();
  }

  // ---- Battle setup (map-driven) ----------------------------------------
  //
  // The battlefield mini-map IS the interface: click an empty spot to drop a
  // unit group, click (or drag) a marker to move it, and configure what it is —
  // unit type, quantity, formation and facing — in a small dialog over the map.
  // Each side is a list of GROUPS: { id, typeKey, count, formation, rot, x, z }.
  openSetup() {
    this._gid = this._gid || 0;
    this._setupEnv = this.game.environment;
    this._setupGroups = {
      roman: this.game.groups.roman.map((g) => ({ ...g, rot: g.rot || 0, id: ++this._gid })),
      barbarian: this.game.groups.barbarian.map((g) => ({ ...g, rot: g.rot || 0, id: ++this._gid })),
    };
    this._editing = null;
    this._renderAll();
    this._wireField();
    this._showTab('location');
    this.setup.classList.add('show');
  }

  _sideTypes(side) { return side === 'roman' ? ROMAN_TYPES : BARBARIAN_TYPES; }
  _sideCount(side) { return this._setupGroups[side].reduce((a, g) => a + g.count, 0); }
  _stripGroups() {
    const strip = (gs) => gs.map(({ typeKey, count, formation, rot, x, z }) => ({ typeKey, count, formation, rot: rot || 0, x, z }));
    return { roman: strip(this._setupGroups.roman), barbarian: strip(this._setupGroups.barbarian) };
  }

  _renderAll() {
    this._renderEnvChoices();
    this._renderSaves();
    this._closeMarker();
    this._drawField();
    this._renderDeployList();
    this._refreshTotals();
  }

  // ---- Save / load battle configurations (localStorage) -----------------
  _loadSaves() {
    try { return JSON.parse(localStorage.getItem('warv1.saves') || '[]'); } catch { return []; }
  }
  _persistSaves(list) {
    try { localStorage.setItem('warv1.saves', JSON.stringify(list)); } catch { /* storage full/blocked */ }
  }

  // Snapshot the current setup (environment + both armies' groups) under a name.
  _saveConfig() {
    const input = document.getElementById('save-name');
    let name = (input.value || '').trim();
    const list = this._loadSaves();
    if (!name) name = 'Battle ' + (list.length + 1);
    const entry = { name, env: this._setupEnv, groups: this._stripGroups() };
    const i = list.findIndex((s) => s.name === name);   // overwrite same-name
    if (i >= 0) list[i] = entry; else list.push(entry);
    this._persistSaves(list);
    input.value = '';
    this._renderSaves();
  }

  _loadConfig(entry) {
    if (ENV_KEYS.includes(entry.env)) this._setupEnv = entry.env;
    const revive = (gs) => (gs || []).map((g) => ({ ...g, rot: g.rot || 0, id: ++this._gid }));
    this._setupGroups = { roman: revive(entry.groups.roman), barbarian: revive(entry.groups.barbarian) };
    this._editing = null;
    this._renderAll();
    this._showTab('deploy');
  }

  _deleteConfig(name) {
    this._persistSaves(this._loadSaves().filter((s) => s.name !== name));
    this._renderSaves();
  }

  _renderSaves() {
    const host = document.getElementById('saves-list');
    if (!host) return;
    host.innerHTML = '';
    const list = this._loadSaves();
    if (list.length === 0) {
      host.innerHTML = '<div class="saves-empty">No saved battles yet — set one up and hit Save.</div>';
      return;
    }
    for (const entry of list) {
      const e = ENVIRONMENTS[entry.env];
      const rn = (entry.groups.roman || []).reduce((a, g) => a + g.count, 0);
      const bn = (entry.groups.barbarian || []).reduce((a, g) => a + g.count, 0);
      const row = document.createElement('div');
      row.className = 'save-item';
      row.innerHTML =
        `<span class="save-emoji">${e ? e.emoji : '⚔️'}</span>
         <span class="save-info"><span class="save-title">${entry.name}</span>
           <span class="save-sub">${e ? e.label : ''} · 🦅 ${rn} vs 🪓 ${bn}</span></span>`;
      const load = document.createElement('button');
      load.className = 'save-load'; load.textContent = 'Load';
      load.addEventListener('click', () => this._loadConfig(entry));
      const del = document.createElement('button');
      del.className = 'save-del'; del.title = 'Delete'; del.textContent = '×';
      del.addEventListener('click', () => this._deleteConfig(entry.name));
      row.appendChild(load); row.appendChild(del);
      host.appendChild(row);
    }
  }

  _showTab(name) {
    document.querySelectorAll('#setup .setup-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#setup .setup-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    // The canvas only sizes correctly once its panel is visible — redraw on show.
    if (name === 'deploy') this._drawField();
  }

  closeSetup() { this.setup.classList.remove('show'); this._closeMarker(); }

  // Battlefield picker: a grid of location/weather tiles.
  _renderEnvChoices() {
    const host = document.getElementById('env-choices');
    if (!host) return;
    host.innerHTML = '';
    for (const key of ENV_KEYS) {
      const e = ENVIRONMENTS[key];
      const tile = document.createElement('button');
      tile.className = 'env-tile' + (key === this._setupEnv ? ' sel' : '');
      tile.innerHTML = `<span class="env-emoji">${e.emoji}</span><span class="env-name">${e.label}</span><span class="env-time">${e.time}</span>`;
      tile.addEventListener('click', () => {
        this._setupEnv = key;
        host.querySelectorAll('.env-tile').forEach((t) => t.classList.remove('sel'));
        tile.classList.add('sel');
      });
      host.appendChild(tile);
    }
  }

  _refreshTotals() {
    const r = this._sideCount('roman'), h = this._sideCount('barbarian');
    const re = document.getElementById('rome-total'), he = document.getElementById('horde-total');
    if (re) re.textContent = r;
    if (he) he.textContent = h;
    document.getElementById('setup-start').disabled = r === 0 || h === 0;
  }

  // ---- Unified battlefield map ------------------------------------------
  // World (x,z) → canvas pixels. The whole field is shown at once: +z (Rome's
  // half) at the BOTTOM, −z (the Horde's half) at the TOP.
  _w2f(wx, wz, W, H) { return [(wx + 28) / 56 * W, (wz + 28) / 56 * H]; }
  _f2w(px, py, W, H) { return [px / W * 56 - 28, py / H * 56 - 28]; }

  _groupWorldUnits(side, grp) {
    const spacing = side === 'roman' ? 2.2 : 2.4;
    const rowGap = grp.count > 24 ? 1.75 : 1.9;
    const slots = rotateSlots(formationOffsets(grp.formation, grp.count, spacing, rowGap), grp.rot || 0);
    const dir = side === 'roman' ? 1 : -1;
    return slots.map((s) => ({ x: grp.x + s.x, z: grp.z + dir * s.depth }));
  }

  _drawField() {
    const cv = document.getElementById('field-map');
    if (!cv) return;
    const W = cv.width, H = cv.height;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    // Ground + the two halves (Horde on top, Rome below).
    g.fillStyle = 'rgba(74,90,52,0.4)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(199,120,60,0.12)'; g.fillRect(0, 0, W, H / 2);
    g.fillStyle = 'rgba(70,120,220,0.12)'; g.fillRect(0, H / 2, W, H / 2);
    // No-man's-land band around the centre line.
    const nz0 = this._w2f(0, -3, W, H)[1], nz1 = this._w2f(0, 3, W, H)[1];
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, nz0, W, nz1 - nz0);
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([6, 5]);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);
    // Half labels.
    g.font = 'bold 12px sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(224,150,74,0.85)'; g.fillText('🪓 THE HORDE', W / 2, 18);
    g.fillStyle = 'rgba(120,170,255,0.9)'; g.fillText('🦅 ROME', W / 2, H - 10);

    for (const side of ['barbarian', 'roman']) {
      const col = side === 'roman' ? '90,160,255' : '224,150,74';
      this._setupGroups[side].forEach((grp) => {
        const on = this._editing && this._editing.grp.id === grp.id;
        for (const u of this._groupWorldUnits(side, grp)) {
          const [x, y] = this._w2f(u.x, u.z, W, H);
          g.fillStyle = `rgba(${col},${on ? 0.95 : 0.55})`;
          g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
        }
        this._drawAnchor(g, side, grp, W, H, on);
      });
    }
    g.lineWidth = 1;
  }

  // A group's anchor: a numbered ring with a facing arrow showing which way the
  // block looks (forward = toward the foe when un-rotated, turning with rot).
  _drawAnchor(g, side, grp, W, H, on) {
    const [ax, ay] = this._w2f(grp.x, grp.z, W, H);
    const ringR = on ? 10 : 7.5;
    const base = side === 'roman' ? 0 : Math.PI;                 // Rome faces up, Horde down
    const ang = base + ((grp.rot || 0) * Math.PI) / 180;
    const fdx = Math.sin(ang), fdy = -Math.cos(ang);
    const px = -fdy, py = fdx;
    const tipx = ax + fdx * (ringR + 9), tipy = ay + fdy * (ringR + 9);
    g.strokeStyle = on ? '#ffe08a' : 'rgba(255,210,79,0.85)'; g.lineWidth = on ? 2.5 : 2;
    g.beginPath(); g.moveTo(ax + fdx * ringR, ay + fdy * ringR); g.lineTo(tipx, tipy); g.stroke();
    g.fillStyle = g.strokeStyle;
    const bx = tipx - fdx * 6, by = tipy - fdy * 6, s = 4;
    g.beginPath(); g.moveTo(tipx, tipy); g.lineTo(bx + px * s, by + py * s); g.lineTo(bx - px * s, by - py * s); g.closePath(); g.fill();
    g.strokeStyle = on ? '#ffe08a' : 'rgba(255,210,79,0.7)'; g.lineWidth = on ? 3 : 1.5;
    g.beginPath(); g.arc(ax, ay, ringR, 0, 7); g.stroke();
    g.fillStyle = on ? 'rgba(255,210,79,0.4)' : 'rgba(255,210,79,0.15)'; g.fill();
    g.fillStyle = '#fff2d0'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(grp.count), ax, ay);
    g.textBaseline = 'alphabetic';
  }

  _wireField() {
    const cv = document.getElementById('field-map');
    if (!cv || cv._wired) return;
    cv._wired = true;
    const canvasXY = (e) => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height];
    };
    const nearest = (px, py) => {
      let best = null, bd = 1e9;
      for (const side of ['roman', 'barbarian']) {
        for (const grp of this._setupGroups[side]) {
          const [ax, ay] = this._w2f(grp.x, grp.z, cv.width, cv.height);
          const d = Math.hypot(ax - px, ay - py);
          if (d < bd) { bd = d; best = { side, grp }; }
        }
      }
      return bd < 22 ? best : null;
    };
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      const [px, py] = canvasXY(e);
      const hit = nearest(px, py);
      if (hit) {
        drag = hit;
        cv.setPointerCapture(e.pointerId);
        this._openMarker(hit.side, hit.grp);
        return;
      }
      const created = this._addGroupAt(px, py, cv);
      if (created) { drag = created; cv.setPointerCapture(e.pointerId); this._openMarker(created.side, created.grp); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const [px, py] = canvasXY(e);
      this._moveGroupTo(drag.side, drag.grp, px, py, cv);
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('pointercancel', () => { drag = null; });
  }

  _moveGroupTo(side, grp, px, py, cv) {
    const B = PLACEMENT_BOUNDS[side];
    const [wx, wz] = this._f2w(px, py, cv.width, cv.height);
    grp.x = clamp(Math.round(wx), B.xMin, B.xMax);
    grp.z = clamp(Math.round(wz), B.zMin, B.zMax);
    this._drawField();
  }

  _addGroupAt(px, py, cv) {
    const [wx, wz] = this._f2w(px, py, cv.width, cv.height);
    const side = wz >= 0 ? 'roman' : 'barbarian';
    const headroom = MAX_PER_SIDE - this._sideCount(side);
    if (headroom <= 0) { this._flashCap(); return null; }
    const B = PLACEMENT_BOUNDS[side];
    const grp = {
      id: ++this._gid, typeKey: this._sideTypes(side)[0],
      count: Math.min(4, headroom, MAX_PER_TYPE), formation: DEFAULT_FORMATION, rot: 0,
      x: clamp(Math.round(wx), B.xMin, B.xMax), z: clamp(Math.round(wz), B.zMin, B.zMax),
    };
    this._setupGroups[side].push(grp);
    this._afterEdit();
    return { side, grp };
  }

  _flashCap() {
    const el = document.getElementById('deploy-hint');
    if (!el) return;
    el.classList.remove('cap'); void el.offsetWidth; el.classList.add('cap');
  }

  _afterEdit() {
    this._drawField();
    this._renderDeployList();
    this._refreshTotals();
  }

  // ---- Marker configuration dialog --------------------------------------
  _wireMarkerDialog() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('md-close', 'click', () => this._closeMarker());
    on('md-done', 'click', () => this._closeMarker());
    on('md-del', 'click', () => this._deleteMarker());
    on('md-type', 'change', (e) => this._editMarker('typeKey', e.target.value));
    on('md-count', 'change', (e) => this._editMarker('count', +e.target.value));
    on('md-formation', 'change', (e) => this._editMarker('formation', e.target.value));
    on('md-rot', 'click', () => this._rotMarker());
  }

  _openMarker(side, grp) {
    this._editing = { side, grp };
    const dlg = document.getElementById('marker-dialog');
    if (!dlg) return;
    const sideEl = document.getElementById('md-side');
    sideEl.textContent = side === 'roman' ? '🦅 Rome' : '🪓 The Horde';
    sideEl.className = 'md-side ' + (side === 'roman' ? 'rome' : 'horde');
    // Unit type.
    const typeSel = document.getElementById('md-type');
    typeSel.innerHTML = '';
    for (const key of this._sideTypes(side)) {
      const o = document.createElement('option');
      o.value = key; o.textContent = UNIT_TYPES[key].label;
      if (key === grp.typeKey) o.selected = true;
      typeSel.appendChild(o);
    }
    this._fillCountSelect(side, grp);
    // Formation.
    const formSel = document.getElementById('md-formation');
    formSel.innerHTML = '';
    for (const key of FORMATION_KEYS) {
      const o = document.createElement('option');
      o.value = key; o.textContent = FORMATIONS[key].label;
      if (key === grp.formation) o.selected = true;
      formSel.appendChild(o);
    }
    // Facing + description.
    document.getElementById('md-rot').textContent = '⟳ ' + (grp.rot || 0) + '°';
    document.getElementById('md-desc').textContent = UNIT_TYPES[grp.typeKey].desc;
    dlg.hidden = false;
    this._drawField();
  }

  _fillCountSelect(side, grp) {
    const sel = document.getElementById('md-count');
    const headroom = MAX_PER_SIDE - (this._sideCount(side) - grp.count);
    const maxCount = Math.max(1, Math.min(MAX_PER_TYPE, headroom));
    sel.innerHTML = '';
    for (let v = 1; v <= maxCount; v++) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      if (v === grp.count) o.selected = true;
      sel.appendChild(o);
    }
  }

  _editMarker(field, value) {
    if (!this._editing) return;
    const { side, grp } = this._editing;
    grp[field] = value;
    if (field === 'typeKey') document.getElementById('md-desc').textContent = UNIT_TYPES[grp.typeKey].desc;
    if (field === 'count') this._fillCountSelect(side, grp);
    this._afterEdit();
  }

  _rotMarker() {
    if (!this._editing) return;
    const grp = this._editing.grp;
    grp.rot = ((grp.rot || 0) + 45) % 360;
    document.getElementById('md-rot').textContent = '⟳ ' + grp.rot + '°';
    this._afterEdit();
  }

  _deleteMarker() {
    if (!this._editing) return;
    const { side, grp } = this._editing;
    this._setupGroups[side] = this._setupGroups[side].filter((x) => x.id !== grp.id);
    this._closeMarker();
    this._afterEdit();
  }

  _closeMarker() {
    this._editing = null;
    const dlg = document.getElementById('marker-dialog');
    if (dlg) dlg.hidden = true;
    this._drawField();
    this._renderDeployList();
  }

  // Compact roster list beside the map — every group, click to edit/select.
  _renderDeployList() {
    const host = document.getElementById('deploy-list');
    if (!host) return;
    host.innerHTML = '';
    const total = this._setupGroups.roman.length + this._setupGroups.barbarian.length;
    if (total === 0) {
      host.innerHTML = '<div class="grp-empty">No units yet — click the map to place a group.</div>';
      return;
    }
    for (const side of ['roman', 'barbarian']) {
      for (const grp of this._setupGroups[side]) {
        const row = document.createElement('div');
        const on = this._editing && this._editing.grp.id === grp.id;
        row.className = 'grp-row ' + side + (on ? ' sel' : '');
        row.innerHTML =
          `<span class="grp-dot ${side}"></span>
           <span class="grp-name">${UNIT_TYPES[grp.typeKey].label} ×${grp.count}</span>
           <span class="grp-form-lbl">${FORMATIONS[grp.formation].label} · ${grp.rot || 0}°</span>`;
        row.addEventListener('click', () => this._openMarker(side, grp));
        host.appendChild(row);
      }
    }
  }

  // ---- Location-tab quick actions ---------------------------------------
  _randomizeSetup() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    this._setupEnv = pick(ENV_KEYS);
    for (const side of ['roman', 'barbarian']) {
      const types = this._sideTypes(side);
      const B = PLACEMENT_BOUNDS[side];
      const nGroups = 2 + Math.floor(Math.random() * 3);   // 2–4 groups
      const groups = [];
      let budget = MAX_PER_SIDE;
      for (let i = 0; i < nGroups && budget > 1; i++) {
        const count = Math.min(budget, Math.min(MAX_PER_TYPE, 2 + Math.floor(Math.random() * 8)));
        budget -= count;
        groups.push({
          id: ++this._gid, typeKey: pick(types), count, formation: pick(FORMATION_KEYS),
          rot: Math.floor(Math.random() * 8) * 45,
          x: clamp(Math.round(B.xMin + Math.random() * (B.xMax - B.xMin)), B.xMin, B.xMax),
          z: clamp(Math.round(B.zMin + Math.random() * (B.zMax - B.zMin)), B.zMin, B.zMax),
        });
      }
      this._setupGroups[side] = groups;
    }
    this._editing = null;
    this._renderAll();
    this._showTab('deploy');
  }

  _clearSetup() {
    this._setupGroups = { roman: [], barbarian: [] };
    this._editing = null;
    this._setupEnv = DEFAULT_ENV;
    this._renderAll();
  }

  _defaultSetup() {
    const d = defaultGroups();
    this._setupGroups = {
      roman: d.roman.map((g) => ({ ...g, rot: g.rot || 0, id: ++this._gid })),
      barbarian: d.barbarian.map((g) => ({ ...g, rot: g.rot || 0, id: ++this._gid })),
    };
    this._editing = null;
    this._setupEnv = DEFAULT_ENV;
    this._renderAll();
  }

  updateTally(game) {
    this.romeCount.textContent = game.livingRomans().length;
    this.hordeCount.textContent = game.livingHorde().length;
  }

  updateSelectionInfo(game) {
    const n = game.selected.size;
    if (game.livingRomans().length === 0) {
      this.selInfo.innerHTML = 'The legion is no more.';
      return;
    }
    if (n === 0) {
      this.selInfo.innerHTML = 'Commanding <em>all</em> legionaries — click one or drag a box to pick a squad';
    } else {
      const orders = new Set([...game.selected].map((u) => u.order));
      const order = orders.size === 1 ? [...orders][0] : 'mixed';
      this.selInfo.innerHTML = `<em>${n}</em> legionar${n === 1 ? 'y' : 'ies'} selected · orders: <em>${order}</em>`;
    }
  }

  // Render a soldier's dossier: attributes + derived combat stats. Only rebuilds
  // the DOM when the shown unit changes, but refreshes the HP bar every frame.
  updateStats(unit) {
    if (!unit) {
      if (this._statKey !== null) { this.stats.classList.remove('show'); this._statKey = null; }
      return;
    }
    if (this._statKey !== unit.id) {
      this._statKey = unit.id;
      const a = unit.attrs;
      const s = unit.stats;
      const side = unit.faction === 'roman' ? 'rome' : 'horde';
      const bars = ATTRS.map((k) => {
        const v = a[k];
        const pct = Math.round((v / 18) * 100);
        return `<div class="attr"><span class="attr-name">${ATTR_LABELS[k]}</span>
          <span class="attr-bar"><i style="width:${pct}%"></i></span>
          <span class="attr-val">${v}</span></div>`;
      }).join('');
      const derived = `<div class="derived">
        <span>❤ ${s.maxHp} HP</span><span>⚔ ${s.dmg.toFixed(0)} dmg</span>
        <span>🎯 ${Math.round(s.accuracy * 100)}% acc</span><span>💨 ${Math.round(s.dodge * 100)}% dodge</span>
        <span>⛨ ${Math.round(s.block * 100)}% block</span><span>🛡 ${Math.round(s.toughness * 100)}% tough</span>
        <span>✷ ${Math.round(s.crit * 100)}% crit</span>
      </div>`;
      this.stats.className = `show ${side}`;
      this.stats.innerHTML =
        `<div class="stat-head"><span class="stat-name">${unit.name}</span>
           <span class="stat-rank">${unit.rank}${unit.faction === 'barbarian' ? ' · enemy' : ''}</span></div>
         <div class="attrs">${bars}</div>${derived}`;
    }
  }

  flashCommand(cmd) {
    const el = this._cmdEls[cmd];
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  showOutcome(win, sub) {
    this.outcomeTitle.textContent = win ? 'VICTORY' : 'DEFEAT';
    this.outcomeTitle.className = win ? 'win' : 'lose';
    this.outcomeSub.textContent = sub;
    this.outcome.classList.add('show');
  }

  hideOutcome() {
    this.outcome.classList.remove('show');
  }

  hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
  }
}
