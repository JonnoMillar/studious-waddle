# Architecture

This document explains how Primordium is built and *why* it's built that way.
The guiding constraints were: **no dependencies**, **fully deterministic**, and
a clean split between a headless simulation engine (unit-testable in Node) and a
browser front-end (never imported by the engine).

```
        ┌─────────────────────────── browser ───────────────────────────┐
        │  index.html → js/ui/app.js                                     │
        │      ├─ Camera        pan / zoom / follow                      │
        │      ├─ Renderer      draws World onto a canvas                │
        │      ├─ BrainInspector  draws the selected creature's network  │
        │      └─ Charts        population / species / flows / traits     │
        └───────────────▲───────────────────────────┬───────────────────┘
                        │ reads state                │ step()
        ┌───────────────┴───────────────────────────▼───────────────────┐
        │  js/engine/World  — owns everything, advances one tick         │
        │      RNG · SpatialGrid×2 · Creature[] · plants[] ·             │
        │      SpeciesTracker · History                                  │
        └────────────────────────────────────────────────────────────────┘
```

The engine has **no reference to the DOM, `window`, or the renderer**. That's
what lets the same code run under Node for the test suite and inside a `<script
type="module">` in the browser, and it's what makes the determinism guarantee
checkable.

---

## 1. Determinism — the core contract

**Given the same seed and config, tick _N_ is bit-identical every time.** Three
tests pin this down: same-seed runs produce equal hashes, a run split into two
segments matches a straight run, and a saved-then-resumed world continues
identically.

Achieving it requires that *every* stochastic decision flow through one seeded
generator, in a fixed order:

- **`core/rng.js`** is a `mulberry32` generator with an FNV-hashed string-seed
  path and a Marsaglia-polar `gaussian()` whose cached spare sample is part of
  the serialized state. `Math.random()` is never called anywhere in the engine.
- **Iteration order is fixed.** Creatures are processed in array order each tick;
  births are appended after the pass (so a newborn never acts on the tick it's
  born); the dead are compacted out in one filter. No `Set`/`Map` iteration ever
  feeds a random-consuming decision in an order that could vary.
- **Serialization is lossless for anything that affects the simulation.**
  Positions, energy, heading, genomes and species references are stored at full
  `Float64` precision. Rounding them — tempting, for smaller save files — would
  inject divergence into what is a chaotic system, so we don't. (Only the
  display-history's trait averages are rounded, because nothing reads them back
  into the simulation.)

`World.hash()` folds positions, energy and species ids into a 32-bit FNV hash;
it's the cheap oracle the determinism tests compare.

---

## 2. The genome

`engine/genome.js`. A genome is a flat `Float64Array`:

```
[ 12 trait loci in [0,1] ][ brain weight vector in [-1,1] ]
```

The twelve named traits (`T.SIZE`, `T.SPEED`, `T.DIET`, …) include two
**meta-mutation** genes — `MUT_RATE` and `MUT_SIZE` — that control how the
genome itself mutates. Because they are heritable and themselves mutable,
*evolvability* is under selection: a lineage can evolve to explore faster or to
lock in.

- **`mutate(parent, rng)`** copies the parent and perturbs each locus with
  probability `rate` by a Gaussian of scale `size`, both derived from the
  parent's meta-genes. Trait loci clamp to `[0,1]` (hue wraps circularly so
  colour drifts freely); brain weights clamp to `[-1,1]`.
- **`distance(a, b)`** is the speciation metric: Euclidean over traits (the
  ecological niche) plus a small-weighted contribution from brain weights (so
  purely behavioural divergence can eventually split a species too). Hue is
  excluded — it's cosmetic and must not drive speciation.

Keeping the whole genotype in one typed array makes mutation a tight loop, makes
serialization trivial, and means the brain's weights literally *are* part of the
heritable material.

---

## 3. The brain

`engine/brain.js`. A fixed-topology feedforward network: **13 inputs → 8 hidden
(`tanh`) → 3 outputs (`tanh`)**. The weights are a slice of the genome starting
at `TRAIT_COUNT`, so no per-creature allocation is needed for the parameters.

Inputs are engineered to be **frame-invariant**: the direction to the nearest
plant / prey / threat is rotated into the creature's own heading frame, so "prey
is on my left" is the same input signal no matter which way the creature faces —
which makes evolved steering behaviour transferable as a lineage turns. Other
inputs are own-energy, local crowding, a slow per-creature sine oscillator (lets
gaits and patrols evolve) and a bias.

`forward()` writes activations into three preallocated arrays — **zero garbage
per tick**, which matters at hundreds of brains × 64× speed. The inspector reads
those same arrays to visualise live activation.

---

## 4. Space: a toroidal spatial hash

`engine/spatial.js`. Neighbour queries are the hot path — each creature runs
several radius queries per tick — so we use a uniform-grid spatial hash rebuilt
in place each tick (two grids: one for creatures, one for plants).

The world **wraps** (a torus), which the grid handles in two places: cell lookup
wraps modulo the grid dimensions, and `query()` returns the *shortest wrapped
displacement* `(dx, dy)` to each hit, so a creature near the left edge senses
plants near the right edge as close. The `spatial.test.js` suite validates the
grid against a brute-force reference over thousands of random queries, including
across the seam.

