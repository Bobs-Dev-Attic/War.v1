// Character attribute system.
//
// Every soldier — Roman or barbarian — is rolled as an individual from their
// faction's attribute profile, then their combat statistics (health, damage,
// attack cadence, movement, accuracy, dodge, crit, toughness) are DERIVED from
// those attributes. Two legionaries are never quite the same fighter.
//
// Attributes use a 3–18 scale (10 ≈ average human).

export const ATTRS = ['str', 'dex', 'con', 'spd', 'exp'];

export const ATTR_LABELS = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  spd: 'Speed',
  exp: 'Experience',
};

// Per-faction attribute ranges [min, max] (inclusive). Romans are disciplined,
// dexterous veterans; barbarians are stronger, tougher and often faster but
// wilder and greener.
// Per-era, per-side attribute ranges [min, max] (inclusive).
export const PROFILES = {
  antiquity: {
    roman:     { str: [9, 13], dex: [10, 15], con: [9, 13],  spd: [9, 13],  exp: [5, 10] },
    barbarian: { str: [12, 18], dex: [7, 11], con: [12, 18], spd: [9, 16], exp: [2, 7] },
  },
  revolution: {
    // Continentals: motivated citizen-soldiers, steadying with the war.
    roman:     { str: [9, 14], dex: [9, 14], con: [9, 14], spd: [9, 14], exp: [3, 9] },
    // British regulars: drilled professionals, cool under fire.
    barbarian: { str: [10, 15], dex: [10, 15], con: [10, 15], spd: [8, 13], exp: [5, 11] },
  },
};

const NAMES = {
  antiquity: {
    roman: ['Marcus', 'Gaius', 'Lucius', 'Titus', 'Quintus', 'Aulus', 'Decimus',
            'Servius', 'Publius', 'Gnaeus', 'Flavius', 'Cassius'],
    barbarian: ['Ragnar', 'Wulfgar', 'Borin', 'Throk', 'Gorm', 'Hrothgar', 'Skarde',
                'Ivar', 'Bjorn', 'Ulf', 'Draggo', 'Kest'],
  },
  revolution: {
    roman: ['Nathaniel', 'Josiah', 'Ezra', 'Samuel', 'Caleb', 'Jedediah', 'Amos',
            'Silas', 'Enoch', 'Reuben', 'Asa', 'Elias'],
    barbarian: ['Percival', 'Reginald', 'Nigel', 'Cedric', 'Edmund', 'Rupert', 'Archibald',
                'Basil', 'Cuthbert', 'Horace', 'Wesley', 'Clive'],
  },
};

const RANKS = {
  antiquity: {
    roman: (exp) => (exp >= 9 ? 'Centurion' : exp >= 7 ? 'Veteran' : exp >= 5 ? 'Legionary' : 'Recruit'),
    barbarian: (exp) => (exp >= 6 ? 'Chieftain' : exp >= 4 ? 'Berserker' : 'Raider'),
  },
  revolution: {
    roman: (exp) => (exp >= 8 ? 'Colonel' : exp >= 6 ? 'Captain' : exp >= 4 ? 'Sergeant' : 'Private'),
    barbarian: (exp) => (exp >= 8 ? 'Colonel' : exp >= 6 ? 'Captain' : exp >= 4 ? 'Corporal' : 'Regular'),
  },
};

// Fastest possible Speed roll across every era/side — used to floor mount speed.
export const MAX_SPD_ATTR = Math.max(
  ...Object.values(PROFILES).flatMap((era) => Object.values(era).map((p) => p.spd[1]))
);

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const _era = (era) => (era && PROFILES[era] ? era : 'antiquity');
let _nameIdx = {};

export function rollAttributes(faction, era) {
  const p = PROFILES[_era(era)][faction];
  const a = {};
  for (const k of ATTRS) a[k] = randInt(p[k][0], p[k][1]);
  return a;
}

export function pickName(faction, era) {
  const list = NAMES[_era(era)][faction];
  const key = _era(era) + ':' + faction;
  if (_nameIdx[key] === undefined) _nameIdx[key] = Math.floor(Math.random() * list.length);
  const n = list[_nameIdx[key] % list.length];
  _nameIdx[key]++;
  return n;
}

export function rankFor(faction, exp, era) {
  return RANKS[_era(era)][faction](exp);
}

// Turn raw attributes into the numbers the combat sim actually uses.
export function deriveStats(a) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    maxHp: Math.round(36 + a.con * 4.5 + a.exp * 1.5),
    dmg: 4 + a.str * 1.15 + a.exp * 0.5,
    // Higher DEX / EXP → faster strikes (shorter time between blows).
    attackTime: clamp(1.55 - a.dex * 0.045 - a.exp * 0.02, 0.6, 1.55),
    // Movement speed in world units/sec (used at a run; walking scales down).
    speed: 1.7 + a.spd * 0.13,
    turn: 6 + a.dex * 0.3,
    // Chance-to-hit before the defender's dodge is subtracted.
    accuracy: clamp(0.55 + a.dex * 0.016 + a.exp * 0.02, 0.3, 0.98),
    dodge: clamp(a.dex * 0.006 + a.spd * 0.006 + a.exp * 0.008, 0, 0.5),
    crit: clamp(a.dex * 0.006 + a.exp * 0.013, 0, 0.6),
    // Chance to raise the shield and block an incoming blow (needs a shield).
    block: clamp(0.18 + a.dex * 0.011 + a.exp * 0.026 + a.con * 0.005, 0, 0.5),
    // Fraction of incoming damage shrugged off.
    toughness: clamp(a.con * 0.004 + a.exp * 0.006, 0, 0.5),
    // Footing: how well you keep your feet (resist being knocked flat) and how
    // quickly you scramble back up. Sturdy, strong, nimble veterans stay upright —
    // but a warhorse at the gallop still bowls most men over.
    balance: clamp(0.1 + a.con * 0.012 + a.str * 0.008 + a.spd * 0.01 + a.exp * 0.012, 0.05, 0.72),
    build: (a.str + a.con) / 2, // used for subtle per-soldier body scale
  };
}

// Resolve one blow from attacker → defender using both fighters' stats.
// Returns { hit, dmg, crit }.
export function resolveAttack(attacker, defender) {
  const A = attacker.stats;
  const D = defender.stats;
  const hitChance = Math.min(0.97, Math.max(0.35, A.accuracy - D.dodge));
  if (Math.random() > hitChance) return { hit: false, dmg: 0, crit: false };
  const crit = Math.random() < A.crit;
  let dmg = A.dmg * (crit ? 1.9 : 1) * (1 - D.toughness);
  dmg *= 0.9 + Math.random() * 0.2; // slight variance per swing
  return { hit: true, dmg, crit };
}
