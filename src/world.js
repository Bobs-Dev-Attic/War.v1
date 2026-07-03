import * as THREE from 'three';

// The battlefield world: renderer, isometric camera rig, lighting and terrain.
export class World {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1420);
    this.scene.fog = new THREE.Fog(0x0d1420, 45, 95);

    // Isometric-style camera: orthographic for that clean RTS look.
    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 400);

    // Camera rig — a yaw pivot the player can rotate around the field.
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.yaw = Math.PI * 0.25;       // rotation around the battlefield
    this.pitch = 0.62;               // fixed isometric tilt
    this.zoom = 24;                  // orthographic half-extent
    this.target = new THREE.Vector3(0, 0, 0);

    this._buildLights();
    this._buildTerrain();

    this.resize();
    this.updateCamera();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xbcd3ff, 0x3a2f22, 0.65);
    this.scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
    sun.position.set(30, 48, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 42;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;

    // Cool rim fill from the opposite side for depth.
    const fill = new THREE.DirectionalLight(0x6a86c7, 0.35);
    fill.position.set(-24, 20, -22);
    this.scene.add(fill);
    this.fill = fill;
  }

  _buildTerrain() {
    const size = 100;
    // Gently undulating ground for a battlefield feel.
    const geo = new THREE.PlaneGeometry(size, size, 80, 80);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h =
        Math.sin(x * 0.12) * Math.cos(z * 0.1) * 0.5 +
        Math.sin(x * 0.05 + z * 0.07) * 0.7;
      // Flatten the central arena so units stand level.
      const d = Math.sqrt(x * x + z * z);
      const flat = THREE.MathUtils.clamp((d - 12) / 20, 0, 1);
      pos.setY(i, h * flat);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a5a34,
      roughness: 1,
      metalness: 0,
      flatShading: false,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    this.ground = ground;

    // Battle arena disc — a trampled dirt ring where the clash happens.
    const arenaGeo = new THREE.CircleGeometry(15, 64);
    arenaGeo.rotateX(-Math.PI / 2);
    const arenaMat = new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 1 });
    const arena = new THREE.Mesh(arenaGeo, arenaMat);
    arena.position.y = 0.02;
    arena.receiveShadow = true;
    this.scene.add(arena);
    this.arena = arena;

    // Subtle grid to aid RTS spatial reading.
    const grid = new THREE.GridHelper(100, 50, 0x2a3320, 0x24301c);
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    grid.position.y = 0.03;
    this.scene.add(grid);
    this.grid = grid;

    // Groups the environment system fills and clears between battles.
    this.envGroup = new THREE.Group();     // terrain features + scenery
    this.weatherGroup = new THREE.Group(); // rain / snow particles
    this.scene.add(this.envGroup);
    this.scene.add(this.weatherGroup);
    this._weather = null;
  }

  // ---- Environments (settings / weather / time of day) -------------------
  applyEnvironment(env) {
    if (!env) return;
    this.environment = env;
    this.scene.background = new THREE.Color(env.sky);
    this.scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
    this.renderer.toneMappingExposure = env.exposure ?? 1.05;

    this.hemi.color.setHex(env.hemi.sky);
    this.hemi.groundColor.setHex(env.hemi.ground);
    this.hemi.intensity = env.hemi.intensity;
    this.sun.color.setHex(env.sun.color);
    this.sun.intensity = env.sun.intensity;
    this.sun.position.set(env.sun.pos[0], env.sun.pos[1], env.sun.pos[2]);
    this.fill.color.setHex(env.fill.color);
    this.fill.intensity = env.fill.intensity;

    this.ground.material.color.setHex(env.ground);
    this.arena.material.color.setHex(env.arena);
    const dark = env.time === 'Night';
    this.grid.material.opacity = dark ? 0.12 : 0.2;

    this._buildFeatures(env);
    this._buildWeather(env.weather);
  }

  _clearGroup(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      group.remove(c);
      c.traverse?.((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    }
  }

  _buildFeatures(env) {
    this._clearGroup(this.envGroup);
    const f = env.features || {};
    // Deterministic-ish scatter, seeded off the environment name so each
    // battlefield keeps a consistent look through rematches.
    let seed = 0; for (const ch of env.label) seed += ch.charCodeAt(0);
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    if (f.hills) this._buildHills(env, rnd);
    if (f.ditch) this._buildDitch(env);
    if (f.stream) this._buildStream(env);
    if (f.bridge && f.stream) this._buildBridge(env);
    if (f.rocks) this._buildRocks(env, f.rocks, rnd);
    if (f.trees) this._buildTrees(env, f.trees, f.treeStyle, rnd);

    // Roman standards always flank the legion's line.
    for (const sx of [-6.5, 6.5]) this.envGroup.add(this._banner(sx, 14.5, 0xd43a3a));
  }

  _buildHills(env, rnd) {
    // Low rolling mounds around the outer ring, sunk so only their crowns show.
    const mat = new THREE.MeshStandardMaterial({ color: env.ground, roughness: 1 });
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.7;
      const r = 26 + rnd() * 12;
      const rad = 6 + rnd() * 7;
      const geo = new THREE.SphereGeometry(rad, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const hill = new THREE.Mesh(geo, mat);
      hill.scale.y = 0.28 + rnd() * 0.22;
      hill.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
      hill.castShadow = true; hill.receiveShadow = true;
      this.envGroup.add(hill);
    }
  }

  _buildDitch(env) {
    // A defensive earthwork on one flank: a sunken trench with a raised rampart.
    const g = new THREE.Group();
    const trench = new THREE.Mesh(
      new THREE.BoxGeometry(34, 2, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x2a2016, roughness: 1 })
    );
    trench.position.set(0, -1.35, 20);
    trench.receiveShadow = true;
    g.add(trench);
    const rampart = new THREE.Mesh(
      new THREE.BoxGeometry(34, 1.5, 2.2),
      new THREE.MeshStandardMaterial({ color: env.ground, roughness: 1 })
    );
    rampart.position.set(0, 0.4, 22);
    rampart.castShadow = true; rampart.receiveShadow = true;
    g.add(rampart);
    g.rotation.y = 0.15;
    this.envGroup.add(g);
  }

  _buildStream(env) {
    // A stream skirting the field on one flank (kept clear of the arena).
    const mat = new THREE.MeshStandardMaterial({
      color: env.time === 'Night' ? 0x25405a : 0x3f7fa6,
      roughness: 0.25, metalness: 0.35, transparent: true, opacity: 0.9,
    });
    const geo = new THREE.RingGeometry(19, 23, 48, 1, Math.PI * 0.15, Math.PI * 0.9);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -0.35;
    water.receiveShadow = true;
    water.name = 'water';
    this._water = water;
    // Muddy banks framing the water.
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x4a3a24, roughness: 1 });
    for (const [ri, ro] of [[18.2, 19], [23, 23.9]]) {
      const bg = new THREE.RingGeometry(ri, ro, 48, 1, Math.PI * 0.15, Math.PI * 0.9);
      bg.rotateX(-Math.PI / 2);
      const bank = new THREE.Mesh(bg, bankMat);
      bank.position.y = -0.12; bank.receiveShadow = true;
      this.envGroup.add(bank);
    }
    this.envGroup.add(water);
  }

  _buildBridge(env) {
    // A timber plank bridge crossing the stream where a path meets it.
    const g = new THREE.Group();
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 0.85 });
    const woodLight = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.8 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 6), woodLight);
    deck.position.y = 0.1; deck.castShadow = true; deck.receiveShadow = true;
    g.add(deck);
    for (let i = -2; i <= 2; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.9), woodDark);
      plank.position.set(0, 0.2, i * 1.1);
      g.add(plank);
    }
    for (const sx of [-1.5, 1.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 6), woodDark);
      rail.position.set(sx, 0.4, 0); g.add(rail);
      for (let i = -2; i <= 2; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), woodDark);
        post.position.set(sx, 0.3, i * 1.4); g.add(post);
      }
    }
    // Sit it on the stream arc (matching the ring's mid-radius).
    const a = Math.PI * 0.15 + Math.PI * 0.45;
    g.position.set(Math.cos(a) * 21, 0, Math.sin(a) * 21);
    g.rotation.y = -a;
    this.envGroup.add(g);
  }

  _buildRocks(env, count, rnd) {
    const rockMat = new THREE.MeshStandardMaterial({
      color: env.features.snowy ? 0x9aa4ac : 0x5b5b57, roughness: 1,
    });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 2;
      const r = 19 + rnd() * 16;
      const s = 0.4 + rnd() * 1.1;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(Math.cos(a) * r, s * 0.35, Math.sin(a) * r);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.castShadow = true; rock.receiveShadow = true;
      this.envGroup.add(rock);
    }
  }

  _buildTrees(env, count, style, rnd) {
    for (let i = 0; i < count; i++) {
      // Ring the arena, clustering toward the corners; never inside the fight.
      const a = rnd() * Math.PI * 2;
      const r = 20 + rnd() * 22;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x, z) < 18) continue;
      this.envGroup.add(this._tree(x, z, style, env, rnd));
    }
  }

  _tree(x, z, style, env, rnd) {
    const g = new THREE.Group();
    const scale = 0.8 + rnd() * 0.9;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f26, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: env.features.tree, roughness: 1 });
    if (style === 'pine') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.4, 6), trunkMat);
      trunk.position.y = 0.7; g.add(trunk);
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5 - k * 0.35, 1.6, 8), leafMat);
        cone.position.y = 1.4 + k * 1.0; cone.castShadow = true; g.add(cone);
      }
      if (env.features.snowy) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0xeef2f8, roughness: 1 }));
        cap.position.y = 3.7; g.add(cap);
      }
    } else if (style === 'palm') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 3.4, 6), trunkMat);
      trunk.position.y = 1.7; trunk.rotation.z = (rnd() - 0.5) * 0.3; g.add(trunk);
      for (let k = 0; k < 6; k++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 4), leafMat);
        frond.position.y = 3.4; frond.rotation.z = Math.PI / 2.6;
        frond.rotation.y = (k / 6) * Math.PI * 2; frond.castShadow = true; g.add(frond);
      }
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.8, 6), trunkMat);
      trunk.position.y = 0.9; g.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), leafMat);
      crown.position.y = 2.6; crown.scale.y = 0.9; crown.castShadow = true; g.add(crown);
      const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), leafMat);
      crown2.position.set((rnd() - 0.5) * 1.2, 3.1, (rnd() - 0.5) * 1.2); crown2.castShadow = true; g.add(crown2);
      if (env.features.snowy) crown.material = new THREE.MeshStandardMaterial({ color: 0xdfe8f0, roughness: 1 });
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    g.rotation.y = rnd() * Math.PI * 2;
    return g;
  }

  _buildWeather(type) {
    this._clearGroup(this.weatherGroup);
    this._weather = null;
    if (type !== 'rain' && type !== 'snow') return;
    const isRain = type === 'rain';
    const n = isRain ? 1800 : 900;
    const range = 70, high = 40;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * range;
      pos[i * 3 + 1] = Math.random() * high;
      pos[i * 3 + 2] = (Math.random() - 0.5) * range;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: isRain ? 0x9fb4c8 : 0xffffff,
      size: isRain ? 0.14 : 0.22,
      transparent: true, opacity: isRain ? 0.5 : 0.85,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.weatherGroup.add(pts);
    this._weather = { type, pts, n, range, high, speed: isRain ? 46 : 6 };
  }

  // Animate weather + drift the stream surface. Called each frame.
  updateEnvironment(dt) {
    const w = this._weather;
    if (w) {
      const arr = w.pts.geometry.attributes.position.array;
      const drop = w.speed * dt;
      for (let i = 0; i < w.n; i++) {
        const yi = i * 3 + 1;
        arr[yi] -= drop;
        if (w.type === 'snow') {
          arr[i * 3] += Math.sin((arr[yi] + i) * 0.6) * dt * 0.6;   // gentle sway
        }
        if (arr[yi] < 0) {
          arr[yi] = w.high;
          arr[i * 3] = (Math.random() - 0.5) * w.range;
          arr[i * 3 + 2] = (Math.random() - 0.5) * w.range;
        }
      }
      w.pts.geometry.attributes.position.needsUpdate = true;
    }
    if (this._water) {
      this._t = (this._t || 0) + dt;
      this._water.position.y = -0.35 + Math.sin(this._t * 1.5) * 0.02;
    }
  }

  _banner(x, z, color) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a6b3a, roughness: 0.7 })
    );
    pole.position.y = 2;
    pole.castShadow = true;
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide })
    );
    flag.position.set(0.6, 3.4, 0);
    g.add(flag);
    const eagle = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.6, roughness: 0.3 })
    );
    eagle.position.y = 4.1;
    g.add(eagle);
    g.position.set(x, 0, z);
    return g;
  }

  // Convert rig orientation into an orthographic camera position.
  updateCamera() {
    const dist = 60;
    const cp = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).multiplyScalar(dist);
    this.camera.position.copy(this.target).add(cp);
    this.camera.lookAt(this.target);

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const z = this.zoom;
    this.camera.left = -z * aspect;
    this.camera.right = z * aspect;
    this.camera.top = z;
    this.camera.bottom = -z;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.updateCamera();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
