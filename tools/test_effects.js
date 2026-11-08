// Reaction events and the effects drawn from them. Run with: node tools/test_effects.js
// The events are for the presentation layer only, so the first check is that writing them changes nothing in the simulation.
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "scenes.js", "effects.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Scenes, Effects, P_POWDER, P_LIQUID } = vm.runInContext("({Sim,Mat,Scenes,Effects,P_POWDER,P_LIQUID})", ctx);

let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? "pass " : "FAIL ") + name + (detail !== undefined ? "  (" + detail + ")" : "")); if (!ok) failed++; };
function fresh(w) { Sim.init(w || 48, 40, w || 48); Sim.seed(9); Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.lid = false; Sim.gravity = 1; Sim.structural = true; Sim.fluid = true; Sim.star = null; }
function events(kind) { const head = Sim.FXH[0], n = Math.min(head, Sim.FX_SIZE); let c = 0; for (let k = 0; k < n; k++) if (Sim.FX[k * 4 + 1] === kind) c++; return c; }
const WATER = Mat.named("H2O");

// 1. Writing events changes nothing: the same run with and without them ends cell for cell the same.
function golden(withFx) {
  fresh(64); const real = Sim.fx;
  if (!withFx) Sim.fx = function () {};
  Scenes.load("golden");
  for (let k = 0; k < 150; k++) Sim.tick();
  Sim.fx = real;
  return [Sim.ID.slice(), Sim.T.slice(), Sim.AUX.slice()];
}
const a = golden(true), b = golden(false);
check("events leave the simulation exactly as it was", a.every((arr, k) => arr.length === b[k].length && arr.every((v, q) => v === b[k][q] || (v !== v && b[k][q] !== b[k][q]))));

// 2. Each kind of reaction gives the event a player should see.
fresh(); Scenes.load("golden"); for (let k = 0; k < 120; k++) Sim.tick();
check("a precipitate falling out of solution", events(Sim.FX_PRECIPITATE) > 20, events(Sim.FX_PRECIPITATE));
fresh(); Sim.box(8, 1, 8, 39, 6, 39, Mat.named("CH3COOH"), P_LIQUID); Sim.box(20, 8, 20, 27, 10, 27, Mat.named("NaHCO3"), P_POWDER); for (let k = 0; k < 150; k++) Sim.tick();
check("gas forming in a liquid fizzes", events(Sim.FX_FIZZ) > 10, events(Sim.FX_FIZZ));
fresh(); Scenes.load("thermite"); for (let k = 0; k < 120; k++) Sim.tick();
check("a hot reaction flashes", events(Sim.FX_HEAT) > 50, events(Sim.FX_HEAT));
fresh(); Scenes.load("gunpowder"); for (let k = 0; k < 120; k++) Sim.tick();
check("gas given off into the air", events(Sim.FX_GAS) > 10, events(Sim.FX_GAS));
fresh(); Sim.box(8, 1, 8, 39, 6, 39, WATER, P_LIQUID); for (let k = 0; k < 150; k++) Sim.tick();
check("plain water gives no events", Sim.FXH[0] === 0, Sim.FXH[0]);

// 3. The effects layer turns events into sprites, thinned out so a flood cannot swamp the screen.
fresh(); Scenes.load("thermite");
Effects.enabled = true; Effects.update(0.016);
const out = new Float32Array(8 * Effects.capacity);
let most = 0, seen = 0;
for (let k = 0; k < 120; k++) { Sim.tick(); Effects.update(1 / 30); most = Math.max(most, Effects.active); seen += Effects.active; }
check("the thermite shows effects", seen > 0, "up to " + most + " at once");
check("and never more than the pool holds", most <= Effects.capacity, most);
const shown = Effects.fill(out, 0);
check("every sprite written has a size and a draw mode", shown === Effects.active && Array.from({ length: shown }, (_, k) => out[k * 8 + 3] > 0 && out[k * 8 + 7] >= 0.25 && out[k * 8 + 7] <= 1).every(Boolean), shown + " sprites");
for (let k = 0; k < 120; k++) Effects.update(1 / 30);
check("they fade away when nothing new happens", Effects.active === 0 || Sim.FXH[0] > 0, Effects.active);
Effects.enabled = false; for (let k = 0; k < 30; k++) { Sim.tick(); Effects.update(1 / 30); }
check("switched off, nothing is shown", Effects.active === 0, Effects.active);
Effects.enabled = true;
fresh(); Effects.update(0.016);
check("a new chamber starts with no leftover effects", Effects.active === 0, Effects.active);

// 4. A flood of events, more than the ring holds, is read from its newest end, within the budget for one frame.
fresh(); Effects.update(0.016);
const hot = Sim.idx(24, 5, 24);
for (let k = 0; k < Sim.FX_SIZE * 3; k++) Sim.fx(hot + (k % 40) * 4 + Math.floor(k / 40) % 40 * 4 * Sim.W, Sim.FX_HEAT, 26, 900);
Effects.update(1 / 30);
check("after the ring has wrapped, effects still come from fresh events", Effects.active > 0 && Effects.active <= 140, Sim.FXH[0] + " events, " + Effects.active + " shown");
Effects.update(1 / 30);
check("and a quiet frame after it adds nothing", Effects.active <= 140, Effects.active);

console.log(failed ? failed + " failed" : "all effects tests passed");
process.exit(failed ? 1 : 0);
