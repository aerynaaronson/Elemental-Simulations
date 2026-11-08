// Scripted experiments for the thermometer, dropper, stopper, power supply, reagent bottles, stirrer, funnel, gas syringe,
// balance, tongs, spark igniter, Geiger counter, bell jar and condenser, driven only
// through the Lab API.
// Run with: node tools/test_equipment.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "vessels.js", "lab.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Vessels, Lab, P_LIQUID, P_GAS, WALL, AIR, ELECTRODE } = vm.runInContext("({Sim,Mat,Vessels,Lab,P_LIQUID,P_GAS,WALL,AIR,ELECTRODE})", ctx);

let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? "pass " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); if (!ok) failed++; };
const WATER = Mat.byFormula.H2O, H2 = 1, O2 = 8, VINEGAR = Mat.byFormula.CH3COOH, SODA = Mat.byFormula.NaHCO3;
function fresh() { Sim.init(64, 48, 64); Sim.seed(7); Sim.ambient = 293.15; Sim.atmosphere = "air"; Lab.init(Sim); Lab.clear(); }
function run(n) { for (let k = 0; k < n; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); } }
const count = mat => Vessels.countInGrid(Sim, mat) + Vessels.countInVessels(mat) + Lab.countInTools(mat);
const gasCells = mat => { let n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === mat && Sim.PH[i] >= P_GAS) n++; return n; };
function waterOutside(v) { const inside = new Set(v.shell.inside); let n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER && Sim.PH[i] === P_LIQUID && !inside.has(i)) n++; return n; }
function beakerOfWater(x, z, n, opts) { const b = Lab.spawnBeaker(x, 1, z, opts); Lab.fill(b, WATER, P_LIQUID, n); run(20); return b; }

// 1. A thermometer let go over a beaker sinks to the glass floor and reads the water, and follows it as a hot plate heats it.
fresh();
const plate = Lab.spawnPlate(32.5, 1, 32.5);
run(10);
const hot = Lab.spawnBeaker(32.5, 4, 32.5);
Lab.fill(hot, WATER, P_LIQUID, 400);
run(20);
check("the beaker stands on the plate", !!hot.shell && Lab.plateOn(hot) === plate);
const probe = Lab.spawnProbe(32.5, 30, 32.5);
run(30);
check("a thermometer rests on the beaker's floor", Math.abs(probe.y - (hot.shell.by + 1)) < 0.01, "tip y " + probe.y.toFixed(2) + ", floor " + (hot.shell.by + 1));
let r = Lab.read(probe);
check("it reads the water at room temperature", r.mat === WATER && r.form === P_LIQUID && Math.abs(r.T - 293.15) < 3, Mat.list[r.mat].name + " " + (r.T - 273.15).toFixed(1) + " °C");
check("and pure water's pH", r.pH != null && Math.abs(r.pH - 7) < 0.5, "pH " + r.pH);
check("and about one atmosphere", Math.abs(r.kPa - 101.3) < 5, r.kPa.toFixed(1) + " kPa");
Lab.setPlate(plate, 353.15);
run(300);
const warm = Lab.read(probe).T;
check("it follows the water as the plate heats it", warm > 300, (warm - 273.15).toFixed(1) + " °C");
const inAir = Lab.spawnProbe(10.5, 1, 10.5);
run(5);
r = Lab.read(inAir);
check("one standing on the bench reads the air", r.mat === AIR && Math.abs(r.T - 293.15) < 2);

