// Checks the lab equipment meshes made in Blender (tools/blender/labware.py -> js/labware.data.js) against the simulation:
// every model and material the game draws exists, the data decodes cleanly, the shapes sit where the simulation puts the real cells,
// and every kind of equipment, loose and set down, gives a list of meshes to draw.
// Run with: node tools/test_labware.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance, Buffer });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "vessels.js", "lab.js", "labware.data.js", "lab-meshes.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Lab, Vessels, LabMeshes, LABWARE, P_LIQUID } = vm.runInContext("({Sim,Mat,Lab,Vessels,LabMeshes,LABWARE,P_LIQUID})", ctx);

let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? "pass " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); if (!ok) failed++; };
const parts = model => (LABWARE.models[model] || []).map(p => LabMeshes.decode(p));
const verts = (model, part) => { const out = []; parts(model).filter(p => !part || p.part === part).forEach(p => { for (let k = 0; k < p.count; k++) out.push([p.pos[k * 3], p.pos[k * 3 + 1], p.pos[k * 3 + 2]]); }); return out; };
const range = (vs, a) => [Math.min(...vs.map(v => v[a])), Math.max(...vs.map(v => v[a]))];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. Every model the game draws is in the data, and every part's material is one the game knows.
const missing = LabMeshes.MODELS_USED.filter(m => !LABWARE.models[m]);
check("every model the game draws was exported", !missing.length, missing.join(", "));
const badMats = [];
Object.keys(LABWARE.models).forEach(m => LABWARE.models[m].forEach(p => { if (!LabMeshes.MATS[p.mat]) badMats.push(m + "." + p.part + ":" + p.mat); }));
check("every part's material is defined", !badMats.length, badMats.join(", "));

// 2. The data decodes into whole triangles with indices in range and normals of unit length.
let bad = [], tris = 0;
Object.keys(LABWARE.models).forEach(m => parts(m).forEach(p => {
  if (p.idx.length % 3 || p.idx.some(i => i >= p.count)) bad.push(m + "." + p.part + " indices");
  for (let k = 0; k < p.count; k++) { const l = Math.hypot(p.nrm[k * 3], p.nrm[k * 3 + 1], p.nrm[k * 3 + 2]) / 127; if (l < 0.9 || l > 1.1) { bad.push(m + "." + p.part + " normals"); break; } }
  if (p.pos.some(v => !isFinite(v))) bad.push(m + "." + p.part + " positions");
  tris += p.idx.length / 3;
}));
check("the meshes decode cleanly", !bad.length, bad.length ? bad.slice(0, 5).join(", ") : tris + " triangles");

