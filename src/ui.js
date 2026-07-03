import { ATTRS, ATTR_LABELS } from './attributes.js';
import { UNIT_TYPES, ROMAN_TYPES, BARBARIAN_TYPES } from './unitTypes.js';
import { ENVIRONMENTS, ENV_KEYS, DEFAULT_ENV } from './environments.js';
import { FORMATIONS, FORMATION_KEYS, formationOffsets, rotateSlots, distributeCounts, PLACEMENT_BOUNDS, DEFAULT_FORMATION } from './formations.js';
import { defaultGroups } from './game.js';

// The engine handles large armies comfortably (collision/AI are cheap and the
// formation packs deep armies inside the field), so these caps are generous.
const MAX_PER_TYPE = 20;
const MAX_PER_SIDE = 40;

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
      game.startBattle({ environment: this._setupEnv, groups: this._setupGroups });
      this.closeSetup();
    });
    // Tabs: Location / Rome / The Horde.
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
  }

  // ---- Battle setup (tabbed: Location / Rome / Horde) --------------------
  //
  // Each side is a list of GROUPS: { id, typeKey, count, formation, x, z }. The
  // roster (per type: total count + how many groups to split it into) drives the
  // group list; each group then gets its own formation and drag-to-place anchor.
  openSetup() {
    this._gid = this._gid || 0;
    this._setupEnv = this.game.environment;
    this._setupGroups = {
      roman: this.game.groups.roman.map((g) => ({ ...g, id: ++this._gid })),
      barbarian: this.game.groups.barbarian.map((g) => ({ ...g, id: ++this._gid })),
    };
    this._roster = { roman: this._deriveRoster('roman'), barbarian: this._deriveRoster('barbarian') };
    this._sel = { roman: null, barbarian: null };
    this._renderAll();
    this._wireMap('rome-map', 'roman');
    this._wireMap('horde-map', 'barbarian');
    this._showTab('location');
    this.setup.classList.add('show');
  }

  _sideIds(side) {
    return side === 'roman'
      ? { types: 'rome-types', map: 'rome-map', legend: 'rome-legend', total: 'rome-total' }
      : { types: 'horde-types', map: 'horde-map', legend: 'horde-legend', total: 'horde-total' };
  }
  _sideTypes(side) { return side === 'roman' ? ROMAN_TYPES : BARBARIAN_TYPES; }
  _sideCount(side) { return this._setupGroups[side].reduce((a, g) => a + g.count, 0); }

  _deriveRoster(side) {
    const r = {};
    for (const g of this._setupGroups[side]) {
      if (!r[g.typeKey]) r[g.typeKey] = { count: 0, groups: 0 };
      r[g.typeKey].count += g.count;
      r[g.typeKey].groups += 1;
    }
    return r;
  }

  _renderAll() {
    this._renderEnvChoices();
    this._renderSide('roman');
    this._renderSide('barbarian');
    this._renderSaves();
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
    const strip = (gs) => gs.map(({ typeKey, count, formation, rot, x, z }) => ({ typeKey, count, formation, rot: rot || 0, x, z }));
    const entry = {
      name, env: this._setupEnv,
      groups: { roman: strip(this._setupGroups.roman), barbarian: strip(this._setupGroups.barbarian) },
    };
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
    this._roster = { roman: this._deriveRoster('roman'), barbarian: this._deriveRoster('barbarian') };
    this._sel = { roman: null, barbarian: null };
    this._renderAll();
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

  _renderSide(side) {
    const id = this._sideIds(side);
    this._renderRoster(id.types, side);
    this._renderLegend(id.legend, side);
    this._drawMap(id.map, side);
    this._refreshTotals();
  }

  _showTab(name) {
    document.querySelectorAll('#setup .setup-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#setup .setup-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    // Canvases only size correctly once visible — redraw on show.
    if (name === 'rome') this._drawMap('rome-map', 'roman');
    if (name === 'horde') this._drawMap('horde-map', 'barbarian');
  }

  closeSetup() { this.setup.classList.remove('show'); }

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

  // Roster: per unit type, a count dropdown and (when 2+) a "groups" dropdown.
  _renderRoster(containerId, side) {
    const host = document.getElementById(containerId);
    if (!host) return;
    host.innerHTML = '';
    for (const key of this._sideTypes(side)) {
      const t = UNIT_TYPES[key];
      const r = this._roster[side][key] || { count: 0, groups: 1 };
      const groups = Math.max(1, Math.min(r.groups || 1, r.count));
      // How many of this type we could still add without breaking the side cap.
      const headroom = MAX_PER_SIDE - (this._sideCount(side) - r.count);
      const maxCount = Math.min(MAX_PER_TYPE, headroom);
      const row = document.createElement('div');
      row.className = 'type-row';
      row.innerHTML =
        `<span class="type-name">${t.label}</span>
         <select class="ros-select" data-role="count"></select>
         <span class="type-groups${r.count >= 2 ? '' : ' hidden'}">groups
           <select class="ros-select ros-groups" data-role="groups"></select></span>
         <span class="type-desc">${t.desc}</span>`;
      const countSel = row.querySelector('[data-role="count"]');
      this._fillSelect(countSel, 0, maxCount, r.count);
      countSel.addEventListener('change', () => this._setCount(side, key, +countSel.value));
      const grpSel = row.querySelector('[data-role="groups"]');
      this._fillSelect(grpSel, 1, r.count, groups);
      grpSel.addEventListener('change', () => this._setGroups(side, key, +grpSel.value));
      host.appendChild(row);
    }
  }

  _fillSelect(sel, lo, hi, cur) {
    sel.innerHTML = '';
    for (let v = lo; v <= hi; v++) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      if (v === cur) o.selected = true;
      sel.appendChild(o);
    }
  }

  _setCount(side, key, value) {
    const roster = this._roster[side];
    const r = roster[key] || (roster[key] = { count: 0, groups: 1 });
    const headroom = MAX_PER_SIDE - (this._sideCount(side) - r.count);
    r.count = Math.max(0, Math.min(MAX_PER_TYPE, headroom, value));
    r.groups = r.count < 2 ? 1 : Math.min(r.groups || 1, r.count);
    this._rebuildGroups(side);
    this._renderSide(side);
  }

  _setGroups(side, key, value) {
    const r = this._roster[side][key];
    if (!r || r.count < 1) return;
    r.groups = Math.max(1, Math.min(r.count, value));
    this._rebuildGroups(side);
    this._renderSide(side);
  }

  // Rebuild the side's group list from the roster, preserving each group's
  // formation/anchor/id by (type, index) so edits and selection survive.
  _rebuildGroups(side) {
    const old = this._setupGroups[side];
    const result = [];
    for (const typeKey of this._sideTypes(side)) {
      const r = this._roster[side][typeKey];
      if (!r || r.count <= 0) continue;
      const g = Math.max(1, Math.min(r.groups || 1, r.count));
      const counts = distributeCounts(r.count, g);
      const prev = old.filter((x) => x.typeKey === typeKey);
      counts.forEach((c, i) => {
        result.push(prev[i] ? { ...prev[i], count: c } : this._newGroup(side, typeKey, c, result.length));
      });
    }
    this._setupGroups[side] = result;
    if (this._sel[side] && !result.some((g) => g.id === this._sel[side])) this._sel[side] = null;
  }

  _newGroup(side, typeKey, count, idx) {
    const B = PLACEMENT_BOUNDS[side];
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const dz = side === 'roman' ? 9 : -9;
    const dir = side === 'roman' ? 1 : -1;
    return {
      id: ++this._gid, typeKey, count, formation: DEFAULT_FORMATION, rot: 0,
      x: clamp(((idx % 5) - 2) * 6, B.xMin, B.xMax),
      z: clamp(dz + dir * Math.floor(idx / 5) * 4, B.zMin, B.zMax),
    };
  }

  // Legend under the map: one row per group with its formation selector; click
  // a row (or its map marker) to select and reposition that group.
  _renderLegend(hostId, side) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';
    const groups = this._setupGroups[side];
    if (groups.length === 0) {
      host.innerHTML = '<div class="grp-empty">No units yet — add some at left.</div>';
      return;
    }
    const badges = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];
    groups.forEach((grp, i) => {
      const row = document.createElement('div');
      row.className = 'grp-row' + (this._sel[side] === grp.id ? ' sel' : '');
      row.innerHTML =
        `<span class="grp-badge">${badges[i] || i + 1}</span>
         <span class="grp-name">${UNIT_TYPES[grp.typeKey].label} ×${grp.count}</span>`;
      const sel = document.createElement('select');
      sel.className = 'grp-form';
      for (const key of FORMATION_KEYS) {
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = FORMATIONS[key].label;
        if (key === grp.formation) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('pointerdown', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        grp.formation = sel.value;
        this._drawMap(this._sideIds(side).map, side);
      });
      row.appendChild(sel);
      // Rotation: a button that cycles the block's facing in 45° steps.
      const rot = document.createElement('button');
      rot.className = 'grp-rot'; rot.title = 'Rotate formation 45°';
      rot.textContent = '⟳ ' + (grp.rot || 0) + '°';
      rot.addEventListener('pointerdown', (e) => e.stopPropagation());
      rot.addEventListener('click', (e) => {
        e.stopPropagation();
        grp.rot = ((grp.rot || 0) + 45) % 360;
        rot.textContent = '⟳ ' + grp.rot + '°';
        this._drawMap(this._sideIds(side).map, side);
      });
      row.appendChild(rot);
      row.addEventListener('click', () => this._selectGroup(side, grp.id));
      host.appendChild(row);
    });
  }

  _selectGroup(side, id) {
    this._sel[side] = id;
    const ids = this._sideIds(side);
    this._renderLegend(ids.legend, side);
    this._drawMap(ids.map, side);
  }

  _refreshTotals() {
    const r = this._sideCount('roman'), h = this._sideCount('barbarian');
    const re = document.getElementById('rome-total'), he = document.getElementById('horde-total');
    if (re) re.textContent = r;
    if (he) he.textContent = h;
    document.getElementById('setup-start').disabled = r === 0 || h === 0;
  }

  // ---- Deployment mini-map ----------------------------------------------
  _groupUnits(side, grp) {
    const spacing = side === 'roman' ? 2.2 : 2.4;
    const rowGap = grp.count > 24 ? 1.75 : 1.9;
    const slots = rotateSlots(formationOffsets(grp.formation, grp.count, spacing, rowGap), grp.rot || 0);
    const dir = side === 'roman' ? 1 : -1;
    return slots.map((s) => ({ x: grp.x + s.x, z: grp.z + dir * s.depth }));
  }

  // World (x,z) → canvas pixels. Forward (toward the foe) is always UP.
  _w2m(side, wx, wz, W, H) {
    return [(wx + 28) / 56 * W, side === 'roman' ? (wz + 28) / 56 * H : (28 - wz) / 56 * H];
  }

  _drawMap(canvasId, side) {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    const W = cv.width, H = cv.height;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(74,90,52,0.35)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(150,50,50,0.10)'; g.fillRect(0, 0, W, H / 2);
    g.fillStyle = side === 'roman' ? 'rgba(70,120,220,0.10)' : 'rgba(199,120,60,0.12)'; g.fillRect(0, H / 2, W, H / 2);
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([5, 5]);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = '10px sans-serif'; g.textAlign = 'center';
    g.fillText('▲ enemy', W / 2, 12);
    // Enemy groups (faint reference)
    const foe = side === 'roman' ? 'barbarian' : 'roman';
    for (const grp of this._setupGroups[foe]) {
      for (const u of this._groupUnits(foe, grp)) {
        const [x, y] = this._w2m(side, u.x, u.z, W, H);
        g.fillStyle = 'rgba(200,90,90,0.30)';
        g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill();
      }
    }
    // Own groups
    const col = side === 'roman' ? '90,160,255' : '224,150,74';
    this._setupGroups[side].forEach((grp, i) => {
      const on = this._sel[side] === grp.id;
      for (const u of this._groupUnits(side, grp)) {
        const [x, y] = this._w2m(side, u.x, u.z, W, H);
        g.fillStyle = `rgba(${col},${on ? 0.95 : 0.5})`;
        g.beginPath(); g.arc(x, y, 3.1, 0, 7); g.fill();
      }
      const [ax, ay] = this._w2m(side, grp.x, grp.z, W, H);
      const ringR = on ? 9 : 7;
      // Facing arrow: points where the group faces (toward the enemy when the
      // formation is un-rotated), turning with the group's rotation.
      const r = ((grp.rot || 0) * Math.PI) / 180;
      const fdx = Math.sin(r), fdy = -Math.cos(r);          // forward on the canvas
      const px = -fdy, py = fdx;                            // perpendicular (barbs)
      const tipx = ax + fdx * (ringR + 9), tipy = ay + fdy * (ringR + 9);
      g.strokeStyle = on ? '#ffe08a' : 'rgba(255,210,79,0.85)'; g.lineWidth = on ? 2.5 : 2;
      g.beginPath(); g.moveTo(ax + fdx * ringR, ay + fdy * ringR); g.lineTo(tipx, tipy); g.stroke();
      g.fillStyle = g.strokeStyle;
      const bx = tipx - fdx * 6, by = tipy - fdy * 6, s = 4;
      g.beginPath(); g.moveTo(tipx, tipy); g.lineTo(bx + px * s, by + py * s); g.lineTo(bx - px * s, by - py * s); g.closePath(); g.fill();
      // Anchor ring + group number.
      g.strokeStyle = on ? '#ffe08a' : 'rgba(255,210,79,0.7)'; g.lineWidth = on ? 3 : 1.5;
      g.beginPath(); g.arc(ax, ay, ringR, 0, 7); g.stroke();
      g.fillStyle = on ? 'rgba(255,210,79,0.35)' : 'rgba(255,210,79,0.15)'; g.fill();
      g.fillStyle = '#fff2d0'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), ax, ay);
      g.textBaseline = 'alphabetic';
    });
    g.lineWidth = 1;
  }

  _wireMap(canvasId, side) {
    const cv = document.getElementById(canvasId);
    if (!cv || cv._wired) return;
    cv._wired = true;
    const B = PLACEMENT_BOUNDS[side];
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const nearest = (px, py) => {
      let best = null, bd = 1e9;
      for (const grp of this._setupGroups[side]) {
        const [ax, ay] = this._w2m(side, grp.x, grp.z, cv.width, cv.height);
        const d = Math.hypot(ax - px, ay - py);
        if (d < bd) { bd = d; best = grp; }
      }
      return bd < 28 ? best : null;
    };
    let drag = null;
    const canvasXY = (e) => {
      const rect = cv.getBoundingClientRect();
      return [(e.clientX - rect.left) / rect.width * cv.width, (e.clientY - rect.top) / rect.height * cv.height];
    };
    const moveTo = (grp, px, py) => {
      const wx = px / cv.width * 56 - 28;
      const wz = side === 'roman' ? py / cv.height * 56 - 28 : 28 - py / cv.height * 56;
      grp.x = clamp(Math.round(wx), B.xMin, B.xMax);
      grp.z = clamp(Math.round(wz), B.zMin, B.zMax);
      this._drawMap(canvasId, side);
    };
    cv.addEventListener('pointerdown', (e) => {
      const [px, py] = canvasXY(e);
      // grab the nearest group, or move the currently-selected one to here
      let grp = nearest(px, py);
      if (!grp && this._sel[side]) grp = this._setupGroups[side].find((x) => x.id === this._sel[side]);
      if (!grp) return;
      drag = grp; cv.setPointerCapture(e.pointerId);
      this._selectGroup(side, grp.id);
      moveTo(grp, px, py);
    });
    cv.addEventListener('pointermove', (e) => { if (drag) { const [px, py] = canvasXY(e); moveTo(drag, px, py); } });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('pointercancel', () => { drag = null; });
  }

  // ---- Location-tab quick actions ---------------------------------------
  _randomizeSetup() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
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
      if (groups.length === 0) groups.push(this._newGroup(side, types[0], 3, 0));
      this._setupGroups[side] = groups;
      this._roster[side] = this._deriveRoster(side);
    }
    this._sel = { roman: null, barbarian: null };
    this._renderAll();
  }

  _clearSetup() {
    this._setupGroups = { roman: [], barbarian: [] };
    this._roster = { roman: {}, barbarian: {} };
    this._sel = { roman: null, barbarian: null };
    this._setupEnv = DEFAULT_ENV;
    this._renderAll();
  }

  _defaultSetup() {
    const d = defaultGroups();
    this._setupGroups = {
      roman: d.roman.map((g) => ({ ...g, id: ++this._gid })),
      barbarian: d.barbarian.map((g) => ({ ...g, id: ++this._gid })),
    };
    this._roster = { roman: this._deriveRoster('roman'), barbarian: this._deriveRoster('barbarian') };
    this._sel = { roman: null, barbarian: null };
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
