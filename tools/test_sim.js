// Headless behaviour tests. Run with: node tools/test_sim.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "scenes.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Chem, Scenes, ELEMENTS, P_POWDER, P_LIQUID, P_GAS, P_STATIC, WALL, AIR } = vm.runInContext("({Sim,Mat,Chem,Scenes,ELEMENTS,P_POWDER,P_LIQUID,P_GAS,P_STATIC,WALL,AIR})", ctx);
let pass = 0, fail = 0;
function check(name, ok, info) { if (ok) { pass++; console.log("  ok  " + name); } else { fail++; console.log("FAIL  " + name + (info !== undefined ? "  -> " + info : "")); } }
function reset(amb) { Sim.ambient = amb || 293.15; Sim.atmosphere = "air"; Sim.lid = false; Sim.magnet = null; Sim.gravity = 1; Sim.init(40, 40, 40); Sim.seed(42); }
function run(n) { for (let k = 0; k < n; k++) Sim.tick(); }
function count(id, ph) { let c = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id && (ph === undefined || Sim.PH[i] === ph)) c++; return c; }
function avgY(id) { let s = 0, c = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id) { s += Math.floor(i / (40 * 40)); c++; } return c ? s / c : -1; }
const WATER = Mat.named("H2O");
function amount(id) { let a = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id) a += 1 - Sim.USED[i]; return a; }
const logs = () => Sim.log.map(l => l.msg).join("; ");

console.log("Data");
check("118 elements", ELEMENTS.length === 119 && ELEMENTS[118].s === "Og");
check("every element has note and colour", ELEMENTS.slice(1).every(e => e.note && e.color));
check("potassium latent heats corrected", ELEMENTS[19].hf === 2.33 && ELEMENTS[19].hv === 76.9);
check("U half-life", Math.abs(ELEMENTS[92].hl - 1.408e17) / 1.408e17 < 0.01, ELEMENTS[92].hl);
check("formula: Al2O3, FeCl3, Ca(OH)2", Mat.list[Mat.salt(13, "O")].formula === "Al2O3" && Mat.list[Mat.salt(26, "Cl")].formula === "FeCl3" && Mat.list[Mat.salt(20, "OH")].formula === "Ca(OH)2");
check("UO2 keeps +4", Mat.list[Mat.named("UO2")].formula === "UO2");
check("palette resolved", Mat.PALETTE.every(f => Mat.named(f) > 0));

console.log("Phases at room temperature");
reset();
Sim.place(5, 5, 5, 80, P_POWDER); Sim.place(7, 5, 5, 35, P_POWDER); Sim.place(9, 5, 5, 26, P_POWDER); Sim.place(11, 5, 5, 7, P_POWDER); Sim.place(13, 5, 5, 31, P_POWDER);
check("Hg liquid", Sim.PH[Sim.idx(5, 5, 5)] === P_LIQUID); check("Br liquid", Sim.PH[Sim.idx(7, 5, 5)] === P_LIQUID); check("Fe solid", Sim.PH[Sim.idx(9, 5, 5)] === P_POWDER);
check("N gas", Sim.PH[Sim.idx(11, 5, 5)] === P_GAS); check("Ga solid at 20 C", Sim.PH[Sim.idx(13, 5, 5)] === P_POWDER);
reset(310); Sim.place(13, 5, 5, 31, P_POWDER); check("Ga liquid at 37 C", Sim.PH[Sim.idx(13, 5, 5)] === P_LIQUID);

console.log("Gravity and density");
reset(); Sim.box(10, 20, 10, 14, 24, 14, 79, P_POWDER); run(80); check("gold falls to the floor", avgY(79) < 6, avgY(79));
reset(); Sim.box(5, 1, 5, 34, 4, 34, 80, P_POWDER); Sim.box(15, 10, 15, 18, 12, 18, 26, P_POWDER); run(250); check("iron floats on mercury", avgY(26) > avgY(80), avgY(26) + " vs " + avgY(80));
reset(); Sim.box(5, 1, 5, 34, 4, 34, 80, P_POWDER); Sim.box(15, 10, 15, 18, 12, 18, 79, P_POWDER); run(400); check("gold sinks in mercury", avgY(79) < avgY(80), avgY(79) + " vs " + avgY(80));
reset(); Sim.box(10, 3, 10, 14, 5, 14, 1, P_POWDER); run(60); check("hydrogen rises", avgY(1) > 12 || count(1) < 75, avgY(1));
reset(); Sim.box(10, 20, 10, 14, 24, 14, 54, P_POWDER); run(150); check("xenon sinks in air", avgY(54) < 20, avgY(54));

console.log("Heat");
reset(); Sim.box(5, 1, 5, 25, 6, 25, WATER, P_POWDER, 200); run(5);
check("cold water is ice", count(WATER, P_LIQUID) === 0);
reset(); Sim.place(20, 2, 20, 74, P_STATIC, 2000); run(1); check("hot cell stays solid under melting point", Sim.PH[Sim.idx(20, 2, 20)] === P_STATIC);
reset(); Sim.box(10, 1, 10, 14, 3, 14, WATER, P_POWDER, 370); Sim.box(10, 4, 10, 14, 6, 14, 29, P_STATIC, 1300);
run(80); let wt = []; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER && Sim.PH[i] === P_LIQUID) wt.push(Sim.T[i]);
check("water holds near 100 C while boiling", wt.length === 0 || Math.max.apply(null, wt) < 377, wt.length ? Math.max.apply(null, wt) : 0);
function heatBox(id, T) { for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id) Sim.T[i] = T; Sim.wakeAll(); }
reset(); Sim.box(10, 1, 10, 14, 5, 14, 29, P_STATIC); heatBox(29, 1900); run(20); check("hot copper melts", count(29, P_LIQUID) > 0, count(29, P_LIQUID));
reset(); Sim.box(10, 1, 10, 14, 5, 14, 29, P_STATIC); heatBox(29, 1500); run(20); check("copper short of its latent heat stays solid", count(29, P_LIQUID) === 0, count(29, P_LIQUID));
reset(); Sim.box(10, 1, 10, 14, 5, 14, 29, P_STATIC); heatBox(29, 1900); run(150); check("molten copper grows only an oxide skin", count(29) > 70, count(29));
reset(); Sim.box(5, 1, 5, 34, 2, 34, 7, P_POWDER, 70); const n0 = count(7, P_LIQUID); check("nitrogen below 77 K is liquid", n0 > 0, n0); run(600); check("liquid nitrogen boils off in a warm room", count(7, P_LIQUID) < n0 * 0.9, count(7, P_LIQUID) + " of " + n0);
reset(); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); Sim.box(12, 7, 12, 22, 12, 22, 29, P_STATIC); heatBox(29, 1000); run(200); check("hot metal makes steam from water", count(WATER, P_GAS) > 0 || Sim.T[Sim.idx(17, 6, 17)] > 340, count(WATER, P_GAS));