// 3. Containers: the inner glass sits just outside the inside cells (which reach r + 0.5), the floor is the first cell layer and the rim is at h + 1.
Object.keys(Lab.CONTAINERS).forEach(type => {
  const c = Lab.CONTAINERS[type], model = type === "bottle" ? "bottle" : type, vs = verts(model, "body");
  // Away from the spout (+X), between the floor's fillet and the rim: the smallest radius is the inside of the wall. A straight wall has
  // vertices only at its ends, so the band runs from just above the floor to just under the rim.
  const mid = vs.filter(v => v[0] < 0 && v[1] > 1.25 && v[1] < c.height + 0.98).map(v => Math.hypot(v[0], v[2]));
  const inner = Math.min(...mid), outer = Math.max(...mid), y = range(vs, 1);
  check(c.label + ": inner wall just outside the cells it holds", inner >= c.radius + 0.5 && inner <= c.radius + 0.62, "inner " + inner.toFixed(2) + " for radius " + c.radius);
  check(c.label + ": wall no wider than the glass cells", outer <= c.radius + 2.0, "outer " + outer.toFixed(2));
  check(c.label + ": stands on its base with its rim at h + 1", near(y[0], 0, 0.01) && near(y[1], c.height + 1, 0.15), "y " + y[0].toFixed(2) + " to " + y[1].toFixed(2));
  const floor = vs.filter(v => Math.hypot(v[0], v[2]) < 0.5 && v[1] > 0.5).map(v => v[1]);
  check(c.label + ": inner floor at the top of the floor cells", floor.length && near(Math.min(...floor), 1, 0.02), floor.length ? "floor " + Math.min(...floor).toFixed(2) : "none");
});
// 4. Plates: things stand on their top, which must be at the slab's height, and they fill their footprint.
[["hotplate", 6, 2], ["stirrer", 6, 2], ["chiller", 6, 2], ["balance", 5, 2], ["burner", 2, 4]].forEach(([m, half, h]) => {
  const top = m === "balance" ? verts(m, "pan") : m === "burner" ? verts(m, "fiber").concat(verts(m, "gauze")) : verts(m, "top");
  const body = verts(m).filter(v => v[2] < half + 0.55);   // knobs stick out in front
  const yr = range(top, 1), xr = range(body, 0);
  check(m + ": its top is the surface things stand on", near(yr[1], h, 0.02), "top " + yr[1].toFixed(3));
  check(m + ": it fills its footprint", near(xr[0], -(half + 0.5), 0.15) && near(xr[1], half + 0.5, 0.15), "x " + xr[0].toFixed(2) + " to " + xr[1].toFixed(2));
});
const jar = verts("jar", "glass"), jarIn = Math.min(...jar.filter(v => v[1] > -0.01 && v[1] < 14.5 && v[0] < 0).map(v => Math.hypot(v[0], v[2])));
check("bell jar: inner wall just outside the cells under it", jarIn >= 8.5 && jarIn <= 8.62, "inner " + jarIn.toFixed(2));
const funnel = verts("funnel", "glass");
const funnelOk = [4, 5, 6, 7, 8].every(dy => {
  const r = Lab.funnelRadius({ stem: 3, len: 8, rTop: 4 }, dy), y = dy + 0.5;
  const ring = funnel.filter(v => Math.abs(v[1] - y) < 0.13).map(v => Math.hypot(v[0], v[2]));
  return ring.length && Math.min(...ring) >= r + 0.45 && Math.min(...ring) <= r + 0.7;
});
check("funnel: its cone follows the cells it holds", funnelOk);

// 5. Every kind of equipment, loose and set down, gives meshes to draw, with sound matrices and models that exist.
Sim.init(64, 48, 64); Sim.seed(3); Sim.ambient = 293.15; Lab.init(Sim); Lab.clear();
const run = n => { for (let k = 0; k < n; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); } };
const W = Mat.byFormula.H2O;
Lab.spawnPlate(12.5, 1, 12.5); Lab.spawnStirrer(32.5, 1, 12.5, { stir: 2 }); Lab.spawnChiller(50.5, 1, 12.5); Lab.spawnBalance(12.5, 1, 32.5); Lab.spawnBurner(50.5, 1, 32.5);
run(10);
const onStir = Lab.spawnBeaker(32.5, 3, 12.5); Lab.fill(onStir, W, P_LIQUID, 100);
Lab.spawnBottle(12.5, 3, 32.5, "hcl"); Lab.spawnBeaker(12.5, 3, 12.5, { type: "crucible" }); Lab.spawnBeaker(50.5, 3, 12.5, { type: "dish" });
const flask = Lab.spawnBeaker(32.5, 1, 34.5, { type: "flask" }); Lab.fill(flask, W, P_LIQUID, 400);
const tube = Lab.spawnBeaker(5.5, 1, 52.5, { type: "tube" });
run(30);
const carried = Lab.spawnBeaker(30.5, 30, 50.5); Lab.fill(carried, W, P_LIQUID, 100); Lab.grab(carried); Lab.tilt(carried, 0.5); Lab.setStopper(carried, true);
Lab.spawnSupply(32.5, 30, 34.5); Lab.spawnProbe(32.5, 30, 12.5); Lab.spawnDropper(5.5, 30, 52.5); Lab.spawnFunnel(40, 20, 50);
const syr = Lab.spawnSyringe(50.5, 1, 52.5); Lab.connect(syr, flask);
["tongs", "igniter", "geiger"].forEach((k, n) => Lab.spawnTool(k, 18.5 + n * 6, 3, 52.5));
const jarT = Lab.spawnTool("jar", 12.5, 30, 32.5);
const cond = Lab.spawnTool("condenser", 50, 16, 40); Lab.connect(cond, onStir);
run(30);
const items = LabMeshes.collect(), models = new Set(items.map(i => i.model));
const want = ["beaker", "tube", "flask", "crucible", "dish", "bottle", "stopper", "hotplate", "stirrer", "chiller", "balance", "burner", "stirbar", "thermometer",
  "dropper", "rod", "supply", "funnel", "syringe", "seg", "ball", "stand", "boss", "jaws", "tongs", "igniter", "geiger", "jar", "pump", "cond_end", "cond_nipple", "cond_tip"];
