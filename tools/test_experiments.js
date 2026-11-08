// Does each experiment do what its text says? Every check below comes from a sentence the player reads.
// Run with: node tools/test_experiments.js [scene ...]     Set SEED to try another run; a check that passes on only one seed is passing by luck.
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "scenes.js", "vessels.js", "lab.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Chem, Scenes, Lab, Vessels, P_STATIC, P_POWDER, P_LIQUID, P_GAS, WALL, AIR, FLAME } = vm.runInContext("({Sim,Mat,Chem,Scenes,Lab,Vessels,P_STATIC,P_POWDER,P_LIQUID,P_GAS,WALL,AIR,FLAME})", ctx);

const only = process.argv.slice(2), SEED = +process.env.SEED || 5;
let failed = 0, passed = 0;
const check = (name, ok, detail) => { console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  (" + detail + ")" : "")); if (ok) passed++; else failed++; };
const WATER = Mat.named("H2O");

// ---- What a check can ask about ----
const seen = new Map();
const realAddLog = Sim.addLog;
Sim.addLog = function (msg, kind, n) { seen.set(msg, (seen.get(msg) || 0) + (n || 1)); return realAddLog.apply(Sim, arguments); };
const logged = re => { let n = 0; seen.forEach((c, m) => { if (re.test(m)) n += c; }); return n; };
const id = x => (typeof x === "number" ? x : Mat.named(x));
function count(x, ph) { const m = id(x); let n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === m && (ph === undefined || Sim.PH[i] === ph)) n++; return n; }
// Cells of a substance, or water cells holding it, weighted by how much is left.
function amount(x) { const m = id(x); let a = 0; for (let i = 0; i < Sim.ID.length; i++) { if (Sim.ID[i] === m) a += 1 - Sim.USED[i]; else if (Sim.ID[i] === WATER) { if (Sim.AUX[i] === m) a += 1 - Sim.USED[i]; if (Sim.AUX2[i] === m) a += 1 - Sim.U2[i]; } } return a; }
const yOf = i => Math.floor(i / (Sim.W * Sim.D));
function meanY(x, ph) { const m = id(x); let s = 0, n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === m && (ph === undefined || Sim.PH[i] === ph)) { s += yOf(i); n++; } return n ? s / n : -1; }
function hottest(x) { const m = id(x); let t = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === m && Sim.T[i] > t) t = Sim.T[i]; return t; }
function peakP() { let p = 0; for (let i = 0; i < Sim.P.length; i++) if (Sim.P[i] > p) p = Sim.P[i]; return p; }
function run(n, each) { for (let k = 0; k < n; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); if (each) each(k); } }
function start(sceneId) {
  Sim.init(64, 48, 64); Sim.seed(SEED); Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.gravity = 1; Sim.lid = false; Sim.structural = true; Sim.fluid = true; Sim.star = null; Sim.magnet = null;
  Lab.init(Sim); Vessels.list.length = 0; Lab.plates.length = 0; Lab.tools.length = 0;
  seen.clear();
  return Scenes.load(sceneId);
}
function scene(sceneId, fn) {
  if (only.length && !only.includes(sceneId)) return;
  const s = start(sceneId), t0 = Date.now();
  console.log(s.name);
  fn(s);
  console.log("        " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
}

// ---- The experiments ----
scene("alkali", () => {
  // Counting metal left would mix up two things, because fire also uses it. This is the time taken to get through 25 reactions with water.
  // It was 40, but most potassium burns in the air on the way down and only 35 to 60 grains reach the water, so on about one seed in four
  // potassium never got there. At 25 the order held on 15 seeds out of 15, with room to spare.
  const water = s => logged(new RegExp("^2?" + s + " \\+ 2?H₂O")), air = s => logged(new RegExp("^[0-9]*" + s + " \\+ O₂")), when = {};
  run(600, k => { for (const s of ["Li", "Na", "K"]) if (!when[s] && water(s) >= 25) when[s] = k + 1; });
  const li = when.Li || Infinity;
  check("each reacts with water faster than the last", when.K < when.Na && when.Na < li, "25 reactions by tick: K " + when.K + ", Na " + when.Na + ", Li " + li);
  check("rubidium and caesium catch fire on the way down", air("Rb") > water("Rb") && air("Cs") > water("Cs"), "Rb " + air("Rb") + " in air, " + water("Rb") + " in water; Cs " + air("Cs") + ", " + water("Cs"));
  check("they give off hydrogen", logged(/H₂$/) > 0);
});
scene("thermite", () => {
  const al = count(13);
  run(600);
  check("the front spreads through the charge", logged(/Fe₂O₃ \+ 2Al/) > al * 0.5, logged(/Fe₂O₃ \+ 2Al/) + " of " + al);
  check("molten iron forms", count(26, P_LIQUID) > 100, count(26, P_LIQUID));
  check("it sinks through the slag", meanY(26, P_LIQUID) < meanY("Al2O3"), meanY(26, P_LIQUID).toFixed(1) + " vs " + meanY("Al2O3").toFixed(1));
});
scene("reactor", s => {
  run(300);
  const held = Sim.stats.fissions;
  s.action.run();
  run(300);
  const after = Sim.stats.fissions - held;
  check("cadmium holds the chain back", held < 200, held + " fissions");
  check("withdrawing the rods makes fission climb", after > held * 3, held + " then " + after);
  run(600);
  check("the pool boils", count(WATER, P_GAS) > 0 || logged(/boil/i) > 0 || hottest(WATER) >= 372, "water up to " + hottest(WATER).toFixed(0) + " K");
  check("poison shows in the log", logged(/I-135|Xe-135/) > 0, logged(/I-135|Xe-135/));
});
scene("decay", () => {
  run(600);
  check("alpha and beta decay walk down the chart", logged(/\+ α/) > 0 && logged(/\+ β/) > 0);
  check("lead builds up", count(82) > 100, count(82));
  check("the heaviest nuclei split", Sim.stats.fissions > 0 && count(118) === 0, Sim.stats.fissions + " fissions, " + count(118) + " Og left");
});
scene("discharge", () => {
  const gases = [2, 10, 18, 36, 54], start = gases.map(z => count(z));
  let lit = 0;
  run(120, () => { let n = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.CH[i] && Sim.PH[i] >= P_GAS) n++; lit = Math.max(lit, n); });
  check("current runs through the gas", lit > 20, lit + " cells carrying current");
  check("each gas stays in its sealed tube", gases.every((z, k) => start[k] > 100 && count(z) >= start[k] * 0.98), gases.map((z, k) => count(z) + " of " + start[k]).join(", "));
});
scene("flames", () => {
  // Coloured flame cells on average, over the first half minute and the second. Before the burners, metal powders burned out in a few seconds.
  const tally = () => { const n = {}; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === FLAME && Sim.AUX[i]) n[Sim.AUX[i]] = (n[Sim.AUX[i]] || 0) + 1; return n; };
  const early = {}, late = {}, add = (into) => () => { const n = tally(); for (const z in n) into[z] = (into[z] || 0) + n[z] / 900; };
  run(900, add(early)); run(900, add(late));
  [[3, "lithium"], [11, "sodium"], [19, "potassium"], [29, "copper"], [56, "barium"], [38, "strontium"], [20, "calcium"], [5, "boron"]].forEach(([z, name]) =>
    check(name + " colours its flame, and keeps on doing it", (early[z] || 0) >= 1.5 && (late[z] || 0) >= 1, (early[z] || 0).toFixed(1) + " then " + (late[z] || 0).toFixed(1) + " cells"));
  Lab.plates.forEach(p => Lab.setPlate(p, null));
  run(90);
  check("the Lab tool turns the burners off", count(FLAME) === 0, count(FLAME) + " flame cells left");
});
scene("density", () => {
  const n0 = { hg: count(80), ccl: count("CCl4"), w: count(WATER), oil: count("C8H18"), fe: count(26), al: count(13) };
  run(180);
  const ice = count(WATER, P_POWDER) + count(WATER, P_STATIC), iceY = meanY(WATER, P_POWDER), wNow = meanY(WATER, P_LIQUID), oilNow = meanY("C8H18");
  check("ice stops where the water meets the octane", ice > 20 && iceY > wNow && iceY <= oilNow + 2, ice + " ice at " + iceY.toFixed(1) + ", water " + wNow.toFixed(1) + ", octane " + oilNow.toFixed(1));
  run(420);
  const hg = meanY(80), ccl = meanY("CCl4"), w = meanY(WATER), oil = meanY("C8H18");
  check("the liquids stack by density", hg < ccl && ccl < w && w < oil, [hg, ccl, w, oil].map(v => v.toFixed(1)).join(" < "));
  // Mercury that takes up the gold is still there, as the amalgam.
  check("the liquids stay themselves", count(80) + count("Amalgam") > n0.hg * 0.9 && count("CCl4") > n0.ccl * 0.9 && count(WATER) > n0.w * 0.9 && count("C8H18") > n0.oil * 0.9, [count(80), count("CCl4"), count(WATER), count("C8H18")].join(" "));
  check("iron floats on the mercury", count(26) > n0.fe * 0.9 && Math.abs(meanY(26) - (hg + ccl) / 2) < (ccl - hg), "iron " + meanY(26).toFixed(1) + ", mercury " + hg.toFixed(1) + ", CCl4 " + ccl.toFixed(1));
  check("gold sinks into it and amalgamates", count(79) === 0 || meanY(79) <= hg + 1, count(79) + " Au at " + meanY(79).toFixed(1) + ", " + count("Amalgam") + " amalgam");
  check("aluminium floats on the mercury too", count(13) > n0.al * 0.9 && meanY(13) < ccl, count(13) + " Al at " + meanY(13).toFixed(1));
});
scene("acid", () => {
  const cu = count(29);
  run(600);
  // Reactions rather than cells used, because a grain that is partly eaten still counts as a cell. Each metal has its own beaker of acid.
  check("zinc goes faster than iron", logged(/^Zn \+/) > logged(/^Fe \+/) * 1.3, "Zn " + logged(/^Zn \+/) + " reactions, Fe " + logged(/^Fe \+/));
  check("copper is left alone by the hydrochloric acid", count(29) >= cu * 0.95, count(29) + " of " + cu);
  check("aqua regia dissolves gold", logged(/HAuCl₄/) > 20, logged(/HAuCl₄/));
  check("zinc fizzes", logged(/Zn \+ .*HCl/) > 0, logged(/Zn \+ .*HCl/));
});
scene("golden", () => {
  const water = count(WATER);
  run(600);
  check("yellow lead iodide falls out", amount("PbI2") > 20 && count("PbI2") > 200, count("PbI2") + " cells holding " + amount("PbI2").toFixed(0) + " cells' worth");
  check("the solutions react where they meet", logged(/PbI₂/) > 500, logged(/PbI₂/));
  // Potassium nitrate is soluble. It used to pile up as a white ridge, because the reacting cells had no free slot for it.
  check("potassium nitrate stays dissolved", count("KNO3") < 10 && amount("KNO3") > 10, count("KNO3") + " grains, " + amount("KNO3").toFixed(0) + " cells' worth in all");
  check("the clear solutions do not crust over", count("Pb(NO3)2") + count("KI") === 0, count("Pb(NO3)2") + " + " + count("KI") + " grains");
  // Lead iodide grows on its own grains, so the pool keeps most of its water. Before, each reaction turned a water cell into a near-empty grain
  // and the pool lost about a quarter. Still open: a precipitate forming far from any grain takes a whole water cell. That cost about 12% of
  // the old open pool, and about 22% of the beaker, which is smaller for the same front where the solutions meet.
  check("the pool keeps its water", count(WATER) > water * 0.72, count(WATER) + " of " + water);
});
scene("filament", () => {
  run(300);
  check("tungsten glows white-hot", hottest(74) > 1800, hottest(74).toFixed(0) + " K");
  check("copper stays far cooler", hottest(29) < hottest(74) * 0.5, hottest(29).toFixed(0) + " K");
  run(300);
  check("in air the hot tungsten burns", logged(/W \+ .*O₂/) > 0, logged(/W \+ .*O₂/));
  check("water splits into hydrogen and oxygen", logged(/electrolysis/) > 100 && count(1) > 0 && count(8) > 0, count(1) + " H, " + count(8) + " O");
});
scene("chain", () => {
  run(600);
  check("it walks the chain", ["Th-234", "Pa-234", "U-234", "Th-230", "Ra-226", "Rn-222"].every(n => logged(new RegExp("→ " + n)) > 0));
  check("it ends at lead-206", logged(/→ Pb-206/) > 0 && count(82) > 500, count(82) + " Pb");
});
scene("breeder", () => {
  run(900);
  check("the blanket captures neutrons", logged(/→ U-239/) > 0, logged(/→ U-239/));
  check("then neptunium", logged(/→ Np-239/) > 0, logged(/→ Np-239/));
  check("then plutonium-239", logged(/→ Pu-239/) > 0, logged(/→ Pu-239/));
});
scene("daniell", () => {
  const zn = count(30), cu = count(29);
  run(900);
  check("the cell reads about 1.10 V", logged(/Cell Zn \| Cu: 1\.(0[5-9]|1[0-5]) V/) > 0);
  check("zinc dissolves", count(30) < zn, zn + " to " + count(30));
  check("copper plates out", count(29) > cu, cu + " to " + count(29));
});
scene("titration", () => {
  // The same test the shader uses to colour a cell pink.
  const IND = Mat.named("Phenolphthalein");
  function pink() {
    let n = 0;
    for (let i = 0; i < Sim.ID.length; i++) {
      if (Sim.ID[i] !== WATER || Sim.PH[i] !== P_LIQUID || (Sim.AUX[i] !== IND && Sim.AUX2[i] !== IND)) continue;
      const other = Sim.AUX[i] === IND ? Sim.AUX2[i] : Sim.AUX[i], u = Sim.AUX[i] === IND ? Sim.U2[i] : Sim.USED[i];
      if (Chem.pHfromSolutes(other, other ? Chem.molar(other, u) : 0, 0, 0) > 8.2) n++;
    }
    return n;
  }
  const water = count(WATER), acid = amount("HCl");
  check("the acid starts colourless", pink() === 0, pink());
  run(900);
  // 40 drops of 1 M base against 18 cells' worth of 0.02 M acid. The acid is used up, and what is left of the base stays pink.
  // Each water cell holds two solutes, and salt and indicator fill both, so the leftover base does not spread out to tint the whole beaker.
  check("the base uses up the acid", amount("HCl") < acid * 0.01 && amount("NaCl") > 0, amount("HCl").toFixed(1) + " of " + acid.toFixed(0) + " left");
  check("past the end point the drops stay pink", pink() > 30, pink() + " pink cells");
  check("the pool does not boil away", count(WATER) > water * 0.97 && hottest(WATER) < 373, count(WATER) + " of " + water + ", up to " + hottest(WATER).toFixed(0) + " K");
  // The last drop of water at an edge can briefly leave a cell behind, but acid must not collect on the surface. Before the fix this was 164.
  check("the acid stays in the water", count("HCl") + count(IND) <= 10, count("HCl") + " HCl, " + count(IND) + " indicator cells");
});
scene("bridge", () => {
  function deckTop() { let y = 0; for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === 26 && Sim.PH[i] === P_STATIC && yOf(i) > y) y = yOf(i); return y; }
  const top = deckTop(), lead = count(82);
  let molten = 0;
  run(900, () => { molten = Math.max(molten, count(82, P_LIQUID)); });
  check("the lead melts", molten > lead * 0.2, "up to " + molten + " of " + lead + " cells molten at once");
  check("the deck falls", deckTop() < top - 1, top + " to " + deckTop());
});
scene("volcano", () => {
  const a = count("(NH4)2Cr2O7");
  run(600);
  check("it decomposes to green chromium oxide", count("Cr2O3") > a * 0.5, count("Cr2O3") + " of " + a);
  check("nitrogen comes off", count(7) > 0, count(7));
});
scene("toothpaste", () => {
  const mn = count("MnO2");
  run(600);
  check("a rush of oxygen", count(8) > 500, count(8));
  check("the catalyst is not used up", count("MnO2") === mn, count("MnO2") + " of " + mn);
  // And without the catalyst, peroxide should hold.
  start("toothpaste");
  for (let i = 0; i < Sim.ID.length; i++) if (Sim.ID[i] === Mat.named("MnO2")) { const W = Sim.W, WD = W * Sim.D, y = yOf(i), r = i - y * WD, z = Math.floor(r / W); Sim.erase(r - z * W, y, z); }
  run(300);
  check("peroxide on its own is almost stable", logged(/2H₂O₂/) < 200, logged(/2H₂O₂/) + " events");
});
scene("snake", () => {
  run(600);
  check("sugar turns to black carbon", count(6) > 500, count(6));
  check("it runs hot and gives off steam", hottest(6) > 373 && (count(WATER, P_GAS) > 0 || logged(/11H₂O/) > 0), hottest(6).toFixed(0) + " K");
});
scene("gunpowder", () => {
  const k = count("KNO3");
  run(600);
  check("the hot spot runs through the charge", count("KNO3") < k * 0.6, count("KNO3") + " of " + k);
  // Cold, the same charge must hold still.
  start("gunpowder");
  for (let i = 0; i < Sim.T.length; i++) if (Sim.T[i] > 400) Sim.T[i] = 293;
  run(200);
  check("and it holds still when cold", Sim.stats.reactions < 20, Sim.stats.reactions + " reactions");
});
scene("triiodide", () => {
  const n = count("NI3");
  run(600);
  check("it goes off", count("NI3") < n * 0.1, count("NI3") + " of " + n);
  check("violet iodine comes off", count(53) > 50, count(53));
});
scene("colours", () => {
  run(600);
  check("ammonia makes the blue copper complex", logged(/\[Cu\(NH₃\)₄\]/) > 0, logged(/\[Cu\(NH₃\)₄\]/));
  // Pools are half-molar and the reagents 2 M, so the dropper of thiocyanate (60 drops) can make about three cells' worth at most. It strongly absorbs, so that shows deep red.
  check("thiocyanate makes blood red iron", amount("Fe(SCN)3") > 1, amount("Fe(SCN)3").toFixed(1));
  check("chromate throws down chrome yellow", count("PbCrO4") > 100, count("PbCrO4"));
  check("and brick red with silver", count("Ag2CrO4") > 100, count("Ag2CrO4"));
  const crust = ["CuSO4", "FeCl3", "Pb(NO3)2", "AgNO3", "NH4SCN", "K2CrO4", "KNO3"].reduce((n, s) => n + count(s), 0);
  check("nothing piles up white over the colours", crust < 10, crust + " grains of salt");
});
scene("cryo", () => {
  const n2 = count(7, P_LIQUID), o2 = count(8, P_LIQUID);
  run(600);
  check("nitrogen boils off", count(7, P_GAS) > n2 * 0.15, count(7, P_GAS) + " gas cells from " + n2 + " of liquid");
  check("liquid oxygen is still there", count(8, P_LIQUID) > o2 * 0.5, count(8, P_LIQUID) + " of " + o2);
  check("gallium melts on the warm block", count(31, P_LIQUID) > 10, count(31, P_LIQUID));
});