// 2. A dropper draws water up out of one beaker and lets it out drop by drop into another, without making or losing any.
fresh();
const src = beakerOfWater(20.5, 32.5, 300), dst = beakerOfWater(44.5, 32.5, 0);
const drop = Lab.spawnDropper(20.5, 30, 32.5);
run(40);
const total = count(WATER);
const took = Lab.drawUp(drop);
check("a dropper draws up a full load", took === drop.cap && Lab.amountIn(drop) === drop.cap, took + " cells");
check("drawing up conserves water", count(WATER) === total);
Lab.grab(drop); Lab.move(drop, 44.5, dst.shell.by + dst.height + 3, 32.5);
const before = Vessels.amountNow(dst, Sim);
Lab.squeeze(drop, 5);
run(3);
check("squeezing lets out one drop a tick", Lab.amountIn(drop) === drop.cap - 3, Lab.amountIn(drop) + " left");
Lab.squeeze(drop);
run(40);
// Standing water slowly evaporates into the air, which the census cannot count, so a cell or two may go missing over 40 ticks.
check("the drops land in the other beaker", Lab.amountIn(drop) === 0 && Vessels.amountNow(dst, Sim) - before >= drop.cap - 2, (Vessels.amountNow(dst, Sim) - before) + " cells");
check("and no water is made", count(WATER) <= total && count(WATER) >= total - 4, count(WATER) + " of " + total);

// 3. A stopper seals a container. Loose, it stops the container pouring. Set down, gas collects under it until it pops.
fresh();
const corked = Lab.spawnBeaker(32.5, 20, 32.5);
Lab.fill(corked, WATER, P_LIQUID, 200);
Lab.setStopper(corked, true);
Lab.grab(corked); Lab.tilt(corked, 2);
for (let k = 0; k < 30; k++) { Sim.tick(); Lab.step(); }
check("a stoppered container does not pour", Vessels.amount(corked) === 200 && Vessels.countInGrid(Sim, WATER) === 0);
Lab.tilt(corked, 0); Lab.release(corked);
run(40);
check("set down, its stopper becomes a seal of cells above the rim", !!corked.shell && corked.shell.cap.length > 40 && corked.shell.cap.every(i => Sim.ID[i] === WALL));
const hotPlate = Lab.spawnPlate(32.5, 1, 32.5);
Lab.grab(corked); Lab.release(corked);   // lift it off so the plate can settle under it
Lab.move(corked, 10, 30, 10);
run(20);
Lab.move(corked, 32.5, 6, 32.5);
run(40);
check("it stands sealed on the hot plate", !!corked.shell && !!corked.shell.cap && Lab.plateOn(corked) === hotPlate);
Lab.setPlate(hotPlate, 873.15);
let popped = -1;
for (let k = 0; k < 2000 && popped < 0; k++) { run(1); if (!corked.stopper) popped = k; }
check("steam builds up under the stopper until it pops", popped > 0 && corked.popped && Sim.log.some(l => /stopper pops/.test(l.msg)), popped < 0 ? "never popped, gas share " + (corked.gas || 0).toFixed(2) : "after " + popped + " ticks");
check("a popped stopper leaves no cells behind", !corked.shell || !corked.shell.cap);
// The same, open, never collects enough gas to matter.
fresh();
const open = Lab.spawnBeaker(32.5, 1, 32.5);
Lab.fill(open, WATER, P_LIQUID, 200);
run(40);
Lab.setStopper(open, true);
check("putting a stopper in a set-down container seals it at once", !!open.shell.cap && open.shell.cap.length > 40);
Lab.setStopper(open, false);
check("taking it out removes the seal", !open.shell.cap && Vessels.countInGrid(Sim, WALL) === Sim.W * Sim.D * 2 + (Sim.W + Sim.D) * 2 * (Sim.H - 2) - 4 * (Sim.H - 2) + open.shell.wall.length);

