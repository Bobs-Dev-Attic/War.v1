// Historical eras. Each era maps two rosters onto the game's two internal side
// slots — 'roman' is always SIDE A (the player) and 'barbarian' SIDE B (the
// enemy) — so the whole faction-keyed engine (health-bar colours, selection,
// win logic) works unchanged while the units, look, names and labels change.

export const ERAS = {
  antiquity: {
    key: 'antiquity', label: 'Antiquity', emoji: '🏛️',
    blurb: 'Rome vs the Barbarian Horde',
    sides: {
      roman: { label: 'Rome', short: 'ROMA', emoji: '🦅', unit: 'legionaries' },
      barbarian: { label: 'The Horde', short: 'HORDE', emoji: '🪓', unit: 'warriors' },
    },
    defaultArmy: {
      roman: { legionary: 2, hastatus: 1, sagittarius: 1 },
      barbarian: { warrior: 2, berserker: 1, raider: 1 },
    },
    win: {
      a: 'The horde is broken. Rome stands triumphant!',
      bSurrender: 'The legion has laid down its arms. The field is lost.',
      b: 'The legion is overrun. The eagles have fallen.',
    },
  },
  revolution: {
    key: 'revolution', label: 'American Revolution', emoji: '🎆',
    blurb: 'Continental Army vs British Redcoats · 1775–1783',
    sides: {
      roman: { label: 'Continental Army', short: 'LIBERTY', emoji: '⭐', unit: 'Continentals' },
      barbarian: { label: 'The Crown', short: 'CROWN', emoji: '👑', unit: 'redcoats' },
    },
    defaultArmy: {
      roman: { continental: 3, rifleman: 1, contCannon: 1 },
      barbarian: { redcoat: 3, grenadier: 1, royalCannon: 1 },
    },
    win: {
      a: 'The line breaks and the Crown withdraws — liberty carries the field!',
      bSurrender: 'The Continentals ground their arms. The cause is lost this day.',
      b: 'The Continental line is shattered. The King holds the field.',
    },
  },
};

export const ERA_KEYS = Object.keys(ERAS);
export const DEFAULT_ERA = 'antiquity';