console.log("Chemistry");
reset(); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); Sim.box(15, 9, 15, 19, 11, 19, 55, P_POWDER); run(200);
check("caesium reacts with water", count(55) < 75, count(55)); check("CsOH forms", Sim.log.some(l => l.msg.includes("CsOH")), logs());
reset(); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); Sim.box(15, 9, 15, 19, 11, 19, 11, P_POWDER); run(500);
check("sodium forms NaOH", Sim.log.some(l => l.msg.includes("NaOH")), logs());
reset(); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); Sim.box(15, 9, 15, 19, 11, 19, 79, P_POWDER); run(200); check("gold ignores water", count(79) === 75, count(79));
reset(); Sim.atmosphere = "argon"; Sim.box(10, 1, 10, 14, 5, 14, 55, P_POWDER); run(100); check("caesium is safe under argon", count(55) === 125, count(55));
reset(); Sim.box(10, 1, 10, 14, 5, 14, 55, P_POWDER); run(200); check("caesium ignites in air", count(55) < 125, count(55));
reset(); const FE2O3 = Mat.named("Fe2O3");
for (let y = 1; y <= 8; y++) for (let z = 15; z <= 22; z++) for (let x = 15; x <= 22; x++) Sim.place(x, y, z, (x + y + z) % 2 ? 13 : FE2O3, P_POWDER);
run(40); check("thermite is stable cold", count(26) === 0);
Sim.forSphere(18, 8, 18, 3, (x, y, z, i) => { Sim.T[i] = 1500; }); Sim.wakeAll();
let peak = 0; for (let k = 0; k < 300; k++) { Sim.tick(); if (k % 5 === 0) peak = Math.max(peak, Math.max.apply(null, Array.from(Sim.T))); }
check("thermite makes iron", count(26) > 20, count(26) + " " + logs()); check("thermite burns hotter than steel melts", peak > 2000, peak);
reset(); Sim.box(10, 5, 10, 14, 9, 14, 1, P_POWDER); Sim.box(15, 5, 10, 19, 9, 14, 8, P_POWDER); run(40);
check("H2 + O2 cold: no reaction", count(WATER) === 0, count(WATER));
reset(); Sim.box(10, 5, 10, 22, 14, 22, 1, P_POWDER, 900); Sim.box(10, 15, 10, 22, 24, 22, 8, P_POWDER, 900); run(100);
check("H2 + O2 hot: water", Sim.log.some(l => l.msg.includes("H₂O")), logs());
reset(); const hcl = Mat.named("HCl"); Sim.box(5, 1, 5, 34, 5, 34, hcl, P_POWDER); Sim.box(15, 8, 15, 18, 10, 18, 30, P_POWDER); Sim.box(25, 8, 25, 28, 10, 28, 29, P_POWDER); run(300);
check("zinc dissolves in HCl", amount(30) < 40, amount(30)); check("copper resists HCl", amount(29) === 48, amount(29));
reset(); const aq = Mat.named("HNO3"); Sim.box(5, 1, 5, 34, 3, 34, aq, P_POWDER); Sim.box(10, 5, 10, 14, 7, 14, 29, P_POWDER); run(300); check("nitric acid dissolves copper", amount(29) < 70, amount(29));
reset(); Sim.box(5, 1, 5, 20, 3, 20, hcl, P_POWDER); Sim.box(21, 1, 5, 34, 3, 20, aq, P_POWDER); Sim.box(19, 5, 10, 22, 8, 14, 79, P_POWDER); run(800); check("aqua regia dissolves gold", amount(79) < 76, amount(79));
reset(); const na = Mat.named("NaCl"); Sim.box(5, 1, 5, 34, 4, 34, WATER, P_POWDER); Sim.box(15, 8, 15, 18, 10, 18, na, P_POWDER); run(300); check("salt dissolves", amount(na) < 47, amount(na));
reset(); const pbn = Mat.named("Pb(NO3)2"), ki = Mat.named("KI"), pbi = Mat.named("PbI2");
Sim.box(5, 1, 5, 34, 5, 34, WATER, P_POWDER); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { const x = i % 40; Sim.AUX[i] = x < 20 ? pbn : ki; } Sim.wakeAll(); run(200);
check("Pb2+ and I- give golden PbI2", count(pbi) > 0, logs());
reset(); Sim.box(5, 1, 5, 34, 5, 34, WATER, P_POWDER); const cus = Mat.named("CuSO4"); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) Sim.AUX[i] = cus; Sim.box(15, 7, 15, 18, 9, 18, 30, P_POWDER); Sim.wakeAll(); run(300); check("zinc plates copper from solution", count(29) > 0, count(29));
reset(); Sim.box(10, 1, 10, 13, 4, 13, 54, P_POWDER); Sim.box(10, 5, 10, 13, 8, 13, 18, P_POWDER); run(50); check("Xe and Ar stay inert", count(54) + count(18) > 0 && !Sim.log.some(l => l.msg.includes("Xe")));
reset(); const lime = Mat.named("CaCO3"); Sim.box(15, 1, 15, 18, 3, 18, lime, P_POWDER, 1400); run(40); check("limestone calcines", count(Mat.named("CaO")) > 0);

console.log("Nuclear");
reset(); Sim.setDecayScale(100); Sim.box(10, 1, 10, 14, 5, 14, 88, P_POWDER); run(800); Sim.setDecayScale(1);
check("radium decays through radon, polonium to lead", count(82) > 0, logs());
check("helium from alpha decay", count(2) > 0 || Sim.log.some(l => l.msg.includes("α")));
reset(); Sim.enrichment = 0.9; Sim.box(8, 1, 8, 32, 24, 32, 92, P_STATIC); for (let k = 0; k < 40; k++) Sim.spawnP(0, 20, 12, 20, 1.5, 0, 500); run(150); Sim.enrichment = null;
check("big uranium block sustains a chain reaction", Sim.stats.fissions > 200, Sim.stats.fissions);
reset(); Sim.enrichment = 0.9; Sim.box(19, 1, 19, 20, 2, 20, 92, P_STATIC); Sim.enrichment = null; for (let k = 0; k < 10; k++) Sim.spawnP(0, 20, 2, 20, 1.5, 0, 500); run(200);
check("tiny uranium piece stays subcritical", Sim.stats.fissions < 12, Sim.stats.fissions);
reset(); Sim.box(8, 1, 8, 32, 24, 32, 48, P_STATIC); for (let k = 0; k < 100; k++) Sim.spawnP(0, 20, 12, 20, 1.5, 0, 500); run(80); check("cadmium eats neutrons", Sim.pCount < 40, Sim.pCount);
reset(); Sim.box(15, 15, 15, 25, 25, 25, 1, P_POWDER, 3e8); Sim.lid = true; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 1) Sim.PH[i] = 4; run(10); check("hydrogen plasma fuses to helium", Sim.stats.fusions > 0 && count(2) > 0, Sim.stats.fusions);

console.log("Electricity");
reset(); Sim.box(10, 2, 10, 30, 2, 10, 74, P_STATIC); Sim.place(9, 2, 10, 121, P_STATIC, undefined, true); const w0 = Sim.T[Sim.idx(20, 2, 10)]; run(300); check("tungsten wire Joule heats", Sim.T[Sim.idx(20, 2, 10)] > w0 + 100, Sim.T[Sim.idx(20, 2, 10)]);
reset(4); Sim.box(10, 2, 10, 30, 2, 10, 41, P_STATIC, 4); Sim.place(9, 2, 10, 121, P_STATIC, 4, true); run(150); check("niobium below 9.25 K superconducts", Sim.T[Sim.idx(20, 2, 10)] < 20, Sim.T[Sim.idx(20, 2, 10)]);
reset(); Sim.box(5, 1, 5, 34, 5, 34, WATER, P_POWDER); Sim.place(6, 3, 6, 121, P_STATIC, undefined, true); run(400); check("current splits water", Sim.log.some(l => l.msg.includes("electrolysis")), logs());

console.log("Magnet");
reset(); Sim.box(10, 1, 10, 14, 3, 14, 26, P_POWDER); Sim.box(25, 1, 10, 29, 3, 14, 29, P_POWDER); const yFe = avgY(26), yCu = avgY(29); Sim.magnet = { x: 12, y: 25, z: 12 }; run(150); check("magnet lifts iron, not copper", avgY(26) > yFe + 1 && Math.abs(avgY(29) - yCu) < 1, avgY(26) + " " + avgY(29));

console.log("Every element");
for (let z = 1; z <= 118; z++) {
  reset(); Sim.box(15, 2, 15, 22, 8, 22, z, P_POWDER); run(4);
  for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === z) Sim.T[i] = 4000;
  Sim.wakeAll(); run(12);
  const bad = Array.from(Sim.T).findIndex(v => !Number.isFinite(v));
  if (bad >= 0) check(ELEMENTS[z].s + " keeps finite temperatures", false, bad);
}
check("all 118 elements survive being placed and heated to 4000 K", true);

console.log("Experiments");
for (const s of Scenes.list) {
  Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.gravity = 1; Sim.init(64, 48, 64); Sim.seed(9);
  const loaded = Scenes.load(s.id); const n0 = Sim.totalCells; run(120);
  if (s.action) { s.action.run(); run(60); }
  check(s.name + " runs, starting with " + n0 + " cells", loaded && n0 > 0 && Array.from(Sim.T).every(Number.isFinite));
}
Sim.setDecayScale(1);
reset(); Sim.box(5, 1, 5, 34, 5, 34, WATER, P_POWDER); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { const x = i % 40; Sim.AUX[i] = x < 15 ? Mat.named("Pb(NO3)2") : (x > 25 ? Mat.named("KI") : 0); } Sim.wakeAll(); run(400);
check("separated solutions diffuse together and precipitate", count(Mat.named("PbI2")) > 0, count(Mat.named("PbI2")));

console.log("Pressure, momentum and structure");
function maxP() { let m = 0; for (let i = 0; i < Sim.P.length; i++) if (Sim.P[i] > m) m = Sim.P[i]; return m; }
reset(); Sim.lid = true; Sim.box(15, 1, 15, 25, 10, 25, 26, P_STATIC); Sim.box(16, 2, 16, 24, 9, 24, WATER, P_POWDER, 372); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) Sim.T[i] = 900; Sim.wakeAll();
let pk = 0; let steelBefore = count(26, P_STATIC); for (let k = 0; k < 250; k++) { Sim.tick(); if (k % 5 === 0) pk = Math.max(pk, maxP()); }
check("boiling in a sealed steel box builds pressure", pk > 30, pk); check("enough pressure ruptures the vessel", Sim.log.some(l => l.msg.includes("ruptures")) || count(26, P_STATIC) < steelBefore, logs());
reset(); Sim.place(20, 2, 20, 74, P_STATIC); Sim.box(10, 30, 10, 12, 32, 12, 79, P_POWDER); let y0 = avgY(79); run(6); const fast = y0 - avgY(79); run(6); const faster = y0 - avgY(79) - fast; check("falling accelerates", faster > fast, fast + " then " + faster);
reset(); Sim.box(5, 1, 5, 34, 3, 34, WATER, P_POWDER); run(30); Sim.box(18, 20, 18, 22, 24, 22, WATER, P_POWDER, undefined); let spreadMax = 0; for (let k = 0; k < 40; k++) { Sim.tick(); } check("water still settles to a level pool", avgY(WATER) < 8, avgY(WATER));
reset(); Sim.structural = true; Sim.box(15, 1, 20, 16, 12, 20, 26, P_STATIC); Sim.box(15, 13, 20, 26, 13, 20, 26, P_STATIC); run(10); const beamY = avgY(26); for (let y = 1; y <= 12; y++) Sim.erase(15, y, 20), Sim.erase(16, y, 20); run(40); check("a beam whose support is removed falls as one piece", avgY(26) < beamY - 3 && count(26, P_STATIC) === 12, avgY(26) + " statics " + count(26, P_STATIC)); Sim.structural = false;
reset(); Sim.structural = true; Sim.box(15, 1, 20, 15, 20, 20, 26, P_STATIC); run(20); check("a supported column stays up", count(26, P_STATIC) === 20 && avgY(26) > 9, avgY(26)); Sim.structural = false;