check("every kind of equipment is drawn", want.every(m => models.has(m)), want.filter(m => !models.has(m)).join(", ") || items.length + " meshes");
check("every mesh drawn exists and has a sound matrix", items.every(i => LABWARE.models[i.model] && i.m.length === 16 && Array.from(i.m).every(isFinite) && Math.abs(LabMeshes.mat.normalMatrix(i.m).det) > 1e-6));
// A set-down container's model stands where its cells are: base on the shell's floor layer, centred on its middle cell.
const it = items.find(i => i.model === "flask");
check("a set-down container's mesh stands on its cells", !!flask.shell && near(it.m[12], flask.shell.cx + 0.5, 1e-6) && near(it.m[13], flask.shell.by, 1e-6) && near(it.m[14], flask.shell.cz + 0.5, 1e-6));
const carriedItem = items.find(i => i.model === "beaker" && near(i.m[13], Vessels.base(carried)[1], 1e-6));
check("a carried container's mesh tips with it", !!carriedItem && near(carriedItem.m[1], Vessels.frame(carried).a[1], 1e-6), carriedItem ? "a.y " + carriedItem.m[1].toFixed(3) : "not found");
check("the jar and its pump are drawn once it is set down over the bench", !!jarT.stamp && items.some(i => i.model === "pump"));

// 6. A container set down between frames is hidden on the very frame its glass is first shaded. The renderer shades dirty chunks and then
// calls LabRender.afterShade, before the lab interface has had its turn that frame, so the hide list must not lag a frame behind.
for (const f of ["shade.js", "lab-render.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Shade, LabRender } = vm.runInContext("({Shade,LabRender})", ctx);
LabMeshes.ready = true;   // as once the meshes have loaded in a browser
Sim.init(64, 48, 64); Sim.seed(5); Sim.ambient = 293.15; Lab.init(Sim); Lab.clear(); Shade.init();
// One renderer frame: shade whatever is dirty, then let the lab paint over it, as Render.uploadDirty does.
function frame() {
  const list = []; for (let k = 0; k < Sim.DIRTY.length; k++) if (Sim.DIRTY[k]) { list.push(k); Sim.DIRTY[k] = 0; }
  list.forEach(k => Shade.chunkByIndex(k));
  LabRender.afterShade(list, list.length);
}
const shown = cells => cells.filter(i => Shade.colorBuf[i * 4 + 3] !== 0).length;
LabRender.update(); frame();
const dropped = Lab.spawnBeaker(20.5, 1, 20.5);
Lab.fill(dropped, W, P_LIQUID, 120);
for (let k = 0; k < 40 && !dropped.shell; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); }   // it comes to rest and is set down, with no frame drawn
frame();   // the first frame after: the interface has not run since
check("a container set down between frames is hidden on the first frame", !!dropped.shell && shown(dropped.shell.wall) === 0, dropped.shell ? shown(dropped.shell.wall) + " of " + dropped.shell.wall.length + " glass cells drawn as voxels" : "not set down");
// Picked up and set down somewhere else: the old spot shows nothing and the new one is hidden at once.
Lab.grab(dropped); LabRender.update(); frame();
Lab.move(dropped, 40.5, 1, 40.5); Lab.release(dropped);
for (let k = 0; k < 40 && !dropped.shell; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); }
frame();
check("set down again elsewhere, it is hidden on the first frame too", !!dropped.shell && shown(dropped.shell.wall) === 0, dropped.shell ? shown(dropped.shell.wall) + " cells drawn" : "not set down");
const plateNew = Lab.spawnPlate(20.5, 1, 44.5);
for (let k = 0; k < 20 && !plateNew.stamp; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); }
frame();
check("a plate is hidden on the first frame it is shaded", !!plateNew.stamp && shown(plateNew.stamp.cells) === 0);

console.log(failed ? failed + " failed" : "all labware tests passed");
process.exit(failed ? 1 : 0);
