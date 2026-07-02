// Canvas renderer. Draws the world onto a single 2D canvas: plants as soft
// dots, creatures as heading-oriented bodies coloured by their genome hue,
// with size/diet reflected in shape. Because the world is toroidal, anything
// near an edge is drawn again on the opposite side so wrap looks seamless.
// Rendering is decoupled from simulation: it just reads current world state.

export class Renderer {
  constructor(canvas, world, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.camera = camera;
    this.selected = null;     // selected creature (persistent inspect target)
    this.showSenses = false;  // draw sense radius + target links for selection
    this.showTrails = false;
    this.colorMode = 'species'; // 'species' | 'diet' | 'energy'
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
  }

  setWorld(world) {
    this.world = world;
    this.selected = null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.camera.resize(rect.width, rect.height);
    this.cssW = rect.width;
    this.cssH = rect.height;
  }

  /** Screen-space pick: nearest creature within a few px of (sx, sy). */
  pick(sx, sy) {
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    let best = null, bestD = Infinity;
    const W = this.world.config.width, H = this.world.config.height;
    for (const cr of this.world.creatures) {
      let dx = cr.x - wx, dy = cr.y - wy;
      if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
      if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
      const d = dx * dx + dy * dy;
      const hit = (cr.radius + 6 / this.camera.zoom) ** 2;
      if (d < hit && d < bestD) { bestD = d; best = cr; }
    }
    return best;
  }

  draw() {
    const ctx = this.ctx;
    const cam = this.camera;
    const W = this.world.config.width, H = this.world.config.height;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Background.
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.translate(this.cssW / 2, this.cssH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // World bounds glow + subtle grid.
    this._drawWorldFrame(ctx, W, H);

    // Compute the set of wrap offsets we might need (only when near edges).
    const margin = 160;
    const offsets = [[0, 0]];
    const [vx0, vy0] = cam.screenToWorld(0, 0);
    const [vx1, vy1] = cam.screenToWorld(this.cssW, this.cssH);
    if (vx0 < margin) offsets.push([W, 0]);
    if (vx1 > W - margin) offsets.push([-W, 0]);
    if (vy0 < margin) offsets.push([0, H]);
    if (vy1 > H - margin) offsets.push([0, -H]);

    for (const [ox, oy] of offsets) {
      ctx.save();
      ctx.translate(ox, oy);
      this._drawPlants(ctx);
      this._drawCreatures(ctx);
      ctx.restore();
    }

    if (this.selected && this.selected.alive) this._drawSelection(ctx);

    ctx.restore();
  }

  _drawWorldFrame(ctx, W, H) {
    ctx.strokeStyle = 'rgba(90,120,180,0.25)';
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.strokeRect(0, 0, W, H);
  }

  _drawPlants(ctx) {
    const zoom = this.camera.zoom;
    // When creatures are coloured by diet, herbivores are green too — so draw
    // plants as a cooler, dimmer teal to keep the two readable apart. In the
    // other colour modes a warmer leaf-green reads best.
    const diet = this.colorMode === 'diet';
    ctx.fillStyle = diet
      ? (zoom > 0.5 ? 'rgba(52,150,150,0.7)' : 'rgba(52,150,150,0.5)')
      : (zoom > 0.5 ? 'rgba(80,200,120,0.85)' : 'rgba(80,200,120,0.6)');
    const r = diet ? 1.7 : 2.2;
    ctx.beginPath();
    for (const p of this.world.plants) {
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  _bodyColor(cr) {
    if (this.colorMode === 'diet') {
      // green (herbivore) → red (carnivore)
      const h = (1 - cr.diet) * 120;
      return `hsl(${h}, 75%, 55%)`;
    }
    if (this.colorMode === 'energy') {
      const f = cr.fullness;
      return `hsl(${f * 140}, 80%, ${30 + f * 30}%)`;
    }
    // species: use the species founder hue, with light/dark by diet
    const sp = this.world.speciesTracker.get(cr.speciesId);
    const hue = sp ? sp.hue : cr.hue;
    const light = 45 + (1 - cr.diet) * 15;
    return `hsl(${hue}, 70%, ${light}%)`;
  }

  _drawCreatures(ctx) {
    const zoom = this.camera.zoom;
    const detailed = zoom > 0.7;
    const now = this.world.tick;
    for (const cr of this.world.creatures) {
      const color = this._bodyColor(cr);
      ctx.save();
      ctx.translate(cr.x, cr.y);
      ctx.rotate(cr.heading);

      // Recent-bite flash ring.
      if (now - cr.lastBite < 8) {
        ctx.beginPath();
        ctx.arc(0, 0, cr.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,80,80,0.8)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      }

      ctx.fillStyle = color;
      if (detailed) {
        // Teardrop body pointing along heading; carnivores get a sharper snout.
        const r = cr.radius;
        const snout = r * (1 + cr.diet * 0.7);
        ctx.beginPath();
        ctx.moveTo(snout, 0);
        ctx.quadraticCurveTo(0, r, -r * 0.8, r * 0.5);
        ctx.quadraticCurveTo(-r, 0, -r * 0.8, -r * 0.5);
        ctx.quadraticCurveTo(0, -r, snout, 0);
        ctx.fill();
        // Direction eye.
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(r * 0.4, 0, Math.max(0.8, r * 0.18), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, cr.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawSelection(ctx) {
    const cr = this.selected;
    const zoom = this.camera.zoom;
    ctx.save();

    // Selection ring.
    ctx.beginPath();
    ctx.arc(cr.x, cr.y, cr.radius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();

    if (this.showSenses) {
      // Sense radius.
      ctx.beginPath();
      ctx.arc(cr.x, cr.y, cr.senseRange, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,209,102,0.25)';
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw links to sensed plant / prey / threat from the brain inputs.
      const inp = cr.brain.input;
      const cosH = Math.cos(cr.heading), sinH = Math.sin(cr.heading);
      const link = (lx, ly, near, col) => {
        if (near <= 0) return;
        const dist = (1 - near) * cr.senseRange;
        // local → world
        const wx = cr.x + (lx * cosH - ly * sinH) * dist;
        const wy = cr.y + (lx * sinH + ly * cosH) * dist;
        ctx.beginPath();
        ctx.moveTo(cr.x, cr.y);
        ctx.lineTo(wx, wy);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      };
      link(inp[0], inp[1], inp[2], 'rgba(80,220,120,0.9)');   // plant
      link(inp[3], inp[4], inp[5], 'rgba(120,160,255,0.9)');  // prey
      link(inp[6], inp[7], inp[8], 'rgba(255,90,90,0.9)');    // threat
    }
    ctx.restore();
  }
}
