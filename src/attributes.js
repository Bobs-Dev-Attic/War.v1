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
export const PROFILES = {
  roman:     { str: [9, 13], dex: [10, 15], con: [9, 13],  spd: [9, 13],  exp: [5, 10] },
  barbarian: { str: [12, 18], dex: [7, 11], con: [12, 18], spd: [9, 16], exp: [2, 7] },
};

const NAMES = {
  roman: ['Marcus', 'Gaius', 'Lucius', 'Titus', 'Quintus', 'Aulus', 'Decimus',
          'Servius', 'Publius', 'Gnaeus', 'Flavius', 'Cassius'],
  barbarian: ['Ragnar', 'Wulfgar', 'Borin', 'Throk', 'Gorm', 'Hrothgar', 'Skarde',
              'Ivar', 'Bjorn', 'Ulf', 'Draggo', 'Kest'],
};

const RANKS = {
  roman: (exp) => (exp >= 9 ? 'Centurion' : exp >= 7 ? 'Veteran' : exp >= 5 ? 'Legionary' : 'Recruit'),
  barbarian: (exp) => (exp >= 6 ? 'Chieftain' : exp >= 4 ? 'Berserker' : 'Raider'),
};

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

let _nameIdx = { roman: Math.floor(Math.random() * 12), barbarian: Math.floor(Math.random() * 12) };

export function rollAttributes(faction) {
  const p = PROFILES[faction];
  const a = {};
  for (const k of ATTRS) a[k] = randInt(p[k][0], p[k][1]);
  return a;
}

export function pickName(faction) {
  const list = NAMES[faction];
  const n = list[_nameIdx[faction] % list.length];
  _nameIdx[faction]++;
  return n;
}

export function rankFor(faction, exp) {
  return RANKS[faction](exp);
}

// Turn raw attributes into the numbers the combat sim actually uses.
export function deriveStats(a) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    maxHp: Math.round(40 + a.con * 5 + a.exp * 2),
    dmg: 3 + a.str * 1.05 + a.exp * 0.4,
    // Higher DEX / EXP → faster strikes (shorter time between blows).
    attackTime: clamp(1.55 - a.dex * 0.045 - a.exp * 0.02, 0.6, 1.55),
    // Movement speed in world units/sec (used at a run; walking scales down).
    speed: 1.7 + a.spd * 0.13,
    turn: 6 + a.dex * 0.3,
    // Chance-to-hit before the defender's dodge is subtracted.
    accuracy: clamp(0.55 + a.dex * 0.016 + a.exp * 0.02, 0.3, 0.98),
    dodge: clamp(a.dex * 0.006 + a.spd * 0.006 + a.exp * 0.008, 0, 0.5),
    crit: clamp(a.dex * 0.006 + a.exp * 0.013, 0, 0.6),
    // Fraction of incoming damage shrugged off.
    toughness: clamp(a.con * 0.004 + a.exp * 0.006, 0, 0.5),
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