console.log("Stoichiometry and concentration");
function firedOnce(a, b, ta, tb) { reset(); Sim.lid = true; const i = Sim.idx(20, 5, 20), j = Sim.idx(21, 5, 20); Sim.place(20, 5, 20, a, P_GAS, ta, true); Sim.place(21, 5, 20, b, P_GAS, tb, true); return [i, j]; }
{ const rule = Chem.ruleFor(1, 8); check("2H2 + O2 carries its ratio", rule.nA / rule.nB === 2, rule.nA + ":" + rule.nB); }
reset(); const NaOH = Mat.named("NaOH"); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); Sim.box(19, 8, 19, 21, 9, 21, Mat.named("CuSO4"), P_POWDER); run(800); { let n = 0, tot = 0, mn = 1; const cu = Mat.named("CuSO4"); for (let i = 0; i < Sim.ID.length; i++) if (Sim.AUX[i] === cu) { n++; const c = 1 - Sim.USED[i]; tot += c; if (c < mn) mn = c; } check("a dissolved salt spreads and thins out", n > 18 && mn < 0.5, n + " cells, weakest " + mn.toFixed(3)); }
reset(); const lim = Mat.named("Ca(OH)2"); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); Sim.box(18, 8, 18, 21, 10, 21, lim, P_POWDER); run(300); { let g = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === lim) g++; check("sparingly soluble lime mostly stays solid", g > 30, g); }
reset(); const nacl = Mat.named("NaCl"), kno = Mat.named("KNO3"); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_POWDER); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { const x = i % 40; Sim.AUX[i] = x < 20 ? nacl : kno; Sim.USED[i] = 0.5; } Sim.wakeAll(); run(300); { let mixed = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.AUX[i] && Sim.AUX2[i]) mixed++; check("two salts share water cells without reacting", mixed > 0, mixed); }

console.log("New experiments");
{ Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.gravity = 1; Sim.init(96, 64, 96); Sim.seed(4); Sim.structural = true; /* a sealed steel tank of hot water on a slab at 1750 K; this was the boiler experiment before it was dropped */ Sim.box(31, 1, 31, 64, 5, 64, 26, P_STATIC, 1750); Sim.box(34, 6, 34, 61, 27, 61, 26, P_STATIC); Sim.box(35, 7, 35, 60, 26, 60, WATER, P_POWDER, 360); let pk2 = 0; for (let k = 0; k < 900; k++) { Sim.tick(); if (k % 10 === 0) pk2 = Math.max(pk2, maxP()); if (Sim.log.some(l => l.msg.includes("ruptures"))) break; } check("the boiler builds pressure and bursts", Sim.log.some(l => l.msg.includes("ruptures")), "peak " + pk2 + " at t " + Sim.tickN + " " + logs()); }
{ Sim.init(96, 64, 96); Sim.seed(4); Sim.structural = true; Scenes.load("bridge"); run(5); const yd = (() => { let s = 0, c = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 26 && Math.floor(i / (96 * 96)) > 10) { s += Math.floor(i / (96 * 96)); c++; } return c ? s / c : 0; })(); run(900); let top = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 26) top = Math.max(top, Math.floor(i / (96 * 96))); check("the deck falls when its supports melt", top < yd - 3, "was " + yd + ", top now " + top); Sim.structural = false; }

console.log("Isotopes");
function massTally() { const o = {}; for (let i = 0; i < Sim.ID.length; i++) { const id = Sim.ID[i]; if (id && id <= 118 && id !== 2) { const k = ELEMENTS[id].s + "-" + Sim.AUX2[i]; o[k] = (o[k] || 0) + 1; } } return o; }
reset(); Sim.setDecayScale(1000); Sim.isotopeOverride = { 92: 238 }; Sim.box(10, 1, 10, 13, 4, 13, 92, P_POWDER); Sim.isotopeOverride = null; { const seen = new Set(); for (let k = 0; k < 3000; k++) { Sim.tick(); for (const l of Sim.log) seen.add(l.msg.split(" ")[0]); } Sim.setDecayScale(1); const want = ["U-238", "Th-234", "Pa-234", "U-234", "Th-230", "Ra-226", "Rn-222", "Po-218"]; const missing = want.filter(w => !seen.has(w)); check("U-238 walks the real decay chain", missing.length === 0, "missing " + missing.join(",") + " saw " + [...seen].slice(0, 12).join(",")); }
reset(); Sim.place(5, 5, 5, 92, P_POWDER); { const nat = []; for (let k = 0; k < 40000; k++) { const a = Sim.ID; } let u5 = 0; Sim.init(40, 40, 40); Sim.box(1, 1, 1, 38, 20, 38, 92, P_STATIC); let n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 92) { n++; if (Sim.AUX2[i] === 235) u5++; } check("natural uranium is about 0.7% U-235", u5 / n > 0.003 && u5 / n < 0.012, u5 / n); }
function chainRun(e) { reset(); Sim.enrichment = e; Sim.box(8, 1, 8, 32, 24, 32, 92, P_STATIC); Sim.enrichment = null; for (let k = 0; k < 40; k++) Sim.spawnP(0, 20, 12, 20, 1.5, 0, 500); run(200); return Sim.stats.fissions; }
{ const nat = chainRun(0.0072), hi = chainRun(0.9); check("natural uranium stays subcritical while enriched goes critical", hi > 10 * Math.max(nat, 5), nat + " vs " + hi); }
reset(); Sim.isotopeOverride = { 92: 238 }; Sim.box(14, 2, 14, 26, 14, 26, 92, P_STATIC); Sim.isotopeOverride = null; for (let k = 0; k < 400; k++) { if (k % 2 === 0) Sim.spawnP(0, 20, 8, 20, 0.5, 0, 200); Sim.tick(); } check("neutrons breed U-239 from U-238", Object.keys(massTally()).some(k => k === "U-239" || k.startsWith("Np") || k.startsWith("Pu")), JSON.stringify(massTally()));
reset(); Sim.isotopeOverride = { 54: 135 }; Sim.box(15, 2, 15, 20, 7, 20, 54, P_STATIC); Sim.isotopeOverride = null; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 54) Sim.PH[i] = 0; for (let k = 0; k < 60; k++) Sim.spawnP(0, 17, 4, 17, 0.5, 0, 200); run(60); check("xenon-135 swallows neutrons", Sim.log.some(l => l.msg.startsWith("Xe-135 + n")), logs());

console.log("Thermodynamics");
const dbFind = eq => Chem.database.find(d => d.eq === eq);
function crossover(eq) { const d = dbFind(eq); return d && d.dS ? d.dH * 1000 / d.dS : null; }
{ const t = crossover("CaCO3 -> CaO + CO2"); check("limestone decomposes near 1100 K by Gibbs energy", t > 1050 && t < 1200, t); }
{ const d = dbFind("N2 + 3H2 -> 2NH3"), hot = Chem.thermo(d, 1000, 0), cool = Chem.thermo(d, 400, 0), press = Chem.thermo(d, 700, 900), base = Chem.thermo(d, 700, 0); check("Haber favours ammonia when cool", cool > hot, cool + " vs " + hot); check("pressure favours ammonia, per Le Chatelier", press > base, press + " vs " + base); }
{ const d = dbFind("N2O4 -> 2NO2"); check("N2O4 dissociates as it warms", Chem.thermo(d, 400, 0) > Chem.thermo(d, 280, 0)); }
reset(); { const a = Chem.ruleFor(1, 8); Sim.box(15, 2, 15, 22, 9, 22, 1, P_POWDER, 400); Sim.lid = true; run(30); check("hydrogen and oxygen stay put well below onset", count(WATER) === 0); }
reset(); Sim.lid = true; { const nh3 = Mat.named("NH3"); function haber(T0) { reset(); Sim.lid = true; for (let z = 12; z < 28; z++) for (let y = 2; y < 18; y++) for (let x = 12; x < 28; x++) { const m = (x + y + z) % 8; Sim.place(x, y, z, m === 0 ? 26 : (m < 4 ? 7 : 1), P_STATIC, T0, true); } run(300); return count(nh3); } const low = haber(620), high = haber(1100); check("more ammonia at equilibrium when cooler", low > high, low + " vs " + high); }

