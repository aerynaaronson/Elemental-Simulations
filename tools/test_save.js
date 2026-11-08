// Save files and restoring state: round trips, damaged files, and every experiment going through the format without being refused.
// Run with: node tools/test_save.js
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const root = path.join(__dirname, "..", "js");
const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Float64Array, Set, Map, Atomics, Object, performance, TextEncoder, TextDecoder, Number, JSON, Array, Error, Infinity });
for (const f of ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "scenes.js", "vessels.js", "lab.js", "savefile.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { Sim, Mat, Scenes, Vessels, Lab, SaveFile, WALL, AIR, P_LIQUID, P_POWDER, P_STATIC } = vm.runInContext("({Sim,Mat,Scenes,Vessels,Lab,SaveFile,WALL,AIR,P_LIQUID,P_POWDER,P_STATIC})", ctx);

let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? "pass " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); if (!ok) failed++; };
const env = { Mat, WALL, labCheck: Lab.check };
const WATER = Mat.byFormula.H2O;
function fresh(w, h, d) { Sim.init(w || 40, h || 32, d || 40); Sim.seed(11); Sim.ambient = 293.15; Sim.atmosphere = "air"; Sim.lid = false; Sim.gravity = 1; Sim.setDecayScale(1); Sim.star = null; Lab.init(Sim); Vessels.list.length = 0; Lab.plates.length = 0; }
function run(n) { for (let k = 0; k < n; k++) { Lab.update(1 / 30); Sim.tick(); Lab.step(); } }
function capture(extra) { const s = Sim.snapshot(); s.lab = Lab.serialize(); return Object.assign(s, extra); }
const bytesOf = state => { const parts = SaveFile.encode(state, Mat); return new Uint8Array(Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength)))); };
const refused = (bytes, want) => { try { SaveFile.decode(bytes, env); return false; } catch (e) { return !!e.friendly && (!want || e.message.indexOf(want) >= 0); } };
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
// A copy of a file with its header edited and the body unchanged.
function withHeader(bytes, edit) { const nl = bytes.indexOf(10), head = JSON.parse(Buffer.from(bytes.subarray(0, nl)).toString()); edit(head); return new Uint8Array(Buffer.concat([Buffer.from(JSON.stringify(head) + "\n"), Buffer.from(bytes.subarray(nl + 1))])); }
const bodyOffset = bytes => bytes.indexOf(10) + 1;

// 1. A round trip brings back every cell, the world settings and the equipment.
fresh();
Sim.box(4, 1, 4, 20, 6, 20, WATER, P_POWDER);
Sim.gravity = 0.16; Sim.lid = true; Sim.atmosphere = "argon"; Sim.ambient = 310; Sim.setDecayScale(25); Sim.star = { x: 5, y: 6, z: 7 }; Sim.structural = false; Sim.fluid = false; Sim.enrichment = 0.5;
const plate = Lab.spawnPlate(30, 1, 30, { setT: 500 });
const beaker = Lab.spawnBeaker(30, 3, 30, { type: "tube" });
Lab.fill(beaker, Mat.byFormula.NaHCO3, P_POWDER, 40);
const loose = Lab.spawnBeaker(10, 25, 10);
Lab.fill(loose, WATER, P_LIQUID, 100);
Lab.tilt(loose, 0.2); loose.pinTilt = true;
run(14);
const state = capture({ scene: "alkali", camera: { yaw: 1, pitch: 0.5, dist: 80, tx: 1, ty: 2, tz: 3 } });
const bytes = bytesOf(state);
const back = SaveFile.decode(bytes, env);
check("every cell array survives a round trip", SaveFile.FIELDS.every(f => same(state[f], back[f])));
check("world settings survive", back.lid === true && back.atmosphere === "argon" && back.ambient === 310 && back.world.gravity === 0.16 && back.world.decayScale === 25 && back.world.star.z === 7 && back.world.structural === false && back.world.fluid === false && back.world.enrichment === 0.5);
check("scene and camera survive", back.scene === "alkali" && back.camera.dist === 80);
check("a clean file needs no repairs", back.repaired === 0);
check("the stored field types match the simulation", SaveFile.FIELDS.every(f => Sim[f].constructor.name === back[f].constructor.name));

