// Lightweight canvas charting tuned for live-updating simulation telemetry.
// Two forms: a multi-series line chart and a stacked-area chart. Both share an
// axis/grid/hover layer. Colours come from the validated dark categorical
// palette (see ARCHITECTURE.md); text stays in ink tokens, never series colour.
//
// Palette validated with the dataviz skill's checker against surface #121826:
// all pass, worst adjacent CVD ΔE 13.4 (tritan) — floor band, so every series
// is also legended and, where <=4, directly labelled.

export const PALETTE = [
  '#3987e5', // 1 blue
  '#199e70', // 2 aqua
  '#c98500', // 3 yellow
  '#2f9e44', // 4 green
  '#9085e9', // 5 violet
  '#e66767', // 6 red
  '#d55181', // 7 magenta
  '#d95926', // 8 orange
];

const INK = {
  primary: '#f2f4f8',
  secondary: '#aab2c0',
  muted: '#6b7688',
  grid: 'rgba(120,140,170,0.14)',
  axis: 'rgba(120,140,170,0.35)',
  surface: '#0d1220',
};

const PAD = { top: 14, right: 14, bottom: 22, left: 42 };

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

class BaseChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.hoverX = null; // css px within plot
    this.data = null;

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.hoverY = e.clientY - r.top;
      this._render();
    });
    canvas.addEventListener('mouseleave', () => {
      this.hoverX = null;
      this._hideTip();
      this._render();
    });
  }

  _tip() {
    if (!this._tipEl) {
      this._tipEl = document.createElement('div');
      this._tipEl.className = 'chart-tip';
      document.body.appendChild(this._tipEl);
    }
    return this._tipEl;
  }
  _hideTip() {
    if (this._tipEl) this._tipEl.style.opacity = '0';
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.floor(r.width * this.dpr);
    this.canvas.height = Math.floor(r.height * this.dpr);
    this._render();
  }

  _plotRect() {
    return {
      x: PAD.left,
      y: PAD.top,
      w: this.w - PAD.left - PAD.right,
      h: this.h - PAD.top - PAD.bottom,
    };
  }

  _axes(ctx, p, maxY, xs, minY = 0) {
    ctx.fillStyle = INK.muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const val = minY + ((maxY - minY) * i) / ticks;
      const y = p.y + p.h - (p.h * i) / ticks;
      ctx.strokeStyle = INK.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, y + 0.5);
      ctx.lineTo(p.x + p.w, y + 0.5);
      ctx.stroke();
      ctx.fillText(this._fmt(val), p.x - 6, y);
    }
    // X labels: first & last tick value.
    if (xs && xs.length) {
      ctx.textAlign = 'left';
      ctx.fillText(this._fmtX(xs[0]), p.x, p.y + p.h + 12);
      ctx.textAlign = 'right';
      ctx.fillText(this._fmtX(xs[xs.length - 1]), p.x + p.w, p.y + p.h + 12);
    }
  }

  _fmt(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
    return Math.round(v).toString();
  }
  _fmtX(v) {
    if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
    return v.toString();
  }
}

export class LineChart extends BaseChart {
  /** data: { xs:number[], series:[{name,color,values:number[]}], unit? } */
  setData(data) {
    this.data = data;
    this._render();
  }

  _render() {
    if (!this.data) return;
    const ctx = this.ctx;
    const { xs, series } = this.data;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);

    const p = this._plotRect();
    let maxY = 0;
    for (const s of series) for (const v of s.values) if (v > maxY) maxY = v;
    maxY = niceMax(maxY);
    this._axes(ctx, p, maxY, xs);

    const n = xs.length;
    const xAt = (i) => p.x + (n <= 1 ? 0 : (p.w * i) / (n - 1));
    const yAt = (v) => p.y + p.h - (p.h * v) / maxY;

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAt(s.values[i] ?? 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Direct end-label when <=4 series.
      if (series.length <= 4 && n) {
        const lastY = yAt(s.values[n - 1] ?? 0);
        ctx.fillStyle = s.color;
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(s.name, p.x + p.w, lastY - 2);
      }
    }