Rebuilding the grid every tick (rather than maintaining it incrementally) is
simpler and, with everything moving every tick anyway, no slower — and it can
never drift out of sync with reality.

---

## 5. The tick pipeline

`World.step()` runs a fixed pipeline:

1. **Rebuild** the creature and plant grids.
2. **Per creature, in order:** sense → `brain.forward()` → apply outputs (turn,
   thrust; movement costs energy ∝ speed²·size) → wrap position → pay resting
   metabolism → feed (herbivory) → maybe bite (predation) → death checks
   (starvation, old age) → maybe reproduce.
3. **Integrate births** appended during the pass.
4. **Compact** out the dead.
5. **Grow plants** logistically; remove eaten ones.
6. **Immigration** wave, on schedule.
7. Advance the tick counter and **sample history**.

Reproduction is asexual with mutation: a fertile, well-fed, old-enough creature
spends a fraction of its energy (`INVESTMENT`) to produce a mutated child, which
the `SpeciesTracker` then classifies.

---

## 6. The energy economy (why it's balanced)

An ecosystem simulation lives or dies on its energy budget. Primordium's is
tuned so that **food, not a population cap, is the regulator**:

- **Herbivory is not a free lunch.** Plants are worth little per bite and, being
  eaten on contact, are held below saturation by grazing pressure.
- **Plants grow logistically** toward a carrying capacity with a small constant
  seed-rate for recovery from near-zero. This is what turns a flat population
  line into real boom-and-bust cycles.
- **Predation depends on a prey base.** A carnivore needs a meaningfully larger
  body than its victim *and a different species* — **kin protection**. Without
  it, predators cannibalise their own young and a carnivore monoculture persists
  forever; with it, over-hunting starves the predators and they crash, letting
  prey recover. That coupling is the predator–prey oscillation.
- **Predator interference** (crowded hunters succeed less often) and a **large
  world** (spatial refuge) damp the oscillation so it doesn't amplify straight to
  extinction.
- **Immigration** injects a few mixed-niche colonists periodically, modelling
  migration from a mainland. It guarantees the world never freezes into a
  permanent monoculture and lets an emptied niche (e.g. an extinct predator
  guild) be recolonised — important because crossing the herbivore→predator
  *fitness valley* by mutation alone is vanishingly unlikely.

These are the only "balance" parameters, all in `DEFAULT_CONFIG`, and the balance
was arrived at empirically by instrumenting long headless runs.

---

## 7. Speciation and phylogeny

`engine/species.js`. Speciation is incremental and lineage-aware. On each birth:

1. If the child is within `SPECIATION_THRESHOLD` of its **parent species'**
   reference genome, it stays put.
2. Otherwise it joins the **nearest living species** within threshold.
3. If it fits none, it **founds a new species** that records its parent species —
   building an actual phylogenetic tree.

Step 2 is what keeps the species count tracking real ecological diversity instead
of exploding into a singleton on every divergent birth (an early version without
it produced 1,500+ "species"). Extinction is recorded when a species' population
reaches zero.

---

## 8. History without unbounded memory

`engine/history.js`. Stats are sampled every _N_ ticks into parallel arrays.
When the buffer fills, it **decimates 2:1** — keep every other sample, *sum* the
flow counters (births/deaths/kills) across merged pairs — and doubles the sample
interval. An overnight run therefore keeps a full-history overview at bounded
memory, trading resolution for span exactly as an old run should.

---

## 9. The front-end

- **`renderer.js`** draws the world on one canvas. Creatures are heading-oriented
  teardrops coloured by species (or diet, or energy); the world's wrap is made
  seamless by redrawing anything near an edge on the opposite side. Rendering is
  fully decoupled from simulation — it only reads current state.
- **`inspector.js`** draws the selected creature's network node-link diagram,
  edges weighted/coloured by genome value and brightened when actually carrying
  signal, nodes filled by live activation.
- **`charts.js`** is a small canvas charting layer (multi-series line +
  stacked-area) with a shared crosshair-and-tooltip hover. Its categorical
  palette was validated for colour-blind separation and contrast against the app
  surface using the data-visualisation method's checker; text stays in ink
  tokens, never series colour.
- **`app.js`** owns a `requestAnimationFrame` loop that steps the simulation a
  fixed number of times per frame according to the speed multiplier, with a
  **12 ms/frame simulation budget** so the UI stays responsive even at 64× with a
  large population. Panels refresh a few times a second, not every frame.

---

## 10. Testing philosophy

The suite is deliberately dependency-free (`tests/harness.js` is ~40 lines over
Node's `assert`). It targets the properties that are easy to get subtly wrong and
hard to eyeball: PRNG statistics, the toroidal query against brute force, a
hand-wired brain producing a known-sign output, exact-resume save/load, and the
population/energy **accounting invariants** (every creature that ever existed
entered as a founder, a birth or an immigrant; every one gone was a death — the
books must balance). If those hold, the emergent behaviour on top can be trusted
to be a property of the model rather than of a bug.