// 2. Restoring into a chamber: cells, settings and equipment come back and keep working.
const wantGrid = Sim.ID.slice(), wantPlateCells = plate.stamp.cells.length, wantShell = beaker.shell && beaker.shell.wall.length;
check("the test set-up has a set-down container and plate", !!beaker.shell && !!plate.stamp);
fresh();
Sim.restore(back);
Lab.deserialize(back.lab);
check("grid restored", same(Sim.ID, wantGrid));
check("Sim settings restored", Sim.gravity === 0.16 && Sim.decayScale === 25 && Sim.star && Sim.star.x === 5 && Sim.structural === false && Sim.fluid === false && Sim.enrichment === 0.5 && Sim.lid === true && Sim.atmosphere === "argon");
const b2 = Vessels.list.filter(v => v.type === "tube")[0], loose2 = Vessels.list.filter(v => !v.shell)[0], p2 = Lab.plates[0];
check("equipment restored", Vessels.list.length === 2 && Lab.plates.length === 1 && !!b2.shell && b2.shell.wall.length === wantShell && p2.stamp.cells.length === wantPlateCells && p2.setT === 500);
check("a loose beaker keeps its inventory and tilt", !!loose2 && Vessels.amount(loose2) > 0 && Math.abs(loose2.tilt - 0.2) < 1e-9 && loose2.pinTilt);
const oldIds = Lab.all().map(o => o.id), added = Lab.spawnBeaker(5, 5, 5);
check("new objects do not reuse an old id", oldIds.every(id => added.id > id), added.id + " after " + oldIds.join(","));
Lab.remove(added);
Sim.gravity = 1; Sim.star = null; Sim.structural = true; Sim.fluid = true; Sim.enrichment = null;
// The plate has been baking the soda, so count what is really in the glass rather than how much soda went in.
const liftBefore = Vessels.amountNow(b2, Sim);
Lab.grab(b2);
check("a restored set-down container can be picked up", !b2.shell && Vessels.amount(b2) === liftBefore && liftBefore > 0, Vessels.amount(b2) + " of " + liftBefore);
Lab.grab(p2);
check("a restored plate can be lifted out of the grid", !p2.stamp);

