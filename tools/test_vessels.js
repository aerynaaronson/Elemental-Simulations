// Headless tests for vessels: pouring, catching and conservation. Run with: node tools/test_vessels.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "vessels.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Vessels, P_LIQUID, P_POWDER } = vm.runInContext("({Sim,Mat,Vessels,P_LIQUID,P_POWDER})", ctx);

let failed = 0;
function check(name, ok, detail) { console.log((ok ? "pass " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); if (!ok) failed++; }
function fresh() { Sim.init(64, 48, 64); Sim.seed(11); Vessels.clear(); }
const WATER = Mat.byFormula.H2O, SAND = Mat.byFormula.SiO2;
function total(mat) { return Vessels.countInGrid(Sim, mat) + Vessels.countInVessels(mat); }
// Water evaporates and sand can react, so the sim itself changes totals. Conservation is checked across each vessel step alone.
let drift = 0;
function run(ticks, mat) { for (let k = 0; k < ticks; k++) { const t0 = total(mat); Vessels.step(Sim); drift += Math.abs(total(mat) - t0); Sim.tick(); } }

// 1. Geometry: the lip sits at the rim and moves down as the vessel tips.
fresh();
let v = Vessels.create({ radius: 4, height: 12 });
Vessels.setBase(v, 20, 1, 32);
let lip0 = Vessels.lip(v);
check("upright lip is at the rim", Math.abs(lip0[1] - 13) < 1e-9 && Math.abs(lip0[0] - 24) < 1e-9, lip0.map(n => n.toFixed(2)).join(","));
Vessels.setTilt(v, 0.6);
check("tipping lowers the lip", Vessels.lip(v)[1] < lip0[1]);
check("retained share falls with tilt", Vessels.retained(v, 0) === 1 && Vessels.retained(v, 0.5) > Vessels.retained(v, 1) && Vessels.retained(v, Math.PI / 2) === 0);

drift = 0;
// 2. A half-full upright beaker holds everything; a tipped one pours and conserves water.
fresh();
v = Vessels.create({ radius: 4, height: 12 });
Vessels.setBase(v, 20, 16, 32);   // held above the floor so the stream falls clear
const cap = Vessels.capacity(v);
Vessels.fill(v, WATER, P_LIQUID, Math.round(cap * 0.6));
const start = total(WATER);
run(30, WATER);
check("upright beaker does not pour", v.poured === 0, "poured " + v.poured);
const spill = Vessels.spillAngle(v);
Vessels.setTilt(v, spill * 0.8);
run(30, WATER);
check("below the spill angle nothing pours", v.poured === 0, "spill angle " + (spill * 180 / Math.PI).toFixed(1) + " deg");
Vessels.setTilt(v, 1.4);
run(120, WATER);
check("past the spill angle it pours", v.poured > cap * 0.35, "poured " + v.poured + " of " + start);
check("water is conserved across every pour step", drift === 0, "drift " + drift);

drift = 0;
// 3. Pouring from one beaker into another moves the water across.
fresh();
const a = Vessels.create({ radius: 4, height: 12 }), b = Vessels.create({ radius: 6, height: 10 });
Vessels.setBase(a, 18, 14, 32);   // held up high
Vessels.setBase(b, 30, 1, 32);    // on the floor, under a's lip once a tips toward +x
Vessels.fill(a, WATER, P_LIQUID, 300);
const before = total(WATER);
Vessels.setTilt(a, 1.5);
run(200, WATER);
check("second beaker catches the stream", Vessels.amount(b) > 200, "caught " + Vessels.amount(b) + " of 300");
check("transfer conserves water", drift === 0, "drift " + drift);

drift = 0;
// 4. Dipping an empty beaker into a pool scoops water up.
fresh();
Sim.box(1, 1, 1, 62, 6, 62, WATER, P_LIQUID);
for (let k = 0; k < 10; k++) Sim.tick();
const pool = total(WATER);
v = Vessels.create({ radius: 3, height: 10 });
Vessels.setBase(v, 32, 1, 32);
run(10, WATER);
check("dipped beaker scoops water", Vessels.amount(v) > 50, "scooped " + Vessels.amount(v));
check("scooping conserves water", drift === 0, "drift " + drift);

// 5. Powders hold a slope: sand stays in at a tilt where water would already pour.
fresh();
v = Vessels.create({ radius: 4, height: 12 });
Vessels.setBase(v, 20, 16, 32);
Vessels.fill(v, SAND, P_POWDER, Math.round(cap * 0.6));
Vessels.setTilt(v, Vessels.spillAngle(v) + 0.2);
drift = 0; run(30, SAND);
check("sand holds its angle of repose", v.poured === 0, "poured " + v.poured);
Vessels.setTilt(v, 1.5);
const sandStart = total(SAND);
run(120, SAND);
check("tipped further, sand pours out", v.poured > sandStart * 0.5, "poured " + v.poured);
check("sand is conserved", drift === 0, "drift " + drift);

// 6. A vessel whose lip is outside the chamber keeps its contents.
fresh();
v = Vessels.create({ radius: 4, height: 12 });
Vessels.setBase(v, 61, 1, 32);
Vessels.fill(v, WATER, P_LIQUID, 300);
Vessels.setTilt(v, 1.5);
run(30, WATER);
check("blocked pour keeps the water", Vessels.amount(v) + Vessels.countInGrid(Sim, WATER) === 300 && v.blocked, "in vessel " + Vessels.amount(v));

console.log(failed ? failed + " failed" : "all vessel tests passed");
process.exit(failed ? 1 : 0);
