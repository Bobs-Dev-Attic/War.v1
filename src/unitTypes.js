// Unit-type hierarchy for both factions.
//
// Each type layers onto its faction's base humanoid config (weapon, shield,
// colours), sets a combat role and reach, applies stat modifiers on top of the
// individually-rolled attributes, and picks a combo/move repertoire. Ranged
// types (archers, javelineers) get a `ranged` profile and kite + shoot.
//
//   role   'melee' | 'pike' | 'ranged'
//   reach  melee strike distance
//   stat   post-derive tweaks: hp/dmg/speed = multipliers; toughness/block/
//          crit/dodge/accuracy = additive; elite = flag
//   ranged { min, max, cooldown, projectile, dmgMul, meleeFallback }
//   combos array of move-name arrays, or 'roman'/'barbarian' for faction default

export const UNIT_TYPES = {
  // ---------------- Rome ----------------
  legionary: {
    faction: 'roman', label: 'Legionary', role: 'melee', reach: 1.7, points: 1,
    cfg: { weapon: 'gladius', shield: 'scutum' }, stat: {}, combos: 'roman',
    desc: 'Balanced swordsman behind a tower shield.',
  },
  hastatus: {
    faction: 'roman', label: 'Hastatus', role: 'melee', reach: 2.5, points: 1,
    cfg: { weapon: 'spear', shield: 'scutum', crest: 0xcf5a2a },
    stat: { dmg: 0.92 }, combos: [['spearThrust'], ['spearThrust', 'spearThrust']],
    desc: 'Spear & shield — outreaches the swords.',
  },
  triarius: {
    faction: 'roman', label: 'Triarius', role: 'pike', reach: 3.3, points: 2, hold: true,
    cfg: { weapon: 'pike', shield: 'parma', crest: 0x3a6acf, armor: 0xd0d5db },
    stat: { hp: 1.18, toughness: 0.07, speed: 0.85, dmg: 1.05 }, combos: [['pikeThrust']],
    desc: 'Veteran pikeman — a braced wall of points.',
  },
  sagittarius: {
    faction: 'roman', label: 'Sagittarius', role: 'ranged', reach: 1.5, points: 1,
    cfg: { weapon: 'bow', shield: null, helmet: 'romanLight', torso: 0x8a6a3a, torsoMetal: 0.1, pauldrons: false, skirt: 0x6a4a28 },
    stat: { hp: 0.78 },
    ranged: { min: 4.2, max: 16, cooldown: 1.8, projectile: 'arrow', dmgMul: 1.0 },
    combos: [['thrust']],
    desc: 'Auxiliary archer — deadly afar, frail up close.',
  },
  veles: {
    faction: 'roman', label: 'Veles', role: 'ranged', reach: 1.7, points: 1,
    cfg: { weapon: 'javelin', shield: 'parma', helmet: 'romanLight', pauldrons: false },
    stat: { hp: 0.85, speed: 1.1 },
    ranged: { min: 3, max: 9, cooldown: 1.4, projectile: 'javelin', dmgMul: 1.15, meleeFallback: true },
    combos: [['thrust'], ['thrust', 'slash']],
    desc: 'Skirmisher — hurls javelins, then draws a blade.',
  },
  praetorian: {
    faction: 'roman', label: 'Praetorian', role: 'melee', reach: 1.75, points: 2,
    cfg: { weapon: 'gladius', shield: 'scutum', crest: 0xd9b45a, armor: 0xdadfe6, torso: 0xc2c6cc },
    stat: { hp: 1.16, dmg: 1.1, block: 0.05, elite: true }, combos: 'roman',
    desc: 'Elite guard — the finest of the legions.',
  },
  eques: {
    faction: 'roman', label: 'Eques', role: 'melee', reach: 2.6, points: 3,
    cfg: { weapon: 'spear', shield: 'parma', helmet: 'romanLight', crest: 0x3a6acf, mounted: true, horse: 0x7a4a28, saddleCloth: 0x8a2a2a },
    stat: { hp: 1.08, dmg: 1.06, speed: 1.8 }, combos: [['spearThrust'], ['spearThrust', 'spearThrust']],
    desc: 'Cavalry — swift lancers who ride down stragglers.',
  },
  cataphract: {
    faction: 'roman', label: 'Cataphract', role: 'melee', reach: 2.0, points: 3,
    cfg: { weapon: 'gladius', shield: 'scutum', helmet: 'roman', armor: 0xd0d5db, crest: 0x3a6acf, mounted: true, horse: 0x6a4a2a, saddleCloth: 0x3a5aa0 },
    stat: { hp: 1.15, dmg: 1.05, toughness: 0.04, speed: 1.7 }, combos: 'roman',
    desc: 'Mailed horseman — sword and shield wielded from the saddle.',
  },
  equesSagittarius: {
    faction: 'roman', label: 'Eques Sagittarius', role: 'ranged', reach: 1.6, points: 3,
    cfg: { weapon: 'bow', shield: null, helmet: 'romanLight', torso: 0x8a6a3a, torsoMetal: 0.1, pauldrons: false, skirt: 0x6a4a28, mounted: true, horse: 0x8a6a3a, saddleCloth: 0x8a2a2a },
    stat: { hp: 0.95, speed: 1.7 },
    ranged: { min: 4.5, max: 18, cooldown: 1.9, projectile: 'arrow', dmgMul: 1.0 },
    combos: [['thrust']],
    desc: 'Horse archer — looses arrows on the move, then wheels away.',
  },
  onager: {
    faction: 'roman', label: 'Onager', role: 'siege', reach: 1.6, points: 5,
    cfg: { siege: 'onager', weapon: 'catapult', shield: null, frame: 0x6a4726, helmet: 'roman', armor: 0xb8b8c0, torso: 0x8a6a3a },
    stat: { hp: 1.5, toughness: 0.1, speed: 0, dmg: 1.2 },
    ranged: { min: 9, max: 30, cooldown: 4.5, projectile: 'boulder', dmgMul: 2.4, aoe: 3.2 },
    combos: [['thrust']],
    desc: 'Catapult — lobs a boulder that bursts, smashing whole knots of foes.',
  },
  ballista: {
    faction: 'roman', label: 'Ballista', role: 'siege', reach: 1.6, points: 4,
    cfg: { siege: 'ballista', weapon: 'ballista', shield: null, frame: 0x6a4726, helmet: 'roman', armor: 0xb8b8c0, torso: 0x8a6a3a },
    stat: { hp: 1.3, toughness: 0.08, speed: 0, dmg: 1.15 },
    ranged: { min: 6, max: 34, cooldown: 2.6, projectile: 'bolt', dmgMul: 2.2, aoe: 0 },
    combos: [['thrust']],
    desc: 'Bolt-thrower — a giant flat-shooting dart that skewers and punches through shields.',
  },

  // ---------------- Horde ----------------
  warrior: {
    faction: 'barbarian', label: 'Warrior', role: 'melee', reach: 1.8, points: 1,
    cfg: { weapon: 'axe', shield: 'round' }, stat: {}, combos: 'barbarian',
    desc: 'Axe & round shield — the horde’s backbone.',
  },
  berserker: {
    faction: 'barbarian', label: 'Berserker', role: 'melee', reach: 1.9, points: 2,
    cfg: { weapon: 'greataxe', shield: null, hair: 0x8a3a1e, torso: 0x9a4a2a },
    stat: { dmg: 1.28, speed: 1.15, hp: 0.95, toughness: -0.05 },
    combos: [['overhead', 'spin'], ['slash', 'overhead'], ['spin', 'overhead', 'slash']],
    desc: 'No shield, pure fury — huge damage, thin defence.',
  },
  marauder: {
    faction: 'barbarian', label: 'Marauder', role: 'melee', reach: 1.8, points: 2,
    cfg: { weapon: 'maul', shield: null }, stat: { hp: 1.22, dmg: 1.18, speed: 0.85 },
    combos: [['overhead'], ['slash', 'overhead'], ['overhead', 'overhead']],
    desc: 'Great maul — slow, bone-breaking smashes.',
  },
  raider: {
    faction: 'barbarian', label: 'Raider', role: 'melee', reach: 2.4, points: 1,
    cfg: { weapon: 'spear', shield: 'round' }, stat: { dmg: 0.92, speed: 1.05 },
    combos: [['spearThrust'], ['spearThrust', 'spearThrust']],
    desc: 'Spear & shield — reach and quick feet.',
  },
  hunter: {
    faction: 'barbarian', label: 'Hunter', role: 'ranged', reach: 1.6, points: 1,
    cfg: { weapon: 'bow', shield: null, torso: 0x6a4a2a }, stat: { hp: 0.8, speed: 1.1 },
    ranged: { min: 3.8, max: 13, cooldown: 1.7, projectile: 'arrow', dmgMul: 0.95 },
    combos: [['thrust']],
    desc: 'Tribal archer — harries from the treeline.',
  },
  chieftain: {
    faction: 'barbarian', label: 'Chieftain', role: 'melee', reach: 1.95, points: 3,
    cfg: { weapon: 'greataxe', shield: null, hair: 0x2a1a0e, torso: 0x6a2a2a, horns: true },
    stat: { hp: 1.32, dmg: 1.22, toughness: 0.06, speed: 1.05, elite: true },
    combos: [['overhead', 'spin'], ['slash', 'slash', 'overhead'], ['spin', 'overhead']],
    desc: 'War-leader — a towering, brutal champion.',
  },
  outrider: {
    faction: 'barbarian', label: 'Outrider', role: 'melee', reach: 1.95, points: 3,
    cfg: { weapon: 'axe', shield: 'round', mounted: true, horse: 0x33261a, saddleCloth: 0x5a3a1e, hair: 0x6a3a1e },
    stat: { hp: 1.05, dmg: 1.08, speed: 1.85 }, combos: 'barbarian',
    desc: 'Horse raider — fast, hard-hitting riders of the horde.',
  },
  reaver: {
    faction: 'barbarian', label: 'Reaver', role: 'melee', reach: 1.95, points: 3,
    cfg: { weapon: 'gladius', shield: 'round', mounted: true, horse: 0x2a2016, saddleCloth: 0x5a3a1e, hair: 0x8a3a1e },
    stat: { hp: 1.08, dmg: 1.06, speed: 1.8 }, combos: 'barbarian',
    desc: 'Mounted swordsman — hacks foes down with sword and shield from horseback.',
  },
  steppeArcher: {
    faction: 'barbarian', label: 'Steppe Archer', role: 'ranged', reach: 1.6, points: 3,
    cfg: { weapon: 'bow', shield: null, torso: 0x6a4a2a, mounted: true, horse: 0x4a3320, saddleCloth: 0x5a3a1e, hair: 0x6a3a1e },
    stat: { hp: 0.9, speed: 1.85 },
    ranged: { min: 4, max: 16, cooldown: 1.7, projectile: 'arrow', dmgMul: 0.95 },
    combos: [['thrust']],
    desc: 'Horse archer — harries the enemy with arrows at the gallop.',
  },
  stonethrower: {
    faction: 'barbarian', label: 'Stone Thrower', role: 'siege', reach: 1.6, points: 5,
    cfg: { siege: 'stonethrower', weapon: 'catapult', shield: null, frame: 0x4a3018, torso: 0x6a4a2a, skin: 0xba7a4a },
    stat: { hp: 1.5, toughness: 0.1, speed: 0, dmg: 1.22 },
    ranged: { min: 9, max: 28, cooldown: 5.0, projectile: 'boulder', dmgMul: 2.4, aoe: 3.2 },
    combos: [['thrust']],
    desc: 'Crude war-sling — heaves a great rock that scatters and crushes ranks.',
  },
};

