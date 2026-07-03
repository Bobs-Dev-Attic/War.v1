// Battlefield environments: a palette of settings, weather and times of day.
//
// Each preset drives the sky, fog, lighting (sun angle/colour = time of day),
// ground colours, weather particles, and which terrain features dress the
// surrounding landscape (trees, a stream + bridge, rolling hills, a ditch).
// The central combat arena always stays flat and clear so the fight reads
// cleanly; features populate the outer ring.

export const ENVIRONMENTS = {
  plains: {
    label: 'Green Plains', emoji: '🌾', time: 'Midday',
    sky: 0x9fc4e8, fog: { color: 0xb9d2e6, near: 55, far: 120 }, exposure: 1.05,
    hemi: { sky: 0xbcd3ff, ground: 0x4a5a2a, intensity: 0.7 },
    sun: { color: 0xfff2d6, intensity: 1.8, pos: [30, 52, 18] },
    fill: { color: 0x7a94c7, intensity: 0.32 },
    ground: 0x53663a, arena: 0x6b5638, grass: 0x5a7038,
    weather: 'clear',
    features: { trees: 26, treeStyle: 'broadleaf', tree: 0x3c5a26, stream: true, bridge: true, hills: true, ditch: false, rocks: 14 },
  },
  dawn: {
    label: 'Misty Dawn', emoji: '🌅', time: 'Dawn',
    sky: 0xd7c2a6, fog: { color: 0xccc0ac, near: 22, far: 78 }, exposure: 1.0,
    hemi: { sky: 0xe3d2b8, ground: 0x40492c, intensity: 0.6 },
    sun: { color: 0xffd9a0, intensity: 1.15, pos: [40, 16, 30] },
    fill: { color: 0x8a93a8, intensity: 0.3 },
    ground: 0x4c5836, arena: 0x64513a, grass: 0x556634,
    weather: 'fog',
    features: { trees: 22, treeStyle: 'broadleaf', tree: 0x36502a, stream: true, bridge: true, hills: true, ditch: false, rocks: 10 },
  },
  dusk: {
    label: 'Amber Dusk', emoji: '🌇', time: 'Dusk',
    sky: 0xe79a52, fog: { color: 0xc77a44, near: 45, far: 110 }, exposure: 1.08,
    hemi: { sky: 0xffb066, ground: 0x3a2a1a, intensity: 0.6 },
    sun: { color: 0xff9b4a, intensity: 1.9, pos: [-42, 14, -22] },
    fill: { color: 0x5a4a8a, intensity: 0.34 },
    ground: 0x5a4e30, arena: 0x6b5334, grass: 0x60582e,
    weather: 'clear',
    features: { trees: 24, treeStyle: 'broadleaf', tree: 0x4a4420, stream: true, bridge: true, hills: true, ditch: true, rocks: 12 },
  },
  night: {
    label: 'Moonlit Night', emoji: '🌙', time: 'Night',
    sky: 0x141d33, fog: { color: 0x16203a, near: 40, far: 100 }, exposure: 1.15,
    hemi: { sky: 0x5f74b0, ground: 0x181410, intensity: 0.5 },
    sun: { color: 0xbcccf2, intensity: 0.85, pos: [26, 46, -18] },
    fill: { color: 0x3a4a8a, intensity: 0.3 },
    ground: 0x2c3830, arena: 0x3a3128, grass: 0x2f3d30,
    weather: 'clear',
    features: { trees: 24, treeStyle: 'broadleaf', tree: 0x203020, stream: true, bridge: true, hills: true, ditch: false, rocks: 12 },
  },
  storm: {
    label: 'Stormy Fens', emoji: '🌧️', time: 'Overcast',
    sky: 0x545c66, fog: { color: 0x565e68, near: 28, far: 85 }, exposure: 0.95,
    hemi: { sky: 0x8a94a2, ground: 0x2a3026, intensity: 0.7 },
    sun: { color: 0xc4ccd6, intensity: 0.8, pos: [18, 44, 26] },
    fill: { color: 0x5a6472, intensity: 0.3 },
    ground: 0x3e4632, arena: 0x4a4030, grass: 0x445234,
    weather: 'rain',
    features: { trees: 20, treeStyle: 'broadleaf', tree: 0x2e4024, stream: true, bridge: true, hills: true, ditch: true, rocks: 10 },
  },
  snow: {
    label: 'Winter Frost', emoji: '❄️', time: 'Grey Winter',
    sky: 0xdfe6ee, fog: { color: 0xdde6ee, near: 35, far: 95 }, exposure: 1.0,
    hemi: { sky: 0xeef4ff, ground: 0x8a94a0, intensity: 0.85 },
    sun: { color: 0xeaf0ff, intensity: 1.2, pos: [24, 40, 30] },
    fill: { color: 0x9aa8c4, intensity: 0.34 },
    ground: 0xd5dde6, arena: 0xc2c8cf, grass: 0xdde4ec,
    weather: 'snow',
    features: { trees: 24, treeStyle: 'pine', tree: 0x2e4432, stream: true, bridge: true, hills: true, ditch: false, rocks: 12, snowy: true },
  },
  desert: {
    label: 'Desert Noon', emoji: '🏜️', time: 'Harsh Noon',
    sky: 0xd9c48f, fog: { color: 0xd8c48f, near: 50, far: 120 }, exposure: 1.12,
    hemi: { sky: 0xf0e2b0, ground: 0x7a5f38, intensity: 0.85 },
    sun: { color: 0xfff0c0, intensity: 2.0, pos: [10, 60, 6] },
    fill: { color: 0xb09a6a, intensity: 0.3 },
    ground: 0xc2a367, arena: 0xb59356, grass: 0xbfa066,
    weather: 'clear',
    features: { trees: 6, treeStyle: 'palm', tree: 0x5c6a2a, stream: false, bridge: false, hills: true, ditch: true, rocks: 20 },
  },
  autumn: {
    label: 'Autumn Woods', emoji: '🍂', time: 'Afternoon',
    sky: 0xbcc4c0, fog: { color: 0xb6bcb2, near: 42, far: 105 }, exposure: 1.05,
    hemi: { sky: 0xd8d0c0, ground: 0x4a3a24, intensity: 0.7 },
    sun: { color: 0xffdca0, intensity: 1.55, pos: [-30, 40, 20] },
    fill: { color: 0x7a7488, intensity: 0.32 },
    ground: 0x5a4d30, arena: 0x66502f, grass: 0x6a5a2e,
    weather: 'clear',
    features: { trees: 34, treeStyle: 'broadleaf', tree: 0xb5642a, stream: true, bridge: true, hills: true, ditch: false, rocks: 12 },
  },
};

export const ENV_KEYS = Object.keys(ENVIRONMENTS);
export const DEFAULT_ENV = 'plains';
