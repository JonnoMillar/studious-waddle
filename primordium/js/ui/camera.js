// Camera for the world canvas: pan, zoom-to-cursor, and follow-a-creature.
// Works in world coordinates; the renderer asks it to transform the context.
// The world wraps, so "follow" keeps the target centred rather than clamping.

export class Camera {
  constructor(viewW, viewH, worldW, worldH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.worldW = worldW;
    this.worldH = worldH;
    this.x = worldW / 2; // world point at screen centre
    this.y = worldH / 2;
    this.zoom = Math.min(viewW / worldW, viewH / worldH);
    this.minZoom = this.zoom * 0.8;
    this.maxZoom = 6;
    this.follow = null; // creature to track, or null
  }

  resize(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.minZoom = Math.min(viewW / this.worldW, viewH / this.worldH) * 0.8;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
  }

  worldToScreen(wx, wy) {
    return [
      (wx - this.x) * this.zoom + this.viewW / 2,
      (wy - this.y) * this.zoom + this.viewH / 2,
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.viewW / 2) / this.zoom + this.x,
      (sy - this.viewH / 2) / this.zoom + this.y,
    ];
  }

  panBy(dxScreen, dyScreen) {
    this.follow = null;
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    // Keep the world point under the cursor fixed.
    const [nsx, nsy] = this.worldToScreen(wx, wy);
    this.x += (nsx - sx) / this.zoom;
    this.y += (nsy - sy) / this.zoom;
  }

  update() {
    if (this.follow && this.follow.alive) {
      // Smoothly chase, accounting for toroidal wrap (take shortest path).
      let dx = this.follow.x - this.x;
      let dy = this.follow.y - this.y;
      if (dx > this.worldW / 2) dx -= this.worldW; else if (dx < -this.worldW / 2) dx += this.worldW;
      if (dy > this.worldH / 2) dy -= this.worldH; else if (dy < -this.worldH / 2) dy += this.worldH;
      this.x = (this.x + dx * 0.15 + this.worldW) % this.worldW;
      this.y = (this.y + dy * 0.15 + this.worldH) % this.worldH;
      if (this.zoom < 1.6) this.zoom += (1.6 - this.zoom) * 0.05;
    } else if (this.follow && !this.follow.alive) {
      this.follow = null;
    }
  }
}
