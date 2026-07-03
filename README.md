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
Use the **top menu → New Battle** to choose a **battlefield**, muster custom armies
(pick how many of each unit type per side) and set each side's **formation**, or
**Rematch** to refight the same armies. When a battle ends you can **close the
banner and watch the victors celebrate**, or start a new one.

### Battlefields

Pick where and when you fight. Each battlefield sets its own **sky, light and
time of day, weather** and surrounding **terrain**:

| Field | Setting | Weather |
| --- | --- | --- |
| 🌾 Green Plains | Midday | Clear |
| 🌅 Misty Dawn | Dawn | Fog |
| 🌇 Amber Dusk | Dusk, long shadows | Clear |
| 🌙 Moonlit Night | Night | Clear |
| 🌧️ Stormy Fens | Overcast | Rain |
| ❄️ Winter Frost | Grey winter | Snow |
| 🏜️ Desert Noon | Harsh noon | Clear |
| 🍂 Autumn Woods | Afternoon | Clear |

The surrounding landscape is dressed with **trees** (broadleaf, snow-capped pine
or palm to suit the setting), **rolling hills**, a **stream** with a timber
**plank bridge**, boulders, and **ditches/earthworks** — while the central arena
stays flat and clear for the fight. Rain and snow fall in real time; the stream
ripples; the moon lights the night.

### Formations

Deploy each side in one of seven **formations** — **Line**, **Phalanx**,
**Column**, **Wedge** (a charging point aimed at the foe), **Square**, **Echelon**
(ranks stepped on a diagonal) or **Skirmish** (loose open order). The melee front
always forms up nearest the enemy with ranged troops to the rear, and deep
formations pack in tighter so they never spill off the field.

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
attackers trade blows.

**Stand Ground** is a genuine defensive posture: Romans hold the line, brace
behind raised shields (better block & dodge), and periodically **shove** pressing
foes back with the shield boss to reopen space. Every outcome surfaces as floating text
(**damage / CRIT / block / dodge / miss**). In a pure all-out charge the two
factions are balanced ~50/50 — the player tips it with tactics.

Fighting **wears soldiers down**: charging and swinging drain stamina, so the
winded slow their pace and take longer between flurries — they recover their
wind while idle or braced on guard. **Wounds slow you too** — a soldier bleeding
near death moves at roughly half their healthy speed. And a fighter who **routs
to the very edge** of the battlefield has fled for good and is counted among the
dead.

Body **colliders** keep any two units from occupying the same space; fallen
bodies are walked over.

### Gore

Combat is bloody. Blows **splatter blood** that arcs and stains the ground, and
strong or killing hits can **hack off limbs** — arms, legs, even heads. Severed
parts fly off as tumbling gibs, the wound gushes and leaves a **bleeding stump**,
and **blood pools spread** on the dirt. Losing a leg drops a soldier to
**crawl** forward in agony; losing the weapon arm **disarms** them (they break
and flee); a decapitation is instantly fatal. The dead **drop their weapons and
shields** where they fall.

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
src/world.js        renderer, isometric camera, lights, terrain, environments, weather
src/environments.js battlefield presets — sky, time of day, weather, terrain features
src/formations.js   deployment formations (line, wedge, phalanx, square, …)
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