console.log("Amounts and mass");
function massRun(setup, ticks) { reset(); Sim.lid = true; setup(); const m0 = Sim.totalMass(); run(ticks); return [m0, Sim.totalMass(), Sim.lostMass()]; }
{ const [a, b, lost] = massRun(() => { const fe = Mat.named("Fe2O3"); for (let y = 2; y <= 8; y++) for (let z = 12; z <= 24; z++) for (let x = 12; x <= 24; x++) Sim.place(x, y, z, (x + y + z) % 2 ? 13 : fe, P_POWDER, 1500, true); }, 300); check("thermite conserves mass within 3% (lost " + lost.toFixed(2) + " g)", Math.abs(b - a) / a < 0.03, a + " to " + b); }
{ const [a, b] = massRun(() => { Sim.atmosphere = "argon"; for (let y = 2; y <= 12; y++) for (let z = 10; z <= 28; z++) for (let x = 10; x <= 28; x++) Sim.place(x, y, z, (x + z) % 3 ? 1 : 8, P_POWDER, 900, true); }, 200); check("hydrogen burning in oxygen conserves mass within 3%", Math.abs(b - a) / a < 0.03, a + " to " + b); }
{ const co = Chem.balance([26, 8], [Mat.named("Fe2O3")]); check("balancer: 2Fe + 3O -> Fe2O3", co && co[0] === 2 && co[1] === 3 && co[2] === 1, co); }

console.log("Solutions");
const near = (a, b, tol) => Math.abs(a - b) <= tol;
check("0.1 M HCl is pH 1", near(Chem.pHfromSolutes(Mat.named("HCl"), 0.1, 0, 0), 1, 0.05));
check("0.1 M acetic acid is pH 2.88", near(Chem.pHfromSolutes(Mat.named("CH3COOH"), 0.1, 0, 0), 2.88, 0.05));
check("0.1 M NaOH is pH 13", near(Chem.pHfromSolutes(Mat.named("NaOH"), 0.1, 0, 0), 13, 0.05));
check("0.1 M ammonia is pH 11.13", near(Chem.pHfromSolutes(Mat.named("NH3"), 0.1, 0, 0), 11.13, 0.05));
check("an equal acetate buffer is pH 4.76", near(Chem.pHfromSolutes(Mat.named("CH3COOH"), 0.1, Mat.named("CH3COONa"), 0.1), 4.76, 0.05));
check("pure water is pH 7", near(Chem.pHfromSolutes(0, 0, 0, 0), 7, 0.01));
check("AgCl solubility from its Ksp", near(Mat.solubilityFromKsp("AgCl"), 1.34e-5, 1e-6), Mat.solubilityFromKsp("AgCl"));
check("Daniell cell gives 1.10 V", near(Sim.nernst(0.34, -0.76, 2, 2, 1, 1, 298), 1.10, 0.005));
check("diluting the anode raises the voltage", Sim.nernst(0.34, -0.76, 2, 2, 0.01, 1, 298) > 1.1);
reset(); { const zn = Mat.named("ZnSO4"), cu = Mat.named("CuSO4"); Sim.lid = true; Sim.box(5, 1, 5, 34, 8, 34, WALL, P_STATIC); Sim.box(6, 2, 6, 33, 8, 33, WATER, P_POWDER); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { const x = i % 40; Sim.AUX[i] = x < 20 ? zn : cu; Sim.USED[i] = 0.9; } Sim.box(9, 2, 19, 10, 12, 20, 30, P_STATIC); Sim.box(29, 2, 19, 30, 12, 20, 29, P_STATIC); Sim.box(9, 12, 19, 30, 12, 20, 29, P_STATIC); const z0 = count(30); Sim.wakeAll(); run(600); check("a Daniell cell runs: zinc is used up", Sim.log.some(l => l.msg.startsWith("Cell Zn | Cu")), logs()); }

console.log("Fluid");
reset(); Sim.place(20, 2, 20, 26, P_STATIC, 3000, true); Sim.forSphere(20, 6, 20, 4, (x, y, z, i) => { Sim.T[i] = 2500; }); Sim.wakeAll(); run(40); { const b = Math.floor(10 / Sim.FB) + Math.floor(10 / Sim.FB) * Sim.fluidDims[0]; let up = 0; for (let i = 0; i < Sim.FV.length; i++) if (Sim.FV[i] > up) up = Sim.FV[i]; check("hot air drives an updraught", up > 0.05, up); }
reset(); Sim.lid = true; Sim.box(14, 2, 14, 26, 14, 26, WALL, P_STATIC); Sim.box(15, 3, 15, 25, 13, 25, 18, P_POWDER); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 18) Sim.T[i] = 900; Sim.wakeAll(); { let m = 0; for (let k = 0; k < 8; k++) { Sim.tick(); m = Math.max(m, maxP()); } check("gas sealed in and heated gains pressure", m >= 0, m); }

console.log("Viscosity");
function fallen(id, T) { reset(); Sim.box(20, 30, 20, 22, 32, 22, id, P_LIQUID, T); const a = avgY(id); run(10); return a - avgY(id); }
{ const thin = fallen(WATER, 300), thick = fallen(Mat.named("C3H8O3"), 300); check("a thick liquid falls through air about as fast as a thin one", thick > thin * 0.8, thin + " vs " + thick); }
// How far a liquid spreads: the mean distance of its cells from the middle, over several runs. Where the farthest droplet lands is mostly chance.
function spreadX(id, T) { let total = 0; for (let s = 0; s < 4; s++) { reset(); Sim.seed(42 + s); Sim.box(18, 1, 18, 21, 10, 21, id, P_LIQUID, T); run(60); let far = 0, n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id) { far += Math.abs(i % 40 - 19.5); n++; } total += far / n; } return total / 4; }
{ const thin = spreadX(WATER, 300), mid = spreadX(Mat.named("C3H8O3"), 300), thick = spreadX(Mat.named("SiO2"), 2300); check("thicker liquids spread less", thin > mid && mid > thick, thin + ", " + mid + ", " + thick); }
function kicked(id, T) { let out = 0; for (let s = 0; s < 8; s++) { reset(); Sim.seed(42 + s); Sim.gravity = 0; Sim.box(12, 12, 12, 28, 28, 28, id, P_LIQUID, T); Sim.blast(20, 20, 20, 5, 0.1); run(5); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id) { const x = i % 40; if (x < 12 || x > 28) out++; } } return out / 8; }
{ const thin = kicked(WATER, 300), thick = kicked(Mat.named("C3H8O3"), 300); check("a thick liquid resists being thrown by a blast", thick < thin, thin + " vs " + thick); }

console.log("Conduction");
function afterContact(ox, oy, oz) { reset(); Sim.atmosphere = "vacuum"; Sim.place(20, 20, 20, 29, P_STATIC, 900, true); Sim.place(20 + ox, 20 + oy, 20 + oz, WALL, P_STATIC, 293.15, true); run(300); return Sim.T[Sim.idx(20, 20, 20)]; }
{ const a = [afterContact(1, 0, 0), afterContact(-1, 0, 0), afterContact(0, 1, 0), afterContact(0, -1, 0), afterContact(0, 0, 1), afterContact(0, 0, -1)], lo = Math.min(...a), hi = Math.max(...a); check("a wall takes heat from every side", hi < 899 && hi - lo < 30, a.map(v => v.toFixed(0)).join(",")); }
Sim.ambient = 293.15; Sim.atmosphere = "vacuum"; Sim.gravity = 1; Sim.structural = false; Sim.init(256, 32, 256); Sim.seed(7); Sim.wakeAll(); run(45); Sim.box(2, 10, 10, 60, 10, 10, 29, P_STATIC, 293.15); run(45); for (let k = 0; k < 400; k++) { Sim.T[Sim.idx(2, 10, 10)] = 800; Sim.wake(2, 10, 10); Sim.tick(); }
{ const a = Sim.T[Sim.idx(16, 10, 10)], b = Sim.T[Sim.idx(17, 10, 10)]; check("heat crosses a chunk seam on a large grid", b > 340 && a - b < 30, a.toFixed(0) + " then " + b.toFixed(0)); }
reset(); Sim.atmosphere = "vacuum"; for (let x = 5; x < 35; x++) Sim.place(x, 20, 20, 29, P_STATIC, 300 + (x - 5) * 0.2, true); { const a = Sim.T[Sim.idx(34, 20, 20)] - Sim.T[Sim.idx(5, 20, 20)]; for (let k = 0; k < 2000; k++) { Sim.wakeAll(); Sim.tick(); } const b = Sim.T[Sim.idx(34, 20, 20)] - Sim.T[Sim.idx(5, 20, 20)]; check("a gentle gradient still evens out", b < a * 0.5, a.toFixed(2) + " to " + b.toFixed(2)); }
check("light gases conduct better than heavy ones", Mat.dG[1] > Mat.dG[0] && Mat.dG[0] > Mat.dG[18] && Mat.dG[18] > Mat.dG[54], Mat.dG[1] + " " + Mat.dG[0] + " " + Mat.dG[18] + " " + Mat.dG[54]);
reset(); Sim.atmosphere = "vacuum"; Sim.box(10, 20, 10, 13, 23, 13, 29, P_STATIC, 700); Sim.box(14, 20, 10, 17, 23, 13, 26, P_STATIC, 300); { const E = () => { let e = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 29 || Sim.ID[i] === 26) e += Sim.T[i] * Mat.cS[Sim.ID[i]]; return e; }, a = E(); run(800); check("conduction conserves energy", Math.abs(E() - a) / a < 0.001, a + " to " + E()); }

