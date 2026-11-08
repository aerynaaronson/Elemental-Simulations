// Scripted experiments that drive the lab only through the Lab API, the same calls a desktop or VR front end makes.
// Run with: node tools/test_lab.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "vessels.js", "lab.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const G = vm.runInContext("({Sim,Mat,Chem,Vessels,Lab,P_LIQUID,P_POWDER,P_GAS,P_STATIC,WALL,AIR})", ctx);
const { Sim, Mat, Chem, Vessels, Lab, P_LIQUID, P_POWDER, P_GAS, P_STATIC, WALL, AIR } = G;

let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? "pass " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); if (!ok) failed++; };
const WATER = Mat.byFormula.H2O, VINEGAR = Mat.byFormula.CH3COOH, SODA = Mat.byFormula.NaHCO3, CO2 = Mat.byFormula.CO2;
function fresh() { Sim.init(64, 48, 64); Sim.seed(7); Sim.ambient = 293.15; Lab.init(Sim); Lab.clear(); }
// One frame of motion and one tick of simulation, as the app's loop does.
function run(n) { for (let k = 0; k < n; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); } }
const count = mat => Vessels.countInGrid(Sim, mat) + Vessels.countInVessels(mat);
function waterOutside(v) {
  const inside = new Set(v.shell ? v.shell.inside : []); let n = 0;
  for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER && Sim.PH[i] === P_LIQUID && !inside.has(i)) n++;
  return n;
}
function meanT(v, mat) { const c = Vessels.contentsNow(v, Sim).filter(e => e.mat === mat); let n = 0, t = 0; c.forEach(e => { n += e.n; t += e.T * e.n; }); return n ? t / n : 0; }

// 1. A beaker dropped in mid-air falls, settles and becomes glass in the grid, with its water poured in.
fresh();
let b = Lab.spawnBeaker(20, 20, 32);
Lab.fill(b, WATER, P_LIQUID, 250);
run(40);
check("beaker falls and is set down into the grid", !!b.shell && Math.abs(Vessels.base(b)[1] - 1) < 0.01, "base y " + Vessels.base(b)[1].toFixed(2));
check("its water is now in the grid", Vessels.amount(b) === 0 && Vessels.amountNow(b, Sim) >= 240, "in grid " + Vessels.amountNow(b, Sim));
check("its glass is WALL cells", b.shell.wall.length > 100 && b.shell.wall.every(i => Sim.ID[i] === WALL));
run(300);
check("water stays inside the glass for 300 ticks", waterOutside(b) === 0, waterOutside(b) + " cells outside");

// 2. Picking it up takes the water back out of the grid and removes the glass, conserving water.
let before = count(WATER);
Lab.grab(b);
check("grabbing lifts the contents back into the beaker", !b.shell && Vessels.amount(b) === before && Vessels.countInGrid(Sim, WATER) === 0, Vessels.amount(b) + " of " + before);
check("grabbing removes the glass", Vessels.countInGrid(Sim, WALL) === Sim.W * Sim.D * 2 + (Sim.W + Sim.D) * 2 * (Sim.H - 2) - 4 * (Sim.H - 2));
Lab.release(b);

// 3. Vinegar and baking soda react inside a set-down beaker and give off CO2.
fresh();
b = Lab.spawnBeaker(32, 1, 32);
run(6);
check("a beaker set on the floor goes into the grid", !!b.shell);
Lab.fill(b, SODA, P_POWDER, 60);
Lab.fill(b, VINEGAR, P_LIQUID, 200);
let fired = 0; Chem.onFire = r => { if (/CH3COOH \+ NaHCO3/.test(r.eq)) fired++; };
run(200);
Chem.onFire = null;
check("vinegar and baking soda react in the beaker", fired > 0, fired + " reactions");
check("the reaction gives off CO2", Vessels.countInGrid(Sim, CO2) > 0, Vessels.countInGrid(Sim, CO2) + " CO2 cells");

