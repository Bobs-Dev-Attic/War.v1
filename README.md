# War.v1 ⚔️

A 3D **real-time strategy RPG** rendered with [Three.js](https://threejs.org/) in a
**rotatable isometric view**, built for landscape orientation and deployable to
[Vercel](https://vercel.com/).

You command a Roman legion against a charging barbarian horde on an open
battlefield. Units fight with articulated, procedurally‑animated movements —
marching, weapon swings, staggers, deaths and surrenders — while holding real
weapons and shields.

## Gameplay

You control the **Roman soldiers** (silver lorica, red‑crested helmets, gladius +
scutum). The **barbarians** (fur, horned helms, axes + round shields) charge
automatically.

### Command menu

| Command | Key | Effect |
| --- | --- | --- |
| ⚔️ **Attack** | `Q` | Advance and engage the nearest enemy. |
| 🛡️ **Stand Ground** | `W` | Hold position; only strike foes that come in range. |
| 🏃 **Retreat** | `E` | Fall back to the legion's edge of the field. |
| 🏳️ **Surrender** | `R` | Lay down arms — units kneel, drop weapons and yield. |

Commands apply to your current selection, or to the whole legion if nothing is
selected.

### Controls

- **Drag** — rotate the isometric camera around the battlefield
- **Scroll / pinch** — zoom
- **Click** a legionary — select (Shift to add) · **Shift+drag** — box‑select a squad
- **Right‑click** ground — order the squad to move · **Right‑click** an enemy — focus fire
- **Ctrl/⌘+A** select all · **Esc** clear selection · **Arrow keys** rotate/zoom

On touch devices: one‑finger drag rotates, two‑finger pinch zooms, tap selects or
orders.

## Combat model

Each unit is a full articulated humanoid (`src/humanoid.js`) with hip/knee,
shoulder/elbow and torso joints. The `Unit` class (`src/unit.js`) runs a state
machine — *idle → move → attack → hit → death/surrender* — driving those joints
procedurally. Blows land at the apex of a swing, deal randomized damage, trigger
stagger recoil and hit sparks, and topple units on death. Romans and barbarians
have distinct stats (health, damage, reach, speed) and attack animations
(gladius thrust vs. overhead axe chop).

## Tech

- **Three.js** — orthographic isometric camera rig, soft shadows, ACES tone
  mapping, procedural undulating terrain.
- **Vite** — dev server and production bundling.
- Pure primitives — no external model/texture assets, so it loads instantly.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview  # serve the production build
```

## Deploy to Vercel

The repo is Vercel‑ready (`vercel.json` sets the Vite framework preset).

- **Dashboard:** import the repo — Vercel auto‑detects Vite (build `npm run build`,
  output `dist`).
- **CLI:** `npm i -g vercel && vercel` (or `vercel --prod`).

## Project layout

```
index.html          HUD, command menu, orientation guard
src/main.js         bootstrap + render loop
src/world.js        renderer, isometric camera, lights, terrain, scenery
src/humanoid.js     articulated Roman / barbarian model builder
src/unit.js         combat state machine + procedural animation
src/game.js         armies, AI, commands, selection, effects, win/lose
src/input.js        camera rotate/zoom, selection, orders (mouse + touch)
src/ui.js           HUD / command / outcome DOM controller
src/styles.css      HUD styling
```
