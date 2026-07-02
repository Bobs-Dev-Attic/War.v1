import * as THREE from 'three';

// Handles all player input: rotating/zooming the isometric camera, selecting
// legionaries (click or marquee) and issuing move/attack orders.
export class Input {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.canvas = world.canvas;

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    this.dragging = false;
    this.mode = null;           // 'rotate' | 'marquee'
    this.down = null;           // {x,y,t,button}
    this.moved = false;

    this.marquee = document.createElement('div');
    this.marquee.id = 'marquee';
    document.getElementById('app').appendChild(this.marquee);

    // Touch state
    this.touches = new Map();
    this.pinchDist = 0;

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this._onKey(e));
    c.addEventListener('pointermove', (e) => this._hover(e));
  }

  _setNDC(x, y) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.x = ((x - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((y - r.top) / r.height) * 2 + 1;
  }

  _pickUnit(x, y) {
    this._setNDC(x, y);
    this.ray.setFromCamera(this.ndc, this.world.camera);
    const hits = this.ray.intersectObjects(this.game.group.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.unit) return o.userData.unit;
        o = o.parent;
      }
    }
    return null;
  }

  _pickGround(x, y) {
    this._setNDC(x, y);
    this.ray.setFromCamera(this.ndc, this.world.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }

  // ---- Pointer ----------------------------------------------------------
  _onDown(e) {
    if (e.pointerType === 'touch') { this._touchDown(e); return; }
    this.canvas.setPointerCapture?.(e.pointerId);
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
    this.moved = false;
    this.dragging = true;
    if (e.button === 0) {
      this.mode = e.shiftKey ? 'marquee' : 'rotate';
    } else {
      this.mode = 'command';
    }
  }

  _onMove(e) {
    if (!this.dragging || e.pointerType === 'touch') return;
    const dx = e.clientX - this.down.x;
    const dy = e.clientY - this.down.y;
    if (!this.moved && Math.hypot(dx, dy) > 5) this.moved = true;

    if (this.mode === 'rotate' && this.moved) {
      this.world.yaw -= dx * 0.008;
      this.world.pitch = THREE.MathUtils.clamp(this.world.pitch - dy * 0.004, 0.25, 1.15);
      this.world.updateCamera();
      this.down.x = e.clientX;
      this.down.y = e.clientY;
    } else if (this.mode === 'marquee' && this.moved) {
      this._drawMarquee(this.down.x, this.down.y, e.clientX, e.clientY);
    }
  }

  _onUp(e) {
    if (e.pointerType === 'touch') { this._touchUp(e); return; }
    if (!this.dragging) return;
    this.dragging = false;

    if (this.mode === 'marquee' && this.moved) {
      const r = this.canvas.getBoundingClientRect();
      const minX = Math.min(this.down.x, e.clientX) - r.left;
      const maxX = Math.max(this.down.x, e.clientX) - r.left;
      const minY = Math.min(this.down.y, e.clientY) - r.top;
      const maxY = Math.max(this.down.y, e.clientY) - r.top;
      this.game.selectInBox(minX, minY, maxX, maxY, this.world.camera, this.canvas);
      this.marquee.style.display = 'none';
    } else if (!this.moved) {
      this._click(e.clientX, e.clientY, e.button, e.shiftKey);
    }
    this.mode = null;
  }

  _click(x, y, button, shift) {
    if (this.game.over) return;
    const unit = this._pickUnit(x, y);
    if (button === 0) {
      // Left click: selection.
      if (unit && unit.faction === 'roman') this.game.select(unit, shift);
      else if (!unit) this.game.clearSelection();
    } else if (button === 2) {
      // Right click: order.
      if (unit && unit.faction === 'barbarian') this.game.focusFire(unit);
      else {
        const p = this._pickGround(x, y);
        if (p) this.game.moveCommand(p);
      }
    }
  }

  _drawMarquee(x0, y0, x1, y1) {
    const s = this.marquee.style;
    s.display = 'block';
    s.left = Math.min(x0, x1) + 'px';
    s.top = Math.min(y0, y1) + 'px';
    s.width = Math.abs(x1 - x0) + 'px';
    s.height = Math.abs(y1 - y0) + 'px';
  }

  _hover(e) {
    if (this.dragging || e.pointerType === 'touch') return;
    const unit = this._hovered;
    const u = this._pickUnit(e.clientX, e.clientY);
    if (unit && unit !== u) unit.setHovered(false);
    if (u && u.faction === 'barbarian') { u.setHovered(true); this._hovered = u; this.game.hoveredEnemy = u; this.canvas.style.cursor = 'crosshair'; }
    else { this._hovered = null; this.game.hoveredEnemy = null; this.canvas.style.cursor = u ? 'pointer' : 'default'; }
  }

  _onWheel(e) {
    e.preventDefault();
    this.world.zoom = THREE.MathUtils.clamp(this.world.zoom + e.deltaY * 0.02, 8, 46);
    this.world.updateCamera();
  }

  _onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'q') this.game.command('attack');
    else if (k === 'w') this.game.command('stand');
    else if (k === 'e') this.game.command('retreat');
    else if (k === 'r') this.game.command('surrender');
    else if (k === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.game.selectAll(); }
    else if (k === 'escape') this.game.clearSelection();
    else if (k === 'arrowleft') { this.world.yaw += 0.12; this.world.updateCamera(); }
    else if (k === 'arrowright') { this.world.yaw -= 0.12; this.world.updateCamera(); }
    else if (k === 'arrowup') { this.world.zoom = THREE.MathUtils.clamp(this.world.zoom - 1.5, 8, 46); this.world.updateCamera(); }
    else if (k === 'arrowdown') { this.world.zoom = THREE.MathUtils.clamp(this.world.zoom + 1.5, 8, 46); this.world.updateCamera(); }
  }

  // ---- Touch ------------------------------------------------------------
  _touchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    window.addEventListener('pointermove', this._touchMoveBound = (ev) => this._touchMove(ev));
  }

  _touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const pdx = e.clientX - t.x;
    const pdy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;

    if (this.touches.size === 1) {
      this.world.yaw -= pdx * 0.008;
      this.world.pitch = THREE.MathUtils.clamp(this.world.pitch - pdy * 0.004, 0.25, 1.15);
      this.world.updateCamera();
    } else if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.world.zoom = THREE.MathUtils.clamp(this.world.zoom - (d - this.pinchDist) * 0.05, 8, 46);
      this.pinchDist = d;
      this.world.updateCamera();
    }
  }

  _touchUp(e) {
    const t = this.touches.get(e.pointerId);
    if (t) {
      const moved = Math.hypot(e.clientX - t.x0, e.clientY - t.y0);
      const dur = performance.now() - t.t;
      if (this.touches.size === 1 && moved < 10 && dur < 300) {
        // Tap: select a Roman, or order to move.
        const unit = this._pickUnit(e.clientX, e.clientY);
        if (unit && unit.faction === 'roman') this.game.select(unit);
        else if (unit && unit.faction === 'barbarian') this.game.focusFire(unit);
        else {
          const p = this._pickGround(e.clientX, e.clientY);
          if (p && this.game.selected.size) this.game.moveCommand(p);
          else this.game.clearSelection();
        }
      }
    }
    this.touches.delete(e.pointerId);
    if (this.touches.size === 0 && this._touchMoveBound) {
      window.removeEventListener('pointermove', this._touchMoveBound);
      this._touchMoveBound = null;
    }
  }
}
