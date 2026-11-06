// Compares simulation results with measured or textbook values. Run with: node tools/validate.js
// The tests in test_sim.js ask whether something happens. These ask how close the number is. The table is the honest measure of the model.
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Map, Set, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "scenes.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Chem, ELEMENTS, P_POWDER, P_LIQUID, P_STATIC, P_GAS } = vm.runInContext("({Sim,Mat,Chem,ELEMENTS,P_POWDER,P_LIQUID,P_STATIC,P_GAS})", ctx);
const WATER = Mat.named("H2O"), rows = [];
function row(group, name, sim, ref, tolPct, unit) { const err = ref === 0 ? Math.abs(sim) : Math.abs(sim - ref) / Math.abs(ref) * 100; rows.push({ group, name, sim, ref, err, ok: err <= tolPct, tolPct, unit: unit || "" }); }
function reset(a) { Sim.ambient = a || 293.15; Sim.atmosphere = "air"; Sim.lid = false; Sim.gravity = 1; Sim.structural = false; Sim.init(48, 40, 48); Sim.seed(11); }
function run(n, each) { for (let k = 0; k < n; k++) { Sim.tick(); if (each) each(k); } }
const eq = e => Chem.database.find(d => d.eq === e);
function crossover(d) { return d.dH * 1000 / d.dS; }

// Phase transitions, measured from a heated sample in the simulation
function plateau(id, start, target) {
  reset(); Sim.lid = true;
  Sim.box(20, 2, 20, 26, 8, 26, id, P_STATIC, start);
  let seen = {};
  const i = Sim.idx(23, 5, 23);
  for (let k = 0; k < 2500; k++) {
    for (let x = 20; x <= 26; x++) for (let z = 20; z <= 26; z++) { const c = Sim.idx(x, 1, z); Sim.T[c] = target; Sim.ID[c] = 120; }
    Sim.forSphere(23, 5, 23, 5, (X, Y, Z, q) => { if (Sim.ID[q] === id) Sim.T[q] += 3; });
    Sim.wake(23, 5, 23); Sim.tick();
    const t = Math.round(Sim.T[i]); seen[t] = (seen[t] || 0) + 1;
    if (Sim.ID[i] !== id || Sim.PH[i] >= P_GAS) break;
  }
  return Number(Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0]);
}
row("Heating curve", "Ice melting plateau", plateau(WATER, 260, 400), 273.15, 1, "K");
row("Heating curve", "Lead melting plateau", plateau(82, 560, 800), 600.6, 2, "K");

// Ideal gas law and gas density
row("Gases", "Air density at 20 C", Sim.gasDensity(0, 293.15) * 1000, 1.204, 2, "g/L");
row("Gases", "Hydrogen density at 0 C", Sim.gasDensity(1, 273.15) * 1000, 0.0899, 2, "g/L");
row("Gases", "Xenon density at 0 C", Sim.gasDensity(54, 273.15) * 1000, 5.894, 2, "g/L");

// Boiling point under pressure, by the model's Clausius-Clapeyron approximation. Measured: 120.2 C at 200 kPa absolute.
row("Pressure", "Water boiling at 200 kPa", Sim.boilingPoint(WATER, 100), 393.4, 2, "K");

row("Pressure", "Water's critical temperature", (reset(), Sim.boilingPoint(WATER, 1e7)), 647, 1, "K");
row("Pressure", "Water boiling at 1 kPa", (Sim.atmosphere = "vacuum", Sim.boilingPoint(WATER, 0)), 280, 3, "K");
Sim.atmosphere = "air";
row("Pressure", "Ice melting point against pressure", Mat.dTm[WATER] * 1e5, -7.4, 5, "mK/MPa x1e3");