    this._hover(ctx, p, xs, series, xAt, yAt);
    ctx.restore();
  }

  _hover(ctx, p, xs, series, xAt, yAt) {
    if (this.hoverX == null || xs.length < 2) return;
    const rel = Math.max(0, Math.min(1, (this.hoverX - p.x) / p.w));
    const i = Math.round(rel * (xs.length - 1));
    const x = xAt(i);
    ctx.strokeStyle = INK.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, p.y);
    ctx.lineTo(x + 0.5, p.y + p.h);
    ctx.stroke();
    for (const s of series) {
      const y = yAt(s.values[i] ?? 0);
      ctx.fillStyle = INK.surface;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const tip = this._tip();
    const rows = series
      .map((s) => `<span style="color:${s.color}">■</span> ${s.name} <b>${this._fmt(s.values[i] ?? 0)}</b>`)
      .join('<br>');
    tip.innerHTML = `<div class="chart-tip-h">tick ${this._fmtX(xs[i])}</div>${rows}`;
    const r = this.canvas.getBoundingClientRect();
    tip.style.left = r.left + x + 12 + 'px';
    tip.style.top = r.top + this.hoverY + 'px';
    tip.style.opacity = '1';
  }
}

export class StackedAreaChart extends BaseChart {
  /** data: { xs, series:[{name,color,values}] } stacked bottom-up. */
  setData(data) {
    this.data = data;
    this._render();
  }

  _render() {
    if (!this.data) return;
    const ctx = this.ctx;
    const { xs, series } = this.data;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);
    const p = this._plotRect();

    const n = xs.length;
    const totals = new Array(n).fill(0);
    for (const s of series) for (let i = 0; i < n; i++) totals[i] += s.values[i] ?? 0;
    let maxY = 0;
    for (const t of totals) if (t > maxY) maxY = t;
    maxY = niceMax(maxY);
    this._axes(ctx, p, maxY, xs);

    const xAt = (i) => p.x + (n <= 1 ? 0 : (p.w * i) / (n - 1));
    const yAt = (v) => p.y + p.h - (p.h * v) / maxY;

    const baseline = new Array(n).fill(0);
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yAt(baseline[i]));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(xAt(i), yAt(baseline[i] + (s.values[i] ?? 0)));
      ctx.closePath();
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 2px surface gap between stacked segments.
      ctx.strokeStyle = INK.surface;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAt(baseline[i] + (s.values[i] ?? 0));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let i = 0; i < n; i++) baseline[i] += s.values[i] ?? 0;
    }

    this._hover(ctx, p, xs, series, xAt, yAt, totals);
    ctx.restore();
  }

  _hover(ctx, p, xs, series, xAt, yAt, totals) {
    if (this.hoverX == null || xs.length < 2) return;
    const rel = Math.max(0, Math.min(1, (this.hoverX - p.x) / p.w));
    const i = Math.round(rel * (xs.length - 1));
    const x = xAt(i);
    ctx.strokeStyle = INK.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, p.y);
    ctx.lineTo(x + 0.5, p.y + p.h);
    ctx.stroke();
    const tip = this._tip();
    const active = series.filter((s) => (s.values[i] ?? 0) > 0).slice(0, 10);
    const rows = active
      .map((s) => `<span style="color:${s.color}">■</span> ${s.name} <b>${this._fmt(s.values[i] ?? 0)}</b>`)
      .join('<br>');
    tip.innerHTML = `<div class="chart-tip-h">tick ${this._fmtX(xs[i])} · total ${this._fmt(totals[i])}</div>${rows || '<i>none</i>'}`;
    const r = this.canvas.getBoundingClientRect();
    tip.style.left = r.left + x + 12 + 'px';
    tip.style.top = r.top + this.hoverY + 'px';
    tip.style.opacity = '1';
  }
}