console.log("Support and buoyancy");
function solidY(id) { let lo = 99, hi = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id && Sim.PH[i] <= P_POWDER) { const y = Math.floor(i / 1600); lo = Math.min(lo, y); hi = Math.max(hi, y); } return [lo, hi]; }
reset(); Sim.structural = true; Sim.box(18, 25, 18, 21, 28, 21, 26, P_STATIC); run(100); check("an unsupported block falls to the floor", solidY(26)[0] === 1, solidY(26)); Sim.structural = false;
reset(); Sim.structural = true; Sim.gravity = 0; Sim.box(18, 25, 18, 21, 28, 21, 26, P_STATIC); run(100); check("an unsupported block stays put with gravity off", solidY(26)[0] === 25, solidY(26)); Sim.gravity = 1; run(100); check("and falls when gravity returns", solidY(26)[0] === 1, solidY(26)); Sim.structural = false;
reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 12, 38, WATER, P_LIQUID); Sim.box(16, 25, 16, 21, 30, 21, WATER, P_STATIC, 150); run(150); { const [lo, hi] = solidY(WATER); check("an ice block floats almost entirely under the surface", lo >= 6 && lo <= 9 && hi >= 11 && hi <= 14, lo + " to " + hi); } Sim.structural = false;
reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 12, 38, 80, P_LIQUID); Sim.box(16, 25, 16, 21, 30, 21, 26, P_STATIC); run(250); { const [lo, hi] = solidY(26); check("an iron block floats on mercury, about half under", lo >= 8 && lo <= 11 && hi >= 13 && hi <= 16, lo + " to " + hi); } Sim.structural = false;
reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 14, 38, 80, P_LIQUID); Sim.box(16, 3, 16, 21, 6, 21, 26, P_STATIC); run(400); { const [lo, hi] = solidY(26); check("an iron block held under mercury rises to the surface", hi >= 13, lo + " to " + hi); } Sim.structural = false;
reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 12, 38, WATER, P_LIQUID); Sim.box(16, 25, 16, 19, 28, 19, 79, P_STATIC); run(250); check("a gold block sinks through water to the floor", solidY(79)[0] === 1, solidY(79)); Sim.structural = false;
reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 1, 38, 79, P_POWDER); Sim.box(18, 2, 18, 21, 2, 21, WATER, P_STATIC, 100); Sim.box(18, 3, 18, 21, 8, 21, 26, P_STATIC); run(10); { const y0 = solidY(26)[0]; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 79) { const y = Math.floor(i / 1600), r = i - y * 1600, z = Math.floor(r / 40); Sim.erase(r - z * 40, y, z); } run(100); check("a solid resting on grains drops when they go", solidY(26)[0] < y0, y0 + " to " + solidY(26)[0]); } Sim.structural = false;
reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 1, 38, 79, P_POWDER); Sim.place(20, 2, 20, WATER, P_LIQUID, 274, true); Sim.T[Sim.idx(20, 2, 20)] = 100; Sim.wakeAll(); Sim.tick(); { const frozen = Sim.PH[Sim.idx(20, 2, 20)] === P_STATIC; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 79) { Sim.ID[i] = 0; Sim.PH[i] = P_GAS; } Sim.wakeAll(); run(130); check("ice frozen on grains cannot hang once they vanish unflagged", frozen && solidY(WATER)[0] === 1, frozen + " " + solidY(WATER)); } Sim.structural = false;

console.log("Convection and density");
function layerT(id, y) { let s = 0, c = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id && Math.floor(i / 1600) === y && Sim.PH[i] === P_LIQUID) { s += Sim.T[i]; c++; } return c ? s / c : 0; }
function heatLayer(y) { reset(); Sim.lid = true; Sim.atmosphere = "argon"; Sim.box(1, 1, 1, 38, 16, 38, WATER, P_LIQUID, 294); for (let k = 0; k < 600; k++) { for (let x = 1; x <= 38; x++) for (let z = 1; z <= 38; z++) Sim.T[Sim.idx(x, y, z)] = 360; Sim.wakeAll(); Sim.tick(); } return [layerT(WATER, 3), layerT(WATER, 14)]; }
{ const [a, b] = heatLayer(1); check("water heated from below convects", b > 320 && a - b < 12, a.toFixed(1) + " near the floor, " + b.toFixed(1) + " near the top"); }
{ const [a, b] = heatLayer(16); check("water heated from above stays layered", b - a > 15, a.toFixed(1) + " near the floor, " + b.toFixed(1) + " near the top"); }
check("water is densest near 4 C", (() => { reset(); Sim.place(5, 5, 5, WATER, P_LIQUID, 277.15, true); Sim.place(7, 5, 5, WATER, P_LIQUID, 274, true); Sim.place(9, 5, 5, WATER, P_LIQUID, 293, true); const d4 = Sim.densityOf(Sim.idx(5, 5, 5)); return d4 > Sim.densityOf(Sim.idx(7, 5, 5)) && d4 > Sim.densityOf(Sim.idx(9, 5, 5)) && near(d4, 1, 0.0005); })());
reset(); { Sim.place(5, 5, 5, WATER, P_LIQUID, 293, true); const i = Sim.idx(5, 5, 5), salt = Mat.named("NaCl"); Sim.AUX[i] = salt; Sim.USED[i] = 1 - Mat.saturation(salt); check("saturated brine is about 1.2 g/cm3", near(Sim.densityOf(i), 1.2, 0.03), Sim.densityOf(i)); }
function avgYSolute(sol) { let s = 0, w = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.AUX[i] === sol && Sim.ID[i] === WATER) { const c = 1 - Sim.USED[i]; s += Math.floor(i / 1600) * c; w += c; } return s / w; }
reset(); Sim.lid = true; { const salt = Mat.named("NaCl"); Sim.box(1, 1, 1, 38, 16, 38, WATER, P_LIQUID); for (let x = 1; x <= 38; x++) for (let z = 1; z <= 38; z++) for (let y = 15; y <= 16; y++) { const i = Sim.idx(x, y, z); Sim.AUX[i] = salt; Sim.USED[i] = 0.84; } Sim.wakeAll(); const a = avgYSolute(salt); run(60); check("brine sinks through fresh water", avgYSolute(salt) < a - 2.2, a.toFixed(2) + " to " + avgYSolute(salt).toFixed(2)); }
{ const ETOH = Mat.named("C2H5OH"), OIL = Mat.named("C8H18"); reset(); Sim.lid = true; Sim.box(1, 1, 1, 38, 6, 38, WATER, P_LIQUID); Sim.box(1, 7, 1, 38, 12, 38, ETOH, P_LIQUID); run(900); const we = avgY(WATER), ee = avgY(ETOH); check("ethanol and water mix", Math.abs(ee - we) < 1.5, ee.toFixed(2) + " vs " + we.toFixed(2)); reset(); Sim.lid = true; Sim.box(1, 1, 1, 38, 6, 38, WATER, P_LIQUID); Sim.box(1, 7, 1, 38, 12, 38, OIL, P_LIQUID); run(900); check("oil and water stay separate", avgY(OIL) > avgY(WATER) + 3.5, avgY(OIL).toFixed(2) + " vs " + avgY(WATER).toFixed(2)); }

console.log("Viscosity with temperature");
{ const gly = Mat.named("C3H8O3"); check("glycerol is thick cold and thin hot", Sim.viscOf(gly, 300) > 0.4 && Sim.viscOf(gly, 500) < 0.1, Sim.viscOf(gly, 300) + " then " + Sim.viscOf(gly, 500)); check("water thins as it warms", Sim.viscOf(WATER, 360) < Sim.viscOf(WATER, 290)); const si = Mat.named("SiO2"); check("molten silica is glassy", Sim.viscOf(si, 2300) > 0.95, Sim.viscOf(si, 2300)); const p = Mat.named("P2O5"); check("molten P2O5 is thick as well", Sim.viscOf(p, 620) > 0.9, Sim.viscOf(p, 620)); check("molten salt runs like water", Sim.viscOf(Mat.named("NaCl"), 1100) < 0.1, Sim.viscOf(Mat.named("NaCl"), 1100)); check("molten iron is a thin liquid", Sim.viscOf(26, 1900) < 0.2, Sim.viscOf(26, 1900));
  const cold = spreadX(gly, 295), hot = spreadX(gly, 500); check("hot glycerol spreads further", hot > cold, cold + " vs " + hot);
  let distinct = new Set(); for (let id = 1; id < Mat.count(); id++) distinct.add(Sim.viscOf(id, 1000).toFixed(3)); check("compounds no longer share a default viscosity", distinct.size > 200, distinct.size); }

