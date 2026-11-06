// Writes every named species and its entered data as JSON, for tools/verify_species.py. Usage: node tools/dump_species.js <out.json>
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Map, Atomics, Object, performance });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Mat } = vm.runInContext("({Mat})", ctx);
const rows = [];
for (const m of Mat.list) {
  if (!m || m.kind !== "compound" || m.est || m.isAlloy) continue;
  rows.push({ f: m.formula, name: m.name, lookup: m.name.replace(/\(I+V?\)/g, x => x), mp: m.mp, bp: m.bp, rho: m.rhoS, M: +m.M.toFixed(2), Hf: m.Hf === undefined ? null : m.Hf });
}
fs.writeFileSync(process.argv[2], JSON.stringify(rows));
console.log(rows.length, "species");