// 4. A power supply's rods stand in a beaker of water. Switched on above 1.23 V they split it into hydrogen and oxygen; off, or below, nothing.
fresh();
const cell = beakerOfWater(32.5, 32.5, 600, { type: "flask" });
const psu = Lab.spawnSupply(32.5, 30, 32.5);
run(30);
check("the supply's rods rest on the beaker floor", !!psu.stamp && psu.stamp.by === cell.shell.by + 1, psu.stamp ? "rods from y " + psu.stamp.by : "not set down");
check("its rods are electrode cells", psu.stamp.rods.every(rod => rod.length >= 10 && rod.every(i => Sim.ID[i] === ELECTRODE)), psu.stamp.rods.map(r => r.length).join(", "));
const wet = Lab.wetRods(psu);
check("both rods stand in the water", wet[0] > 3 && wet[1] > 3, wet.join(", "));
const waterBefore = count(WATER);
check("pushing the rods in spilled no water", waterOutside(cell) === 0 && waterBefore >= 596, waterBefore + " cells, " + waterOutside(cell) + " outside");
run(600);
check("switched off, nothing happens", gasCells(H2) === 0 && gasCells(O2) === 0, gasCells(H2) + " H₂");
Lab.setSupply(psu, true, 1);
run(600);
check("below 1.23 V, nothing happens", gasCells(H2) === 0, gasCells(H2) + " H₂");
Lab.setSupply(psu, true, 12);
run(900);
const h12 = gasCells(H2) + gasCells(O2);
check("at 12 V the water splits into hydrogen and oxygen", gasCells(H2) > 0 && gasCells(O2) > 0, gasCells(H2) + " H₂, " + gasCells(O2) + " O₂");
check("a higher voltage pulses faster", Lab.pulseEvery(psu) < Lab.pulseEvery({ volts: 6 }) && Lab.pulseEvery({ volts: 6 }) === 6);
Lab.setSupply(psu, false);
const loose = Sim.ID.reduce((n, id, i) => n + (id === ELECTRODE && !psu.stamp.cells.includes(i) ? 1 : 0), 0);
check("switching off leaves no stray electrodes", loose === 0);
// Saving keeps the supply, its rods and its settings, and a file that says otherwise is refused.
const saved = JSON.parse(JSON.stringify(Lab.serialize()));
check("the save check accepts it", Lab.check(saved, Sim.ID.length, Mat.count()));
Lab.deserialize(saved);
const back = Lab.tools.filter(o => o.kind === "supply")[0];
check("a save keeps the supply, its rods and its settings", back && back.stamp && back.stamp.cells.length === psu.stamp.cells.length && back.volts === 12 && back.on === false);
const bad = JSON.parse(JSON.stringify(saved)); bad.tools[0].volts = 1e9;
check("a file with an impossible voltage is refused", !Lab.check(bad, Sim.ID.length, Mat.count()));
const bad2 = JSON.parse(JSON.stringify(saved)); bad2.tools[0].kind = "laser";
check("a file with an unknown tool is refused", !Lab.check(bad2, Sim.ID.length, Mat.count()));
const old = JSON.parse(JSON.stringify(saved)); delete old.tools;
check("a file from before hand tools still loads", Lab.check(old, Sim.ID.length, Mat.count()));
// Lifting the beaker out from under the rods lets them fall. The save above replaced every object, so find the beaker again.
const cell2 = Vessels.list[0];
Lab.grab(cell2);
run(1);
check("lifting the beaker frees the rods", !back.stamp && !Sim.ID.some(id => id === ELECTRODE));
Lab.release(cell2);

// 5. Solutions keep their strength. A bottle of 1 M hydrochloric acid set down, picked up and poured into a beaker is still 1 M there.
fresh();
const P_POWDER = vm.runInContext("P_POWDER", ctx);
const HCL = Mat.byFormula.HCl, want = Lab.reagent("hcl").sol.used;
const bottle = Lab.spawnBottle(20.5, 1, 32.5, "hcl");
check("a reagent bottle comes filled and named", bottle.type === "bottle" && /Hydrochloric acid, 1 M/.test(bottle.name) && Vessels.amount(bottle) === Math.round(Vessels.capacity(bottle) * 0.9));
run(20);
const strength = cells => { let n = 0, u = 0; cells.forEach(i => { if (Sim.ID[i] === WATER && Sim.AUX[i] === HCL) { n++; u += Sim.USED[i]; } }); return n ? u / n : -1; };
check("set down, its acid is 1 M in the grid", Math.abs(strength(bottle.shell.inside) - want) < 1e-6, "USED " + strength(bottle.shell.inside).toFixed(4) + ", want " + want.toFixed(4));
const catcher = beakerOfWater(40.5, 32.5, 0);
Lab.grab(bottle); Lab.move(bottle, 40.5 - 6, 18, 32.5); Lab.tilt(bottle, 2.2);
for (let k = 0; k < 200; k++) run(1);
Lab.tilt(bottle, 0); Lab.release(bottle);
run(30);
const poured = strength(catcher.shell.inside);
check("poured into a beaker it is still 1 M", Math.abs(poured - want) < 0.002, "USED " + poured.toFixed(4));
const dish = Lab.spawnBeaker(10.5, 1, 10.5, { type: "dish" });
check("an evaporating dish is wide and shallow", dish.radius === 6 && dish.height === 3 && /Evaporating dish/.test(dish.name));
check("every reagent on the shelf exists", Lab.REAGENTS.every(r => Lab.reagent(r.key)), Lab.REAGENTS.filter(r => !Lab.reagent(r.key)).map(r => r.key).join(", "));