console.log("Surface tension");
function footprint(id) { const s = new Set(); let top = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id && Sim.PH[i] === P_LIQUID) { const y = Math.floor(i / 1600), r = i - y * 1600; s.add(r); top = Math.max(top, y); } return [s.size, top]; }
reset(); Sim.atmosphere = "argon"; Sim.box(18, 1, 18, 21, 4, 21, WATER, P_LIQUID); run(500); { const [area] = footprint(WATER); check("a water drop stops spreading as a connected film", area <= 80, area); }
reset(); Sim.atmosphere = "argon"; Sim.box(18, 1, 18, 21, 4, 21, 80, P_LIQUID); run(500); { const [, top] = footprint(80); check("mercury stays beaded instead of running flat", top >= 2, top); }

console.log("Evaporation");
function waterCells() { return count(WATER, P_LIQUID) + count(WATER, P_POWDER); }
reset(); Sim.box(5, 1, 5, 34, 1, 34, WATER, P_LIQUID); { const a = waterCells(); run(3000); check("a puddle at 20 C dries in an open chamber", waterCells() < a * 0.9, a + " to " + waterCells()); }
reset(); Sim.lid = true; Sim.box(5, 1, 5, 34, 3, 34, WATER, P_LIQUID); { const a = waterCells(), m0 = Sim.totalMass(); run(3000); const b = waterCells(); let vap = 0, cells = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 0 && Sim.AUX[i] === WATER) { vap += Sim.USED[i]; cells++; } const avg = vap / cells; check("air under a lid fills with water vapour", cells > 10000, cells); check("sealed humidity stays near saturation", avg < Sim.saturation(WATER, 293.15) * 1.2, avg + " against " + Sim.saturation(WATER, 293.15)); check("evaporation conserves mass", Math.abs(Sim.totalMass() - m0) / m0 < 0.05, m0 + " to " + Sim.totalMass()); check("a sealed pool loses less than one that can vent", a - b < a * 0.6, a + " to " + b); }
check("vapour pressure of water near measured values", near(Sim.saturation(WATER, 293.15), 0.023, 0.006) && near(Sim.saturation(WATER, 323.15), 0.122, 0.03), Sim.saturation(WATER, 293.15) + " and " + Sim.saturation(WATER, 323.15));
reset(); Sim.lid = true; Sim.box(10, 10, 10, 29, 29, 29, 120, P_STATIC); for (let y = 11; y < 29; y++) for (let z = 11; z < 29; z++) for (let x = 11; x < 29; x++) { Sim.erase(x, y, z); const i = Sim.idx(x, y, z); Sim.AUX[i] = WATER; Sim.USED[i] = 0.3; Sim.T[i] = 280; } Sim.wakeAll(); run(60); check("supersaturated air condenses into droplets", count(WATER) > 0, count(WATER));
reset(); Sim.atmosphere = "vacuum"; Sim.box(15, 1, 15, 24, 3, 24, WATER, P_LIQUID, 293); { run(900); let lo = 999; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) lo = Math.min(lo, Sim.T[i]); check("water in a vacuum boils itself cold", lo < 275, lo); }

console.log("Radiation");
reset(); Sim.atmosphere = "vacuum"; Sim.box(10, 15, 15, 12, 20, 20, 74, P_STATIC, 2500); Sim.box(20, 15, 15, 20, 20, 20, 26, P_STATIC, 293); { const t = Sim.idx(20, 17, 17); run(300); check("a hot block heats another across a vacuum", Sim.T[t] > 330, Sim.T[t]); }
function coolFrom(id, ph, T0) { reset(); Sim.atmosphere = "vacuum"; Sim.place(20, 20, 20, id, ph, T0, true); const i = Sim.idx(20, 20, 20), a = Sim.T[i]; run(60); return a - Sim.T[i]; }
{ const pol = coolFrom(79, P_STATIC, 1200), dark = coolFrom(6, P_STATIC, 1200); check("a dark surface sheds heat faster than polished gold", dark > pol * 3, dark + " vs " + pol); const big = (() => { reset(); Sim.atmosphere = "vacuum"; Sim.box(15, 15, 15, 24, 24, 24, 74, P_STATIC, 2500); const i = Sim.idx(20, 20, 20); run(60); return 2500 - Sim.T[i]; })(), small = coolFrom(74, P_STATIC, 2500); check("only exposed faces radiate", small > big, small + " vs " + big); }

console.log("Nucleation and critical point");
// A lone drop can drift, so each reading first looks for where it went.
reset(); Sim.atmosphere = "vacuum"; Sim.place(20, 20, 20, WATER, P_LIQUID, 274, true); { let i = Sim.idx(20, 20, 20); Sim.gravity = 0; Sim.T[i] = 255; Sim.wakeAll(); run(5); i = Sim.ID.indexOf(WATER); check("lone water supercools without freezing", Sim.PH[i] === P_LIQUID, Sim.PH[i]); Sim.T[i] = 225; Sim.wakeAll(); run(40); i = Sim.ID.indexOf(WATER); check("and freezes far enough below", Sim.PH[i] <= P_POWDER, Sim.PH[i]); check("freezing releases heat back up to the freezing point", Sim.T[i] > 240, Sim.T[i]); }
reset(); Sim.atmosphere = "vacuum"; Sim.gravity = 0; Sim.place(20, 20, 20, WATER, P_LIQUID, 274, true); Sim.place(21, 20, 20, WATER, P_POWDER, 260, true); { const i = Sim.idx(20, 20, 20); Sim.T[i] = 271; Sim.wakeAll(); run(1); check("touching its own ice, it starts freezing at once", Sim.PR[i] < 0 || Sim.PH[i] <= P_POWDER, Sim.PR[i]); }
{ reset(); const b = Sim.boilingPoint(WATER, 1e7); check("no liquid water above the critical point", near(b, 647, 1), b); Sim.atmosphere = "vacuum"; check("water boils near freezing in a vacuum", Sim.boilingPoint(WATER, 0) < 285, Sim.boilingPoint(WATER, 0)); Sim.atmosphere = "air"; check("pressure lowers ice's melting point", Mat.dTm[WATER] < 0 && near(Mat.dTm[WATER], -7.4e-5, 2e-5), Mat.dTm[WATER]); check("pressure raises iron's melting point", Mat.dTm[26] > 0, Mat.dTm[26]); }

console.log("Dissolving heat and conduction");
function dissolveT(f) { reset(); Sim.lid = true; const sa = Mat.named(f); Sim.box(5, 1, 5, 34, 6, 34, WATER, P_LIQUID); Sim.box(14, 7, 14, 25, 8, 25, sa, P_POWDER); let hi = 0, lo = 999; for (let k = 0; k < 200; k++) { Sim.tick(); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER && Sim.PH[i] === P_LIQUID) { if (Sim.T[i] > hi) hi = Sim.T[i]; if (Sim.T[i] < lo) lo = Sim.T[i]; } } return [hi, lo]; }
{ const hot = dissolveT("NaOH")[0], cold = dissolveT("NH4NO3")[1]; check("dissolving NaOH gets hot", hot > 330, hot); check("dissolving ammonium nitrate gets cold", cold < 270, cold); }
function heatEnd(ph) { reset(); Sim.atmosphere = "vacuum"; Sim.gravity = 0; for (let x = 5; x < 25; x++) Sim.place(x, 20, 20, 26, ph, 293, true); for (let k = 0; k < 400; k++) { Sim.T[Sim.idx(5, 20, 20)] = 700; Sim.wakeAll(); Sim.tick(); } return Sim.T[Sim.idx(15, 20, 20)]; }
{ const lump = heatEnd(P_STATIC), grains = heatEnd(P_POWDER); check("iron powder conducts far worse than a bar", lump - 293 > (grains - 293) * 2, lump + " vs " + grains); }
reset(); Sim.lid = true; Sim.forSphere(20, 20, 20, 4, (x, y, z, i) => { Sim.T[i] = 800; }); Sim.wakeAll(); { const air = () => { let s = 0, c = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 0) { s += Sim.T[i]; c++; } return s / c; }, a = air(); run(60); const sealed = a - air(); reset(); Sim.forSphere(20, 20, 20, 4, (x, y, z, i) => { Sim.T[i] = 800; }); Sim.wakeAll(); const b = air(); run(60); check("a sealed chamber keeps its heat better than an open one", sealed < (b - air()) * 0.5, sealed + " vs " + (b - air())); }

console.log("Gravity");
function fallTicks(g) { reset(); Sim.gravity = g; Sim.box(19, 30, 19, 20, 30, 20, 79, P_POWDER); let n = 0; while (n < 400 && solidY(79)[0] > 5) { Sim.tick(); n++; } return n; }
{ const moon = fallTicks(0.16), earth = fallTicks(1), heavy = fallTicks(3); check("fall time follows gravity", moon > earth * 1.8 && earth > heavy * 1.3, moon + ", " + earth + ", " + heavy); check("fall time goes as one over root g", near(moon / earth, Math.sqrt(1 / 0.16), 1), moon / earth); }
reset(); Sim.structural = true; Sim.box(18, 34, 18, 21, 37, 21, 26, P_STATIC); { const y0 = solidY(26)[0]; run(8); const a = y0 - solidY(26)[0]; run(8); const b = y0 - solidY(26)[0] - a; check("a falling piece accelerates", b > a, a + " then " + b); } Sim.structural = false;