// ---- Experiments are set up with lab equipment, which the player can pick up and use. ----
// Containers are set down as the experiment loads, so their glass is in the grid from the first tick.
if (!only.length) {
  console.log("Equipment");
  const want = {
    alkali: { beakers: 5 }, thermite: { beakers: 1 }, decay: { beakers: 4, geiger: 1 }, discharge: { beakers: 5, sealed: 5 }, flames: { plates: 8 },
    density: { beakers: 1 }, acid: { beakers: 4 }, golden: { beakers: 1 }, filament: { beakers: 1, supply: 1 }, chain: { beakers: 1, geiger: 1 },
    titration: { beakers: 1, plates: 1, dropper: 1 }, bridge: { plates: 1 }, volcano: { beakers: 1 }, toothpaste: { beakers: 1 }, snake: { beakers: 1 },
    gunpowder: { beakers: 1 }, triiodide: { plates: 1 }, colours: { beakers: 4, dropper: 4 }, cryo: { beakers: 3, plates: 1 }
  };
  for (const sid in want) {
    start(sid);
    const w = want[sid], have = { beakers: Vessels.list.length, plates: Lab.plates.length, sealed: Vessels.list.filter(v => v.sealed).length };
    ["geiger", "supply", "dropper"].forEach(k => { have[k] = Lab.tools.filter(o => o.kind === k).length; });
    const ok = Object.keys(w).every(k => have[k] === w[k]) && Vessels.list.every(v => v.shell) && Lab.plates.every(p => p.stamp);
    check(sid + " stands on the bench with its equipment", ok, Object.keys(w).map(k => k + " " + have[k] + "/" + w[k]).join(", "));
  }
  // The three that were dropped stay dropped.
  check("the stellar forge, boiler and blast furnace are gone", ["star", "boiler", "furnace"].every(sid => !Scenes.list.some(s => s.id === sid)));
}

// ---- Rust needs oxygen. Not an experiment, but a player will try it. ----
if (!only.length) {
  console.log("Rust");
  for (const atm of ["air", "argon", "vacuum"]) {
    Sim.init(32, 24, 32); Sim.seed(SEED); Sim.ambient = 293.15; Sim.atmosphere = atm; Sim.lid = true; Sim.gravity = 1; Sim.star = null;
    Sim.box(8, 1, 8, 23, 3, 23, 26, P_STATIC);
    Sim.box(8, 4, 8, 23, 4, 23, WATER, P_LIQUID);
    seen.clear();
    for (let k = 0; k < 3000; k++) Sim.tick();
    const rusted = logged(/corrodes/);
    if (atm === "air") check("iron under a film of water rusts in air", rusted > 0, rusted);
    else check("and not in " + atm, rusted === 0, rusted);
  }
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
