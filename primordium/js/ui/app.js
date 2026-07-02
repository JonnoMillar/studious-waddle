// Application controller. Owns the World, the render loop, the fixed-timestep
// simulation loop (decoupled from frame rate via a speed multiplier), all UI
// panels, and user interaction. Everything below is glue; the interesting
// systems live under js/engine and the other js/ui modules.

import { World, DEFAULT_CONFIG } from '../engine/world.js';
import { traitName, T, TRAIT_COUNT } from '../engine/genome.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { BrainInspector } from './inspector.js';
import { LineChart, StackedAreaChart, PALETTE } from './charts.js';

const SPEEDS = [0, 1, 2, 4, 8, 16, 32, 64];
const TRAIT_SERIES = [T.SIZE, T.SPEED, T.SENSE, T.DIET, T.METABOLISM, T.AGGRESSION];

export class App {
  constructor(root) {
    this.root = root;
    this.speedIndex = 2; // 2x by default
    this.accum = 0;
    this.lastFrame = performance.now();
    this.tps = 0;        // measured ticks/sec
    this._tickWindow = [];
    this.paused = false;

    this.seed = this._seedFromUrl() || 'primordium';
    this.world = new World(this.seed);

    this._buildDom();
    this.camera = new Camera(1, 1, this.world.config.width, this.world.config.height);
    this.renderer = new Renderer(this.canvas, this.world, this.camera);
    this.inspector = new BrainInspector(this.brainCanvas);
    this._buildCharts();
    this._wireControls();
    this._wireCanvas();

    window.addEventListener('resize', () => this._resizeAll());
    this._resizeAll();
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---- DOM construction ------------------------------------------------

  _buildDom() {
    this.root.innerHTML = TEMPLATE;
    this.canvas = this.root.querySelector('#world-canvas');
    this.brainCanvas = this.root.querySelector('#brain-canvas');
    this.$ = (sel) => this.root.querySelector(sel);
  }

  _buildCharts() {
    this.popChart = new LineChart(this.$('#chart-pop'));
    this.speciesChart = new StackedAreaChart(this.$('#chart-species'));
    this.flowChart = new LineChart(this.$('#chart-flow'));
    this.traitChart = new LineChart(this.$('#chart-traits'));
    // Trait legend.
    const legend = this.$('#trait-legend');
    legend.innerHTML = TRAIT_SERIES.map(
      (t, i) => `<span class="lg"><i style="background:${PALETTE[i]}"></i>${traitName(t)}</span>`,
    ).join('');
  }

  // ---- main loop -------------------------------------------------------

  _frame(now) {
    const dtMs = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;

    const speed = SPEEDS[this.speedIndex];
    if (!this.paused && speed > 0) {
      // Fixed simulation step; run up to `speed` ticks per 16.7ms of real time,
      // capped so a slow frame can't spiral into a huge catch-up burst.
      this.accum += (dtMs / 16.6667) * speed;
      let budget = Math.min(this.accum, speed * 2 + 4);
      let ran = 0;
      const t0 = performance.now();
      while (budget >= 1) {
        this.world.step();
        budget -= 1;
        this.accum -= 1;
        ran++;
        // Guard: never spend more than ~12ms/frame on simulation so the UI
        // stays responsive even at 64× with a big population.
        if (performance.now() - t0 > 12) { this.accum = 0; break; }
      }
      if (ran) this._recordTps(ran, performance.now() - t0);
    } else {
      this.accum = 0;
    }

    this.camera.update();
    this.renderer.draw();
    this.inspector.setCreature(this.renderer.selected);
    this.inspector.draw();
    this._updateHud();

    // Charts & panels don't need 60fps; refresh a few times a second.
    if (now - (this._lastPanel || 0) > 350) {
      this._lastPanel = now;
      this._updateCharts();
      this._updateSpeciesList();
      this._updateInspectorStats();
    }

    requestAnimationFrame((t) => this._frame(t));
  }

  _recordTps(ran, ms) {
    this._tickWindow.push([ran, ms]);
    if (this._tickWindow.length > 30) this._tickWindow.shift();
    let tot = 0, t = 0;
    for (const [r, m] of this._tickWindow) { tot += r; t += m; }
    this.tps = t > 0 ? Math.round((tot / t) * 1000) : 0;
  }

  // ---- HUD & panels ----------------------------------------------------

  _updateHud() {
    const w = this.world;
    this.$('#hud-tick').textContent = w.tick.toLocaleString();
    this.$('#hud-pop').textContent = w.creatures.length;
    this.$('#hud-species').textContent = w.speciesTracker.livingCount();
    this.$('#hud-plants').textContent = w.plants.length;
    this.$('#hud-tps').textContent = this.paused ? 'paused' : `${this.tps.toLocaleString()}/s`;
    // Live diet mix.
    let herb = 0, carn = 0, omni = 0;
    for (const cr of w.creatures) {
      if (cr.diet < 0.28) herb++;
      else if (cr.diet > 0.6) carn++;
      else omni++;
    }
    const tot = w.creatures.length || 1;
    this.$('#mix-herb').style.width = `${(herb / tot) * 100}%`;
    this.$('#mix-omni').style.width = `${(omni / tot) * 100}%`;
    this.$('#mix-carn').style.width = `${(carn / tot) * 100}%`;
    this.$('#mix-label').textContent = `${herb} herbivore · ${omni} omnivore · ${carn} carnivore`;
  }

  _updateCharts() {
    const h = this.world.history;
    if (h.length < 2) return;
    const xs = h.ticks;

    this.popChart.setData({
      xs,
      series: [
        { name: 'creatures', color: PALETTE[0], values: h.population },
        { name: 'plants', color: PALETTE[1], values: h.plantCount },
      ],
    });

    this.flowChart.setData({
      xs,
      series: [
        { name: 'births', color: PALETTE[1], values: h.births },
        { name: 'deaths', color: PALETTE[7], values: h.deaths },
        { name: 'predation', color: PALETTE[5], values: h.kills },
      ],
    });

    // Trait evolution: scale each 0..1 trait to a percentage for readability.
    this.traitChart.setData({
      xs,
      series: TRAIT_SERIES.map((t, i) => ({
        name: traitName(t),
        color: PALETTE[i],
        values: h.avgTraits.map((a) => (a[t] ?? 0) * 100),
      })),
    });

    // Species stacked area: top 8 living species by peak, each in its own hue.
    const top = this.world.speciesTracker.living().slice(0, 8);
    const ids = top.map((s) => s.id);
    const series = top.map((s) => ({
      name: `sp ${s.id}`,
      color: `hsl(${s.hue}, 65%, 55%)`,
      values: h.speciesPop.map((m) => m[s.id] ?? 0),
    }));
    // Fold everyone else into "other".
    const other = h.speciesPop.map((m) => {
      let sum = 0;
      for (const k in m) if (!ids.includes(+k)) sum += m[k];
      return sum;
    });
    if (other.some((v) => v > 0)) series.push({ name: 'other', color: '#4a5266', values: other });
    this.speciesChart.setData({ xs, series });
  }

  _updateSpeciesList() {
    const list = this.$('#species-list');
    const living = this.world.speciesTracker.living().slice(0, 12);
    list.innerHTML = living
      .map((sp) => {
        const age = this.world.tick - sp.foundedAt;
        return `<div class="sp-row" data-sp="${sp.id}">
          <span class="sp-dot" style="background:hsl(${sp.hue},65%,55%)"></span>
          <span class="sp-id">Species ${sp.id}</span>
          <span class="sp-pop">${sp.population}</span>
          <span class="sp-age">${(age / 1000).toFixed(1)}k</span>
        </div>`;
      })
      .join('');
    list.querySelectorAll('.sp-row').forEach((row) => {
      row.onclick = () => {
        const id = +row.dataset.sp;
        const target = this.world.creatures.find((c) => c.speciesId === id);
        if (target) this._select(target);
      };
    });
  }

  _updateInspectorStats() {
    const cr = this.renderer.selected;
    const box = this.$('#inspect-stats');
    if (!cr || !cr.alive) {
      box.innerHTML = '<div class="muted">No creature selected. Click one, or a species above.</div>';
      return;
    }
    const g = cr.genome;
    const dietLabel = cr.diet < 0.28 ? 'herbivore' : cr.diet > 0.6 ? 'carnivore' : 'omnivore';
    const bar = (v) => `<div class="tb"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    const rows = [
      ['diet', `${dietLabel} (${(cr.diet * 100).toFixed(0)}%)`, cr.diet],
      ['size', (g[T.SIZE]).toFixed(2), g[T.SIZE]],
      ['speed', (g[T.SPEED]).toFixed(2), g[T.SPEED]],
      ['sense', `${Math.round(cr.senseRange)}px`, g[T.SENSE]],
      ['metabolism', (g[T.METABOLISM]).toFixed(2), g[T.METABOLISM]],
      ['aggression', (g[T.AGGRESSION]).toFixed(2), g[T.AGGRESSION]],
      ['mut rate', (g[T.MUT_RATE]).toFixed(2), g[T.MUT_RATE]],
    ]
      .map(([k, v, frac]) => `<div class="stat-row"><span>${k}</span><span class="sv">${v}</span>${bar(frac)}</div>`)
      .join('');
    box.innerHTML = `
      <div class="inspect-head">
        <span class="sp-dot" style="background:hsl(${cr.hue},70%,55%)"></span>
        <b>Creature #${cr.id}</b> · species ${cr.speciesId}
      </div>
      <div class="inspect-grid">
        <div><span class="k">generation</span><span class="v">${cr.generation}</span></div>
        <div><span class="k">age</span><span class="v">${cr.age}/${cr.lifespan}</span></div>
        <div><span class="k">energy</span><span class="v">${cr.energy.toFixed(0)}/${cr.maxEnergy.toFixed(0)}</span></div>
        <div><span class="k">offspring</span><span class="v">${cr.children}</span></div>
        <div><span class="k">kills</span><span class="v">${cr.kills}</span></div>
        <div><span class="k">fullness</span><span class="v">${(cr.fullness * 100).toFixed(0)}%</span></div>
      </div>
      ${rows}`;
  }

  // ---- interaction -----------------------------------------------------

  _select(cr) {
    this.renderer.selected = cr;
    this.camera.follow = cr;
    this.renderer.showSenses = true;
    this._updateInspectorStats();
  }

  _wireCanvas() {
    const c = this.canvas;
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    c.addEventListener('mousedown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY; moved = 0;
    });
    window.addEventListener('mouseup', (e) => {
      if (dragging && moved < 5) {
        const r = c.getBoundingClientRect();
        const hit = this.renderer.pick(e.clientX - r.left, e.clientY - r.top);
        if (hit) this._select(hit);
        else { this.renderer.selected = null; this.camera.follow = null; }
      }
      dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.camera.panBy(dx, dy);
      lastX = e.clientX; lastY = e.clientY;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.camera.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  _wireControls() {
    this.$('#btn-play').onclick = () => this._togglePause();
    this.$('#btn-slower').onclick = () => this._setSpeed(this.speedIndex - 1);
    this.$('#btn-faster').onclick = () => this._setSpeed(this.speedIndex + 1);
    this.$('#btn-restart').onclick = () => this._restart(this.seed);
    this.$('#btn-new').onclick = () => this._restart(this._randomSeed());
    this.$('#btn-save').onclick = () => this._save();
    this.$('#btn-load').onclick = () => this.$('#file-input').click();
    this.$('#file-input').onchange = (e) => this._load(e.target.files[0]);
    this.$('#seed-input').value = this.seed;
    this.$('#seed-input').onchange = (e) => this._restart(e.target.value.trim() || 'primordium');
    this.$('#color-mode').onchange = (e) => { this.renderer.colorMode = e.target.value; };
    this.$('#btn-follow').onclick = () => {
      if (this.renderer.selected) this.camera.follow = this.renderer.selected;
    };

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this._togglePause(); }
      else if (e.code === 'ArrowRight') this._setSpeed(this.speedIndex + 1);
      else if (e.code === 'ArrowLeft') this._setSpeed(this.speedIndex - 1);
      else if (e.key === 's') this.renderer.showSenses = !this.renderer.showSenses;
      else if (e.key === '.') { if (this.paused) this.world.step(); }
    });
    this._setSpeed(this.speedIndex);
  }

  _togglePause() {
    this.paused = !this.paused;
    this.$('#btn-play').textContent = this.paused ? '▶ Play' : '⏸ Pause';
    this.$('#btn-play').classList.toggle('active', !this.paused);
  }

  _setSpeed(i) {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
    const s = SPEEDS[this.speedIndex];
    this.$('#speed-label').textContent = s === 0 ? '0×' : `${s}×`;
    if (s === 0 && !this.paused) this._togglePause();
    else if (s > 0 && this.paused) this._togglePause();
  }

  _restart(seed) {
    this.seed = seed;
    this.world = new World(seed);
    this.renderer.setWorld(this.world);
    this.camera = new Camera(this.renderer.cssW, this.renderer.cssH, this.world.config.width, this.world.config.height);
    this.renderer.camera = this.camera;
    this.$('#seed-input').value = seed;
    this._setUrlSeed(seed);
    this._updateCharts();
    this._resizeAll();
  }

  _save() {
    const data = JSON.stringify(this.world.serialize());
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `primordium-${this.seed}-t${this.world.tick}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async _load(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      this.world = World.deserialize(data);
      this.seed = this.world.seed;
      this.renderer.setWorld(this.world);
      this.camera = new Camera(this.renderer.cssW, this.renderer.cssH, this.world.config.width, this.world.config.height);
      this.renderer.camera = this.camera;
      this.$('#seed-input').value = this.seed;
      this._updateCharts();
      this._resizeAll();
    } catch (err) {
      alert('Could not load file: ' + err.message);
    }
  }

  // ---- misc ------------------------------------------------------------

  _resizeAll() {
    this.renderer.resize();
    this.inspector.resize();
    this.popChart.resize();
    this.speciesChart.resize();
    this.flowChart.resize();
    this.traitChart.resize();
  }

  _seedFromUrl() {
    return new URLSearchParams(location.search).get('seed');
  }
  _setUrlSeed(seed) {
    const u = new URL(location.href);
    u.searchParams.set('seed', seed);
    history.replaceState(null, '', u);
  }
  _randomSeed() {
    const words = ['aurora', 'ember', 'tundra', 'delta', 'cobalt', 'zephyr', 'marrow', 'quartz', 'onyx', 'pyre', 'vireo', 'lumen'];
    return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(Math.random() * 1000);
  }
}

const TEMPLATE = /* html */ `
<header class="topbar">
  <div class="brand"><span class="logo">✦</span> Primordium <em>evolution laboratory</em></div>
  <div class="controls">
    <div class="seedbox">
      <label>seed</label>
      <input id="seed-input" type="text" spellcheck="false" />
    </div>
    <button id="btn-restart" title="Restart this seed">↻ Restart</button>
    <button id="btn-new" title="New random world">✦ New</button>
    <span class="divider"></span>
    <button id="btn-slower" title="Slower (←)">«</button>
    <button id="btn-play" class="active">⏸ Pause</button>
    <span id="speed-label" class="speed">2×</span>
    <button id="btn-faster" title="Faster (→)">»</button>
    <span class="divider"></span>
    <select id="color-mode" title="Colour creatures by">
      <option value="species">colour: species</option>
      <option value="diet">colour: diet</option>
      <option value="energy">colour: energy</option>
    </select>
    <button id="btn-save">⤓ Save</button>
    <button id="btn-load">⤒ Load</button>
    <input id="file-input" type="file" accept="application/json" hidden />
  </div>
</header>
<div class="layout">
  <main class="stage">
    <canvas id="world-canvas"></canvas>
    <div class="hud">
      <div class="hud-item"><span class="hv" id="hud-tick">0</span><span class="hk">tick</span></div>
      <div class="hud-item"><span class="hv" id="hud-pop">0</span><span class="hk">creatures</span></div>
      <div class="hud-item"><span class="hv" id="hud-species">0</span><span class="hk">species</span></div>
      <div class="hud-item"><span class="hv" id="hud-plants">0</span><span class="hk">plants</span></div>
      <div class="hud-item"><span class="hv" id="hud-tps">0/s</span><span class="hk">sim speed</span></div>
    </div>
    <div class="mixbar" title="Diet composition of the living population">
      <div class="mix" id="mix-herb"></div>
      <div class="mix" id="mix-omni"></div>
      <div class="mix" id="mix-carn"></div>
    </div>
    <div class="mix-label" id="mix-label"></div>
  </main>
  <aside class="sidebar">
    <section class="panel">
      <h3>Brain <span class="hint">live neural activity</span></h3>
      <canvas id="brain-canvas" class="brain"></canvas>
      <div id="inspect-stats" class="inspect"><div class="muted">Click a creature to inspect.</div></div>
      <div class="inspect-actions"><button id="btn-follow" class="small">⌖ Follow</button></div>
    </section>
    <section class="panel">
      <h3>Population <span class="hint">creatures vs plants</span></h3>
      <canvas id="chart-pop" class="chart"></canvas>
    </section>
    <section class="panel">
      <h3>Species over time <span class="hint">stacked, top 8</span></h3>
      <canvas id="chart-species" class="chart"></canvas>
    </section>
    <section class="panel">
      <h3>Births · deaths · predation</h3>
      <canvas id="chart-flow" class="chart"></canvas>
    </section>
    <section class="panel">
      <h3>Trait evolution <span class="hint">population mean, %</span></h3>
      <canvas id="chart-traits" class="chart"></canvas>
      <div id="trait-legend" class="legend"></div>
    </section>
    <section class="panel">
      <h3>Living species</h3>
      <div id="species-list" class="species-list"></div>
    </section>
  </aside>
</div>`;
