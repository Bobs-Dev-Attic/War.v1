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
    stat: { hp: 1.08, dmg: 1.06, speed: 1.5 }, combos: [['spearThrust'], ['spearThrust', 'spearThrust']],
    desc: 'Cavalry — swift lancers who ride down stragglers.',
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
    stat: { hp: 1.05, dmg: 1.08, speed: 1.55 }, combos: 'barbarian',
    desc: 'Horse raider — fast, hard-hitting riders of the horde.',
  },
};

export const ROMAN_TYPES = Object.keys(UNIT_TYPES).filter((k) => UNIT_TYPES[k].faction === 'roman');
export const BARBARIAN_TYPES = Object.keys(UNIT_TYPES).filter((k) => UNIT_TYPES[k].faction === 'barbarian');

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
