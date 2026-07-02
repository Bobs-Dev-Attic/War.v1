# War.v1 ⚔️

A 3D **real-time strategy RPG** rendered with [Three.js](https://threejs.org/) in a
**rotatable isometric view**, built for landscape orientation and deployable to
[Vercel](https://vercel.com/).

You command a Roman legion against a charging barbarian horde on an open
battlefield. Units are articulated humanoids that fight with dynamic,
procedurally-animated moves — thrusts, chops, spins, shield bashes, blocks and
dodges — while holding real weapons and shields.

## Gameplay

You control the **Roman soldiers**; the **barbarian horde** charges automatically.
Use the **top menu → New Battle** to muster custom armies (pick how many of each
unit type per side), or **Rematch** to refight the same armies. When a battle ends
you can **close the banner and watch the victors celebrate**, or start a new one.

### Unit types

Each side is a hierarchy of specialists with their own weapons, reach, stats and
attack patterns (`src/unitTypes.js`):

**Rome** — Legionary (gladius + scutum), Hastatus (spear), Triarius (long pike,
braced wall), Sagittarius (bow, kites & volleys), Veles (javelin skirmisher),
Praetorian (elite guard).

**The Horde** — Warrior (axe + shield), Berserker (greataxe, no shield, huge
damage), Marauder (great maul, staggering smashes), Raider (spear + shield),
Hunter (bow), Chieftain (towering elite champion).

Archers and javelineers fire **projectiles**, keep their distance and fall back
when a foe closes; pikes and spears out-reach swords; shields catch arrows.

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

- **Drag** — rotate the isometric camera · **Scroll / pinch** — zoom
- **Click** a legionary — select (Shift to add) · **Shift+drag** — box-select a squad
- **Right-click** ground — move the squad · **Right-click** an enemy — focus fire
- **Ctrl/⌘+A** select all · **Esc** clear · **Arrow keys** rotate/zoom
- Touch: one-finger drag rotates, two-finger pinch zooms, tap selects/orders.

## Attributes

Every soldier is rolled as an **individual** from their faction's profile
(`src/attributes.js`) across five attributes — **Strength, Dexterity,
Constitution, Speed, Experience** — and their combat statistics are *derived*
from them:

| Attribute | Drives |
| --- | --- |
| Strength | damage per blow |
| Dexterity | attack cadence, accuracy, dodge, block, crit |
| Constitution | max health, toughness (damage reduction) |
| Speed | movement speed, dodge |
| Experience | a bonus to nearly everything; also rank & name |

Romans are disciplined, dexterous veterans; barbarians are stronger and tougher.
Select a legionary (or hover an enemy) to open their **dossier** — attributes plus
derived stats. Each soldier even differs in build (the burly stand a touch
taller). Roman health bars read **green**, the enemy horde's read **red**.

## Dynamic melee — moves, combos & reactions

Fighting is driven by a **move library** (`src/moves.js`). Each move is a
data-defined pose over normalized time with an impact window and metadata
(reach, damage multiplier, heavy/spin/aoe/stagger), articulating the humanoid's
hips, knees, shoulders and elbows.

- **Attacks:** `thrust`, `slash`, `overhead` (heavy chop), `shieldBash`
  (staggers, punches through blocks) and `spin` (a spinning **AoE** hitting every
  foe in reach).
- **Reactions:** `block` (raise the shield), `dodgeL`/`dodgeR` (sidestep hop) and
  a `flinch` recoil.

Attacks are strung into **combos** — curated sequences *and* randomly assembled
ones ("mix & match") — so no two exchanges look alike. When a blow lands the
**defender reacts** from their attributes: a nimble fighter may **dodge** (fully
evade, hop aside), a shield-bearer may **block** (chip damage only), and
telegraphed heavy attacks are easier to read. Bashes knock foes back; committed
attackers trade blows. Every outcome surfaces as floating text
(**damage / CRIT / block / dodge / miss**). In a pure all-out charge the two
factions are balanced ~50/50 — the player tips it with tactics.

Body **colliders** keep any two units from occupying the same space; fallen
bodies are walked over.

## Tech

- **Three.js** — orthographic isometric camera rig, soft shadows, ACES tone
  mapping, procedural undulating terrain. No external model/texture assets, so it
  loads instantly.
- **Vite** — dev server and production bundling.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview  # serve the production build
```

## Deploy to Vercel

The repo is Vercel-ready (`vercel.json` sets the Vite framework preset).

- **Dashboard:** import the repo — Vercel auto-detects Vite (build `npm run build`,
  output `dist`).
- **CLI:** `npm i -g vercel && vercel` (or `vercel --prod`).

## Project layout

```
index.html          HUD, command menu, dossier, orientation guard
src/main.js         bootstrap + render loop
src/world.js        renderer, isometric camera, lights, terrain, scenery
src/humanoid.js     articulated model builder + all weapons/shields
src/unitTypes.js    Roman & barbarian type hierarchy, army composition
src/attributes.js   per-soldier attribute rolls + derived combat stats
src/moves.js        move library (poses, impact windows) + combo assembler
src/unit.js         combat state machine, ranged/melee AI, reactions, animation
src/game.js         armies, projectiles, commands, colliders, effects, win/celebrate
src/input.js        camera rotate/zoom, selection, orders (mouse + touch)
src/ui.js           HUD, dossier, New Battle setup, outcome DOM controller
src/styles.css      HUD & setup styling
```
