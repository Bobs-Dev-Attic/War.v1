import { ATTRS, ATTR_LABELS } from './attributes.js';
import { UNIT_TYPES, ROMAN_TYPES, BARBARIAN_TYPES, armyCount } from './unitTypes.js';

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
      game.startBattle(this._setupComp);
      this.closeSetup();
    });
    document.getElementById('restart').addEventListener('click', () => game.reset());
    document.getElementById('new-battle').addEventListener('click', () => { this.hideOutcome(); this.openSetup(); });
    document.getElementById('outcome-close').addEventListener('click', () => this.hideOutcome());
  }

  // ---- Battle setup ------------------------------------------------------
  openSetup() {
    // Start from a copy of the current composition.
    this._setupComp = {
      roman: { ...this.game.composition.roman },
      barbarian: { ...this.game.composition.barbarian },
    };
    this._renderSetup('rome-types', ROMAN_TYPES, 'roman');
    this._renderSetup('horde-types', BARBARIAN_TYPES, 'barbarian');
    this._refreshSetupTotals();
    this.setup.classList.add('show');
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
  }

  _refreshSetupTotals() {
    const r = armyCount(this._setupComp.roman);
    const h = armyCount(this._setupComp.barbarian);
    document.getElementById('rome-total').textContent = r;
    document.getElementById('horde-total').textContent = h;
    document.getElementById('setup-start').disabled = r === 0 || h === 0;
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