// Densities, read from placed cells
function densityAt(id, T, setup) { reset(); Sim.place(20, 20, 20, id, P_LIQUID, T, true); const i = Sim.idx(20, 20, 20); if (setup) setup(i); return Sim.densityOf(i); }
row("Liquids", "Water density at 20 C", densityAt(WATER, 293.15), 0.9982, 0.2, "g/cm3");
row("Liquids", "Water density at 4 C", densityAt(WATER, 277.15), 1.0, 0.2, "g/cm3");
row("Liquids", "Water density at 90 C", densityAt(WATER, 363.15), 0.9653, 0.5, "g/cm3");
row("Liquids", "Saturated brine density", densityAt(WATER, 293.15, i => { const s = Mat.named("NaCl"); Sim.AUX[i] = s; Sim.USED[i] = 1 - Mat.saturation(s); }), 1.2, 3, "g/cm3");
row("Liquids", "Ethanol density at 60 C", densityAt(Mat.named("C2H5OH"), 333.15), 0.754, 4, "g/cm3");

// Viscosity, undoing the compression the simulation stores it under, before the limits that a cell's movement applies. Measured values from the CRC Handbook.
const viscosity = (f, T) => { const id = Mat.named(f); return Math.pow(10, (Mat.viscA[id] + Mat.viscB[id] / T - 0.03) / 0.157); };
row("Viscosity", "Water at 20 C", viscosity("H2O", 293.15), 1.0, 10, "mPa s");
row("Viscosity", "Water at 80 C", viscosity("H2O", 353.15), 0.355, 30, "mPa s");
row("Viscosity", "Glycerol at 20 C", viscosity("C3H8O3", 293.15), 1412, 10, "mPa s");
row("Viscosity", "Glycerol at 100 C", viscosity("C3H8O3", 373.15), 14.8, 60, "mPa s");
row("Viscosity", "Ethanol at 50 C, by Andrade", viscosity("C2H5OH", 323.15), 0.70, 20, "mPa s");
row("Viscosity", "Acetone, as listed", viscosity("CH3COCH3", 293.15), 0.32, 10, "mPa s");
row("Viscosity", "Eyring's rule, tried on benzene", (() => { const b = Mat.named("C6H6"), hv = 0.088 * Mat.bp[b], E = 0.4 * hv; return 0.3 * Math.exp(E / 8.314e-3 * (1 / 293.15 - 1 / Mat.bp[b])); })(), 0.65, 30, "mPa s");

// Vapour pressure
const vapour = (f, T) => Sim.saturation(Mat.named(f), T) * 101.325;
row("Vapour", "Water at 20 C", vapour("H2O", 293.15), 2.34, 25, "kPa");
row("Vapour", "Water at 50 C", vapour("H2O", 323.15), 12.35, 20, "kPa");
row("Vapour", "Ethanol at 20 C", vapour("C2H5OH", 293.15), 5.9, 25, "kPa");

// Gravity: fall time goes as one over the root of g. Speed is resolved by chance, so this follows one grain over several runs: one run says little, and the fastest of a group runs early.
function fallTicks(g) { let total = 0; for (let s = 1; s <= 24; s++) { reset(); Sim.seed(s); Sim.gravity = g; Sim.place(20, 34, 20, 79, P_POWDER); let n = 0, y; do { Sim.tick(); n++; y = 99; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 79) { const Y = Math.floor(i / (48 * 48)); if (Y < y) y = Y; } } while (y > 5 && n < 500); total += n; } return total / 24; }
row("Gravity", "Fall time, Moon over Earth", fallTicks(0.16) / fallTicks(1), Math.sqrt(1 / 0.16), 15);

// Heat of solution, from a grain dissolving in a little water. Walled in, because a lone drop can drift away from the grain before it dissolves.
function dissolveRise(f) { reset(); Sim.atmosphere = "argon"; Sim.gravity = 0; const s = Mat.named(f); Sim.box(19, 19, 19, 22, 21, 21, 120, P_STATIC); Sim.place(20, 20, 20, WATER, P_LIQUID, 293.15, true); Sim.place(21, 20, 20, s, P_POWDER, 293.15, true); const w = Sim.idx(20, 20, 20); for (let k = 0; k < 2000; k++) { Sim.tick(); if (Sim.AUX[w]) break; } return Sim.T[w] - 293.15; }
row("Solutions", "Heat released dissolving KOH at its saturation, per the table", -Mat.hsol[Mat.named("KOH")], 57.6, 1, "kJ/mol");
row("Solutions", "Cold from dissolving KNO3 to saturation", dissolveRise("KNO3"), -19, 40, "K");