// 6. A stirrer swirls a container's contents and lifts grains off its floor, without making or losing anything.
const CU = 29;
function grainsUp(stir) {
  fresh();
  const plate = stir ? Lab.spawnStirrer(32.5, 1, 32.5, { stir: 3 }) : Lab.spawnPlate(32.5, 1, 32.5);
  run(10);
  const b = Lab.spawnBeaker(32.5, 4, 32.5);
  Lab.fill(b, CU, P_POWDER, 30); run(30);
  Lab.fill(b, WATER, P_LIQUID, 300); run(5);
  const before = [count(CU), count(WATER)];
  let lifted = 0;
  for (let k = 0; k < 60; k++) { run(1); b.shell.inside.forEach(i => { if (Sim.ID[i] === CU && ((i / (Sim.W * Sim.D)) | 0) > b.shell.by + 2) lifted++; }); }
  return { lifted, kept: count(CU) === before[0] && count(WATER) >= before[1] - 3, on: Lab.plateOn(b) === plate };
}
const still = grainsUp(false), stirred = grainsUp(true);
check("a stirred container keeps its grains in suspension", stirred.on && stirred.lifted > still.lifted * 3 + 20, "lifted " + stirred.lifted + " stirred, " + still.lifted + " still");
check("stirring conserves what is in the container", stirred.kept);

// 7. A funnel in a beaker's mouth rests on the rim. Through filter paper, water runs through and chalk stays behind; without paper both pass.
const CHALK = Mat.byFormula.CaCO3;
// Put cells straight into a funnel's cone, from the top layer down, so none miss it.
function pourInto(fn, mat, form, n) {
  for (let dy = fn.len; dy > fn.stem && n > 0; dy--) for (let dz = -4; dz <= 4 && n > 0; dz++) for (let dx = -4; dx <= 4 && n > 0; dx++) {
    if (Math.hypot(dx, dz) > Lab.funnelRadius(fn, dy) - 0.5) continue;
    const x = Math.floor(fn.x) + dx, y = Math.floor(fn.y) + dy, z = Math.floor(fn.z) + dz;
    if (Sim.ID[Sim.idx(x, y, z)] !== AIR) continue;
    Sim.place(x, y, z, mat, form); n--;
  }
  if (n) throw new Error("the funnel had no room for " + n + " cells");
}
function filter(paper) {
  fresh();
  const b = beakerOfWater(32.5, 32.5, 0);
  const fn = Lab.spawnFunnel(32.5, 30, 32.5, { filter: paper });
  run(30);
  const rest = fn.y;
  pourInto(fn, CHALK, P_POWDER, 15);
  pourInto(fn, WATER, P_LIQUID, 40);
  run(300);
  const inBeaker = m => b.shell.inside.reduce((n, i) => n + (Sim.ID[i] === m ? 1 : 0), 0);
  return { rest, by: b.shell.by, h: b.shell.h, water: inBeaker(WATER), chalk: inBeaker(CHALK), left: fn.contents.reduce((n, c) => n + (c.mat === CHALK ? c.n : 0), 0), fn };
}
const paper = filter(true), bare = filter(false);
check("a funnel rests in the beaker's mouth with its stem inside", paper.rest > paper.by + 1 && paper.rest < paper.by + paper.h, "tip y " + paper.rest + ", beaker floor " + paper.by);
check("through filter paper the water runs into the beaker", paper.water >= 35, paper.water + " of 40");
check("and the chalk stays in the paper", paper.chalk === 0 && paper.left === 15, paper.left + " in the funnel, " + paper.chalk + " in the beaker");
check("without paper the chalk goes through too", bare.chalk >= 13 && bare.water >= 35, bare.chalk + " chalk, " + bare.water + " water");