// 4. A hot plate heats a beaker of water standing on it until it boils.
fresh();
const plate = Lab.spawnPlate(32.5, 1, 32.5, { setT: 520 });
run(8);
check("plate rests and is written into the grid", !!plate.stamp, plate.stamp && plate.stamp.cells.length + " cells");
b = Lab.spawnBeaker(32.5, 10, 32.5);
Lab.fill(b, WATER, P_LIQUID, 300);
run(30);
check("beaker comes to rest on the plate", !!b.shell && Lab.plateOn(b) === plate, "base y " + Vessels.base(b)[1].toFixed(1) + ", plate top " + plate.stamp.top);
const w0 = Vessels.amountNow(b, Sim), t0 = meanT(b, WATER);
run(400);
const t1 = meanT(b, WATER), w1 = Vessels.amountNow(b, Sim);
check("the water warms up", t1 > t0 + 20, t0.toFixed(0) + " K -> " + t1.toFixed(0) + " K");
check("it boils away", w1 < w0, w0 + " -> " + w1 + " cells of liquid");
Lab.setPlate(plate, null);

// 5. Lifting the plate out from under a set-down beaker makes the beaker come loose and fall.
Lab.grab(plate);
Lab.move(plate, 12, 1, 12);
run(3);
check("a beaker loses its footing when the plate is taken away", !b.shell);
Lab.release(plate);
run(60);
check("and falls to the floor", Math.abs(Vessels.base(b)[1] - 1) < 0.01 && !!b.shell, "base y " + Vessels.base(b)[1].toFixed(2));

// 6. transferMaterial moves material between beakers, set down or not, without losing any.
fresh();
const a = Lab.spawnBeaker(16, 1, 32), c = Lab.spawnBeaker(44, 1, 32);
Lab.fill(a, WATER, P_LIQUID, 300);
run(10);
before = count(WATER);
const moved = Lab.transferMaterial(a, c, 120);
check("transfer moves the cells", moved === 120 && Vessels.amountNow(c, Sim) === 120, moved + " moved, " + Vessels.amountNow(c, Sim) + " in target");
check("transfer conserves water", count(WATER) === before, count(WATER) + " vs " + before);
check("both beakers are still set down", !!a.shell && !!c.shell);

// 7. Pouring from a held beaker into a set-down one: the stream lands inside the real glass.
fresh();
const target = Lab.spawnBeaker(36, 1, 32, { radius: 6, height: 10 });
run(6);
const jug = Lab.spawnBeaker(28, 16, 32);
Lab.fill(jug, WATER, P_LIQUID, 250);
Lab.grab(jug);
Lab.tilt(jug, 1.5);
run(150);
check("the poured stream collects inside the set-down beaker", Vessels.amountNow(target, Sim) > 150, Vessels.amountNow(target, Sim) + " of 250");

// 8. placeMaterial puts cells into open space near a point.
fresh();
check("placeMaterial places exactly what was asked", Lab.placeMaterial(SODA, 32, 5, 32, 40, P_POWDER) === 40 && Vessels.countInGrid(Sim, SODA) === 40);

// 9. Every container shape holds water once set down, and hands all of it back when picked up.
for (const type of Object.keys(Lab.CONTAINERS)) {
  fresh();
  const v = Lab.spawnBeaker(32, 1, 32, { type });
  const n = Math.round(Vessels.capacity(v) * 0.7);
  Lab.fill(v, WATER, P_LIQUID, n);
  run(120);
  const inGrid = Vessels.amountNow(v, Sim), out = waterOutside(v);   // a little evaporates from an open container, so compare with what is in it now
  Lab.grab(v);
  check(Lab.CONTAINERS[type].label + " holds water and gives it back", inGrid >= n * 0.95 && out === 0 && Vessels.amount(v) === inGrid, n + " poured, " + inGrid + " now, " + out + " outside, " + Vessels.amount(v) + " back");
}

