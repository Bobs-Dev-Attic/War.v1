import { ATTRS, ATTR_LABELS } from './attributes.js';
import { UNIT_TYPES, ROMAN_TYPES, BARBARIAN_TYPES } from './unitTypes.js';
import { ENVIRONMENTS, ENV_KEYS, DEFAULT_ENV } from './environments.js';
import { FORMATIONS, FORMATION_KEYS, formationOffsets, distributeCounts, PLACEMENT_BOUNDS, DEFAULT_FORMATION } from './formations.js';
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

  // Roster: per unit type, a count stepper and (when 2+) a "groups" splitter.
  _renderRoster(containerId, side) {
    const host = document.getElementById(containerId);
    if (!host) return;
    host.innerHTML = '';
    for (const key of this._sideTypes(side)) {
      const t = UNIT_TYPES[key];
      const r = this._roster[side][key] || { count: 0, groups: 1 };
      const groups = Math.max(1, Math.min(r.groups || 1, r.count));
      const groupCtl = r.count >= 2
        ? `<span class="type-groups">groups
             <span class="stepper stepper-sm">
               <button data-g="-1">−</button><span class="gcount">${groups}</span><button data-g="1">+</button>
             </span></span>` : '';
      const row = document.createElement('div');
      row.className = 'type-row';
      row.innerHTML =
        `<span class="type-name">${t.label}</span>
         <span class="stepper">
           <button data-d="-1">−</button><span class="count">${r.count}</span><button data-d="1">+</button>
         </span>
         ${groupCtl}
         <span class="type-desc">${t.desc}</span>`;
      row.querySelectorAll('button[data-d]').forEach((b) =>
        b.addEventListener('click', () => this._stepCount(side, key, +b.dataset.d)));
      row.querySelectorAll('button[data-g]').forEach((b) =>
        b.addEventListener('click', () => this._stepGroups(side, key, +b.dataset.g)));
      host.appendChild(row);
    }
  }

  _stepCount(side, key, delta) {
    const roster = this._roster[side];
    const r = roster[key] || (roster[key] = { count: 0, groups: 1 });
    const total = this._sideCount(side);
    let next = Math.max(0, Math.min(MAX_PER_TYPE, r.count + delta));
    if (delta > 0 && total - r.count + next > MAX_PER_SIDE) return;
    r.count = next;
    r.groups = r.count < 2 ? 1 : Math.min(r.groups || 1, r.count);
    this._rebuildGroups(side);
    this._renderSide(side);
  }

  _stepGroups(side, key, delta) {
    const r = this._roster[side][key];
    if (!r || r.count < 1) return;
    r.groups = Math.max(1, Math.min(r.count, (r.groups || 1) + delta));
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
      id: ++this._gid, typeKey, count, formation: DEFAULT_FORMATION,
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
    const slots = formationOffsets(grp.formation, grp.count, spacing, rowGap);
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
      g.strokeStyle = on ? '#ffe08a' : 'rgba(255,210,79,0.7)'; g.lineWidth = on ? 3 : 1.5;
      g.beginPath(); g.arc(ax, ay, on ? 9 : 7, 0, 7); g.stroke();
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