export const ROMAN_TYPES = Object.keys(UNIT_TYPES).filter((k) => UNIT_TYPES[k].faction === 'roman');
export const BARBARIAN_TYPES = Object.keys(UNIT_TYPES).filter((k) => UNIT_TYPES[k].faction === 'barbarian');

// Broad battlefield categories, for grouping the ever-growing type roster in the
// setup UI. Order defines how the groups are listed.
export const UNIT_CATEGORIES = [
  { key: 'infantry', label: '⚔️ Infantry' },
  { key: 'missile', label: '🏹 Missile' },
  { key: 'cavalry', label: '🐎 Cavalry' },
  { key: 'siege', label: '🎯 Siege' },
];

// Which category a unit type belongs to (mounted → cavalry, on foot by role).
export function unitCategory(typeKey) {
  const t = UNIT_TYPES[typeKey];
  if (!t) return 'infantry';
  if (t.role === 'siege') return 'siege';
  if (t.cfg && t.cfg.mounted) return 'cavalry';
  if (t.role === 'ranged') return 'missile';
  return 'infantry';
}

// Group a list of type keys into ordered { label, keys[] } buckets, skipping empties.
export function categorizeTypes(keys) {
  const buckets = {};
  for (const k of keys) (buckets[unitCategory(k)] ||= []).push(k);
  return UNIT_CATEGORIES
    .filter((c) => buckets[c.key] && buckets[c.key].length)
    .map((c) => ({ label: c.label, keys: buckets[c.key] }));
}

// Default army compositions (used on first load and as the setup defaults).
export const DEFAULT_ARMY = {
  roman: { legionary: 2, hastatus: 1, sagittarius: 1 },
  barbarian: { warrior: 2, berserker: 1, raider: 1 },
};

// Expand a composition {typeKey: count} into a flat, shuffled-ish list of keys.
export function composeArmy(comp) {
  const list = [];
  for (const key in comp) {
    for (let i = 0; i < comp[key]; i++) list.push(key);
  }
  return list;
}

export function armyCount(comp) {
  return Object.values(comp).reduce((a, n) => a + n, 0);
}