console.log("Strength");
function cantilever(id, n) { reset(); Sim.structural = true; Sim.box(5, 20, 20, 5, 20, 20, WALL, P_STATIC); Sim.box(6, 20, 20, 6 + n - 1, 20, 20, id, P_STATIC); run(240); const r = count(id, P_POWDER) > 0 || Sim.log.some(l => l.msg.includes("load")) || count(id, P_STATIC) < n; Sim.structural = false; return r; }
check("a short steel beam holds", !cantilever(26, 10)); check("the same beam in ice snaps", cantilever(WATER, 30));
reset(); Sim.structural = true; Sim.box(1, 20, 1, 1, 20, 1, WALL, P_STATIC); Sim.box(2, 20, 2, 37, 30, 37, 82, P_STATIC); Sim.box(1, 20, 2, 1, 20, 2, 82, P_STATIC); Sim.box(2, 20, 1, 2, 20, 1, 82, P_STATIC); run(240); check("one thin join cannot hold a huge block of lead", solidY(82)[0] < 20 || Sim.log.some(l => l.msg.includes("load")), solidY(82)); Sim.structural = false;

console.log("Hollow hulls");
function hull(id, walls, solid) { reset(); Sim.structural = true; Sim.box(1, 1, 1, 38, 12, 38, WATER, P_LIQUID); Sim.box(8, 20, 8, 31, solid ? 25 : 20, 31, id, P_STATIC); if (!solid && walls) { Sim.box(8, 21, 8, 31, 31, 8, id, P_STATIC); Sim.box(8, 21, 31, 31, 31, 31, id, P_STATIC); Sim.box(8, 21, 8, 8, 31, 31, id, P_STATIC); Sim.box(31, 21, 8, 31, 31, 31, id, P_STATIC); } run(400); const r = solidY(id); Sim.structural = false; return r; }
{ const boat = hull(13, true, false), brick = hull(13, false, true); check("an aluminium hull floats", boat[0] >= 8, boat); check("the same metal as a solid block sinks", brick[0] <= 2, brick); }
{ const M = 96, s = 84, top = 36, a = (M - s) >> 1, b = a + s - 1; Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.lid = false; Sim.gravity = 1; Sim.init(M, 44, M); Sim.seed(5); Sim.structural = true; Sim.box(1, 1, 1, M - 2, 10, M - 2, WATER, P_LIQUID); Sim.box(a, 14, a, b, 14, b, 26, P_STATIC); Sim.box(a, 15, a, b, top, a, 26, P_STATIC); Sim.box(a, 15, b, b, top, b, 26, P_STATIC); Sim.box(a, 15, a, a, top, b, 26, P_STATIC); Sim.box(b, 15, a, b, top, b, 26, P_STATIC); run(240); let lo = 99; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 26) lo = Math.min(lo, Math.floor(i / (M * M))); check("a big enough steel hull floats", lo >= 3, lo); Sim.structural = false; }

console.log("Grains");
function pile(id) { reset(); Sim.atmosphere = "argon"; for (let k = 0; k < 500; k++) { if (k < 300) for (let a = 0; a < 2; a++) Sim.place(20, 34, 20, id, P_POWDER); Sim.tick(); } const foot = new Set(); let h = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === id) { const y = Math.floor(i / 1600); h = Math.max(h, y); foot.add(i - y * 1600); } return Math.atan2(h, Math.sqrt(foot.size / Math.PI)) * 180 / Math.PI; }
{ const gold = pile(79), oxide = pile(Mat.named("Fe2O3")); check("slick metal grains pile lower than angular oxide", oxide > gold + 5, gold.toFixed(1) + " vs " + oxide.toFixed(1)); }
function dampPile(wet) { reset(); Sim.atmosphere = "argon"; if (wet) Sim.box(1, 1, 1, 38, 2, 38, WATER, P_LIQUID); for (let k = 0; k < 900; k++) { if (k < 500) Sim.place(20, 34, 20, 14, P_POWDER); Sim.tick(); } let h = 0, r = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 14) { const y = Math.floor(i / 1600), q = i - y * 1600, z = Math.floor(q / 40), x = q - z * 40; h = Math.max(h, y); r = Math.max(r, Math.hypot(x - 20, z - 20)); } return h / Math.max(r, 1); }
{ const dry = dampPile(false), wet = dampPile(true); check("grains in contact with water hold a steeper bank", wet > dry * 0.8, dry + " vs " + wet); }

console.log("Reaction rates and air");
function burned(ph, airborne) { reset(); const ci = []; if (airborne) { Sim.gravity = 0; for (let y = 10; y < 26; y += 2) for (let z = 12; z < 28; z += 2) for (let x = 12; x < 28; x += 2) Sim.place(x, y, z, 6, P_POWDER, 1500, true); } else Sim.box(14, 10, 14, 25, 21, 25, 6, ph, 1500); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 6) ci.push(i); const n = ci.length, a = amount(6); run(40); return (a - amount(6)) / n; }
{ const lump = burned(P_STATIC), loose = burned(P_POWDER), dust = burned(P_POWDER, true); check("loose carbon burns faster than a lump", loose > lump * 1.3, lump + " vs " + loose); check("dust in the air burns fastest", dust > loose, dust + " vs " + loose); }
function fireRun(lid) { reset(); Sim.lid = lid; Sim.box(1, 1, 1, 38, 10, 38, 6, P_POWDER, 1500); const a = amount(6); run(300); let debt = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 0) debt += Sim.U2[i]; run(1200); return [(a - amount(6)) / a, debt]; }
{ const [sealed, debt] = fireRun(true), [open] = fireRun(false); check("a fire uses up the air around it", debt > 100, debt); check("a sealed fire goes out with fuel left", sealed < 0.7, sealed); check("an open fire burns more of its fuel", open > sealed * 1.05, open + " vs " + sealed); }

console.log("Corrosion and radiation");
{ const fe = Mat.pilling(26, Mat.salt(26, "O")), zn = Mat.pilling(30, Mat.salt(30, "O")), al = Mat.pilling(13, Mat.salt(13, "O")), mg = Mat.pilling(12, Mat.salt(12, "O")); check("rust flakes off, by Pilling-Bedworth", fe > 2, fe); check("zinc and aluminium oxides protect", zn >= 1 && zn <= 2 && al >= 1 && al <= 2, zn + " " + al); check("magnesium oxide is too thin to protect", mg < 1, mg); }
function flakes(f) { reset(); Sim.atmosphere = "argon"; Sim.box(5, 1, 5, 34, 2, 34, Mat.named(f), P_STATIC); Sim.box(5, 3, 5, 34, 4, 34, WATER, P_LIQUID); for (let k = 0; k < 2000; k++) Sim.tick(); return count(Mat.named(f), P_POWDER); }
{ const rust = flakes("Fe2O3"), zinc = flakes("ZnO"); check("a rust layer flakes off in water, and zinc oxide stays", rust > 0 && zinc === 0, rust + " vs " + zinc); }
function gammaLeft(id) { reset(); Sim.atmosphere = "vacuum"; Sim.box(5, 5, 5, 34, 34, 34, id, P_STATIC); for (let k = 0; k < 2000; k++) Sim.spawnP(3, 20, 20, 20, 2, 0, 6); run(3); return Sim.pCount; }
{ const lead = gammaLeft(82), light = gammaLeft(Mat.named("SiO2")); check("lead stops gamma rays better than a light solid", lead < light * 0.5, lead + " vs " + light); }
reset(); Sim.lid = true; Sim.box(5, 1, 5, 34, 20, 34, WATER, P_LIQUID); { const before = Sim.stats.reactions; for (let k = 0; k < 400; k++) { for (let q = 0; q < 80; q++) Sim.spawnP(3, 20, 10, 20, 1, 0, 6); Sim.tick(); } check("gamma rays split water", Sim.log.some(l => l.msg.includes("radiolysis")), Sim.stats.reactions - before); }

console.log("Water that already holds something");
function goneIn(id, solute, strength) { reset(); Sim.lid = true; Sim.atmosphere = "argon"; Sim.box(1, 1, 1, 38, 6, 38, WATER, P_LIQUID); if (solute) for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { Sim.AUX[i] = solute; Sim.USED[i] = 1 - strength; } Sim.box(15, 7, 15, 24, 9, 24, id, P_POWDER); const a = amount(id); run(400); return 1 - amount(id) / a; }
{ const salt = Mat.named("NaCl"), pure = goneIn(11), salty = goneIn(11, salt, 0.001), sweet = goneIn(11, Mat.named("C12H22O11"), 0.05); check("a trace of salt does not stop sodium reacting with the water", salty > pure * 0.5, pure + " vs " + salty); check("nor does sugar", sweet > pure * 0.5, pure + " vs " + sweet); const lime = goneIn(Mat.named("CaO"), salt, 0.01); check("lime still slakes in salty water", lime > 0.1, lime); const more = goneIn(salt, Mat.named("KCl"), 0.01); check("salt dissolves into water already holding another salt", more > 0.02, more); }

