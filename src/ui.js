import { ATTRS, ATTR_LABELS } from './attributes.js';
import { UNIT_TYPES, ROMAN_TYPES, BARBARIAN_TYPES, DEFAULT_ARMY, composeArmy, armyCount } from './unitTypes.js';
import { ENVIRONMENTS, ENV_KEYS, DEFAULT_ENV } from './environments.js';
import { FORMATIONS, FORMATION_KEYS, formationOffsets, defaultPlacement, PLACEMENT_BOUNDS } from './formations.js';

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
      game.startBattle(this._setupComp, {
        environment: this._setupEnv,
        placement: this._setupPlacement,
      });
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
  openSetup() {
    // Start from a copy of the current composition and battlefield settings.
    this._setupComp = {
      roman: { ...this.game.composition.roman },
      barbarian: { ...this.game.composition.barbarian },
    };
    this._setupEnv = this.game.environment;
    this._setupPlacement = {
      roman: { ...this.game.placement.roman },
      barbarian: { ...this.game.placement.barbarian },
    };
    this._renderAll();
    this._wireMap('rome-map', 'roman');
    this._wireMap('horde-map', 'barbarian');
    this._showTab('location');
    this.setup.classList.add('show');
  }

  // Re-render every control from the current setup state.
  _renderAll() {
    this._renderEnvChoices();
    this._renderSetup('rome-types', ROMAN_TYPES, 'roman');
    this._renderSetup('horde-types', BARBARIAN_TYPES, 'barbarian');
    this._renderFormationChoice('rome-formation', 'roman');
    this._renderFormationChoice('horde-formation', 'barbarian');
    this._drawMap('rome-map', 'roman');
    this._drawMap('horde-map', 'barbarian');
    this._refreshSetupTotals();
  }

  _showTab(name) {
    document.querySelectorAll('#setup .setup-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#setup .setup-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    // Canvases only lay out correctly once visible — redraw on show.
    if (name === 'rome') this._drawMap('rome-map', 'roman');
    if (name === 'horde') this._drawMap('horde-map', 'barbarian');
  }

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

  // Per-side formation selector; changing it re-lays the deployment map.
  _renderFormationChoice(hostId, side) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';
    const sel = document.createElement('select');
    sel.className = 'form-select';
    for (const key of FORMATION_KEYS) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = FORMATIONS[key].label;
      if (key === this._setupPlacement[side].formation) opt.selected = true;
      sel.appendChild(opt);
    }
    const desc = document.createElement('span');
    desc.className = 'form-desc';
    desc.textContent = FORMATIONS[this._setupPlacement[side].formation].desc;
    sel.addEventListener('change', () => {
      this._setupPlacement[side].formation = sel.value;
      desc.textContent = FORMATIONS[sel.value].desc;
      this._drawMap(side === 'roman' ? 'rome-map' : 'horde-map', side);
    });
    host.appendChild(sel);
    host.appendChild(desc);
  }

  closeSetup() { this.setup.classList.remove('show'); }

  _renderSetup(containerId, typeKeys, side) {
    const host = document.getElementById(containerId);
    host.innerHTML = '';
    for (const key of typeKeys) {
      const t = UNIT_TYPES[key];
      const row = document.createElement('div');
      row.className = 'type-row';
      row.innerHTML =
        `<span class="type-name">${t.label}</span>
         <span class="stepper">
           <button data-d="-1">−</button>
           <span class="count" id="cnt-${side}-${key}">0</span>
           <button data-d="1">+</button>
         </span>
         <span class="type-desc">${t.desc}</span>`;
      const countEl = row.querySelector('.count');
      countEl.textContent = this._setupComp[side][key] || 0;
      row.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => this._step(side, key, +b.dataset.d, countEl));
      });
      host.appendChild(row);
    }
  }

  _step(side, key, delta, countEl) {
    const comp = this._setupComp[side];
    const cur = comp[key] || 0;
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > MAX_PER_TYPE) next = MAX_PER_TYPE;
    // Respect the per-side cap.
    if (delta > 0 && armyCount(comp) - cur + next > MAX_PER_SIDE) return;
    comp[key] = next;
    countEl.textContent = next;
    this._refreshSetupTotals();
    this._drawMap(side === 'roman' ? 'rome-map' : 'horde-map', side);
  }

  _refreshSetupTotals() {
    const r = armyCount(this._setupComp.roman);
    const h = armyCount(this._setupComp.barbarian);
    const re = document.getElementById('rome-total');
    const he = document.getElementById('horde-total');
    if (re) re.textContent = r;
    if (he) he.textContent = h;
    document.getElementById('setup-start').disabled = r === 0 || h === 0;
  }

  // ---- Deployment mini-map ----------------------------------------------
  // Draw a top-down plan of the side's half of the field with a dot per unit
  // at its formation slot; the anchor handle can be dragged to reposition.
  _mapUnits(side) {
    const comp = this._setupComp[side];
    const order = composeArmy(comp).sort((a, b) =>
      (UNIT_TYPES[a].role === 'ranged' ? 1 : 0) - (UNIT_TYPES[b].role === 'ranged' ? 1 : 0));
    const p = this._setupPlacement[side];
    const spacing = side === 'roman' ? 2.2 : 2.4;
    const rowGap = order.length > 24 ? 1.75 : 1.9;
    const slots = formationOffsets(p.formation, order.length, spacing, rowGap);
    const dir = side === 'roman' ? 1 : -1;
    return order.map((key, i) => {
      const s = slots[i] || { x: 0, depth: 0 };
      return { x: p.x + s.x, z: p.z + dir * s.depth, ranged: UNIT_TYPES[key].role === 'ranged' };
    });
  }

  // World (x,z) → canvas pixels. Forward (toward the foe) is always UP.
  _w2m(side, wx, wz, W, H) {
    const cx = (wx + 28) / 56 * W;
    const cy = side === 'roman' ? (wz + 28) / 56 * H : (28 - wz) / 56 * H;
    return [cx, cy];
  }

  _drawMap(canvasId, side) {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    const W = cv.width, H = cv.height;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    // Field
    g.fillStyle = 'rgba(74,90,52,0.35)';
    g.fillRect(0, 0, W, H);
    // Enemy half tint (top)
    g.fillStyle = 'rgba(150,50,50,0.10)';
    g.fillRect(0, 0, W, H / 2);
    // Own half tint (bottom)
    g.fillStyle = side === 'roman' ? 'rgba(70,120,220,0.10)' : 'rgba(199,120,60,0.12)';
    g.fillRect(0, H / 2, W, H / 2);
    // Midline
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([5, 5]);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = '10px sans-serif'; g.textAlign = 'center';
    g.fillText('▲ enemy', W / 2, 12);
    // Enemy formation (faint reference)
    const foe = side === 'roman' ? 'barbarian' : 'roman';
    for (const u of this._mapUnits(foe)) {
      const [x, y] = this._w2m(side, u.x, u.z, W, H);
      g.fillStyle = 'rgba(200,90,90,0.35)';
      g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill();
    }
    // Own units
    const col = side === 'roman' ? '#5aa0ff' : '#e0964a';
    const rangedCol = side === 'roman' ? '#9ec8ff' : '#f0c48a';
    for (const u of this._mapUnits(side)) {
      const [x, y] = this._w2m(side, u.x, u.z, W, H);
      g.fillStyle = u.ranged ? rangedCol : col;
      g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill();
    }
    // Anchor handle
    const p = this._setupPlacement[side];
    const [ax, ay] = this._w2m(side, p.x, p.z, W, H);
    g.strokeStyle = '#ffd24f'; g.lineWidth = 2;
    g.beginPath(); g.arc(ax, ay, 7, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,210,79,0.35)'; g.fill();
    g.lineWidth = 1;
  }

  _wireMap(canvasId, side) {
    const cv = document.getElementById(canvasId);
    if (!cv || cv._wired) return;
    cv._wired = true;
    const B = PLACEMENT_BOUNDS[side];
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const setFromEvent = (e) => {
      const rect = cv.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * cv.width;
      const py = (e.clientY - rect.top) / rect.height * cv.height;
      const wx = px / cv.width * 56 - 28;
      const wz = side === 'roman' ? py / cv.height * 56 - 28 : 28 - py / cv.height * 56;
      const p = this._setupPlacement[side];
      p.x = clamp(Math.round(wx), B.xMin, B.xMax);
      p.z = clamp(Math.round(wz), B.zMin, B.zMax);
      this._drawMap(canvasId, side);
    };
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => { dragging = true; cv.setPointerCapture(e.pointerId); setFromEvent(e); });
    cv.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    cv.addEventListener('pointerup', () => { dragging = false; });
    cv.addEventListener('pointercancel', () => { dragging = false; });
  }

  // ---- Location-tab quick actions ---------------------------------------
  _randomizeSetup() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    this._setupEnv = pick(ENV_KEYS);
    for (const [side, types] of [['roman', ROMAN_TYPES], ['barbarian', BARBARIAN_TYPES]]) {
      const comp = {};
      let budget = 6 + Math.floor(Math.random() * (MAX_PER_SIDE - 6));
      const shuffled = types.slice().sort(() => Math.random() - 0.5);
      for (const key of shuffled) {
        if (budget <= 0) break;
        const n = Math.min(budget, Math.floor(Math.random() * (MAX_PER_TYPE + 1)));
        if (n > 0) { comp[key] = n; budget -= n; }
      }
      if (armyCount(comp) === 0) comp[types[0]] = 3;      // never empty
      this._setupComp[side] = comp;
      const B = PLACEMENT_BOUNDS[side];
      this._setupPlacement[side] = {
        formation: pick(FORMATION_KEYS),
        x: Math.round(B.xMin + Math.random() * (B.xMax - B.xMin)),
        z: Math.round(B.zMin + Math.random() * (B.zMax - B.zMin)),
      };
    }
    this._renderAll();
  }

  _clearSetup() {
    this._setupComp = { roman: {}, barbarian: {} };
    this._setupEnv = DEFAULT_ENV;
    this._setupPlacement = defaultPlacement();
    this._renderAll();
  }

  _defaultSetup() {
    this._setupComp = { roman: { ...DEFAULT_ARMY.roman }, barbarian: { ...DEFAULT_ARMY.barbarian } };
    this._setupEnv = DEFAULT_ENV;
    this._setupPlacement = defaultPlacement();
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