// 8. A gas syringe on a stoppered container draws off the gas, so the stopper stays in, and gives it back when pushed in.
fresh();
const gasJar = beakerOfWater(32.5, 32.5, 100);
const syr = Lab.spawnSyringe(46.5, 5, 32.5);
Lab.connect(syr, gasJar);
check("connecting a syringe stoppers the container", gasJar.stopper && !!gasJar.shell.cap);
const top = gasJar.shell.by + gasJar.shell.h;
let put = 0;
gasJar.shell.inside.forEach(i => { const y = (i / (Sim.W * Sim.D)) | 0; if (y >= top - 3 && Sim.ID[i] === AIR && put < 60) { const r = i - y * Sim.W * Sim.D, z = (r / Sim.W) | 0; Sim.place(r - z * Sim.W, y, z, H2, P_GAS); put++; } });
const h2Before = count(H2);
run(60);
check("the syringe draws the hydrogen out of the container", Lab.amountIn(syr) >= put - 2 && gasCells(H2) <= 2, Lab.amountIn(syr) + " in the syringe, " + gasCells(H2) + " left");
check("so the stopper stays in", gasJar.stopper && !gasJar.popped);
check("no hydrogen is made or lost", count(H2) === h2Before, count(H2) + " of " + h2Before);
const saved2 = JSON.parse(JSON.stringify(Lab.serialize()));
Lab.connect(syr, null);
Lab.ventSyringe(syr);
run(40);
check("pushed in, the syringe lets its gas out", Lab.amountIn(syr) === 0 && gasCells(H2) > 0 && count(H2) === h2Before, gasCells(H2) + " hydrogen cells out, " + count(H2) + " of " + h2Before);
check("the save check accepts a syringe, funnel and stirrer", Lab.check(saved2, Sim.ID.length, Mat.count()) && Lab.check(JSON.parse(JSON.stringify((() => { fresh(); Lab.spawnFunnel(10, 5, 10); Lab.spawnStirrer(30.5, 1, 30.5); return Lab.serialize(); })())), Sim.ID.length, Mat.count()));

// 9. A balance weighs what stands on it, and its tare zeroes it with an empty beaker on it.
fresh();
const bal = Lab.spawnBalance(32.5, 1, 32.5);
run(10);
check("a balance rests and reads nothing when empty", !!bal.stamp && Math.abs(Lab.weigh(bal)) < 1e-6);
const onBal = Lab.spawnBeaker(32.5, bal.stamp.top + 2, 32.5);
run(30);
check("a beaker stands on the balance", !!onBal.shell && onBal.shell.by === bal.stamp.top);
const glass = Lab.weigh(bal);
check("the empty beaker weighs its glass", glass > 100 && Math.abs(glass - 2.5 * onBal.shell.wall.length) < 60, glass.toFixed(1) + " g for " + onBal.shell.wall.length + " glass cells");
Lab.tare(bal);
Lab.fill(onBal, WATER, P_LIQUID, 100);
run(5);
const net = Lab.weigh(bal);
check("tared, 100 cells of water weigh about 100 g", Math.abs(net - 100) < 4, net.toFixed(1) + " g");

