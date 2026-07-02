// A tiny fixed-topology feedforward network: INPUTS → HIDDEN(tanh) → OUTPUTS(tanh).
// Weights live in the genome, so behaviour evolves rather than being scripted.
// The forward pass writes activations into preallocated arrays — zero garbage
// per tick, which matters with thousands of brains at 64× speed.

export const INPUTS = [
  'plant dx',   // direction (creature-local) & proximity of nearest plant
  'plant dy',
  'plant near',
  'prey dx',    // nearest creature we could eat
  'prey dy',
  'prey near',
  'threat dx',  // nearest creature that could eat us
  'threat dy',
  'threat near',
  'energy',     // own energy fraction
  'crowd',      // local population pressure
  'osc',        // slow sine oscillator — lets gaits/patrols evolve
  'bias',
];
export const OUTPUTS = ['turn', 'thrust', 'bite'];

export const N_IN = INPUTS.length;   // 13
export const N_HID = 8;
export const N_OUT = OUTPUTS.length; // 3

export const BRAIN_GENE_COUNT = N_HID * (N_IN + 1) + N_OUT * (N_HID + 1);

export class Brain {
  /**
   * @param {Float64Array} genome full genome
   * @param {number} offset index where brain genes start
   */
  constructor(genome, offset) {
    this.genome = genome;
    this.offset = offset;
    this.input = new Float64Array(N_IN);
    this.hidden = new Float64Array(N_HID);
    this.output = new Float64Array(N_OUT);
  }

  /** Run the network on whatever is currently in this.input. */
  forward() {
    const g = this.genome;
    let w = this.offset;
    for (let h = 0; h < N_HID; h++) {
      let sum = g[w++]; // bias
      for (let i = 0; i < N_IN; i++) sum += g[w++] * this.input[i];
      this.hidden[h] = Math.tanh(sum * 2);
    }
    for (let o = 0; o < N_OUT; o++) {
      let sum = g[w++]; // bias
      for (let h = 0; h < N_HID; h++) sum += g[w++] * this.hidden[h];
      this.output[o] = Math.tanh(sum * 2);
    }
    return this.output;
  }
}
