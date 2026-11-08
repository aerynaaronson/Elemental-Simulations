// Lab: the object and interaction layer between input and the simulation.
// Desktop mouse code, a future VR layer and scripted tests all drive the lab through these calls, never the grid directly:
//   spawnBeaker, spawnPlate, grab, release, move, tilt, turn, remove, fill, setPlate, transferMaterial, placeMaterial, applyHeat
// Two clocks drive it. update(dt) runs every frame and only moves objects: falling, settling, righting. step() runs once per
// simulation tick, between ticks, and is the only place objects write to the grid: pouring, catching, setting down and heating.
// Grabbing is the one exception: it lifts a set-down object out of the grid at once, so a held object is never half in the world.
var Lab = (function () {
  var L = { plates: [], tools: [] };
  var EASE = 2.5;       // radians per second a released beaker rights itself
  var FALL = 40;        // cells per second a released object drops
  var REST_TICKS = 4;   // ticks an object must sit still before it is set down into the grid
  var CONTACT = 0.15;   // share of the gap to the plate temperature closed each tick by touching cells
  // A stopper pops once gas other than air fills this share of the headspace. Air in the sim is empty space, so gas added to a sealed
  // vessel stands for pressure on top of the air already there: a quarter is about 1.25 atm, a loosely fitting stopper. Air at room
  // temperature over water holds about 0.01, and a beaker brought to the boil passes 0.25 within a few seconds.
  var POP_SHARE = 0.25;
  var POP_KPA = 20;     // or once the gas under it is this far above the room's pressure
  var sim = null;

  L.init = function (Sim) { sim = Sim; refreshGate(); };
  L.beakers = function () { return Vessels.list; };
  L.all = function () { return Vessels.list.concat(L.plates, L.tools); };
  function isTool(o) { return !!L.TOOLS[o.kind]; }
  L.isTool = isTool;
  L.get = function (id) { var a = L.all(); for (var k = 0; k < a.length; k++) if (a[k].id === id) return a[k]; return null; };
  function obj(o) { return typeof o === "number" ? L.get(o) : o; }
  L.clear = function () {
    Vessels.list.slice().forEach(function (v) { Vessels.remove(v, sim); });
    L.plates.slice().forEach(function (p) { L.remove(p); });
    L.tools.slice().forEach(function (o) { L.remove(o); });
  };

  // ---- Spawning ----
  // The containers on offer differ only in shape. All of them are the same object underneath, so pouring, setting down and heating work the same.
  L.CONTAINERS = {
    beaker: { label: "Beaker", radius: 4, height: 12 },
    tube: { label: "Test tube", radius: 2, height: 14 },
    flask: { label: "Large beaker", radius: 7, height: 14 },
    crucible: { label: "Crucible", radius: 4, height: 5 },
    dish: { label: "Evaporating dish", radius: 6, height: 3 },
    bottle: { label: "Reagent bottle", radius: 3, height: 10 }
  };
  // The reagent shelf: solutions made up at a stated strength, and a few pure liquids. A solution is water with the reagent dissolved in it.
  // Strength in the simulation is the share of a full cell of solute, 1 - USED, so a molarity M is M / (n0 * 1000) of a full cell.
  L.REAGENTS = [
    { key: "water", label: "Distilled water", mat: "H2O" },
    { key: "hcl", label: "Hydrochloric acid, 1 M", aux: "HCl", M: 1 },
    { key: "h2so4", label: "Sulfuric acid, 0.5 M", aux: "H2SO4", M: 0.5 },
    { key: "hno3", label: "Nitric acid, 1 M", aux: "HNO3", M: 1 },
    { key: "vinegar", label: "Vinegar (acetic acid, 0.8 M)", aux: "CH3COOH", M: 0.8 },
    { key: "naoh", label: "Sodium hydroxide, 1 M", aux: "NaOH", M: 1 },
    { key: "nh3", label: "Ammonia solution, 1 M", aux: "NH3", M: 1 },
    { key: "nacl", label: "Brine (sodium chloride, 1 M)", aux: "NaCl", M: 1 },
    { key: "cuso4", label: "Copper(II) sulfate, 0.5 M", aux: "CuSO4", M: 0.5 },
    { key: "fecl3", label: "Iron(III) chloride, 0.5 M", aux: "FeCl3", M: 0.5 },
    { key: "agno3", label: "Silver nitrate, 0.1 M", aux: "AgNO3", M: 0.1 },
    { key: "ki", label: "Potassium iodide, 0.5 M", aux: "KI", M: 0.5 },
    { key: "pbno3", label: "Lead(II) nitrate, 0.5 M", aux: "Pb(NO3)2", M: 0.5 },
    { key: "bacl2", label: "Barium chloride, 0.5 M", aux: "BaCl2", M: 0.5 },
    { key: "kmno4", label: "Potassium permanganate, 0.05 M", aux: "KMnO4", M: 0.05 },
    { key: "h2o2", label: "Hydrogen peroxide, 3%", aux: "H2O2", M: 0.9 },
    { key: "phenol", label: "Phenolphthalein indicator", aux: "Phenolphthalein", M: 0.05 },
    { key: "litmus", label: "Litmus solution", aux: "Litmus", M: 0.05 },
    { key: "ethanol", label: "Ethanol", mat: "C2H5OH" }
  ];
  // What a reagent is in the simulation: { mat, sol } for Lab.fill, or null if this build has no such material.
  L.reagent = function (key) {
    var r = L.REAGENTS.filter(function (q) { return q.key === key; })[0];
    if (!r) return null;
    if (r.mat) { var m = Mat.byFormula[r.mat]; return m ? { mat: m, sol: null, label: r.label } : null; }
    var aux = Mat.byFormula[r.aux] || (Mat.named && Mat.named(r.aux)), water = Mat.byFormula.H2O;
    if (!aux || !water) return null;
    return { mat: water, sol: { aux: aux, used: Math.max(0, Math.min(0.9999, 1 - r.M / (Mat.n0[aux] * 1000))) }, label: r.label };
  };
  // A reagent bottle, nine-tenths full and named after what is in it.
  L.spawnBottle = function (x, y, z, key, opts) {
    var r = L.reagent(key) || L.reagent("water");
    var v = L.spawnBeaker(x, y, z, Object.assign({ type: "bottle", name: r.label }, opts));
    Vessels.fill(v, r.mat, P_LIQUID, Math.round(Vessels.capacity(v) * 0.9), sim ? sim.ambient : 293.15, r.sol);
    v.reagent = key;
    return v;
  };
  L.spawnBeaker = function (x, y, z, opts) {
    opts = opts || {};
    var type = L.CONTAINERS[opts.type] ? opts.type : "beaker", c = L.CONTAINERS[type];
    var v = Vessels.create({ radius: opts.radius || c.radius, height: opts.height || c.height, yaw: opts.yaw || 0, name: opts.name });
    v.kind = "beaker"; v.rest = 0; v.type = type;
    if (!opts.name) v.name = c.label + " " + v.id;
    Vessels.setBase(v, x, y, z);
    return v;
  };
  // A hot plate is a ceramic slab. When it rests it is written into the grid as WALL, which the renderer draws as glass-ceramic.
  // A chiller is the same slab running the other way, with its own name and a colder range on its dial.
  L.spawnPlate = function (x, y, z, opts) {
    opts = opts || {};
    var p = { id: Vessels.nextId++, kind: "plate", cold: !!opts.cold, name: opts.name || "Hot plate", x: x, y: y, z: z, half: opts.half || 6, h: opts.h || 2, setT: opts.setT == null ? null : opts.setT, held: false, rest: 0, stamp: null };
    if (!opts.name) p.name = (p.cold ? "Chiller " : "Hot plate ") + p.id;
    L.plates.push(p);
    return p;
  };
  L.spawnChiller = function (x, y, z, opts) { return L.spawnPlate(x, y, z, Object.assign({}, opts, { cold: true })); };
  // A magnetic stirrer is a hot plate with a spinning magnet under its top. stir is 0 (off) to 3 (fast), and it heats as a hot plate does.
  L.spawnStirrer = function (x, y, z, opts) {
    opts = opts || {};
    var p = L.spawnPlate(x, y, z, Object.assign({}, opts, { cold: false }));
    p.stir = opts.stir == null ? 2 : opts.stir;
    if (!opts.name) p.name = "Stirrer " + p.id;
    return p;
  };
  L.setStir = function (o, speed) { o = obj(o); if (o && o.kind === "plate" && o.stir != null) o.stir = Math.max(0, Math.min(3, speed | 0)); };
  // A gas burner is a small stand with a nozzle in the middle of its top. While the gas is on it feeds flame from the nozzle, and setT is
  // the flame's temperature (a Bunsen burner's blue cone is about 1800 K). Off is setT null. Its top around the nozzle holds a sample in the flame.
  // nozzle is the nozzle's radius in cells (0 is a single cell) and core the height of the flame it keeps alight, so a big chamber can have a bigger burner.
  L.BURNER_T = 1800;
  L.spawnBurner = function (x, y, z, opts) {
    opts = opts || {};
    var nozzle = opts.nozzle | 0, p = L.spawnPlate(x, y, z, Object.assign({ half: nozzle + 2, h: 4 }, opts, { cold: false, setT: opts.setT === undefined ? L.BURNER_T : opts.setT }));
    p.burner = true; p.nozzle = nozzle; p.core = opts.core || 5;
    if (!opts.name) p.name = "Gas burner " + p.id;
    return p;
  };
  // Writes a plate into the grid right away rather than after it has settled, so an experiment can build on top of it in one go.
  L.placePlateNow = function (p) { stamp(p); return p; };
  // The same for a container: its glass goes into the grid now, standing where it was spawned, so an experiment can fill it cell by cell.
  L.setDownNow = function (v) { Vessels.setDown(v, sim); return v; };

  // Hand tools are upright sticks positioned by their tip: x, y, z is the bottom of the stick, len its height in cells.
  // They come to rest on solids only, so one let go over a beaker sinks through the liquid to the glass floor.
  //   probe:   a thermometer. It is never part of the grid; read() says what its tip is touching.
  //   dropper: a glass dropper holding up to cap cells of liquid. drawUp() takes liquid in at the tip and squeeze() lets it out drop by drop.
  //   supply:  a DC power supply on a clamp with two electrode rods hanging gap cells either side of its centre. Once it rests, the rods
  //            are written into the grid as ELECTRODE cells. They pulse only while it is switched on, faster at higher voltage.
  L.TOOLS = {
    probe: { label: "Thermometer", len: 12 },
    dropper: { label: "Dropper", len: 9, cap: 20 },
    supply: { label: "Power supply", len: 14, gap: 2 },
    funnel: { label: "Funnel", len: 8, cap: 80 },
    syringe: { label: "Gas syringe", len: 3, cap: 100 },
    tongs: { label: "Tongs", len: 10, cap: 6, clamp: true },
    igniter: { label: "Spark igniter", len: 9, clamp: true },
    geiger: { label: "Geiger counter", len: 10, clamp: true },
    jar: { label: "Bell jar", len: 16, radius: 8 },
    condenser: { label: "Condenser", len: 3, clamp: true }
  };
  L.MIN_VOLTS = 1.23;   // water's decomposition voltage: below it no current flows through a solution
  L.MAX_VOLTS = 12;
  L.spawnTool = function (kind, x, y, z, opts) {
    opts = opts || {};
    var d = L.TOOLS[kind];
    if (!d) return null;
    var id = Vessels.nextId++;
    var o = { id: id, kind: kind, name: opts.name || d.label + " " + id, x: x, y: y, z: z, len: opts.len || d.len, held: false, rest: 0 };
    if (kind === "dropper") { o.cap = opts.cap || d.cap; o.contents = []; o.drip = 0; o.clamp = !!opts.clamp; }
    if (kind === "supply") { o.gap = opts.gap || d.gap; o.volts = opts.volts == null ? 6 : opts.volts; o.on = !!opts.on; o.stamp = null; }
    if (kind === "funnel") { o.cap = d.cap; o.contents = []; o.filter = opts.filter !== false; o.rTop = 4; o.stem = 3; }
    if (kind === "syringe") { o.cap = d.cap; o.contents = []; o.vessel = null; o.vent = 0; }
    if (kind === "tongs") { o.cap = d.cap; o.contents = []; o.hold = []; }
    if (kind === "igniter") { o.auto = !!opts.auto; o.sparks = 0; }
    if (kind === "geiger") { o.hits = []; o.total = 0; o.byType = { alpha: 0, beta: 0, gamma: 0, neutron: 0 }; }
    if (kind === "jar") { o.radius = opts.radius || d.radius; o.stamp = null; o.kPa = L.ROOM_KPA; o.pump = !!opts.pump; o.vap = {}; }
    if (kind === "condenser") { o.vessel = null; o.contents = []; o.gas = []; o.vap = {}; o.made = 0; }
    L.tools.push(o);
    return o;
  };
  L.spawnProbe = function (x, y, z, opts) { return L.spawnTool("probe", x, y, z, opts); };
  L.spawnDropper = function (x, y, z, opts) { return L.spawnTool("dropper", x, y, z, opts); };
  L.spawnSupply = function (x, y, z, opts) { return L.spawnTool("supply", x, y, z, opts); };
  L.spawnFunnel = function (x, y, z, opts) { return L.spawnTool("funnel", x, y, z, opts); };
  L.spawnSyringe = function (x, y, z, opts) { return L.spawnTool("syringe", x, y, z, opts); };
  // The columns a tool stands in: one for a stick, two for the supply's rods.
  function columns(o) {
    if (o.kind === "supply") return [[o.x - o.gap, o.z], [o.x + o.gap, o.z]];
    if (o.kind === "syringe") return [[o.x - 5, o.z], [o.x, o.z], [o.x + 5, o.z]];
    return [[o.x, o.z]];
  }
  // Height just above the highest solid cell at or below fromY in a column, or 1 if there is none.
  function solidBelow(x, z, fromY) {
    var X = Math.floor(x), Z = Math.floor(z);
    if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1) return 1;
    for (var y = Math.min(sim.H - 2, Math.floor(fromY)); y >= 1; y--) { var i = sim.idx(X, y, Z); if (sim.ID[i] !== AIR && sim.PH[i] === P_STATIC) return y + 1; }
    return 1;
  }
  function toolFloor(o, fromY) {
    if (o.kind === "funnel") return funnelFloor(o, fromY);
    if (o.kind === "jar") return jarRing(o, fromY);
    var g = 1; columns(o).forEach(function (c) { g = Math.max(g, solidBelow(c[0], c[1], fromY)); }); return g;
  }
  // A funnel is a cone on a stem. Its radius at a height above the tip: 0 along the stem, widening to rTop at the top.
  L.funnelRadius = function (o, dy) { return dy < o.stem ? 0 : Math.max(0.7, (dy - o.stem) / (o.len - o.stem) * o.rTop); };
  // A funnel rests on whatever its cone or stem touches first, so one set in a container's mouth sits on the rim with its stem inside.
  function funnelFloor(o, fromY) {
    var g = solidBelow(o.x, o.z, fromY);
    for (var dy = o.stem; dy <= o.len; dy++) {
      var r = L.funnelRadius(o, dy);
      for (var a = 0; a < 8; a++) {
        var x = o.x + Math.cos(a * Math.PI / 4) * r, z = o.z + Math.sin(a * Math.PI / 4) * r;
        g = Math.max(g, solidBelow(x, z, fromY + dy) - dy);
      }
    }
    return g;
  }

  // ---- Saving ----
  function copyEntry(c) { return { mat: c.mat, form: c.form, aux: c.aux, aux2: c.aux2 || 0, n: c.n, T: c.T, used: c.used || 0, u2: c.u2 || 0 }; }
  // Equipment as plain data, for undo and save files. The cells of a set-down object belong to the grid and travel with it, so a saved
  // object only records which cells are its own. deserialize therefore touches nothing in the grid: restore the grid first, then this.
  L.serialize = function () {
    return {
      nextId: Vessels.nextId,
      beakers: Vessels.list.map(function (v) {
        return { id: v.id, type: v.type || "beaker", name: v.name, x: v.x, y: v.y, z: v.z, radius: v.radius, height: v.height, tilt: v.tilt, yaw: v.yaw, pinTilt: !!v.pinTilt, stopper: !!v.stopper, sealed: !!v.sealed,
          contents: v.contents.map(copyEntry),
          shell: v.shell ? { cx: v.shell.cx, by: v.shell.by, cz: v.shell.cz, h: v.shell.h, wall: Array.from(v.shell.wall), inside: Array.from(v.shell.inside), cap: v.shell.cap ? Array.from(v.shell.cap) : null } : null };
      }),
      tools: L.tools.map(function (o) {
        var t = { id: o.id, kind: o.kind, name: o.name, x: o.x, y: o.y, z: o.z, len: o.len };
        if (o.kind === "dropper") { t.cap = o.cap; t.drip = o.drip; t.clamp = !!o.clamp; t.contents = o.contents.map(copyEntry); }
        if (o.kind === "supply") { t.gap = o.gap; t.volts = o.volts; t.on = o.on; t.stamp = o.stamp ? { by: o.stamp.by, rods: o.stamp.rods.map(function (r) { return Array.from(r); }) } : null; }
        if (o.kind === "funnel") { t.cap = o.cap; t.filter = !!o.filter; t.contents = o.contents.map(copyEntry); }
        if (o.kind === "syringe") { t.cap = o.cap; t.vessel = o.vessel; t.vent = o.vent; t.contents = o.contents.map(copyEntry); }
        if (o.kind === "tongs") { t.cap = o.cap; t.contents = o.contents.map(copyEntry); t.hold = o.hold.slice(); }
        if (o.kind === "igniter") t.auto = !!o.auto;
        if (o.kind === "jar") { t.radius = o.radius; t.kPa = o.kPa; t.pump = !!o.pump; t.vap = Object.assign({}, o.vap); t.stamp = o.stamp ? { by: o.stamp.by, cx: o.stamp.cx, cz: o.stamp.cz, leak: o.stamp.leak, cells: Array.from(o.stamp.cells) } : null; }
        if (o.kind === "condenser") { t.vessel = o.vessel; t.made = o.made; t.contents = o.contents.map(copyEntry); t.gas = o.gas.map(copyEntry); t.vap = Object.assign({}, o.vap); }
        return t;
      }),
      plates: L.plates.map(function (p) {
        return { id: p.id, cold: !!p.cold, burner: !!p.burner, stir: p.stir == null ? null : p.stir, scale: !!p.scale, tare: p.tare || 0, nozzle: p.nozzle || 0, core: p.core || 0, name: p.name, x: p.x, y: p.y, z: p.z, half: p.half, h: p.h, setT: p.setT,
          stamp: p.stamp ? { cx: p.stamp.cx, cz: p.stamp.cz, by: p.stamp.by, top: p.stamp.top, cells: Array.from(p.stamp.cells) } : null };
      })
    };
  };
  L.deserialize = function (data) {
    Vessels.list.length = 0; L.plates.length = 0; L.tools.length = 0;
    if (!data) { refreshGate(); return; }
    Vessels.nextId = data.nextId;
    data.beakers.forEach(function (b) {
      var v = Vessels.create({ radius: b.radius, height: b.height, yaw: b.yaw, name: b.name });
      Vessels.list.pop(); Vessels.list.push(v);
      v.id = b.id; v.kind = "beaker"; v.type = b.type; v.rest = 0; v.x = b.x; v.y = b.y; v.z = b.z; v.tilt = b.tilt; v.pinTilt = !!b.pinTilt; v.stopper = !!b.stopper; v.sealed = !!b.sealed;
      v.contents = b.contents.map(copyEntry);
      v.shell = b.shell ? { cx: b.shell.cx, by: b.shell.by, cz: b.shell.cz, h: b.shell.h, wall: b.shell.wall.slice(), inside: b.shell.inside.slice(), cap: b.shell.cap ? b.shell.cap.slice() : null } : null;
    });
    (data.tools || []).forEach(function (t) {   // files from before hand tools have none
      var o = { id: t.id, kind: t.kind, name: t.name, x: t.x, y: t.y, z: t.z, len: t.len, held: false, rest: 0 };
      if (t.kind === "dropper") { o.cap = t.cap; o.drip = t.drip | 0; o.clamp = !!t.clamp; o.contents = t.contents.map(copyEntry); }
      if (t.kind === "supply") { o.gap = t.gap; o.volts = t.volts; o.on = !!t.on; o.stamp = t.stamp ? rodStamp(t.stamp.by, t.stamp.rods.map(function (r) { return r.slice(); })) : null; }
      if (t.kind === "funnel") { o.cap = t.cap; o.filter = !!t.filter; o.rTop = 4; o.stem = 3; o.contents = t.contents.map(copyEntry); }
      if (t.kind === "syringe") { o.cap = t.cap; o.vessel = t.vessel; o.vent = t.vent | 0; o.contents = t.contents.map(copyEntry); }
      if (t.kind === "tongs") { o.cap = t.cap; o.contents = t.contents.map(copyEntry); o.hold = t.hold.slice(); }
      if (t.kind === "igniter") { o.auto = !!t.auto; o.sparks = 0; }
      if (t.kind === "geiger") { o.hits = []; o.total = 0; o.byType = { alpha: 0, beta: 0, gamma: 0, neutron: 0 }; }
      if (t.kind === "jar") { o.radius = t.radius; o.kPa = t.kPa; o.pump = !!t.pump; o.vap = Object.assign({}, t.vap || {}); o.stamp = t.stamp ? { by: t.stamp.by, cx: t.stamp.cx, cz: t.stamp.cz, leak: t.stamp.leak, cells: t.stamp.cells.slice() } : null; }
      if (t.kind === "condenser") { o.vessel = t.vessel; o.made = t.made | 0; o.contents = t.contents.map(copyEntry); o.gas = t.gas.map(copyEntry); o.vap = Object.assign({}, t.vap); }
      L.tools.push(o);
    });
    refreshGate();
    refreshRegion();
    Vessels.nextId = data.nextId;
    data.plates.forEach(function (o) {
      L.plates.push({ id: o.id, kind: "plate", cold: !!o.cold, burner: !!o.burner, stir: o.stir == null ? null : o.stir, scale: !!o.scale, tare: o.tare || 0, nozzle: o.nozzle | 0, core: o.core || 5, name: o.name, x: o.x, y: o.y, z: o.z, half: o.half, h: o.h, setT: o.setT, held: false, rest: 0,
        stamp: o.stamp ? { cx: o.stamp.cx, cz: o.stamp.cz, by: o.stamp.by, top: o.stamp.top, cells: o.stamp.cells.slice() } : null });
    });
  };
  // Whether saved equipment is sound, for a file that may be damaged. Nothing is changed. N is the number of cells, matCount the number of materials.
  L.check = function (d, N, matCount) {
    function num(v) { return typeof v === "number" && isFinite(v); }
    function cells(a) { return Array.isArray(a) && a.length <= N && a.every(function (i) { return Number.isInteger(i) && i >= 0 && i < N; }); }
    function name(s) { return typeof s === "string" && s.length < 200; }
    function id(m) { return Number.isInteger(m) && m >= 0 && m < matCount; }
    function share(u) { return u === undefined || (num(u) && u >= 0 && u <= 1); }   // files from before strengths were kept have none
    function vapOK(v) { return v === undefined || (v && typeof v === "object" && Object.keys(v).every(function (k) { return id(+k) && num(v[k]) && v[k] >= 0 && v[k] < 1000; })); }
    function entryOK(c) { return c && id(c.mat) && id(c.aux) && (c.aux2 === undefined || id(c.aux2)) && share(c.used) && share(c.u2) && Number.isInteger(c.n) && c.n >= 0 && num(c.T) && c.T > 0; }
    if (!d || typeof d !== "object" || !Number.isInteger(d.nextId) || d.nextId < 1 || !Array.isArray(d.beakers) || !Array.isArray(d.plates)) return false;
    if (d.beakers.length + d.plates.length > 1000) return false;
    var okB = d.beakers.every(function (b) {
      if (!b || !Number.isInteger(b.id) || !name(b.name) || !L.CONTAINERS[b.type]) return false;
      if (![b.x, b.y, b.z, b.radius, b.height, b.tilt, b.yaw].every(num) || b.radius < 1 || b.radius > 64 || b.height < 1 || b.height > 256) return false;
      if (!Array.isArray(b.contents) || !b.contents.every(function (c) { return entryOK(c) && (c.form === P_LIQUID || c.form === P_POWDER) && c.n <= N; })) return false;
      if (b.shell && !(num(b.shell.cx) && num(b.shell.by) && num(b.shell.cz) && num(b.shell.h) && cells(b.shell.wall) && cells(b.shell.inside))) return false;
      if (b.shell && b.shell.cap != null && !cells(b.shell.cap)) return false;
      return true;
    });
    if (!okB) return false;
    if (d.tools !== undefined && !(Array.isArray(d.tools) && d.tools.length <= 1000 && d.tools.every(function (t) {
      if (!t || !Number.isInteger(t.id) || !name(t.name) || !L.TOOLS[t.kind]) return false;
      if (![t.x, t.y, t.z].every(num) || !Number.isInteger(t.len) || t.len < 1 || t.len > 64) return false;
      if (t.kind === "dropper") {
        if (!Number.isInteger(t.cap) || t.cap < 1 || t.cap > 1000 || !Number.isInteger(t.drip) || t.drip < 0 || !Array.isArray(t.contents) || (t.clamp !== undefined && typeof t.clamp !== "boolean")) return false;
        if (!t.contents.every(function (c) { return entryOK(c) && c.form === P_LIQUID && c.n <= t.cap; })) return false;
      }
      if (t.kind === "funnel" || t.kind === "syringe") {
        if (!Number.isInteger(t.cap) || t.cap < 1 || t.cap > 1000 || !Array.isArray(t.contents) || !t.contents.every(function (c) { return entryOK(c) && c.n <= t.cap; })) return false;
        if (t.kind === "funnel" && typeof t.filter !== "boolean") return false;
        if (t.kind === "syringe" && (!(t.vessel === null || Number.isInteger(t.vessel)) || !Number.isInteger(t.vent) || t.vent < 0)) return false;
      }
      if (t.kind === "tongs" && !(Number.isInteger(t.cap) && t.cap >= 1 && t.cap <= 64 && Array.isArray(t.contents) && t.contents.every(function (c) { return entryOK(c) && c.n <= t.cap; }) && cells(t.hold) && t.hold.length <= 64)) return false;
      if (t.kind === "igniter" && typeof t.auto !== "boolean") return false;
      if (t.kind === "jar") {
        if (!Number.isInteger(t.radius) || t.radius < 2 || t.radius > 32 || !num(t.kPa) || t.kPa < 0 || t.kPa > 200 || typeof t.pump !== "boolean" || !vapOK(t.vap)) return false;
        if (t.stamp && !(num(t.stamp.by) && num(t.stamp.cx) && num(t.stamp.cz) && Number.isInteger(t.stamp.leak) && t.stamp.leak >= 0 && cells(t.stamp.cells))) return false;
      }
      if (t.kind === "condenser") {
        if (!(t.vessel === null || Number.isInteger(t.vessel)) || !Number.isInteger(t.made) || t.made < 0) return false;
        if (!Array.isArray(t.contents) || !t.contents.every(function (c) { return entryOK(c) && c.n <= N; }) || !Array.isArray(t.gas) || !t.gas.every(function (c) { return entryOK(c) && c.n <= N; })) return false;
        if (!t.vap || !vapOK(t.vap)) return false;
      }
      if (t.kind === "supply") {
        if (!Number.isInteger(t.gap) || t.gap < 1 || t.gap > 32 || !num(t.volts) || t.volts < 0 || t.volts > L.MAX_VOLTS || typeof t.on !== "boolean") return false;
        if (t.stamp && !(num(t.stamp.by) && Array.isArray(t.stamp.rods) && t.stamp.rods.length === 2 && t.stamp.rods.every(cells))) return false;
      }
      return true;
    }))) return false;
    return d.plates.every(function (p) {
      if (!p || !Number.isInteger(p.id) || !name(p.name)) return false;
      if (![p.x, p.y, p.z].every(num) || !Number.isInteger(p.half) || p.half < 1 || p.half > 64 || !Number.isInteger(p.h) || p.h < 1 || p.h > 32) return false;
      if (p.setT !== null && !(num(p.setT) && p.setT > 0 && p.setT < 1e5)) return false;
      if (p.nozzle !== undefined && !(Number.isInteger(p.nozzle) && p.nozzle >= 0 && p.nozzle < p.half)) return false;
      if (p.core !== undefined && !(Number.isInteger(p.core) && p.core >= 0 && p.core <= 64)) return false;
      if (p.stir != null && !(Number.isInteger(p.stir) && p.stir >= 0 && p.stir <= 3)) return false;
      if (p.tare !== undefined && !(num(p.tare) && Math.abs(p.tare) < 1e9)) return false;
      if (p.stamp && !(num(p.stamp.cx) && num(p.stamp.cz) && num(p.stamp.by) && num(p.stamp.top) && cells(p.stamp.cells))) return false;
      return true;
    });
  };

  // ---- Grabbing and moving ----
  L.grab = function (o) {
    o = obj(o); if (!o) return;
    o.held = true; o.rest = 0;
    if (o.kind === "beaker") { Vessels.pickUp(o, sim); o.pinTilt = false; }
    else if (o.kind === "supply") unstampRods(o);
    else if (o.kind === "tongs") releaseSample(o);
    else if (o.kind === "jar") unstampJar(o);
    else if (o.kind === "plate") unstamp(o);
  };
  L.release = function (o) { o = obj(o); if (o) { o.held = false; o.rest = 0; } };
  // Positions are the base centre: the bottom of a beaker, the underside of a plate, the tip of a tool.
  L.move = function (o, x, y, z) {
    o = obj(o); if (!o) return;
    if (o.kind === "beaker") { if (o.shell) Vessels.pickUp(o, sim); Vessels.setBase(o, x, y, z); }
    else {
      if (o.kind === "supply") unstampRods(o); else if (o.kind === "jar") unstampJar(o); else if (o.kind === "tongs") releaseSample(o); else if (o.stamp) unstamp(o);
      o.x = x; o.y = y; o.z = z;
    }
    o.rest = 0;
  };
  L.base = function (o) { o = obj(o); return o.kind === "beaker" ? Vessels.base(o) : [o.x, o.y, o.z]; };
  L.tilt = function (o, angle) {
    o = obj(o); if (!o || o.kind !== "beaker") return;
    if (angle > 0.01 && o.shell) Vessels.pickUp(o, sim);
    Vessels.setTilt(o, angle); o.rest = 0;
  };
  L.turn = function (o, dYaw) { o = obj(o); if (o && o.kind === "beaker") o.yaw += dYaw; };
  L.remove = function (o) {
    o = obj(o); if (!o) return;
    if (o.kind === "beaker") Vessels.remove(o, sim);
    else if (isTool(o)) {
      if (o.kind === "supply") unstampRods(o);
      if (o.kind === "jar") unstampJar(o);
      if (o.kind === "tongs") L.letGo(o);   // what they hold drops rather than vanishing
      L.tools.splice(L.tools.indexOf(o), 1);
      refreshRegion();
    }
    else { unstamp(o); L.plates.splice(L.plates.indexOf(o), 1); }
  };

  // ---- Material operations ----
  // Add material to a beaker from the material browser. A set-down beaker gets it poured straight into the grid.
  L.fill = function (o, mat, form, n, T, sol) {
    o = obj(o); if (!o || o.kind !== "beaker") return 0;
    var room = Vessels.capacity(o) - (o.shell ? Vessels.amountNow(o, sim) : Vessels.amount(o));
    var add = Vessels.fill(o, mat, form, Math.max(0, Math.min(n, room)), T, sol);
    if (o.shell) Vessels.settleContents(o, sim);
    return add;
  };
  // Move up to n cells from one beaker to another without pouring, as a pipette would. Returns how many moved.
  L.transferMaterial = function (src, dst, n) {
    src = obj(src); dst = obj(dst);
    if (!src || !dst || src === dst) return 0;
    if (sim.busy) sim.idle();
    var srcShell = !!src.shell, dstShell = !!dst.shell;
    if (srcShell) Vessels.pickUp(src, sim);
    var room = Vessels.capacity(dst) - (dstShell ? Vessels.amountNow(dst, sim) : Vessels.amount(dst)), moved = 0;
    n = Math.min(n, room, Vessels.amount(src));
    while (moved < n && src.contents.length) {
      var e = src.contents[0], take = Math.min(e.n, n - moved), d = null;
      for (var k = 0; k < dst.contents.length; k++) { var c = dst.contents[k]; if (c.mat === e.mat && c.form === e.form && c.aux === e.aux && (c.aux2 || 0) === (e.aux2 || 0)) d = c; }
      if (!d) { d = { mat: e.mat, form: e.form, aux: e.aux, aux2: e.aux2 || 0, n: 0, T: e.T, used: 0, u2: 0 }; dst.contents.push(d); }
      Vessels.addTo(d, take, e.T, e.used, e.u2); e.n -= take; moved += take;
      if (e.n <= 0) src.contents.shift();
    }
    if (srcShell) Vessels.setDown(src, sim);
    if (dstShell) Vessels.settleContents(dst, sim);
    return moved;
  };
  // Put n cells of a material into empty space near a point, nearest first. Returns how many were placed.
  L.placeMaterial = function (mat, x, y, z, n, form, T) {
    if (sim.busy) sim.idle();
    var placed = 0, cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    for (var r = 0; r < 12 && placed < n; r++) {
      for (var dy = -r; dy <= r && placed < n; dy++) for (var dz = -r; dz <= r && placed < n; dz++) for (var dx = -r; dx <= r && placed < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        var X = cx + dx, Y = cy + dy, Z = cz + dz;
        if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
        var i = sim.idx(X, Y, Z);
        if (sim.ID[i] !== AIR) continue;
        sim.place(X, Y, Z, mat, form == null ? P_POWDER : form, T);
        if (sim.ID[i] === mat) placed++;
      }
    }
    return placed;
  };
  // Change the temperature of a beaker's contents by dT kelvin, whether it is held or set down.
  L.applyHeat = function (o, dT) {
    o = obj(o); if (!o || o.kind !== "beaker") return;
    o.contents.forEach(function (c) { c.T = Math.max(1, c.T + dT); });
    if (o.shell) o.shell.inside.forEach(function (i) { if (sim.ID[i] !== AIR && sim.ID[i] !== WALL) { sim.T[i] = Math.max(1, sim.T[i] + dT); sim.wakeI(i); } });
  };
  L.setPlate = function (o, T) { o = obj(o); if (o && o.kind === "plate") o.setT = T; };
  // Put a stopper in a container or take it out. A stoppered container holds everything in, gas included, until the gas pops it.
  L.setStopper = function (o, on) { o = obj(o); if (!o || o.kind !== "beaker") return; if (sim.busy) sim.idle(); Vessels.setStopper(o, on, sim); o.popped = false; };
  L.setSupply = function (o, on, volts) {
    o = obj(o); if (!o || o.kind !== "supply") return;
    if (on != null) o.on = !!on;
    if (volts != null) o.volts = Math.max(0, Math.min(L.MAX_VOLTS, volts));
  };

  // ---- Hand tools ----
  function clampCell(o) { return [Math.max(1, Math.min(sim.W - 2, Math.floor(o.x))), Math.max(1, Math.min(sim.H - 2, Math.floor(o.y))), Math.max(1, Math.min(sim.D - 2, Math.floor(o.z)))]; }
  // The cell a tool's tip senses: the cell it is in, or when that is empty, what it is touching, below first.
  function tipCell(o) {
    var c = clampCell(o), i = sim.idx(c[0], c[1], c[2]);
    if (sim.ID[i] !== AIR) return i;
    var near = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
    for (var k = 0; k < near.length; k++) {
      var X = c[0] + near[k][0], Y = c[1] + near[k][1], Z = c[2] + near[k][2];
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var j = sim.idx(X, Y, Z);
      if (sim.ID[j] !== AIR && sim.ID[j] !== WALL && sim.ID[j] !== ELECTRODE) return j;
    }
    return i;
  }
  // What a thermometer reads at its tip: { T kelvin, mat, form, pH (null unless the tip is in water), kPa absolute }.
  L.read = function (o) {
    o = obj(o); if (!o || !sim) return null;
    var i = tipCell(o), id = sim.ID[i];
    var pH = typeof Chem !== "undefined" && Chem.pH && sim.PH[i] === P_LIQUID ? Chem.pH(i) : null;
    var room = sim.atmosphere === "vacuum" ? 0 : 101.3;
    return { T: sim.T[i], mat: id, form: sim.PH[i], pH: pH, kPa: Math.max(0, room + (sim.P ? sim.P[i] : 0)) };
  };
  L.amountIn = function (o) { var n = 0; (o.contents || []).forEach(function (c) { n += c.n; }); return n; };
  // Draw up to n cells of liquid into a dropper from around its tip, nearest first. Returns how many it took.
  L.drawUp = function (o, n) {
    o = obj(o); if (!o || o.kind !== "dropper") return 0;
    if (sim.busy) sim.idle();
    var room = o.cap - L.amountIn(o), want = Math.min(n == null ? room : n, room), took = 0, c = clampCell(o), found = [];
    for (var dy = -3; dy <= 1; dy++) for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      var X = c[0] + dx, Y = c[1] + dy, Z = c[2] + dz;
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var i = sim.idx(X, Y, Z), id = sim.ID[i];
      if (sim.PH[i] !== P_LIQUID || id === AIR || id === WALL || id === ELECTRODE || id === FLAME) continue;
      found.push([dx * dx + dz * dz + dy * dy, i, X, Y, Z]);
    }
    // Nearest first, and the top of a pool before its floor, so the dropper takes what is at its tip.
    found.sort(function (a, b) { return a[0] - b[0] || b[3] - a[3]; });
    for (var k = 0; k < found.length && took < want; k++) {
      var f = found[k];
      Vessels.takeCell(o.contents, sim, f[1], P_LIQUID);
      sim.erase(f[2], f[3], f[4]);
      took++;
    }
    return took;
  };
  // Let n drops out of a dropper, one per tick from the next tick on. Returns how many are queued.
  L.squeeze = function (o, n) {
    o = obj(o); if (!o || o.kind !== "dropper") return 0;
    o.drip = Math.min(L.amountIn(o), o.drip + (n == null ? L.amountIn(o) : n));
    return o.drip;
  };
  // One drop from the tip, into the nearest free cell below or beside it.
  function drip(o) {
    if (!L.amountIn(o)) { o.drip = 0; return; }
    var c = clampCell(o), spots = [[0, -1, 0], [0, 0, 0], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (var k = 0; k < spots.length; k++) {
      var X = c[0] + spots[k][0], Y = c[1] + spots[k][1], Z = c[2] + spots[k][2];
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var i = sim.idx(X, Y, Z);
      if (sim.ID[i] !== AIR) continue;
      var r = sim.rf() * L.amountIn(o), e = o.contents[0];
      for (var q = 0; q < o.contents.length; q++) { r -= o.contents[q].n; if (r < 0) { e = o.contents[q]; break; } }
      sim.place(X, Y, Z, e.mat, P_LIQUID, e.T);
      if (sim.ID[i] !== e.mat) continue;
      Vessels.putExtras(sim, i, e);
      e.n--; o.drip--;
      if (e.n <= 0) o.contents.splice(o.contents.indexOf(e), 1);
      return;
    }
    o.drip = 0;   // the tip is buried; the rest stays in the dropper
  }
  L.countInTools = function (mat) {
    var n = 0;
    L.tools.forEach(function (o) { (o.contents || []).forEach(function (c) { if (c.mat === mat) n += c.n; }); });
    return n;
  };

  // Throw away what a dropper, funnel or syringe holds.
  L.discard = function (o) { o = obj(o); if (o && o.contents) { o.contents.length = 0; if (o.drip) o.drip = 0; if (o.vent) o.vent = 0; } };

  // ---- Funnel ----
  L.setFilter = function (o, on) { o = obj(o); if (o && o.kind === "funnel") o.filter = !!on; };
  // Loose liquid and grains inside the cone go into the funnel, as with a container. Liquid runs out of the stem, a cell a tick through
  // filter paper and three without; grains pass only without paper, so with it they stay behind as the residue. What is dissolved passes.
  function funnelStep(o) {
    var X = Math.floor(o.x), Y = Math.floor(o.y), Z = Math.floor(o.z), R = Math.ceil(o.rTop) + 1, room = o.cap - L.amountIn(o), took = 0, lim = Math.min(room, 40);
    for (var y = Math.max(1, Y + o.stem); y <= Math.min(sim.H - 2, Y + o.len) && took < lim; y++) for (var dz = -R; dz <= R && took < lim; dz++) for (var dx = -R; dx <= R && took < lim; dx++) {
      var x = X + dx, z = Z + dz;
      if (x < 1 || z < 1 || x >= sim.W - 1 || z >= sim.D - 1) continue;
      if (Math.hypot(dx, dz) > L.funnelRadius(o, y - Y)) continue;
      var i = sim.idx(x, y, z);
      if (!movable(i)) continue;
      Vessels.takeCell(o.contents, sim, i);
      sim.erase(x, y, z);
      took++;
    }
    var rate = o.filter ? 1 : 3, spots = [[0, -1, 0], [0, 0, 0], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]];
    for (var k = 0; k < rate; k++) {
      var pass = o.contents.filter(function (c) { return c.n > 0 && (c.form === P_LIQUID || !o.filter); });
      if (!pass.length) return;
      var total = pass.reduce(function (a, c) { return a + c.n; }, 0), r = sim.rf() * total, e = pass[0];
      for (var q = 0; q < pass.length; q++) { r -= pass[q].n; if (r < 0) { e = pass[q]; break; } }
      var out = false;
      for (var s = 0; s < spots.length && !out; s++) {
        var sx = X + spots[s][0], sy = Y + spots[s][1], sz = Z + spots[s][2];
        if (sx < 1 || sy < 1 || sz < 1 || sx >= sim.W - 1 || sy >= sim.H - 1 || sz >= sim.D - 1) continue;
        var j = sim.idx(sx, sy, sz);
        if (sim.ID[j] !== AIR) continue;
        sim.place(sx, sy, sz, e.mat, e.form, e.T);
        if (sim.ID[j] !== e.mat) continue;
        Vessels.putExtras(sim, j, e);
        e.n--; out = true;
        if (e.n <= 0) o.contents.splice(o.contents.indexOf(e), 1);
      }
      if (!out) return;   // the stem is blocked or under liquid
    }
  }

  // ---- Gas syringe ----
  // A syringe is connected by a delivery tube through the stopper of one container. While that container is set down and stoppered,
  // the syringe draws off gas from its headspace, three cells a tick, until the barrel is full; after that the gas builds up as it would
  // with no syringe, and pops the stopper. Steam and other vapour held by air are left: they would condense in the tube.
  L.connect = function (o, v) {
    o = obj(o); v = obj(v);
    if (!o || (o.kind !== "syringe" && o.kind !== "condenser")) return;
    if (!v || v.kind !== "beaker") { o.vessel = null; return; }
    o.vessel = v.id;
    if (!v.stopper) L.setStopper(v, true);
  };
  // Connect to the nearest container within reach, and return it.
  L.connectNearest = function (o) {
    o = obj(o); if (!o) return null;
    var best = null, bd = 40;
    Vessels.list.forEach(function (v) { var b = Vessels.base(v), d = Math.hypot(b[0] - o.x, b[2] - o.z); if (d < bd) { bd = d; best = v; } });
    L.connect(o, best);
    return best;
  };
  L.ventSyringe = function (o) { o = obj(o); if (o && o.kind === "syringe") o.vent = L.amountIn(o); };
  L.syringeNozzle = function (o) { return [o.x - 6.5, o.y + 1.5, o.z]; };
  function syringeStep(o) {
    if (o.vent > 0) {
      var nz = L.syringeNozzle(o);
      for (var k = 0; k < 4 && o.vent > 0 && o.contents.length; k++) {
        var e = o.contents[0];
        if (!L.placeMaterial(e.mat, nz[0], nz[1], nz[2], 1, P_GAS, e.T)) { o.vent = 0; break; }
        e.n--; o.vent--;
        if (e.n <= 0) o.contents.shift();
      }
      if (!o.contents.length) o.vent = 0;
    }
    var v = o.vessel != null ? Vessels.byId(o.vessel) : null;
    if (o.vessel != null && !v) { o.vessel = null; return; }
    if (!v || !v.shell || !v.shell.cap) return;
    var take = Math.min(3, o.cap - L.amountIn(o)), inside = v.shell.inside, WD = sim.W * sim.D;
    for (var q = inside.length - 1; q >= 0 && take > 0; q--) {   // from the top down, where gas collects
      var i = inside[q], id = sim.ID[i];
      if (id === AIR || id === FLAME || sim.PH[i] < P_GAS) continue;
      Vessels.takeCell(o.contents, sim, i, P_GAS);
      var y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0;
      sim.erase(r - z * sim.W, y, z);
      take--;
    }
  }

  // ---- Balance ----
  // A balance is a plate that weighs what stands on it. Each cell is a cubic centimetre, so a cell weighs its density in grams.
  // It reads every column of its pan up to the first empty cell, so a set-down container counts with its glass and its contents,
  // and gas, which floats off, does not. tare() zeroes it with whatever is on it now.
  L.spawnBalance = function (x, y, z, opts) {
    opts = opts || {};
    var p = L.spawnPlate(x, y, z, Object.assign({ half: 5, h: 2 }, opts, { cold: false, setT: null }));
    p.scale = true; p.tare = 0;
    if (!opts.name) p.name = "Balance " + p.id;
    return p;
  };
  function massOf(i, id, ph) {
    if (id === WALL) return 2.5;          // glass
    if (id === ELECTRODE) return 8.9;     // copper
    if (ph === P_LIQUID) return sim.densityOf ? sim.densityOf(i) : Mat.rhoL[id];
    return Mat.rhoS[id];
  }
  // Grams on the pan before the tare is taken off.
  function gross(p) {
    var s = p.stamp, g = 0;
    if (!s || s.top >= sim.H - 1) return 0;
    for (var dz = -p.half; dz <= p.half; dz++) for (var dx = -p.half; dx <= p.half; dx++) {
      var X = s.cx + dx, Z = s.cz + dz;
      if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1) continue;
      for (var y = s.top; y < sim.H - 1; y++) {
        var i = sim.idx(X, y, Z), id = sim.ID[i], ph = sim.PH[i];
        if (id === AIR || ph >= P_GAS) break;
        g += massOf(i, id, ph);
      }
    }
    return g;
  }
  L.weigh = function (p) { p = obj(p); return p && p.scale && p.stamp ? gross(p) - (p.tare || 0) : 0; };
  L.tare = function (p) { p = obj(p); if (p && p.scale) p.tare = gross(p); };

  // ---- Clamped tools ----
  // Tongs, a spark igniter, a Geiger counter and a condenser are held in a clamp stand, so they stay where they are let go instead of falling.
  function clamped(o) { var d = L.TOOLS[o.kind]; return !!(d && d.clamp) || !!o.clamp; }
  L.clamped = clamped;

  // ---- Tongs ----
  // Tongs grip up to cap cells of a solid near their tip. While they are carried the sample is held out of the grid; let go, it is written
  // back at the tip as fixed solid cells, so it can be held in a flame and burn, melt or colour it like anything else. Whatever is still
  // solid there when they are picked up again comes with them; what melted or burned away stays behind.
  var TIP_SPOTS = [[0, 0, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, -1, 0], [-1, -1, 0]];
  L.grip = function (o) {
    o = obj(o); if (!o || o.kind !== "tongs" || L.amountIn(o) || o.hold.length) return 0;
    if (sim.busy) sim.idle();
    var c = clampCell(o), found = [];
    for (var dy = -3; dy <= 1; dy++) for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      var X = c[0] + dx, Y = c[1] + dy, Z = c[2] + dz;
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var i = sim.idx(X, Y, Z), id = sim.ID[i], ph = sim.PH[i];
      if (ph > P_POWDER || id === AIR || id === WALL || id === ELECTRODE || id === FLAME) continue;
      found.push([dx * dx + dy * dy + dz * dz, i, X, Y, Z]);
    }
    found.sort(function (a, b) { return a[0] - b[0]; });
    var took = 0;
    for (var k = 0; k < found.length && took < o.cap; k++) {
      Vessels.takeCell(o.contents, sim, found[k][1], P_POWDER);
      sim.erase(found[k][2], found[k][3], found[k][4]);
      took++;
    }
    if (took && !o.held) holdSample(o);
    return took;
  };
  function holdSample(o) {
    if (o.hold.length || !L.amountIn(o)) return;
    if (sim.busy) sim.idle();
    var c = clampCell(o);
    for (var k = 0; k < TIP_SPOTS.length && o.contents.length; k++) {
      var X = c[0] + TIP_SPOTS[k][0], Y = c[1] + TIP_SPOTS[k][1], Z = c[2] + TIP_SPOTS[k][2];
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var i = sim.idx(X, Y, Z);
      if (sim.ID[i] !== AIR) continue;
      var e = o.contents[0];
      sim.place(X, Y, Z, e.mat, P_STATIC, e.T);
      if (sim.ID[i] !== e.mat) continue;
      Vessels.putExtras(sim, i, e);
      o.hold.push(i);
      if (--e.n <= 0) o.contents.shift();
    }
  }
  function releaseSample(o) {
    if (!o.hold.length) return;
    if (sim.busy) sim.idle();
    var WD = sim.W * sim.D;
    o.hold.forEach(function (i) {
      var id = sim.ID[i];
      if (id === AIR || id === WALL || id === ELECTRODE || id === FLAME || sim.PH[i] > P_POWDER) return;
      Vessels.takeCell(o.contents, sim, i, P_POWDER);
      var y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0;
      sim.erase(r - z * sim.W, y, z);
    });
    o.hold = [];
  }
  // Open the tongs: the sample drops from the tip as grains.
  L.letGo = function (o) {
    o = obj(o); if (!o || o.kind !== "tongs") return 0;
    releaseSample(o);
    var n = 0;
    while (o.contents.length) { var e = o.contents.shift(); n += L.placeMaterial(e.mat, o.x, o.y - 1, o.z, e.n, P_POWDER, e.T); }
    return n;
  };

  // ---- Spark igniter ----
  // Each spark heats any gas at the tip to well past ignition, sends a pulse into anything conducting there and throws a shower of sparks.
  L.IGNITE_T = 1300;
  L.spark = function (o) {
    o = obj(o); if (!o || o.kind !== "igniter") return;
    if (sim.busy) sim.idle();
    var c = clampCell(o);
    for (var dy = -2; dy <= 2; dy++) for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy + dz * dz > 4) continue;
      var X = c[0] + dx, Y = c[1] + dy, Z = c[2] + dz;
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var i = sim.idx(X, Y, Z);
      if (sim.ID[i] !== AIR && sim.PH[i] >= P_GAS && sim.T[i] < L.IGNITE_T) { sim.T[i] = L.IGNITE_T; sim.wakeI(i); }
    }
    sim.spark(c[0], c[1], c[2], 1);
    for (var k = 0; k < 10; k++) sim.spawnP(PT_SPARK, c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 0.5 + sim.rf() * 0.4, 0, 8 + (sim.rf() * 10 | 0));
    o.sparks = (o.sparks || 0) + 1;
  };
  L.setAuto = function (o, on) { o = obj(o); if (o && o.kind === "igniter") o.auto = !!on; };

  // ---- Geiger counter ----
  // The tube counts every alpha, beta, gamma and neutron passing through its window, the bottom four cells of the tube and a cell around
  // them. A particle counts once, on the tick it comes in: it is inside now and was outside a tick ago. rate() is counts per second
  // over the last second.
  var COUNTED = {}; COUNTED[PT_ALPHA] = "alpha"; COUNTED[PT_BETA] = "beta"; COUNTED[PT_GAMMA] = "gamma"; COUNTED[PT_NEUTRON] = "neutron";
  function geigerStep(o) {
    var n = 0, x0 = o.x - 1.5, x1 = o.x + 1.5, z0 = o.z - 1.5, z1 = o.z + 1.5, y0 = o.y - 1, y1 = o.y + 4, P = sim.pCount;
    function inside(x, y, z) { return x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1; }
    for (var p = 0; p < P; p++) {
      var t = sim.ptype[p];
      if (!COUNTED[t]) continue;
      var px = sim.px[p], py = sim.py[p], pz = sim.pz[p];
      if (!inside(px, py, pz)) continue;
      if (sim.pvx && inside(px - sim.pvx[p], py - sim.pvy[p], pz - sim.pvz[p])) continue;   // already in the window last tick
      n++; o.byType[COUNTED[t]]++;
    }
    o.hits.push(n);
    var keep = sim.TICKS_PER_SEC || 30;
    while (o.hits.length > keep) o.hits.shift();
    o.total += n;
  }
  L.rate = function (o) { o = obj(o); if (!o || !o.hits) return 0; var s = 0; o.hits.forEach(function (h) { s += h; }); return s * (sim.TICKS_PER_SEC || 30) / Math.max(1, o.hits.length); };
  L.resetCount = function (o) { o = obj(o); if (o && o.kind === "geiger") { o.total = 0; o.byType = { alpha: 0, beta: 0, gamma: 0, neutron: 0 }; } };

  // ---- Bell jar and vacuum pump ----
  // A glass dome, radius cells across the middle and len high, open at the bottom. Let go, it falls until its rim rests on something
  // solid and is written into the grid as WALL, which seals it to what it stands on. Its pump runs a low-pressure region inside it
  // through the simulation: liquids boil at the jar's pressure and nothing burns once the air is mostly gone. Gas inside is pumped out
  // through the pump, which lets it go beside the jar. A jar whose rim does not sit flat leaks and cannot get below 60 kPa.
  L.ROOM_KPA = 101.3;
  function jarRing(o, fromY) {
    var g = 1, r = o.radius + 0.75;
    for (var a = 0; a < 12; a++) g = Math.max(g, solidBelow(o.x + Math.cos(a * Math.PI / 6) * r, o.z + Math.sin(a * Math.PI / 6) * r, fromY));
    return g;
  }
  function stampJar(o) {
    if (sim.busy) sim.idle();
    var by = Math.round(o.y), cx = Math.floor(o.x), cz = Math.floor(o.z), r = o.radius, R = Math.ceil(r + 1.5), ro2 = (r + 1.5) * (r + 1.5), r2 = r * r;
    var want = [], avoid = new Set(), cells = [], leak = 0;
    for (var y = by; y <= by + o.len && y < sim.H - 1; y++) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var d2 = dx * dx + dz * dz, X = cx + dx, Z = cz + dz;
      if (d2 > ro2 || (y < by + o.len && d2 <= r2)) continue;
      if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1) continue;
      var i = sim.idx(X, y, Z);
      want.push([i, X, y, Z]); avoid.add(i);
      if (y === by && by > 1) { var below = sim.idx(X, by - 1, Z); if (sim.ID[below] === AIR || sim.PH[below] !== P_STATIC) leak++; }
    }
    want.forEach(function (w) {
      var i = w[0];
      if (sim.ID[i] !== AIR && (sim.PH[i] === P_STATIC || !displace(i, avoid))) { if (w[2] === by) leak++; return; }
      sim.place(w[1], w[2], w[3], WALL, P_STATIC);
      if (sim.ID[i] === WALL) cells.push(i);
    });
    o.x = cx + 0.5; o.z = cz + 0.5; o.y = by;
    o.stamp = { by: by, cx: cx, cz: cz, cells: cells, leak: leak };
  }
  function unstampJar(o) {
    if (!o.stamp) return;
    if (sim.busy) sim.idle();
    var WD = sim.W * sim.D;
    o.stamp.cells.forEach(function (i) {
      if (sim.ID[i] !== WALL) return;
      var y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0;
      sim.erase(r - z * sim.W, y, z);
    });
    o.stamp = null; o.kPa = L.ROOM_KPA;
    refreshRegion();
  }
  L.setPump = function (o, on) { o = obj(o); if (o && o.kind === "jar") o.pump = !!on; };
  L.letAirIn = function (o) { o = obj(o); if (o && o.kind === "jar") { o.pump = false; o.kPa = L.ROOM_KPA; refreshRegion(); } };
  L.pumpOutlet = function (o) { return [o.x + o.radius + 5, o.y + 6, o.z]; };
  function jarInside(o, i) {
    var s = o.stamp, WD = sim.W * sim.D, y = (i / WD) | 0;
    if (y < s.by || y >= s.by + o.len) return false;
    var r = i - y * WD, z = (r / sim.W) | 0, x = r - z * sim.W, dx = x - s.cx, dz = z - s.cz;
    return dx * dx + dz * dz <= o.radius * o.radius;
  }
  function jarStep(o) {
    if (!o.stamp) {
      if (!o.held && Math.abs(o.y - L.groundUnder(o)) < 0.02) { if (++o.rest >= REST_TICKS) stampJar(o); }
      else o.rest = 0;
      return;
    }
    var floor = o.stamp.leak ? 60 : 0.5;
    if (o.pump) {
      o.kPa = Math.max(floor, o.kPa * 0.96);
      // Pump out gas cells inside, a few a tick, and let them go at the pump's outlet.
      var s = o.stamp, r = o.radius, out = L.pumpOutlet(o), moved = 0;
      for (var y = s.by + o.len - 1; y >= s.by && moved < 6; y--) for (var dz = -r; dz <= r && moved < 6; dz++) for (var dx = -r; dx <= r && moved < 6; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        var X = s.cx + dx, Z = s.cz + dz;
        if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1) continue;
        var i = sim.idx(X, y, Z), id = sim.ID[i];
        if (id === AIR || id === FLAME || sim.PH[i] < P_GAS) continue;
        var t = sim.T[i];
        sim.erase(X, y, Z);
        if (!L.placeMaterial(id, out[0], out[1], out[2], 1, P_GAS, t)) sim.place(X, y, Z, id, P_GAS, t);   // nowhere to put it: it stays
        else moved++;
      }
      // Vapour held by the air inside goes too, a share of a cell at a time, and leaves the outlet as gas once a whole cell has gathered.
      if (sim.tickN % 4 === 0) for (var vy = s.by; vy < s.by + o.len; vy++) for (var vz = -r; vz <= r; vz++) for (var vx = -r; vx <= r; vx++) {
        if (vx * vx + vz * vz > r * r) continue;
        var VX = s.cx + vx, VZ = s.cz + vz;
        if (VX < 1 || VZ < 1 || VX >= sim.W - 1 || VZ >= sim.D - 1) continue;
        var j = sim.idx(VX, vy, VZ);
        if (sim.ID[j] !== AIR || !sim.AUX[j] || !(sim.USED[j] > 0)) continue;
        o.vap[sim.AUX[j]] = (o.vap[sim.AUX[j]] || 0) + sim.USED[j];
        sim.AUX[j] = 0; sim.USED[j] = 0;
      }
      Object.keys(o.vap).forEach(function (k) {
        while (o.vap[k] >= 1 && L.placeMaterial(+k, out[0], out[1], out[2], 1, P_GAS, sim.ambient)) o.vap[k] -= 1;
      });
    } else if (o.kPa < L.ROOM_KPA) o.kPa = Math.min(L.ROOM_KPA, o.kPa + (o.stamp.leak ? 2 : 0.01));   // a good seal holds for minutes
    // Still liquid sleeps, and a sleeping cell never checks whether it should boil, so while the pressure is down everything under the
    // jar is kept awake.
    if (o.kPa < L.ROOM_KPA - 0.5 && sim.tickN % 5 === 0) {
      var st = o.stamp, rr = o.radius;
      for (var wy = st.by; wy < st.by + o.len; wy += 8) for (var wz = -rr; wz <= rr; wz += 8) for (var wx = -rr; wx <= rr; wx += 8) {
        var WX = st.cx + wx, WZ = st.cz + wz;
        if (WX >= 1 && WZ >= 1 && WX < sim.W - 1 && WZ < sim.D - 1) sim.wake(WX, wy, WZ);
      }
    }
  }
  // Tell the simulation about the jar with the lowest pressure, if any is below the room's.
  function refreshRegion() {
    if (!sim) return;
    var best = null;
    L.tools.forEach(function (o) { if (o.kind === "jar" && o.stamp && o.kPa < L.ROOM_KPA - 0.5 && (!best || o.kPa < best.kPa)) best = o; });
    sim.region = best ? { cx: best.stamp.cx + 0.5, cz: best.stamp.cz + 0.5, r: best.radius, y0: best.stamp.by, y1: best.stamp.by + best.len - 1, kPa: best.kPa } : null;
  }
  L.inJar = function (o, i) { o = obj(o); return !!(o && o.stamp && jarInside(o, i)); };

  // ---- Condenser ----
  // A water-cooled glass tube from the stopper of a source container down to an outlet, held in a clamp. While the source is set down
  // and stoppered, vapour that reaches its headspace goes into the condenser: gas cells of anything that boils above the cooling water's
  // temperature, and the vapour held in its air. It comes out of the outlet as liquid at the cooling water's temperature, two drops a
  // tick, for a container placed under it to catch. Gas that does not condense passes straight through. Nothing dissolved goes over,
  // which is what makes distillation separate a liquid from what is dissolved in it, or from a liquid that boils higher.
  L.COOLANT_T = 291.15;
  function condenserStep(o) {
    var v = o.vessel != null ? Vessels.byId(o.vessel) : null;
    if (o.vessel != null && !v) o.vessel = null;
    if (v && v.shell && v.shell.cap) {
      var inside = v.shell.inside, WD = sim.W * sim.D, took = 0;
      for (var q = inside.length - 1; q >= 0 && took < 6; q--) {
        var i = inside[q], id = sim.ID[i];
        if (id === AIR) {
          // Vapour held by air, a share of a cell at a time. It is drawn off every few ticks so a slow evaporation still gets across.
          if (sim.AUX[i] && sim.USED[i] > 0 && (q & 3) === (sim.tickN & 3)) { var m = sim.AUX[i]; o.vap[m] = (o.vap[m] || 0) + sim.USED[i]; sim.AUX[i] = 0; sim.USED[i] = 0; }
          continue;
        }
        if (id === FLAME || sim.PH[i] < P_GAS) continue;
        var cond = Mat.bp[id] > L.COOLANT_T + 10;
        Vessels.takeCell(cond ? o.contents : o.gas, sim, i, cond ? P_LIQUID : P_GAS);
        var y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0;
        sim.erase(r - z * sim.W, y, z);
        took++;
      }
      Object.keys(o.vap).forEach(function (k) {
        while (o.vap[k] >= 1) { o.vap[k] -= 1; Vessels.addTo(entryIn(o.contents, +k, P_LIQUID), 1, L.COOLANT_T, 0, 0); }
      });
    }
    // Out of the outlet: liquid as drops, at the cooling water's temperature, and gas let go.
    var c = clampCell(o), spots = [[0, -1, 0], [0, 0, 0], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]];
    for (var k = 0; k < 2 && o.contents.length; k++) {
      var e = o.contents[0], out = false;
      for (var s = 0; s < spots.length && !out; s++) {
        var X = c[0] + spots[s][0], Y = c[1] + spots[s][1], Z = c[2] + spots[s][2];
        if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
        var j = sim.idx(X, Y, Z);
        if (sim.ID[j] !== AIR) continue;
        sim.place(X, Y, Z, e.mat, P_LIQUID, L.COOLANT_T);
        if (sim.ID[j] !== e.mat) continue;
        out = true; o.made++;
        if (--e.n <= 0) o.contents.shift();
      }
      if (!out) break;
    }
    while (o.gas.length) {
      var g = o.gas[0];
      if (!L.placeMaterial(g.mat, o.x, o.y, o.z, 1, P_GAS, g.T)) break;
      if (--g.n <= 0) o.gas.shift();
    }
  }
  function entryIn(list, mat, form) {
    for (var k = 0; k < list.length; k++) if (list[k].mat === mat && list[k].form === form && !list[k].aux) return list[k];
    var e = { mat: mat, form: form, aux: 0, aux2: 0, n: 0, T: L.COOLANT_T, used: 0, u2: 0 };
    list.push(e);
    return e;
  }

  // ---- Power supply ----
  var rodSet = new Set();
  function gate(i) { return !rodSet.has(i); }
  function refreshGate() {
    rodSet = new Set();
    L.tools.forEach(function (o) { if (o.stamp) o.stamp.cells.forEach(function (i) { rodSet.add(i); }); });
    if (sim) sim.electrodeGate = rodSet.size ? gate : null;
  }
  function rodStamp(by, rods) { return { by: by, rods: rods, cells: rods[0].concat(rods[1]) }; }
  // Move whatever is in cell i into the nearest empty cell that is not in the way, keeping its temperature and what is dissolved in it.
  function displace(i, avoid) {
    var WD = sim.W * sim.D, y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0, x = r - z * sim.W;
    for (var R = 1; R <= 4; R++) for (var dy = R; dy >= -R; dy--) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== R) continue;
      var X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 1 || Y < 1 || Z < 1 || X >= sim.W - 1 || Y >= sim.H - 1 || Z >= sim.D - 1) continue;
      var j = sim.idx(X, Y, Z);
      if (sim.ID[j] !== AIR || avoid.has(j)) continue;
      var id = sim.ID[i], ph = sim.PH[i], t = sim.T[i], aux = sim.AUX[i], used = sim.USED[i], aux2 = sim.AUX2[i], u2 = sim.U2[i];
      sim.place(X, Y, Z, id, ph, t);
      if (sim.ID[j] !== id) return false;
      sim.AUX[j] = aux; sim.USED[j] = used; sim.AUX2[j] = aux2; sim.U2[j] = u2;
      sim.erase(x, y, z);
      return true;
    }
    return false;
  }
  // Write the rods into the grid from the tip up. Liquid and grains in the way are pushed aside; a solid in the way leaves a gap in the rod.
  function stampRods(o) {
    if (sim.busy) sim.idle();
    var by = Math.round(o.y), cx = Math.floor(o.x), cz = Math.floor(o.z), avoid = new Set(), rods = [[], []];
    var xs = [cx - o.gap, cx + o.gap], top = Math.min(sim.H - 1, by + o.len);
    xs.forEach(function (X) { for (var y = by; y < top; y++) if (X >= 1 && X < sim.W - 1 && cz >= 1 && cz < sim.D - 1) avoid.add(sim.idx(X, y, cz)); });
    xs.forEach(function (X, k) {
      if (X < 1 || X >= sim.W - 1 || cz < 1 || cz >= sim.D - 1) return;
      for (var y = by; y < top; y++) {
        var i = sim.idx(X, y, cz);
        if (sim.ID[i] !== AIR) {
          if (sim.PH[i] === P_STATIC || !displace(i, avoid)) continue;
        }
        sim.place(X, y, cz, ELECTRODE, P_STATIC);
        if (sim.ID[i] === ELECTRODE) rods[k].push(i);
      }
    });
    o.x = cx + 0.5; o.z = cz + 0.5; o.y = by;
    o.stamp = rodStamp(by, rods);
    refreshGate();
  }
  function unstampRods(o) {
    if (!o.stamp) return;
    if (sim.busy) sim.idle();
    var WD = sim.W * sim.D;
    o.stamp.cells.forEach(function (i) {
      if (sim.ID[i] !== ELECTRODE) return;
      var y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0;
      sim.erase(r - z * sim.W, y, z);
    });
    o.stamp = null;
    refreshGate();
  }
  // Ticks between pulses: every 6 at 6 V, the same rate as a plain electrode, faster at higher voltage.
  L.pulseEvery = function (o) { return Math.max(2, Math.round(36 / Math.max(o.volts, 0.1))); };
  // Whether current can flow: switched on and above the decomposition voltage.
  L.live = function (o) { o = obj(o); return !!(o && o.kind === "supply" && o.stamp && o.on && o.volts >= L.MIN_VOLTS); };
  // How many cells of each rod touch liquid, [left, right]. A rod in air carries no current into anything.
  L.wetRods = function (o) {
    o = obj(o); if (!o || !o.stamp) return [0, 0];
    var d = [1, -1, sim.W, -sim.W];
    return o.stamp.rods.map(function (rod) {
      var n = 0;
      rod.forEach(function (i) { for (var k = 0; k < 4; k++) { var j = i + d[k]; if (sim.PH[j] === P_LIQUID && sim.ID[j] !== AIR) { n++; break; } } });
      return n;
    });
  };

  // ---- Ground ----
  // The highest cell under a point that is not gas or air. Objects rest on solids, grains and liquid surfaces.
  function groundAt(x, z, fromY) {
    var X = Math.floor(x), Z = Math.floor(z);
    if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1) return 1;
    for (var y = Math.min(sim.H - 2, Math.floor(fromY)); y >= 1; y--) {
      var i = sim.idx(X, y, Z);
      if (sim.ID[i] !== AIR && sim.PH[i] < P_GAS) return y + 1;
    }
    return 1;
  }
  // Highest ground under an object's footprint, sampled at its centre and around its edge.
  L.groundUnder = function (o) {
    o = obj(o);
    if (isTool(o)) return toolFloor(o, o.y - 0.5);
    var b = L.base(o), rr = o.kind === "beaker" ? o.radius * 0.8 : o.half, g = 1;
    var pts = [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr]];
    if (o.kind === "plate") pts.push([rr, rr], [-rr, rr], [rr, -rr], [-rr, -rr]);
    for (var k = 0; k < pts.length; k++) g = Math.max(g, groundAt(b[0] + pts[k][0], b[2] + pts[k][1], b[1] - 0.5));
    return g;
  };
  L.groundAt = groundAt;
  // Lowest height a carried object can be at without its footprint sitting inside something solid. Liquid and grains do not count,
  // because a beaker can be dipped into them. The scan starts at the object's top, so walking it into a pillar lifts it over the pillar.
  L.carryFloor = function (o) {
    o = obj(o);
    if (isTool(o)) return toolFloor(o, o.y + o.len);
    var b = L.base(o), beaker = o.kind === "beaker", rr = beaker ? o.radius * 0.8 : o.half, top = b[1] + (beaker ? o.height : o.h), g = 1;
    var pts = [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr], [rr * 0.7, rr * 0.7], [-rr * 0.7, rr * 0.7], [rr * 0.7, -rr * 0.7], [-rr * 0.7, -rr * 0.7]];
    for (var k = 0; k < pts.length; k++) {
      var X = Math.floor(b[0] + pts[k][0]), Z = Math.floor(b[2] + pts[k][1]);
      if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1) continue;
      for (var y = Math.min(sim.H - 2, Math.floor(top)); y >= g; y--) {
        var i = sim.idx(X, y, Z);
        if (sim.ID[i] !== AIR && sim.PH[i] === P_STATIC) { g = Math.max(g, y + 1); break; }
      }
    }
    return g;
  };

  function clampInside(o) {
    var m = o.kind === "beaker" ? Math.ceil(o.radius + 1.5) + 1.5 : o.kind === "supply" ? o.gap + 2.5 : o.kind === "funnel" ? o.rTop + 1.5 : o.kind === "syringe" ? 7.5 : o.kind === "jar" ? o.radius + 2.5 : isTool(o) ? 1.5 : o.half + 1.5, b = L.base(o);   // room for the glass inside the chamber walls
    var bx = Math.max(m, Math.min(sim.W - m, b[0])), bz = Math.max(m, Math.min(sim.D - m, b[2])), by = Math.max(1, Math.min(sim.H - 3, b[1]));
    if (bx === b[0] && by === b[1] && bz === b[2]) return;
    if (o.kind === "beaker") Vessels.setBase(o, bx, by, bz); else { o.x = bx; o.y = by; o.z = bz; }
  }
  L.clampInside = clampInside;

  // ---- Every frame: motion only ----
  L.update = function (dt) {
    L.all().forEach(function (o) {
      clampInside(o);
      if (o.held) {
        var at = L.base(o), floor = L.carryFloor(o);
        if (at[1] < floor) { if (o.kind === "beaker") Vessels.setBase(o, at[0], floor, at[2]); else o.y = floor; }
        return;
      }
      if (o.stamp || o.shell || clamped(o)) return;
      if (o.kind === "beaker" && !o.pinTilt && o.tilt > 0) Vessels.setTilt(o, Math.max(0, o.tilt - EASE * dt));
      var b = L.base(o), g = L.groundUnder(o), y = b[1];
      if (y > g + 0.01) y = Math.max(g, y - FALL * dt);
      else if (y < g - 0.01) y = Math.min(g, y + FALL * dt * 0.5);   // something filled in under it
      if (y !== b[1]) { if (o.kind === "beaker") Vessels.setBase(o, b[0], y, b[2]); else o.y = y; }
    });
  };

  // ---- Every tick: grid writes ----
  L.step = function () {
    var list = Vessels.list;
    for (var k = 0; k < list.length; k++) {
      var v = list[k];
      if (v.shell) {
        // A set-down beaker whose support is gone, say because the plate under it was lifted, comes loose and falls.
        var s = v.shell, below = sim.idx(s.cx, s.by - 1, s.cz);
        if (s.by > 1 && (sim.ID[below] === AIR || sim.PH[below] >= P_GAS)) { Vessels.pickUp(v, sim); v.rest = 0; }
        continue;
      }
      Vessels.exchange(v, sim);
      if (!v.held && v.tilt < 0.01 && Math.abs(Vessels.base(v)[1] - L.groundUnder(v)) < 0.02) { if (++v.rest >= REST_TICKS) Vessels.setDown(v, sim); }
      else v.rest = 0;
    }
    L.plates.forEach(function (p) {
      if (!p.stamp) {
        if (!p.held && Math.abs(p.y - L.groundUnder(p)) < 0.02) { if (++p.rest >= REST_TICKS) stamp(p); }
        else p.rest = 0;
      }
      if (p.stamp) { if (p.burner) feedFlame(p); else heatPlate(p); if (p.stir) stirOn(p); }
    });
    if (sim.tickN % 10 === 0) list.forEach(function (v) { if (v.shell && v.shell.cap) checkStopper(v); });
    L.tools.forEach(function (o) {
      if (o.kind === "dropper") { if (o.drip > 0) drip(o); return; }
      if (o.kind === "funnel") { funnelStep(o); return; }
      if (o.kind === "syringe") { syringeStep(o); return; }
      if (o.kind === "tongs") { if (!o.held && !o.hold.length && o.contents.length) holdSample(o); return; }
      if (o.kind === "igniter") { if (o.auto && sim.tickN % 15 === 0) L.spark(o); return; }
      if (o.kind === "geiger") { geigerStep(o); return; }
      if (o.kind === "jar") { jarStep(o); return; }
      if (o.kind === "condenser") { condenserStep(o); return; }
      if (o.kind !== "supply") return;
      if (!o.stamp) {
        if (!o.held && Math.abs(o.y - L.groundUnder(o)) < 0.02) { if (++o.rest >= REST_TICKS) stampRods(o); }
        else o.rest = 0;
        return;
      }
      // Rods whose footing has gone, say because the beaker they stood in was lifted, come loose and fall.
      var by = o.stamp.by, cz = Math.floor(o.z), cx = Math.floor(o.x);
      if (by > 1 && [cx - o.gap, cx + o.gap].every(function (X) { var j = sim.idx(X, by - 1, cz); return sim.ID[j] === AIR || sim.PH[j] !== P_STATIC; })) { unstampRods(o); o.rest = 0; return; }
      if (L.live(o) && sim.tickN % L.pulseEvery(o) === 0) o.stamp.cells.forEach(function (i) { sim.pulseCell(i); });
    });
    refreshRegion();
  };
  // A stopper holds until the gas under it fills enough of the headspace or presses hard enough, then pops off with a puff.
  // A sealed tube, such as a discharge tube, is closed for good: its stopper stands for glass fused shut, and never pops.
  function checkStopper(v) {
    if (v.sealed) return;
    var share = Vessels.gasShare(v, sim), kPa = 0, n = 0;
    v.shell.inside.forEach(function (i) { if (sim.PH[i] >= P_GAS) { kPa += sim.P[i]; n++; } });
    kPa = n ? kPa / n : 0;
    v.gas = share;
    if (share < POP_SHARE && kPa < POP_KPA) return;
    var cap = v.shell.cap.slice();
    Vessels.setStopper(v, false, sim);
    cap.forEach(function (i) { sim.addPressure(i, 15); });
    v.popped = true;
    sim.addLog("The stopper pops out of " + v.name.toLowerCase(), "chem");
  }

  // ---- Plates ----
  function stamp(p) {
    if (sim.busy) sim.idle();
    var cx = Math.floor(p.x), cz = Math.floor(p.z), by = Math.round(p.y), cells = [];
    for (var y = by; y < by + p.h; y++) for (var dz = -p.half; dz <= p.half; dz++) for (var dx = -p.half; dx <= p.half; dx++) {
      var X = cx + dx, Z = cz + dz;
      if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1 || y >= sim.H - 1) continue;
      var i = sim.idx(X, y, Z);
      if (sim.ID[i] !== AIR) continue;   // a plate set into a pile just fills the gaps; the pile stays
      sim.place(X, y, Z, WALL, P_STATIC);
      cells.push(i);
    }
    p.x = cx + 0.5; p.z = cz + 0.5; p.y = by;
    p.stamp = { cx: cx, cz: cz, by: by, top: by + p.h, cells: cells };
  }
  function unstamp(p) {
    if (!p.stamp) return;
    if (sim.busy) sim.idle();
    var WD = sim.W * sim.D;
    p.stamp.cells.forEach(function (i) {
      if (sim.ID[i] !== WALL) return;
      var y = (i / WD) | 0, r = i - y * WD, z = (r / sim.W) | 0;
      sim.erase(r - z * sim.W, y, z);
    });
    p.stamp = null;
  }
  // A plate holds its own cells at the set temperature and pulls whatever touches its top toward it.
  // Glass conducts poorly in the simulation, so a beaker standing on the plate has its bottom layer of contents heated directly,
  // standing in for heat passing through the glass floor.
  function heatPlate(p) {
    if (p.setT == null) return;
    var s = p.stamp, T = sim.T, ID = sim.ID;
    s.cells.forEach(function (i) { if (ID[i] === WALL) T[i] = p.setT; });
    for (var dz = -p.half; dz <= p.half; dz++) for (var dx = -p.half; dx <= p.half; dx++) {
      var X = s.cx + dx, Z = s.cz + dz;
      if (X < 1 || Z < 1 || X >= sim.W - 1 || Z >= sim.D - 1 || s.top >= sim.H - 1) continue;
      var i = sim.idx(X, s.top, Z);
      if (ID[i] === AIR || ID[i] === WALL || ID[i] === ELECTRODE) continue;
      T[i] += (p.setT - T[i]) * CONTACT;
      sim.wakeI(i);
    }
    Vessels.list.forEach(function (v) {
      var vs = v.shell;
      if (!vs || vs.by !== s.top || Math.abs(vs.cx - s.cx) > p.half || Math.abs(vs.cz - s.cz) > p.half) return;
      var row = (vs.by + 1) * sim.W * sim.D;
      vs.inside.forEach(function (i) {
        if (i < row || i >= row + sim.W * sim.D) return;
        if (ID[i] === AIR || ID[i] === WALL) return;
        T[i] += (p.setT - T[i]) * CONTACT;
        sim.wakeI(i);
      });
    });
  }
  // A burner keeps a core of flame alight in the column above its nozzle (core cells high, five unless set), at the flame's temperature, for
  // as long as the gas is on. Flame rises off the core and fades. The core starts at the nozzle, so it passes a sample sitting around the
  // nozzle and carries its colour up. Anything in the core's way is heated by the flame instead. The burner's own body stays cool.
  function feedFlame(p) {
    if (p.setT == null) return;
    var s = p.stamp, ID = sim.ID, T = sim.T, r = p.nozzle || 0, top = Math.min(sim.H - 2, s.top + (p.core || 5));
    if (s.cx - r < 1 || s.cz - r < 1 || s.cx + r >= sim.W - 1 || s.cz + r >= sim.D - 1) return;
    for (var y = s.top; y < top; y++) for (var dz = -r; dz <= r; dz++) for (var dx = -r; dx <= r; dx++) {
      var i = sim.idx(s.cx + dx, y, s.cz + dz);
      if (ID[i] === FLAME) { T[i] = p.setT; if (sim.rf() < 0.1) sim.AUX[i] = 0; }   // fresh gas, so a colour lasts only while the sample is there to give it
      else if (ID[i] === AIR) { ID[i] = FLAME; sim.PH[i] = P_GAS; T[i] = p.setT; sim.AUX[i] = 0; sim.AUX2[i] = 0; sim.USED[i] = 0; sim.U2[i] = 0; sim.wakeI(i); }
      else if (ID[i] !== WALL && ID[i] !== ELECTRODE) { T[i] += (p.setT - T[i]) * CONTACT; sim.wakeI(i); }
    }
  }
  // A stirrer swirls the contents of a set-down container standing on it: liquid and grains trade places with the cell beside them along
  // a circle round the middle, and grains on the floor are lifted into the liquid above, which is what keeps a solid dissolving.
  // Faster settings move more cells each tick. Cells are only ever swapped, so nothing is made or lost.
  var STIR_SHARE = [0, 0.08, 0.2, 0.4];   // share of the contents moved along the circle each tick
  var STIR_LIFT = [0, 0.15, 0.3, 0.5];    // chance each tick that a grain under liquid is swept up
  function movable(i) { var ph = sim.PH[i], id = sim.ID[i]; return (ph === P_LIQUID || ph === P_POWDER) && id !== AIR && id !== WALL && id !== ELECTRODE; }
  function stirOn(p) {
    Vessels.list.forEach(function (v) {
      if (L.plateOn(v) !== p) return;
      var s = v.shell, inside = s.inside, n = Math.round(inside.length * STIR_SHARE[p.stir] * 0.5), W = sim.W, WD = sim.W * sim.D, k, i, y;
      // Grains under liquid are swept up a few cells, trading places with the liquid above them. They settle again on their own,
      // so the faster the stirrer, the more of a solid hangs in the liquid at any moment.
      for (k = 0; k < inside.length; k++) {
        i = inside[k];
        if (sim.PH[i] !== P_POWDER || sim.ID[i] === AIR || sim.rf() >= STIR_LIFT[p.stir]) continue;
        y = (i / WD) | 0;
        for (var climb = 1 + ((sim.rf() * (p.stir + 1)) | 0); climb > 0 && y + 1 <= s.by + s.h; climb--, y++) {
          var up = i + WD;
          if (sim.PH[up] !== P_LIQUID || sim.ID[up] === AIR) break;
          sim.swap(i, up); sim.wakeI(i); sim.wakeI(up); i = up;
        }
      }
      for (k = 0; k < n; k++) {
        i = inside[(sim.rf() * inside.length) | 0];
        if (!movable(i)) continue;
        y = (i / WD) | 0;
        var r = i - y * WD, z = (r / W) | 0, x = r - z * W, dx = x - s.cx, dz = z - s.cz;
        // Step along the circle: the tangent to the radius, rounded to whichever neighbour it points at most.
        var tx = -dz, tz = dx, j;
        if (!tx && !tz) j = i + (sim.rf() < 0.5 ? 1 : W);
        else j = Math.abs(tx) >= Math.abs(tz) ? i + (tx > 0 ? 1 : -1) : i + (tz > 0 ? W : -W);
        if (!movable(j)) continue;
        sim.swap(i, j); sim.wakeI(i); sim.wakeI(j);
      }
    });
  }
  L.plateOn = function (v) {
    if (!v.shell) return null;
    for (var k = 0; k < L.plates.length; k++) { var p = L.plates[k], s = p.stamp; if (s && v.shell.by === s.top && Math.abs(v.shell.cx - s.cx) <= p.half && Math.abs(v.shell.cz - s.cz) <= p.half) return p; }
    return null;
  };
  return L;
})();
if (typeof module !== "undefined") module.exports = Lab;