// 10. Tongs grip a sample and hold it where they are let go, fixed in place, even in mid air. Picked up, it comes with them.
fresh();
const MG = 12;
Lab.placeMaterial(MG, 20.5, 1, 20.5, 10, P_POWDER);
run(20);
const tongs = Lab.spawnTool("tongs", 20.5, 3, 20.5);
const gripped = Lab.grip(tongs);
check("tongs grip up to six cells of a solid", gripped === 6, gripped + " cells");
Lab.grab(tongs); Lab.move(tongs, 32.5, 20, 32.5); Lab.release(tongs);
run(30);
check("let go, they stay in their clamp", Math.abs(tongs.y - 20) < 1e-6);
check("and hold the sample at their tip as fixed solid", tongs.hold.length === 6 && tongs.hold.every(i => Sim.ID[i] === MG && Sim.PH[i] === vm.runInContext("P_STATIC", ctx)), tongs.hold.length + " held");
Lab.grab(tongs);
check("picked up, the sample comes with them", tongs.hold.length === 0 && Lab.amountIn(tongs) === 6 && Vessels.countInGrid(Sim, MG) === 4);
Lab.letGo(tongs);
check("opened, they drop it", Lab.amountIn(tongs) === 0 && Vessels.countInGrid(Sim, MG) === 10);
// Held in a gas burner's flame, magnesium burns.
fresh();
const burner2 = Lab.spawnBurner(32.5, 1, 32.5);
run(10);
Lab.placeMaterial(MG, 10.5, 1, 10.5, 6, P_POWDER); run(10);
const t2 = Lab.spawnTool("tongs", 10.5, 2, 10.5);
Lab.grip(t2); Lab.grab(t2); Lab.move(t2, 32.5, burner2.stamp.top + 3, 32.5); Lab.release(t2);
let mgLeft = 6;
for (let k = 0; k < 600 && mgLeft > 0; k++) { run(1); mgLeft = Vessels.countInGrid(Sim, MG) + Lab.countInTools(MG); }
check("magnesium held in a burner flame burns away", mgLeft < 6, mgLeft + " of 6 cells left");

// 11. A spark igniter lights hydrogen; left alone, the same hydrogen does not burn.
function hydrogenAfter(spark) {
  fresh();
  for (let y = 10; y < 15; y++) for (let z = 30; z < 35; z++) for (let x = 30; x < 35; x++) Sim.place(x, y, z, H2, P_GAS);
  const ig = Lab.spawnTool("igniter", 35.5, 12, 32.5);   // at the edge of the hydrogen, where it meets the air
  if (spark) Lab.spark(ig);
  run(40);
  return Vessels.countInGrid(Sim, H2);
}
const h2Still = hydrogenAfter(false), h2Lit = hydrogenAfter(true);
check("a spark lights hydrogen", h2Lit < h2Still - 20, h2Lit + " hydrogen cells left after a spark, " + h2Still + " without");

// 12. A Geiger counter counts radiation passing its window, and nothing without a source.
fresh();
const gm = Lab.spawnTool("geiger", 32.5, 10, 32.5);
run(40);
check("with no source it counts nothing", gm.total === 0);
const PT_GAMMA = vm.runInContext("PT_GAMMA", ctx), PT_ALPHA = vm.runInContext("PT_ALPHA", ctx);
// Fire 30 gamma rays and 30 alpha particles sideways through the window from a few cells away. Each must count once, however long it is inside.
for (let k = 0; k < 60; k++) { const q = Sim.spawnP(k < 30 ? PT_GAMMA : PT_ALPHA, 28.5, 11.5 + (k % 3) * 0.5, 32.5, 0, 0, 40); Sim.pvx[q] = 0.7; Sim.pvy[q] = 0; Sim.pvz[q] = 0; }
run(15);
check("radiation through its window is counted once per particle", gm.total === 60 && gm.byType.gamma === 30 && gm.byType.alpha === 30 && Lab.rate(gm) > 0, gm.total + " counts (" + gm.byType.gamma + " gamma, " + gm.byType.alpha + " alpha), " + Lab.rate(gm).toFixed(0) + " per second");

