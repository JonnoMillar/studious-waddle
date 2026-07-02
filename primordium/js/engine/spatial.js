// Uniform spatial hash grid over a toroidal (wrapping) world. Neighbour
// queries are the hot path — every creature runs several radius queries per
// tick — so the grid stores plain arrays per cell and is rebuilt in place
// each tick rather than incrementally maintained.

export class SpatialGrid {
  /**
   * @param {number} width world width
   * @param {number} height world height
   * @param {number} cellSize should be >= the largest common query radius
   */
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.cellW = width / this.cols;
    this.cellH = height / this.rows;
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear() {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
  }

  /** Items must expose .x and .y in world coordinates. */
  insert(item) {
    const cx = Math.floor(item.x / this.cellW) % this.cols;
    const cy = Math.floor(item.y / this.cellH) % this.rows;
    this.cells[((cy + this.rows) % this.rows) * this.cols + ((cx + this.cols) % this.cols)].push(item);
  }

  /**
   * Visit every item within `radius` of (x, y), honouring toroidal wrap.
   * The callback receives (item, dx, dy, distSq) where dx/dy is the shortest
   * wrapped vector from the query point to the item. Return true from the
   * callback to stop early.
   */
  query(x, y, radius, cb) {
    const { width: W, height: H } = this;
    const r2 = radius * radius;
    const minCx = Math.floor((x - radius) / this.cellW);
    const maxCx = Math.floor((x + radius) / this.cellW);
    const minCy = Math.floor((y - radius) / this.cellH);
    const maxCy = Math.floor((y + radius) / this.cellH);
    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = ((cy % this.rows) + this.rows) % this.rows;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const col = ((cx % this.cols) + this.cols) % this.cols;
        const cell = this.cells[row * this.cols + col];
        for (let i = 0; i < cell.length; i++) {
          const item = cell[i];
          let dx = item.x - x;
          let dy = item.y - y;
          // shortest wrapped displacement
          if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
          if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            if (cb(item, dx, dy, d2)) return;
          }
        }
      }
    }
  }
}

/** Shortest toroidal displacement from (x1,y1) to (x2,y2). */
export function torusDelta(x1, y1, x2, y2, W, H) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
  if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
  return [dx, dy];
}

/** Wrap a coordinate into [0, limit). */
export function wrap(v, limit) {
  v %= limit;
  return v < 0 ? v + limit : v;
}