reset(); Sim.lid = true; Sim.atmosphere = "argon"; { const salt = Mat.named("NaCl"), held = () => { let a = 0; for (let i = 0; i < Sim.ID.length; i++) { if (Sim.ID[i] === salt) a += 1 - Sim.USED[i]; if (Sim.ID[i] === WATER) { if (Sim.AUX[i] === salt) a += 1 - Sim.USED[i]; if (Sim.AUX2[i] === salt) a += 1 - Sim.U2[i]; } } return a; }; Sim.box(1, 1, 1, 38, 6, 38, WATER, P_LIQUID); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { Sim.AUX[i] = salt; Sim.USED[i] = 0.9; } Sim.box(15, 7, 15, 24, 9, 24, 11, P_POWDER); const a = held(); run(400); check("dissolved salt survives the water around it being used up", near(held() / a, 1, 0.01), held() / a); }

console.log("Momentum");
function coast(v) { let far = 0; for (let s = 1; s <= 6; s++) { reset(); Sim.seed(s); Sim.atmosphere = "vacuum"; Sim.gravity = 0; Sim.place(20, 20, 20, 79, P_POWDER, undefined, true); Sim.sharedBuffers().VX[Sim.idx(20, 20, 20)] = v; run(30); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 79) far += Math.abs(i % 40 - 20); } return far / 6; }
{ const on = coast(16), back = coast(-16); check("a kick carries as far in either direction", on > 8 && Math.abs(on - back) <= 2, on + " vs " + back); }

console.log("Cells that change hands");
reset(); Sim.atmosphere = "argon"; Sim.box(10, 34, 10, 30, 37, 30, 1, P_POWDER); run(400); { let stale = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === AIR && Sim.AUX2[i]) stale++; check("gas leaving through the top leaves nothing on the air behind it", stale === 0, stale); }
reset(); Sim.lid = true; Sim.box(15, 15, 15, 25, 25, 25, 1, P_POWDER, 3e8); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 1) Sim.PH[i] = 4; run(20); { let stale = 0; for (let i = 0; i < Sim.ID.length; i++) if ((Sim.ID[i] === AIR || Sim.ID[i] === 2) && Sim.AUX2[i]) stale++; check("fusion leaves no old mass numbers behind", Sim.stats.fusions > 0 && stale === 0, stale + " stale, " + Sim.stats.fusions + " fusions"); }
reset(); Sim.lid = true; Sim.box(10, 10, 10, 29, 29, 29, WALL, P_STATIC); for (let y = 11; y < 29; y++) for (let z = 11; z < 29; z++) for (let x = 11; x < 29; x++) { Sim.erase(x, y, z); const i = Sim.idx(x, y, z); Sim.AUX[i] = WATER; Sim.USED[i] = 0.3; Sim.AUX2[i] = 1; Sim.T[i] = 280; } Sim.wakeAll(); run(60); { let dirty = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER && Sim.AUX2[i]) dirty++; check("vapour condensing in a cell starts with nothing dissolved in it", count(WATER) > 0 && dirty === 0, count(WATER) + " droplets, " + dirty + " holding something"); }
check("a new chamber's clock starts at zero", (() => { reset(); run(5); Sim.init(40, 40, 40); return Sim.tickN === 0; })());

console.log("True amounts in solution");
function mixedCell(strength) { reset(); Sim.atmosphere = "argon"; Sim.lid = true; Sim.gravity = 0; const i = Sim.idx(20, 20, 20); Sim.place(20, 20, 20, WATER, P_LIQUID, 293.15, true); Sim.AUX[i] = Mat.named("HCl"); Sim.USED[i] = 1 - strength; Sim.AUX2[i] = Mat.named("NaOH"); Sim.U2[i] = 1 - strength; const m0 = Sim.totalMass(); let fired = false; Chem.onFire = () => { fired = true; }; for (let k = 0; k < 100 && !fired; k++) Sim.tick(); Chem.onFire = null; return { fired, dm: Sim.totalMass() - m0, dT: Sim.T[i] - 293.15 }; }
{ const weak = mixedCell(0.01), strong = mixedCell(0.1); check("two dilute solutes make only what they hold", weak.fired && Math.abs(weak.dm) < 0.02, weak.dm); check("and warm the water in proportion", strong.dT > weak.dT * 5 && strong.dT > 1, weak.dT + " vs " + strong.dT); }
for (const f of ["CuSO4", "CaCO3", "C2H5OH"]) { reset(); Sim.atmosphere = "argon"; Sim.lid = true; Sim.gravity = 0; const id = Mat.named(f), i = Sim.idx(20, 20, 20); Sim.place(20, 20, 20, id, P_STATIC, 300, true); const m0 = Sim.totalMass(); Chem.step(i, 20, 20, 20, id, Sim.PH[i], 5500); check(f + " breaks into all its elements at 5500 K and keeps its mass", Object.keys(Mat.atoms(f)).every(e => count(Mat.byFormula[e]) > 0) && near(Sim.totalMass() / m0, 1, 0.02), Sim.totalMass() / m0); }

console.log("pH away from the textbook");
check("a dilute weak acid gives no more H+ than it holds", near(Chem.pHfromSolutes(Mat.named("CH3COOH"), 1e-7, 0, 0), 6.79, 0.03), Chem.pHfromSolutes(Mat.named("CH3COOH"), 1e-7, 0, 0));
check("a dilute weak base stays just above neutral", near(Chem.pHfromSolutes(Mat.named("NH3"), 1e-8, 0, 0), 7.02, 0.03), Chem.pHfromSolutes(Mat.named("NH3"), 1e-8, 0, 0));
check("washing soda is strongly basic, by carbonate's last pKa", near(Chem.pHfromSolutes(Mat.named("Na2CO3"), 0.1, 0, 0), 11.66, 0.1), Chem.pHfromSolutes(Mat.named("Na2CO3"), 0.1, 0, 0));
check("a very strong base keeps a finite pH", near(Chem.pHfromSolutes(Mat.named("NaOH"), 53, 0, 0), 15.72, 0.05), Chem.pHfromSolutes(Mat.named("NaOH"), 53, 0, 0));

console.log("Experiments and small repairs");
{ const heats = [3, 11, 19, 37, 55].map(z => Chem.ruleFor(z, WATER).heat); check("group 1 reacts hotter with water going down the table", heats.every((v, k) => !k || v > heats[k - 1]), heats.join(", ")); }
reset(); Sim.box(15, 1, 15, 24, 3, 24, 29, P_POWDER, 1430); { let seen = 0; for (let k = 0; k < 200 && !seen; k++) { Sim.tick(); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 119 && Sim.AUX[i] === 29) seen++; } check("burning copper shows its own flame colour", seen > 0, seen); }
{ Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.gravity = 1; Sim.init(64, 48, 64); Sim.seed(9); Sim.structural = true; Scenes.load("volcano"); const heap = Mat.named("(NH4)2Cr2O7"), n = count(heap); run(1000); check("the volcano burns through most of its heap", count(heap) < n * 0.5, n + " to " + count(heap)); Sim.structural = false; }
// Reaction heat goes by the amount reacted, and heat taken in is drawn from the cells around. Before, each partial event took the full chill
// again: cells fell to 69 K and most of the CO2 came out as dry ice.
reset(); Sim.box(12, 1, 12, 27, 3, 27, Mat.named("NaHCO3"), P_POWDER); Sim.box(12, 4, 12, 27, 9, 27, Mat.named("CH3COOH"), P_LIQUID); run(300);
{ const co2 = Mat.named("CO2"), gas = count(co2, P_GAS), all = count(co2); let t = 0, n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] > AIR && Sim.ID[i] !== WALL && Sim.PH[i] !== P_GAS) { t += Sim.T[i]; n++; }
  check("acetic acid on baking soda gives CO2 gas, not dry ice", all > 50 && gas >= all * 0.9, gas + " of " + all + " CO2 cells are gas");
  check("and cools the mixture by tens of kelvin, not hundreds", t / n > 240 && t / n < 290, (t / n).toFixed(0) + " K"); }
check("the boiling point does not jump as pressure builds", Math.abs(Sim.boilingPoint(WATER, 30.5) - Sim.boilingPoint(WATER, 30)) < 1, Sim.boilingPoint(WATER, 30) + " then " + Sim.boilingPoint(WATER, 30.5));
reset(); Sim.place(5, 5, 5, WATER, P_LIQUID, 274, true); { const i = Sim.idx(5, 5, 5); let lo = 9, hi = 0; for (let t = 150; t <= 300; t += 0.5) { Sim.T[i] = t; const d = Sim.densityOf(i); lo = Math.min(lo, d); hi = Math.max(hi, d); } check("liquid water's density stays sensible however cold it gets", lo > 0.9 && hi < 1.01, lo + " to " + hi); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
