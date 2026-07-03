import './styles.css';
import { version } from '../package.json';
import { World } from './world.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const canvas = document.getElementById('scene');
const world = new World(canvas);
const ui = new UI();
const game = new Game(world, ui);
const input = new Input(world, game);

ui.bindCommands((cmd) => game.command(cmd));
ui.wire(game);
ui.updateSelectionInfo(game);

// ---- Title screen: show the version, open straight to Prepare for Battle ----
const landing = document.getElementById('landing');
document.getElementById('landing-version').textContent = 'v' + version;
document.body.classList.add('title');            // hide the battle HUD behind the title
document.getElementById('landing-start').addEventListener('click', () => {
  landing.classList.add('hidden');
  document.body.classList.remove('title');
  ui.openSetup();
});
// Backing out of the very first setup (no battle mustered yet) returns to the title.
document.getElementById('setup-cancel').addEventListener('click', () => {
  if (game.units.length === 0) { landing.classList.remove('hidden'); document.body.classList.add('title'); }
});

// Slow idle rotation of the camera until the player takes the reins.
let autoRotate = true;
canvas.addEventListener('pointerdown', () => { autoRotate = false; }, { once: true });
window.addEventListener('keydown', () => { autoRotate = false; }, { once: true });

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  world.resize();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
onResize();

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (autoRotate) {
    world.yaw += dt * 0.12;
    world.updateCamera();
  }

  game.update(dt);
  world.updateEnvironment(dt);
  world.render();
  requestAnimationFrame(loop);
}

// Reveal once the first frame is ready.
requestAnimationFrame((t) => {
  last = t;
  world.render();
  setTimeout(() => ui.hideLoading(), 300);
  requestAnimationFrame(loop);
});
