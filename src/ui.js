import { ATTRS, ATTR_LABELS } from './attributes.js';

// Thin controller over the HUD DOM: tallies, selection info, command feedback,
// the soldier dossier panel and the victory/defeat banner.
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

  bindRestart(handler) {
    document.getElementById('restart').addEventListener('click', handler);
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
        <span>🎯 ${Math.round(s.accuracy * 100)}%</span><span>💨 ${Math.round(s.dodge * 100)}% dodge</span>
        <span>✷ ${Math.round(s.crit * 100)}% crit</span><span>🛡 ${Math.round(s.toughness * 100)}% tough</span>
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