// 13. A bell jar over a beaker of water seals to the bench. Pumped out, the water boils at room temperature; letting air in stops it.
function jarWater(pump) {
  fresh();
  const b = beakerOfWater(32.5, 32.5, 200);
  const jar = Lab.spawnTool("jar", 32.5, 30, 32.5);
  run(30);
  if (pump) Lab.setPump(jar, true);
  run(400);
  const T = Vessels.contentsNow(b, Sim).filter(c => c.mat === WATER && c.form === P_LIQUID).reduce((a, c) => [a[0] + c.T * c.n, a[1] + c.n], [0, 0]);
  return { jar, b, water: Vessels.amountNow(b, Sim), region: Sim.region, waterAll: count(WATER), T: T[0] / T[1] };
}
const airJar = jarWater(false), vacJar = jarWater(true);
check("a bell jar comes down over the beaker and seals to the bench", !!vacJar.jar.stamp && vacJar.jar.stamp.by === 1 && vacJar.jar.stamp.leak === 0, vacJar.jar.stamp ? "leak " + vacJar.jar.stamp.leak : "not set down");
check("its pump brings the pressure down", vacJar.jar.kPa < 2, vacJar.jar.kPa.toFixed(2) + " kPa");
check("the simulation knows the jar's low pressure", !!vacJar.region && Math.abs(vacJar.region.kPa - vacJar.jar.kPa) < 1e-9 && Sim.inRegion(Sim.idx(32, 3, 32)) && !Sim.inRegion(Sim.idx(5, 3, 5)));
// Water at room temperature boils at about 2.3 kPa. It cools itself to its boiling point at the jar's pressure, below freezing, as real
// water in a vacuum does, and evaporates far faster than at room pressure.
check("pumped out, room-temperature water boils and chills itself below 0 °C", vacJar.T < 273.15 && airJar.T > 285, (vacJar.T - 273.15).toFixed(1) + " °C pumped, " + (airJar.T - 273.15).toFixed(1) + " °C at room pressure");
check("and evaporates far faster", vacJar.water < airJar.water - 8, vacJar.water + " cells left pumped, " + airJar.water + " at room pressure");
check("the pumped-out vapour is let go beside the jar, not lost", vacJar.waterAll + Object.values(vacJar.jar.vap).reduce((a, v) => a + v, 0) >= 190, vacJar.waterAll + " of 200 water cells in the chamber");
Lab.letAirIn(vacJar.jar);
run(1);
check("letting air in ends the low pressure", Sim.region === null && vacJar.jar.kPa === Lab.ROOM_KPA);
const savedJar = JSON.parse(JSON.stringify(Lab.serialize()));
check("the save check accepts a jar", Lab.check(savedJar, Sim.ID.length, Mat.count()));
Lab.grab(vacJar.jar);
check("lifting the jar takes its glass away", !vacJar.jar.stamp && !Sim.ID.some((id, i) => id === WALL && vacJar.jar && Lab.inJar(vacJar.jar, i)));

// 14. Distillation: brine boils in a stoppered flask on a hot plate, and a condenser carries pure water over into a beaker under its outlet.
fresh();
const NACL = Mat.byFormula.NaCl;
const hotp = Lab.spawnPlate(20.5, 1, 32.5);
run(10);
const flask = Lab.spawnBeaker(20.5, hotp.stamp.top, 32.5);
const brine = Lab.reagent("nacl");
Lab.fill(flask, brine.mat, P_LIQUID, 250, 293.15, brine.sol);
run(20);
const recv = beakerOfWater(44.5, 32.5, 0);
const cond = Lab.spawnTool("condenser", 44.5, 18, 32.5);
Lab.connect(cond, flask);
check("connecting a condenser stoppers the flask", flask.stopper && !!flask.shell.cap);
Lab.setPlate(hotp, 573.15);
for (let k = 0; k < 2500 && Vessels.amountNow(recv, Sim) < 30; k++) run(1);
let fresh2 = 0, salty = 0;
recv.shell.inside.forEach(i => { if (Sim.ID[i] === WATER) { if (Sim.AUX[i]) salty++; else fresh2++; } });
check("water comes over into the receiver", fresh2 >= 20, fresh2 + " cells of water, made " + cond.made);
check("and it is pure: the salt stays behind", salty === 0, salty + " salty cells");
check("so the flask's stopper never pops", flask.stopper && !flask.popped);
check("the save check accepts tongs, an igniter, a Geiger counter, a balance and a condenser", Lab.check(JSON.parse(JSON.stringify((() => { Lab.spawnTool("tongs", 5, 5, 5); Lab.spawnTool("igniter", 8, 5, 8); Lab.spawnTool("geiger", 11, 5, 11); Lab.spawnBalance(50.5, 1, 50.5); return Lab.serialize(); })())), Sim.ID.length, Mat.count()));

console.log(failed ? failed + " failed" : "all equipment tests passed");
process.exit(failed ? 1 : 0);