// 10. A chiller freezes water standing on it, and warms back toward room temperature when turned off.
fresh();
const chill = Lab.spawnChiller(32.5, 1, 32.5, { setT: 200 });
run(8);
check("a chiller rests and is written into the grid", !!chill.stamp && chill.cold && /Chiller/.test(chill.name));
b = Lab.spawnBeaker(32.5, 10, 32.5, { type: "crucible" });
Lab.fill(b, WATER, P_LIQUID, 120);
run(30);
check("the container comes to rest on the chiller", !!b.shell && Lab.plateOn(b) === chill);
const warm = meanT(b, WATER);
run(900);
const iced = Vessels.contentsNow(b, Sim).filter(e => e.mat === WATER && e.form !== P_LIQUID).reduce((s, e) => s + e.n, 0);
check("the water cools", meanT(b, WATER) < warm - 15, warm.toFixed(0) + " K -> " + meanT(b, WATER).toFixed(0) + " K");
check("some of it freezes", iced > 0, iced + " cells of ice");
check("a chiller does not bring material from nowhere", Vessels.countInGrid(Sim, WATER) <= 120);

// 11. Carried objects stay out of solids, but can still be dipped into liquid.
fresh();
Sim.box(26, 1, 26, 38, 14, 38, 26, P_STATIC);   // an iron block
b = Lab.spawnBeaker(10, 2, 32);
Lab.grab(b);
Lab.move(b, 32, 3, 32);
Lab.update(1 / 30);
check("carrying a beaker into a solid block lifts it on top", Math.abs(Vessels.base(b)[1] - 15) < 0.01, "base y " + Vessels.base(b)[1].toFixed(1));
Lab.move(b, 10, 3, 32);
Lab.update(1 / 30);
check("away from the block it can go back down", Math.abs(Vessels.base(b)[1] - 3) < 0.01, "base y " + Vessels.base(b)[1].toFixed(1));
Lab.release(b);
fresh();
Sim.box(10, 1, 10, 54, 8, 54, WATER, P_POWDER);
b = Lab.spawnBeaker(32, 20, 32);
Lab.grab(b);
Lab.move(b, 32, 2, 32);
Lab.update(1 / 30);
check("liquid does not stop a beaker being dipped", Math.abs(Vessels.base(b)[1] - 2) < 0.01, "base y " + Vessels.base(b)[1].toFixed(1));
const scooped = (() => { for (let k = 0; k < 10; k++) { Sim.tick(); Lab.step(); } return Vessels.amount(b); })();
check("and it scoops up what it is dipped in", scooped > 0, scooped + " cells");

// 12. A gas burner keeps a flame going while it is lit, colours it by a salt around its nozzle, stops when turned off and survives a save.
fresh();
const FLAME = vm.runInContext("FLAME", ctx), NACL = Mat.byFormula.NaCl;
const burner = Lab.spawnBurner(32.5, 1, 32.5);
run(10);
check("a burner rests and is written into the grid", !!burner.stamp && burner.burner && /Gas burner/.test(burner.name));
const flames = () => { let n = 0, sodium = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === FLAME) { n++; if (Sim.AUX[i] === 11) sodium++; } return [n, sodium]; };
let seen = 0;
for (let k = 0; k < 300; k++) { run(1); seen = Math.min(seen || Infinity, flames()[0]); }
check("its flame never goes out while it is lit", seen >= 3, "fewest flame cells " + seen);
check("the burner body stays cool", burner.stamp.cells.every(i => Sim.T[i] < 400));
check("a plain flame has no metal colour", flames()[1] === 0);
const top = burner.stamp.top;
for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) Sim.place(32 + dx, top, 32 + dz, NACL, P_STATIC, undefined, true);
let yellow = 0;
for (let k = 0; k < 120; k++) { run(1); yellow += flames()[1]; }
check("salt around the nozzle turns the flame sodium yellow", yellow / 120 > 1.5, (yellow / 120).toFixed(1) + " yellow cells on average");
const saved = JSON.parse(JSON.stringify(Lab.serialize()));
Lab.deserialize(saved);
check("a save keeps it a lit burner", Lab.plates.length === 1 && Lab.plates[0].burner && Lab.plates[0].setT === Lab.BURNER_T);
Lab.setPlate(Lab.plates[0], null);
run(60);
check("turned off, its flame dies away", flames()[0] === 0, flames()[0] + " flame cells left");

console.log(failed ? failed + " failed" : "all lab tests passed");
process.exit(failed ? 1 : 0);