// Thermodynamic crossovers, where Gibbs energy changes sign
row("Thermodynamics", "CaCO3 decomposition", crossover(eq("CaCO3 -> CaO + CO2")), 1170, 8, "K");
row("Thermodynamics", "Haber K = 1", crossover(eq("N2 + 3H2 -> 2NH3")), 465, 8, "K");
row("Thermodynamics", "N2O4 dissociation K = 1", crossover(eq("N2O4 -> 2NO2")), 330, 8, "K");
row("Thermodynamics", "HgO decomposition", crossover(eq("2HgO -> 2Hg + O2")), 840, 15, "K");
row("Thermodynamics", "Reaction enthalpy: methane burning", eq("CH4 + 2O2 -> CO2 + 2H2O").dH, -890.3, 1, "kJ/mol");
row("Thermodynamics", "Reaction enthalpy: thermite", eq("Fe2O3 + 2Al -> 2Fe + Al2O3").dH, -851.5, 1, "kJ/mol");

// Flame and reaction temperatures from running the simulation
function peak(setup, ticks) { reset(); setup(); let m = 0; run(ticks, () => { for (let i = 0; i < Sim.ID.length; i += 1) { const id = Sim.ID[i]; if (id && id !== 120 && id !== 119 && Sim.T[i] > m) m = Sim.T[i]; } }); return m; }
row("Temperature", "Methane flame in air", peak(() => { Sim.box(18, 2, 18, 28, 8, 28, Mat.named("CH4"), P_POWDER, 1000); }, 40), 2226, 25, "K");
row("Temperature", "Thermite reaction", peak(() => { const fe = Mat.named("Fe2O3"); for (let y = 2; y <= 10; y++) for (let z = 15; z <= 30; z++) for (let x = 15; x <= 30; x++) Sim.place(x, y, z, (x + y + z) % 2 ? 13 : fe, P_POWDER, undefined, true); Sim.forSphere(22, 10, 22, 3, (x, y, z, i) => { Sim.T[i] = 1600; }); Sim.wakeAll(); }, 100), 2800, 10, "K");

// Water chemistry
const pH = (a, ca, b, cb) => Chem.pHfromSolutes(a ? Mat.named(a) : 0, ca, b ? Mat.named(b) : 0, cb);
row("pH", "0.1 M HCl", pH("HCl", 0.1), 1, 2);
row("pH", "0.1 M acetic acid", pH("CH3COOH", 0.1), 2.88, 2);
row("pH", "0.01 M NaOH", pH("NaOH", 0.01), 12, 1);
row("pH", "0.1 M ammonia", pH("NH3", 0.1), 11.13, 1);
row("pH", "Acetate buffer, 1:1", pH("CH3COOH", 0.1, "CH3COONa", 0.1), 4.76, 1);
row("pH", "Acetate buffer, 1:10", pH("CH3COOH", 0.1, "CH3COONa", 1), 5.76, 1);
row("pH", "Pure water", pH(null, 0), 7, 0.5);
row("Solubility", "AgCl from Ksp", Mat.solubilityFromKsp("AgCl") * 1e5, 1.34, 2, "x1e-5 mol/L");
row("Solubility", "BaSO4 from Ksp", Mat.solubilityFromKsp("BaSO4") * 1e5, 1.05, 2, "x1e-5 mol/L");
row("Solubility", "Ca(OH)2 from Ksp", Mat.solubilityFromKsp("Ca(OH)2") * 1e3, 11.1, 5, "x1e-3 mol/L");

// Electrochemistry
row("Electrochemistry", "Daniell cell Zn|Cu", Sim.nernst(0.34, -0.76, 2, 2, 1, 1, 298), 1.10, 1, "V");
row("Electrochemistry", "Cu|Ag cell", Sim.nernst(0.80, 0.34, 2, 1, 1, 1, 298), 0.46, 1, "V");
row("Electrochemistry", "Concentration effect, 0.01 M Zn2+", Sim.nernst(0.34, -0.76, 2, 2, 0.01, 1, 298), 1.159, 1, "V");