// 3. Damaged and foreign files are refused before anything is touched.
fresh();
Sim.box(4, 1, 4, 12, 4, 12, WATER, P_POWDER);
const good = bytesOf(capture({}));
check("the good file loads", !refused(good));
const gridBefore = Sim.ID.slice();
check("random bytes", refused(new Uint8Array(4096).map((_, k) => (k * 37) & 0xff), "not a saved"));
check("empty file", refused(new Uint8Array(0), "not a saved"));
check("a text file", refused(new Uint8Array(Buffer.from("hello world\nsecond line\n")), "not a saved"));
check("a JSON file of something else", refused(new Uint8Array(Buffer.from('{"name":"x"}\n')), "not a saved"));
check("another format", refused(withHeader(good, h => { h.format = "other-1"; }), "not a saved"));
check("a future version", refused(withHeader(good, h => { h.format = "elemental-3"; }), "newer"));
check("a different material count", refused(withHeader(good, h => { h.count = 5; }), "different version"));
check("a same-sized but different material list", refused(withHeader(good, h => { h.matHash = 1; }), "different version"));
check("cut short", refused(good.subarray(0, good.length - 100), "damaged"));
check("extra bytes on the end", refused(new Uint8Array(Buffer.concat([Buffer.from(good), Buffer.alloc(10)])), "damaged"));
check("absurd chamber size", refused(withHeader(good, h => { h.W = 100000; }), "damaged"));
check("fractional chamber size", refused(withHeader(good, h => { h.W = 40.5; }), "damaged"));
check("chamber too small", refused(withHeader(good, h => { h.W = 2; }), "damaged"));
check("wrong size for the body", refused(withHeader(good, h => { h.W = 41; }), "damaged"));
check("bad ambient", refused(withHeader(good, h => { h.ambient = -5; }), "damaged"));
check("unknown atmosphere", refused(withHeader(good, h => { h.atmosphere = "soup"; }), "damaged"));
check("bad gravity", refused(withHeader(good, h => { h.world.gravity = "lots"; }), "damaged"));
check("bad decay scale", refused(withHeader(good, h => { h.world.decayScale = 0; }), "damaged"));
const poke = (at, value) => { const c = good.slice(); c.set(value, bodyOffset(c) + at); return c; };
const N = Sim.ID.length, inner = Sim.idx(20, 20, 20);
check("a material id past the end of the list", refused(poke(inner * 2, [0xff, 0xff]), "damaged"));
check("an unknown phase", refused(poke(N * 2 + inner, [9]), "damaged"));
check("a solute id past the end of the list", refused(poke(N * 2 + N + N * 4 + N * 4 + inner * 2, [0xff, 0xff]), "damaged"));
check("a hole in the chamber's outer wall", refused(poke(0, [0, 0]), "damaged"));
check("none of those refused files changed the chamber", same(Sim.ID, gridBefore));
// Equipment that points outside the chamber must not get as far as the simulation.
const withLab = (() => { fresh(); const v = Lab.spawnBeaker(20, 1, 20); run(8); return { bytes: bytesOf(capture({})), ok: !!v.shell }; })();
check("the equipment file loads", withLab.ok && !refused(withLab.bytes));
check("a shell cell outside the chamber", refused(withHeader(withLab.bytes, h => { h.lab.beakers[0].shell.wall[0] = 1e9; }), "damaged"));
check("a beaker with a broken position", refused(withHeader(withLab.bytes, h => { h.lab.beakers[0].x = null; }), "damaged"));
check("a beaker of an unknown type", refused(withHeader(withLab.bytes, h => { h.lab.beakers[0].type = "bucket"; }), "damaged"));
check("contents with an unknown material", refused(withHeader(withLab.bytes, h => { h.lab.beakers[0].contents = [{ mat: 99999, form: P_LIQUID, aux: 0, n: 1, T: 300 }]; }), "damaged"));
check("a plate with a broken dial", refused(withHeader(withLab.bytes, h => { h.lab.plates = [{ id: 9, name: "x", x: 1, y: 1, z: 1, half: 2, h: 2, setT: "hot", stamp: null }]; }), "damaged"));
check("equipment that is not a list", refused(withHeader(withLab.bytes, h => { h.lab.beakers = 7; }), "damaged"));

// 4. One bad number does not throw the whole chamber away, and does not get into the simulation.
fresh();
const nanFile = bytesOf(capture({}));
const body = bodyOffset(nanFile), tOffset = N * 3;   // T follows ID (2 bytes a cell) and PH (1 byte a cell)
const nanBytes = nanFile.slice();
new DataView(nanBytes.buffer).setFloat32(body + tOffset + inner * 4, NaN, true);
new DataView(nanBytes.buffer).setFloat32(body + tOffset + (inner + 1) * 4, Infinity, true);
const repaired = SaveFile.decode(nanBytes, env);
check("bad temperatures are replaced, not spread", repaired.repaired === 2 && repaired.T[inner] === Math.fround(repaired.ambient) && repaired.T[inner + 1] === Math.fround(repaired.ambient), repaired.repaired + " repaired");

// 5. The older file format still opens.
fresh();
Sim.box(4, 1, 4, 12, 4, 12, WATER, P_POWDER);
const v2 = bytesOf(capture({}));
const old = withHeader(v2, h => { h.format = "elemental-1"; delete h.matHash; delete h.world; delete h.lab; delete h.scene; delete h.camera; });
const oldState = SaveFile.decode(old, env);
check("an elemental-1 file loads", same(oldState.ID, Sim.ID) && oldState.world === null && oldState.lab === null);
fresh();
Sim.gravity = 3;
Sim.restore(oldState); Lab.deserialize(oldState.lab);
check("loading one leaves settings it does not record alone", Sim.gravity === 3);
Sim.gravity = 1;

