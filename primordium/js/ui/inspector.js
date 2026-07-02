// Live brain inspector. Renders the selected creature's neural network as a
// node-link diagram: input row → hidden row → output row, edges coloured and
// weighted by their genome value, nodes filled by live activation each tick.
// This is the "look inside the mind" panel that makes the evolved behaviour
// legible — you can watch a threat input light up the flee pathway.

import { INPUTS, OUTPUTS, N_IN, N_HID, N_OUT } from '../engine/brain.js';
import { TRAIT_COUNT } from '../engine/genome.js';

export class BrainInspector {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.creature = null;
  }

  setCreature(cr) {
    this.creature = cr;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.floor(r.width * this.dpr);
    this.canvas.height = Math.floor(r.height * this.dpr);
  }

  _layout() {
    const padX = 74, padY = 16;
    const colX = [padX, this.w / 2, this.w - padX];
    const colFor = (count) => {
      const usable = this.h - padY * 2;
      return (i) => padY + (count <= 1 ? usable / 2 : (usable * i) / (count - 1));
    };
    return {
      in: { x: colX[0], y: colFor(N_IN) },
      hid: { x: colX[1], y: colFor(N_HID) },
      out: { x: colX[2], y: colFor(N_OUT) },
    };
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);

    if (!this.creature || !this.creature.alive) {
      ctx.fillStyle = '#6b7688';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Select a creature to inspect its brain', this.w / 2, this.h / 2);
      ctx.restore();
      return;
    }

    const cr = this.creature;
    const g = cr.genome;
    const L = this._layout();
    const b = cr.brain;

    // Edges: input→hidden then hidden→output. Draw weak edges first.
    let w = TRAIT_COUNT;
    const edges = [];
    for (let hgt = 0; hgt < N_HID; hgt++) {
      w++; // skip hidden bias
      for (let i = 0; i < N_IN; i++) {
        edges.push({ x1: L.in.x, y1: L.in.y(i), x2: L.hid.x, y2: L.hid.y(hgt), wt: g[w++], act: b.input[i] });
      }
    }
    for (let o = 0; o < N_OUT; o++) {
      w++; // skip output bias
      for (let hgt = 0; hgt < N_HID; hgt++) {
        edges.push({ x1: L.hid.x, y1: L.hid.y(hgt), x2: L.out.x, y2: L.out.y(o), wt: g[w++], act: b.hidden[hgt] });
      }
    }
    edges.sort((a, z) => Math.abs(a.wt) - Math.abs(z.wt));
    for (const e of edges) {
      const mag = Math.min(1, Math.abs(e.wt));
      const signalling = Math.min(1, Math.abs(e.wt * e.act));
      // Positive weights blue, negative red; opacity/width by strength; a
      // brighter core when the edge is actually carrying signal this tick.
      const col = e.wt >= 0 ? '90,160,255' : '235,110,110';
      ctx.strokeStyle = `rgba(${col},${0.06 + mag * 0.28})`;
      ctx.lineWidth = 0.4 + mag * 2.2;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      if (signalling > 0.12) {
        ctx.strokeStyle = `rgba(${col},${signalling * 0.7})`;
        ctx.lineWidth = 0.5 + signalling * 2.5;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
      }
    }

    // Nodes.
    const node = (x, y, act, label, align) => {
      const a = Math.max(-1, Math.min(1, act));
      const r = 6 + Math.abs(a) * 5;
      // Blue for positive activation, red for negative, dim grey near zero.
      const t = Math.abs(a);
      const col = a >= 0 ? `rgba(90,170,255,${0.25 + t * 0.75})` : `rgba(235,110,110,${0.25 + t * 0.75})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (label) {
        ctx.fillStyle = '#aab2c0';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        if (align === 'left') {
          ctx.textAlign = 'right';
          ctx.fillText(label, x - r - 4, y);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(label, x + r + 4, y);
        }
      }
    };

    for (let i = 0; i < N_IN; i++) node(L.in.x, L.in.y(i), b.input[i], INPUTS[i], 'left');
    for (let h = 0; h < N_HID; h++) node(L.hid.x, L.hid.y(h), b.hidden[h], null);
    for (let o = 0; o < N_OUT; o++) node(L.out.x, L.out.y(o), b.output[o], OUTPUTS[o], 'right');

    // Column captions.
    ctx.fillStyle = '#6b7688';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('SENSES', L.in.x, 2);
    ctx.fillText('HIDDEN', L.hid.x, 2);
    ctx.fillText('ACTIONS', L.out.x, 2);

    ctx.restore();
  }
}
