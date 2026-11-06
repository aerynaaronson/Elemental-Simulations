// Tick-time benchmark at the default grid size. Run with: node tools/bench.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, P_POWDER } = vm.runInContext("({Sim,Mat,P_POWDER})", ctx);
Sim.init(96, 64, 96); Sim.seed(7);
function bench(name, ticks) {
  const t0 = Date.now();
  for (let k = 0; k < ticks; k++) Sim.tick();
  console.log(name.padEnd(36), ((Date.now() - t0) / ticks).toFixed(2) + " ms/tick", "active chunks", Sim.stats.active);
}
bench("empty", 60);
Sim.box(4, 1, 4, 91, 10, 91, Mat.named("H2O"), P_POWDER);
Sim.box(30, 20, 30, 60, 30, 60, 14, P_POWDER);
bench("water pool + falling sand", 120);
bench("settled", 120);
Sim.wakeAll();
for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 0) Sim.T[i] = 400;
bench("whole grid awake and warm", 40);