// 6. Every experiment's real state goes through the format. Validation must never refuse a file the game itself wrote.
let refusedScenes = [], worst = 0;
for (const s of Scenes.list) {
  fresh(64, 48, 64);
  Sim.lid = false; Sim.setDecayScale(1); Sim.enrichment = null; Sim.isotopeOverride = null;
  Scenes.load(s.id);
  for (let k = 0; k < 40; k++) Sim.tick();
  try {
    const st = capture({ scene: s.id }), r = SaveFile.decode(bytesOf(st), env);
    worst = Math.max(worst, r.repaired);
    if (!SaveFile.FIELDS.every(f => f === "T" || f === "PR" || f === "USED" || f === "U2" || same(st[f], r[f]))) refusedScenes.push(s.id + " changed");
  } catch (e) { refusedScenes.push(s.id + ": " + e.message); }
}
check("all " + Scenes.list.length + " experiments save and load", refusedScenes.length === 0, refusedScenes.join("; "));
check("no experiment needs repairs", worst === 0, "worst " + worst);
Sim.setDecayScale(1);

// 7. Compressed size stays practical for a real chamber, so autosaving often is reasonable.
fresh(96, 64, 96);
Sim.box(4, 1, 4, 91, 10, 91, WATER, P_POWDER);
for (let k = 0; k < 30; k++) Sim.tick();
const t0 = Date.now(), big = bytesOf(capture({})), t1 = Date.now(), gz = zlib.gzipSync(Buffer.from(big), { level: 6 }), t2 = Date.now();
SaveFile.decode(big, env);
const t3 = Date.now();
check("a medium chamber compresses well", gz.length < big.length / 5, (big.length / 1048576).toFixed(1) + " MB -> " + (gz.length / 1048576).toFixed(2) + " MB, encode " + (t1 - t0) + " ms, gzip " + (t2 - t1) + " ms, decode " + (t3 - t2) + " ms");
check("checking a file takes well under a second", t3 - t2 < 1000, (t3 - t2) + " ms");

// 8. Settings cannot be broken by a stale or hand-edited entry.
vm.runInContext(fs.readFileSync(path.join(root, "settings.js"), "utf8"), ctx, { filename: "settings.js" });
const Settings = vm.runInContext("Settings", ctx);
const memory = { value: null, getItem() { return this.value; }, setItem(k, v) { this.value = v; } };
memory.value = '{"quality":"ultra","uiScale":99,"autosave":"maybe","chamber":"1,1,1"}';
Settings.useStorage(memory);
check("unknown setting values fall back to defaults", Settings.get("quality") === "auto" && Settings.get("uiScale") === 1 && Settings.get("autosave") === true && Settings.get("chamber") === "auto");
memory.value = "{not json";
Settings.useStorage(memory);
check("an unreadable settings entry falls back to defaults", Settings.get("quality") === "auto");
check("a value off the list is refused", Settings.set("quality", "ultra") === false && Settings.get("quality") === "auto");
check("a fixed quality gives a fixed render scale, automatic gives none", Settings.renderScale() === null && Settings.set("quality", "low") && Settings.renderScale() === 0.45);
Settings.useStorage(memory);
check("a chosen value is still there next time", Settings.get("quality") === "low" && /low/.test(memory.value));
check("favourites are kept as a list of material ids", Settings.set("favourites", [29, 26, 123]) && Settings.get("favourites").join() === "29,26,123");
check("a broken favourites list is refused", !Settings.set("favourites", [1.5]) && !Settings.set("favourites", "Cu") && !Settings.set("favourites", new Array(41).fill(1)) && Settings.get("favourites").length === 3);
memory.value = '{"favourites":[29,"x"],"room":"jungle"}';
Settings.useStorage(memory);
check("stored favourites that are not ids, and an unknown room, fall back", Settings.get("favourites").length === 0 && Settings.get("room") === "lab");
Settings.set("favourites", [29]); Settings.set("quality", "low");
Settings.reset();
check("reset goes back to the defaults", Settings.get("quality") === "auto" && Settings.renderScale() === null);
check("but keeps the player's favourites", Settings.get("favourites").join() === "29");

console.log(failed ? failed + " failed" : "all save tests passed");
process.exit(failed ? 1 : 0);
