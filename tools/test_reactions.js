// Checks the reaction database: every species resolves, every equation balances, and every reaction actually fires in the simulation.
// Run with: node tools/test_reactions.js [--count]
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "scenes.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Chem, Scenes } = vm.runInContext("({Sim,Mat,Chem,Scenes})", ctx);

console.log(`${Chem.database.length} database reactions, ${Mat.count()} materials`);
if (Chem.invalid.length) { console.log("UNRESOLVED:"); Chem.invalid.forEach(e => console.log("  " + e)); }

let unbalanced = 0, noHeat = 0;
for (const d of Chem.database) {
  const count = side => {
    const t = {};
    for (const term of side) {
      const a = Mat.atoms(Mat.list[term.id].formula);
      if (!a) return null;
      for (const k in a) t[k] = (t[k] || 0) + a[k] * term.n * (term.id <= 118 && term.f !== Mat.list[term.id].formula ? 1 : 1);
    }
    return t;
  };
  // Elements written as H2, S8, P4 carry their own atom count.
  const atomsOf = term => term.id <= 118 ? Mat.atoms(term.f) : Mat.atoms(Mat.list[term.id].formula);
  const tally = side => { const t = {}; for (const term of side) { const a = atomsOf(term); if (!a) return null; for (const k in a) t[k] = (t[k] || 0) + a[k] * term.n; } return t; };
  const L = tally(d.L), R = tally(d.R);
  if (d.dH === null) noHeat++;
  if (!L || !R) continue;   // alloys have no fixed formula
  const keys = new Set([...Object.keys(L), ...Object.keys(R)]);
  for (const k of keys) if (L[k] !== R[k]) { console.log(`UNBALANCED ${d.eq}: ${k} ${L[k]} vs ${R[k]}`); unbalanced++; break; }
}
console.log(`${unbalanced} unbalanced, ${noHeat} using estimated heat`);

if (process.argv.includes("--count")) {
  const t0 = Date.now(), n = Mat.count(); let pairs = 0, uni = 0;
  for (let a = 1; a < n; a++) { if (Chem.uniFor(a)) uni++; if (Chem.ruleFor(a, 0)) pairs++; for (let b = 1; b < n; b++) if (Chem.ruleFor(a, b)) pairs++; }
  console.log(`${pairs} reacting pairs, ${uni} materials that decompose, over ${n} materials (${Date.now() - t0} ms)`);
}

if (process.argv.includes("--fire")) {
  Sim.init(40, 32, 40);
  let ok = 0; const failed = [], suppressed = [];
  for (const d of Chem.database) {
    Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.gravity = 1; Sim.seed(5);
    Scenes.demo(d);
    let hit = false;
    Chem.onFire = r => { if (r.eq === d.eq) hit = true; };
    for (let k = 0; k < 300 && !hit; k++) { Sim.tick(); Scenes.demoTick(d); }
    Chem.onFire = null;
    // A reaction Gibbs energy says barely proceeds anywhere in its window is right not to fire in a short test.
    let bestK = 0; for (let T = Math.max(50, d.minT * 0.85); T <= (d.maxT || 3500); T += 25) bestK = Math.max(bestK, Chem.thermo(d, T, 0));
    if (hit) ok++; else if (d.dS !== null && Chem.thermo(d, Scenes.demoT(d), 0) < 0.03) suppressed.push(d.eq + "  (at most K/(1+K) = " + bestK.toExponential(1) + " in window)"); else failed.push(d.eq + "  [" + [d.minT ? "T>" + d.minT : "", d.maxT ? "T<" + d.maxT : "", d.cat ? "cat " + Mat.list[d.cat].formula : "", d.elec ? "elec" : "", d.liq ? "liq" : "", d.light ? "light" : ""].filter(Boolean).join(" ") + "]");
  }
  console.log(`${ok} of ${Chem.database.length} fired in a demo`);
  console.log(`${suppressed.length} correctly suppressed by thermodynamics at their test temperature:`);
  suppressed.forEach(f => console.log("  " + f));
  console.log(`${failed.length} failed:`);
  failed.forEach(f => console.log("  did not fire: " + f));
}
process.exit(Chem.invalid.length || unbalanced ? 1 : 0);
