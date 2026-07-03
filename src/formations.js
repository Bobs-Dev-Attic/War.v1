// Formation layouts. Each returns an array of { x, depth } slots for `n`
// soldiers, front-first (index 0 is the front rank, nearest the enemy).
//   x      = lateral offset (centred on 0)
//   depth  = distance back from the front line (>= 0), grows away from the foe
// The game maps these to world positions: worldX = x, worldZ = line ± depth.
//
// Depth is bounded (MAX_ROWS) so no formation spills past the battlefield edge
// where a soldier would be counted as routed the instant they spawn.

export const FORMATIONS = {
  line:     { label: 'Line',     desc: 'Broad, shallow ranks — a wide front.' },
  phalanx:  { label: 'Phalanx',  desc: 'Dense, wide and several ranks deep.' },
  column:   { label: 'Column',   desc: 'Narrow and deep — a marching column.' },
  wedge:    { label: 'Wedge',    desc: 'A charging point aimed at the foe.' },
  square:   { label: 'Square',   desc: 'A compact block, faced all around.' },
  echelon:  { label: 'Echelon',  desc: 'Ranks stepped back on a diagonal.' },
  skirmish: { label: 'Skirmish', desc: 'Loose and scattered — hard to pin.' },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATION = 'line';

// Where each side musters: the front-line depth (z) and lateral offset (x) of
// the formation anchor, plus the chosen shape. Rows extend back from the front
// line toward the side's own edge. Romans hold the south (+z), the horde north.
export const DEFAULT_PLACEMENT = {
  roman: { formation: DEFAULT_FORMATION, x: 0, z: 9 },
  barbarian: { formation: DEFAULT_FORMATION, x: 0, z: -9 },
};

// Valid range for a side's anchor so armies stay in the field and on their own
// half (a small no-man's-land is kept at the centre).
export const PLACEMENT_BOUNDS = {
  roman: { xMin: -18, xMax: 18, zMin: 3, zMax: 16 },
  barbarian: { xMin: -18, xMax: 18, zMin: -16, zMax: -3 },
};

export function defaultPlacement() {
  return {
    roman: { ...DEFAULT_PLACEMENT.roman },
    barbarian: { ...DEFAULT_PLACEMENT.barbarian },
  };
}

// Split `total` units across `groups` as evenly as possible (front groups get
// the remainder), e.g. distributeCounts(7, 3) => [3, 2, 2].
export function distributeCounts(total, groups) {
  const g = Math.max(1, Math.min(groups, total));
  const base = Math.floor(total / g), rem = total % g;
  return Array.from({ length: g }, (_, i) => base + (i < rem ? 1 : 0));
}

const MAX_ROWS = 8;   // keep the deepest formation inside the field

// Deterministic tiny jitter so skirmish lines look loose but reproducible-ish.
const jitter = (i, seed) => (Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453 % 1);

// Lay `n` slots into a centred grid `cols` wide, front-to-back, row-major.
function grid(n, cols, spacing, rowGap) {
  const slots = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const rowCount = Math.min(cols, n - row * cols);
    slots.push({ x: (col - (rowCount - 1) / 2) * spacing, depth: row * rowGap });
  }
  return slots;
}

export function formationOffsets(name, n, spacing = 2.2, rowGap = 1.9) {
  if (n <= 0) return [];
  switch (name) {
    case 'column': {
      // As narrow as possible while staying within the depth budget.
      const cols = Math.max(2, Math.ceil(n / MAX_ROWS));
      return grid(n, cols, spacing, rowGap);
    }
    case 'phalanx': {
      // Wide and dense: tight ranks, several deep.
      const cols = Math.max(6, Math.ceil(n / MAX_ROWS));
      return grid(n, cols, spacing * 0.82, rowGap * 0.85);
    }
    case 'square': {
      const cols = Math.max(2, Math.round(Math.sqrt(n)));
      return grid(n, cols, spacing * 0.92, rowGap);
    }
    case 'echelon': {
      // A line, but each file is stepped progressively back on a diagonal.
      const cols = Math.max(3, Math.min(MAX_ROWS + 2, Math.ceil(Math.sqrt(n) * 1.7)));
      const base = grid(n, cols, spacing, rowGap);
      return base.map((s, i) => ({ x: s.x, depth: s.depth + (i % cols) * rowGap * 0.55 }));
    }
    case 'skirmish': {
      // Loose open order with scatter — spread wide, no tidy ranks.
      const cols = Math.max(4, Math.ceil(Math.sqrt(n) * 1.9));
      const base = grid(n, cols, spacing * 1.5, rowGap * 1.5);
      return base.map((s, i) => ({
        x: s.x + jitter(i, 1) * spacing * 0.9,
        depth: Math.max(0, s.depth + jitter(i, 2) * rowGap * 0.9),
      }));
    }
    case 'wedge': {
      // A triangle with its point at the front (nearest the enemy): ranks
      // 1, 2, 3 … wide. Once it reaches full width, remaining ranks are full.
      const slots = [];
      let placed = 0, row = 0, width = 1;
      const maxWidth = Math.max(3, Math.min(14, Math.ceil(Math.sqrt(n) * 1.8)));
      while (placed < n && row < MAX_ROWS - 1) {
        const w = Math.min(width, n - placed);
        for (let c = 0; c < w; c++) slots.push({ x: (c - (w - 1) / 2) * spacing, depth: row * rowGap });
        placed += w; row++; width = Math.min(maxWidth, width + 1);
      }
      // Any overflow fills flat back ranks at full width.
      while (placed < n) {
        const w = Math.min(maxWidth, n - placed);
        for (let c = 0; c < w; c++) slots.push({ x: (c - (w - 1) / 2) * spacing, depth: row * rowGap });
        placed += w; row++;
      }
      return slots.slice(0, n);
    }
    case 'line':
    default: {
      const cols = Math.max(3, Math.max(Math.min(8, Math.ceil(Math.sqrt(n) * 1.7)), Math.ceil(n / MAX_ROWS)));
      return grid(n, cols, spacing, rowGap);
    }
  }
}