// Nuclear: half-lives from the table, compared on the model's compressed clock
function measuredHalf(z, A, scale) {
  reset(); Sim.setDecayScale(scale); Sim.isotopeOverride = {}; Sim.isotopeOverride[z] = A;
  Sim.box(4, 1, 4, 43, 8, 43, z, P_STATIC); Sim.isotopeOverride = null;
  let n0 = 0; const isHe = () => { let c = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === z && Sim.AUX2[i] === A) c++; return c; };
  n0 = isHe(); let t = 0;
  while (t < 60000) { Sim.tick(); t++; if (t % 5 === 0 && isHe() <= n0 / 2) break; }
  Sim.setDecayScale(1);
  return t / Sim.TICKS_PER_SEC * scale;
}
row("Nuclear", "Rn-222 half-life on the model clock", measuredHalf(86, 222, 40), Mat.simHalfLife(330200), 12, "s");
row("Nuclear", "Natural U-235 abundance", (() => { reset(); Sim.box(1, 1, 1, 46, 30, 46, 92, P_STATIC); let u = 0, n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 92) { n++; if (Sim.AUX2[i] === 235) u++; } return u / n * 100; })(), 0.72, 30, "%");

// Conservation
function massCheck(setup, ticks) { reset(); Sim.lid = true; setup(); const a = Sim.totalMass(); run(ticks); return Math.abs(Sim.totalMass() - a) / a * 100; }
row("Conservation", "Thermite mass change", massCheck(() => { const fe = Mat.named("Fe2O3"); for (let y = 2; y <= 8; y++) for (let z = 14; z <= 28; z++) for (let x = 14; x <= 28; x++) Sim.place(x, y, z, (x + y + z) % 2 ? 13 : fe, P_POWDER, 1500, true); }, 300), 0, 3, "%");
row("Conservation", "Hydrogen burning mass change", massCheck(() => { Sim.atmosphere = "argon"; for (let y = 2; y <= 12; y++) for (let z = 12; z <= 30; z++) for (let x = 12; x <= 30; x++) Sim.place(x, y, z, (x + z) % 3 ? 1 : 8, P_POWDER, 900, true); }, 200), 0, 3, "%");
row("Conservation", "Salt precipitation mass change", massCheck(() => { const pb = Mat.named("Pb(NO3)2"), ki = Mat.named("KI"); Sim.box(8, 1, 8, 40, 6, 40, WATER, P_POWDER); for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === WATER) { Sim.AUX[i] = (i % 48) < 24 ? pb : ki; Sim.USED[i] = 0.9; } Sim.wakeAll(); }, 300), 0, 12, "%");

let group = "", pass = 0;
for (const r of rows) {
  if (r.group !== group) { group = r.group; console.log("\n" + group); }
  if (r.ok) pass++;
  console.log((r.ok ? "  ok   " : "  OFF  ") + r.name.padEnd(40) + (Number.isFinite(r.sim) ? String(+r.sim.toPrecision(5)) : "n/a").padStart(10) + "  vs " + String(r.ref).padStart(8) + " " + r.unit.padEnd(12) + "  " + (r.ref === 0 ? "" : r.err.toFixed(1) + "%"));
}
console.log(`\n${pass} of ${rows.length} within tolerance`);
fs.writeFileSync(path.join(__dirname, "..", "VALIDATION.md"), "# Validation\n\nGenerated by `tools/validate.js`. Each line compares the simulation with a measured or textbook value.\n\n| Check | Simulation | Reference | Error | Within tolerance |\n| --- | --- | --- | --- | --- |\n" + rows.map(r => `| ${r.group}: ${r.name} | ${+r.sim.toPrecision(5)} ${r.unit} | ${r.ref} ${r.unit} | ${r.ref === 0 ? "" : r.err.toFixed(1) + "%"} | ${r.ok ? "yes" : "no (" + r.tolPct + "% allowed)"} |`).join("\n") + `\n\n${pass} of ${rows.length} within tolerance.\n`);
