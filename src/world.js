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

    // Subtle grid to aid RTS spatial reading.
    const grid = new THREE.GridHelper(100, 50, 0x2a3320, 0x24301c);
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    grid.position.y = 0.03;
    this.scene.add(grid);

    // Scatter a few rocks and banners for scenery.
    this._scatterScenery();
  }

  _scatterScenery() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5b5b57, roughness: 1 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + i;
      const r = 20 + (i % 5) * 3;
      const s = 0.4 + (i % 4) * 0.35;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r);
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }
    // A pair of Roman standards flanking the legion's side.
    for (const sx of [-6, 6]) {
      this.scene.add(this._banner(sx, 14, 0xd43a3a));
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
