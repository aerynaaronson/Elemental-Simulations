// Draws lab equipment as smooth meshes modelled in Blender (tools/blender/labware.py writes js/labware.data.js), on top of the raymarched
// chamber. The meshes are depth-tested against the raymarcher's depth, so material in front hides them and contents show through glass.
// Nothing here touches the simulation: the equipment's own cells (glass shells, plate slabs, rods, the bell jar) stay real, and
// LabRender only hides how they look, so the mesh is what you see where they are. Liquids and powders inside are still cells.
// Every model is in cell units with its origin where the simulation puts the object, so meshes and cells line up.
var LabMeshes = (function () {
  var M = { ready: false, failed: false, enabled: true };
  var gl = null, prog = null, U = {}, meshes = {}, frameN = 0, readings = new Map();

  // Linear colour, metalness, roughness, glass (blended: alpha is how much of the body colour shows) and emission.
  var MATS = {
    glass: { c: [0.9, 0.95, 1.0], m: 0, r: 0.04, glass: true, a: 0.035 },
    coolant: { c: [0.4, 0.66, 0.95], m: 0, r: 0.05, glass: true, a: 0.22 },
    oil: { c: [0.9, 0.55, 0.1], m: 0, r: 0.05, glass: true, a: 0.6 },
    liquid: { c: [0.4, 0.6, 0.9], m: 0, r: 0.05, glass: true, a: 0.5 },
    enamel: { c: [0.86, 0.86, 0.83], m: 0, r: 0.5 },
    ink: { c: [0.02, 0.02, 0.025], m: 0, r: 0.6 },
    porcelain: { c: [0.84, 0.83, 0.79], m: 0, r: 0.22 },
    steel: { c: [0.62, 0.63, 0.66], m: 1, r: 0.32 },
    chrome: { c: [0.8, 0.81, 0.83], m: 1, r: 0.12 },
    alu: { c: [0.72, 0.73, 0.75], m: 1, r: 0.42 },
    brass: { c: [0.82, 0.6, 0.3], m: 1, r: 0.3 },
    cast: { c: [0.06, 0.1, 0.17], m: 0, r: 0.55 },
    body_white: { c: [0.74, 0.75, 0.76], m: 0, r: 0.45 },
    body_grey: { c: [0.36, 0.38, 0.42], m: 0, r: 0.45 },
    body_blue: { c: [0.12, 0.22, 0.38], m: 0, r: 0.45 },
    "case": { c: [0.05, 0.06, 0.075], m: 0, r: 0.5 },
    panel: { c: [0.018, 0.02, 0.024], m: 0, r: 0.35 },
    knob: { c: [0.008, 0.008, 0.01], m: 0, r: 0.35 },
    ceramic: { c: [0.006, 0.006, 0.008], m: 0, r: 0.07 },
    ceramic_white: { c: [0.82, 0.82, 0.8], m: 0, r: 0.18 },
    zone: { c: [0.3, 0.3, 0.31], m: 0, r: 0.3 },
    rubber: { c: [0.16, 0.045, 0.025], m: 0, r: 0.75 },
    rubber_red: { c: [0.45, 0.025, 0.02], m: 0, r: 0.55 },
    rubber_black: { c: [0.012, 0.012, 0.012], m: 0, r: 0.7 },
    latex: { c: [0.56, 0.24, 0.06], m: 0, r: 0.45 },
    paper: { c: [0.88, 0.87, 0.82], m: 0, r: 0.9 },
    label: { c: [0.9, 0.89, 0.85], m: 0, r: 0.8 },
    band: { c: [0.6, 0.03, 0.02], m: 0, r: 0.6 },
    lcd: { c: [0.01, 0.025, 0.015], m: 0, r: 0.2, e: [0.05, 0.25, 0.12] },
    lamp: { c: [0.08, 0.01, 0.01], m: 0, r: 0.2 },
    alcohol: { c: [0.7, 0.02, 0.015], m: 0, r: 0.2, e: [0.08, 0.0, 0.0] },
    gauze: { c: [0.05, 0.05, 0.055], m: 1, r: 0.6 },
    fiber: { c: [0.64, 0.6, 0.55], m: 0, r: 0.95 },
    graphite: { c: [0.02, 0.02, 0.022], m: 0.3, r: 0.5 },
    ptfe: { c: [0.88, 0.88, 0.86], m: 0, r: 0.4 },
    geiger: { c: [0.88, 0.4, 0.008], m: 0, r: 0.4 },
    red_plastic: { c: [0.55, 0.008, 0.004], m: 0, r: 0.35 },
    mica: { c: [0.04, 0.025, 0.012], m: 0, r: 0.15 },
    motor: { c: [0.015, 0.075, 0.26], m: 0, r: 0.4 },
    cork: { c: [0.36, 0.19, 0.07], m: 0, r: 0.9 }
  };
  M.MATS = MATS;
  // The containers' models and the size each was modelled at, from Lab.CONTAINERS.
  var CONTAINER_MODEL = { beaker: "beaker", tube: "tube", flask: "flask", crucible: "crucible", dish: "dish", bottle: "bottle" };
  // Plates: the model, and the half-width and height it was modelled at.
  var PLATE_BASE = { hotplate: [6, 2], stirrer: [6, 2], chiller: [6, 2], balance: [5, 2], burner: [2, 4] };
  M.MODELS_USED = ["beaker", "tube", "flask", "crucible", "dish", "bottle", "stopper", "hotplate", "stirrer", "chiller", "balance", "burner", "stirbar",
    "thermometer", "dropper", "rod", "supply", "funnel", "syringe", "seg", "ball", "stand", "boss", "jaws", "tongs", "igniter", "geiger", "jar", "pump",
    "cond_end", "cond_nipple", "cond_tip"];
  // Label stripe colours by kind of reagent, as hazard bands on real bottles.
  var BAND = { hcl: "acid", h2so4: "acid", hno3: "acid", vinegar: "acid", naoh: "alkali", nh3: "alkali", kmno4: "oxidiser", h2o2: "oxidiser", agno3: "oxidiser",
    phenol: "indicator", litmus: "indicator", ethanol: "flammable", water: "water" };
  var BAND_COL = { acid: [0.6, 0.03, 0.02], alkali: [0.03, 0.12, 0.5], oxidiser: [0.75, 0.45, 0.01], indicator: [0.3, 0.05, 0.4], flammable: [0.8, 0.2, 0.0],
    water: [0.15, 0.4, 0.7], salt: [0.04, 0.32, 0.08] };

  // ---- Decoding the Blender data ----
  function bytes(s) {
    if (typeof atob === "function") { var b = atob(s), u = new Uint8Array(b.length); for (var k = 0; k < b.length; k++) u[k] = b.charCodeAt(k); return u; }
    return new Uint8Array(Buffer.from(s, "base64"));   // headless tests
  }
  M.decode = function (p) {
    var q = new Uint16Array(bytes(p.p).buffer), n = q.length / 3, pos = new Float32Array(q.length);
    for (var k = 0; k < n; k++) for (var a = 0; a < 3; a++) pos[k * 3 + a] = p.lo[a] + q[k * 3 + a] / 65535 * p.sc[a];
    var nb = bytes(p.n), nrm = new Int8Array(nb.buffer, nb.byteOffset, nb.length);
    return { pos: pos, nrm: nrm, idx: new Uint16Array(bytes(p.i).buffer), count: n, part: p.part, mat: p.mat, lo: p.lo, sc: p.sc };
  };

  // ---- Matrices, column-major as GL wants them ----
  function mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function T(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
  function S(x, y, z) { return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); }
  function RY(t) { var c = Math.cos(t), s = Math.sin(t); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
  function RZ(t) { var c = Math.cos(t), s = Math.sin(t); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function basis(a, b, c, o) { return new Float32Array([a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, o[0], o[1], o[2], 1]); }
  function chain() { var m = arguments[0]; for (var k = 1; k < arguments.length; k++) m = mul(m, arguments[k]); return m; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  // A frame whose Y axis is u, for laying a part along a direction.
  function alongY(u, o) {
    u = norm(u); var ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], x = norm(cross(ref, u)), z = cross(x, u);
    return basis(x, u, z, o);
  }
  function normalMatrix(m) {
    var a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C, k = det ? 1 / det : 0;
    // inverse transpose of the upper 3x3, column-major
    return { m: new Float32Array([A * k, B * k, C * k, -(b * i - c * h) * k, (a * i - c * g) * k, -(a * h - b * g) * k, (b * f - c * e) * k, -(a * f - c * d) * k, (a * e - b * d) * k]), det: det };
  }
  M.mat = { mul: mul, T: T, S: S, RY: RY, RZ: RZ, basis: basis, alongY: alongY, normalMatrix: normalMatrix };

  // ---- What to draw ----
  // An item is one model placed by a matrix. opts.parts picks parts, opts.skip leaves some out, opts.over changes a part's material.
  var items = [];
  function put(model, m, opts) { items.push({ model: model, m: m, o: opts || {} }); }
  function lin(c) { return Math.pow(c / 255, 2.2); }
  function liquidColour(mat) {
    if (typeof Mat === "undefined" || !Mat.colL) return [0.4, 0.6, 0.9];
    var k = mat * 3; return [lin(Mat.colL[k]), lin(Mat.colL[k + 1]), lin(Mat.colL[k + 2])];
  }
  function tube(a, b, r, mat) {   // a round tube from a to b, as the unit segment stretched
    var d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-3) return;
    put("seg", mul(alongY(d, a), S(r, L, r)), { over: { seg: { mat: mat } } });
  }
  function hose(pts, r, mat) {
    for (var k = 0; k + 1 < pts.length; k++) tube(pts[k], pts[k + 1], r, mat);
    for (var j = 1; j + 1 < pts.length; j++) put("ball", mul(T(pts[j][0], pts[j][1], pts[j][2]), S(r, r, r)), { over: { ball: { mat: mat } } });
  }

  // Containers. A set-down one stands on its cells; a carried one follows its frame, tipped and turned. The spout faces its pour direction.
  function container(v) {
    var c = (typeof Lab !== "undefined" && Lab.CONTAINERS[v.type]) || { radius: 4, height: 12 }, model = CONTAINER_MODEL[v.type] || "beaker";
    var f = Vessels.frame(v), o;
    if (v.shell) { var cy = Math.cos(v.yaw), sy = Math.sin(v.yaw); f = { a: [cy, 0, sy], b: [0, 1, 0], c: [-sy, 0, cy] }; o = [v.shell.cx + 0.5, v.shell.by, v.shell.cz + 0.5]; }
    else o = Vessels.base(v);
    var B = basis(f.a, f.b, f.c, o), sr = (v.radius + 0.95) / (c.radius + 0.95), sh = (v.height + 1) / (c.height + 1);
    var over = {};
    if (model === "bottle") over.band = { col: BAND_COL[BAND[v.reagent] || "salt"] };
    put(model, mul(B, S(sr, sh, sr)), { over: over, centre: o });
    if (v.stopper) { var ri = v.radius + 0.55; put("stopper", chain(B, T(0, v.height + 1, 0), S(ri + 0.12, 1, ri + 0.12)), { centre: o }); }
    // A stirrer turning under a set-down container spins a bar on its floor.
    if (v.shell && typeof Lab !== "undefined" && Lab.plateOn) {
      var p = Lab.plateOn(v);
      if (p && p.stir) put("stirbar", chain(T(o[0], o[1] + 1.02, o[2]), RY((Sim.tickN || 0) * 0.22 * p.stir), S(Math.min(1, v.radius / 4), 1, 1)));
    }
  }

  // Plates sit on the cells they fill, or where they are carried. Each model stretches to the plate's footprint and height.
  function plateModel(p) { return p.burner ? "burner" : p.scale ? "balance" : p.cold ? "chiller" : p.stir != null ? "stirrer" : "hotplate"; }
  function plateGlow(p) { return p.setT == null ? 0 : Math.max(0, Math.min(1, (p.setT - 340) / 520)); }
  function plateFrost(p) { return p.setT == null ? 0 : Math.max(0, Math.min(1, (273 - p.setT) / 196)); }
  function plate(p) {
    var model = plateModel(p), base = PLATE_BASE[model], o = p.stamp ? [p.stamp.cx + 0.5, p.stamp.by, p.stamp.cz + 0.5] : [Math.floor(p.x) + 0.5, Math.round(p.y), Math.floor(p.z) + 0.5];
    var s = (p.half + 0.5) / (base[0] + 0.5), m = mul(T(o[0], o[1], o[2]), S(s, p.h / base[1], s)), over = {}, on = p.setT != null;
    var t = plateGlow(p);
    if (model === "hotplate" || model === "stirrer") {
      // The heating zone glows dull red and then orange as it heats; the rest of the glass-ceramic only faintly.
      var e = [2.6 * Math.pow(t, 1.3), 0.4 * t * t, 0.05 * t];
      over.top = { emit: [e[0] * 0.08, e[1] * 0.08, e[2] * 0.08] }; over.zone = { emit: e };
      over.led = { emit: on ? [2.2, 0.15, 0.05] : [0, 0, 0] };
      if (model === "stirrer" && p.stir && !on) over.led = { emit: [0.2, 1.6, 0.4] };
    } else if (model === "chiller") {
      var fr = plateFrost(p), c0 = MATS.alu.c;
      over.top = { col: [c0[0] + (0.85 - c0[0]) * fr, c0[1] + (0.9 - c0[1]) * fr, c0[2] + (0.95 - c0[2]) * fr], metal: 1 - 0.85 * fr, rough: 0.42 + 0.5 * fr };
      over.grooves = over.top;
      over.led = { emit: on ? [0.2, 0.6, 2.2] : [0, 0, 0] };
    } else if (model === "balance") {
      over.lcd = { emit: [0.12, 0.55, 0.28] };
    }
    put(model, m, { over: over, centre: o });
  }

  // A clamp stand beside a tool: a base on whatever is under it, a rod, a boss and an arm whose jaws close round the tool at height y.
  function ground(x, z, fromY) {
    var X = Math.floor(x), Z = Math.floor(z), y = Math.min(Sim.H - 2, Math.floor(fromY));
    if (X < 1 || Z < 1 || X >= Sim.W - 1 || Z >= Sim.D - 1) return 1;
    while (y > 1) { var i = Sim.idx(X, y - 1, Z); if (Sim.ID[i] !== AIR && Sim.PH[i] === P_STATIC) break; y--; }
    return y;
  }
  function stand(sx, sz, y, tx, tz) {
    var gy = ground(sx, sz, y), top = y + 0.9;
    put("stand", T(sx, gy, sz));
    tube([sx, gy + 0.4, sz], [sx, top, sz], 0.2, "chrome");
    var dx = sx - tx, dz = sz - tz, L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    put("boss", chain(T(sx, y, sz), RY(yaw)));
    if (L > 1.2) tube([sx - dx / L * 0.4, y, sz - dz / L * 0.4], [tx + dx / L * 1.4, y, tz + dz / L * 1.4], 0.13, "steel");
    put("jaws", chain(T(tx, y, tz), RY(yaw)));
  }

  // Readings that change how a tool looks, refreshed every few frames rather than every frame.
  function thermometerLevel(o) {
    var r = readings.get(o);
    if (!r || frameN - r.at > 6) { var q = Lab.read(o); r = { at: frameN, T: q ? q.T : 293.15 }; readings.set(o, r); }
    return Math.max(0, Math.min(1, (r.T - 73.15) / 800));   // -200 to 600 °C
  }
  function lampState(o) {
    if (o.kind === "jar") return o.pump ? 2 : o.kPa < Lab.ROOM_KPA - 0.5 ? 1 : 0;
    return !o.on ? 0 : Lab.live(o) || (!o.stamp && o.volts >= Lab.MIN_VOLTS) ? 2 : 1;
  }
  var LAMP = [[0.25, 0.02, 0.01], [2.4, 1.2, 0.1], [0.25, 2.6, 0.5]];
  function mouthTop(v) {   // the top of a container's stopper, where a tube goes in
    if (v.shell) return [v.shell.cx + 0.5, v.shell.by + v.shell.h + 1.9, v.shell.cz + 0.5];
    var b = Vessels.base(v); return [b[0], b[1] + v.height + 1.9, b[2]];
  }

  function tool(o) {
    var x = o.x, y = o.y, z = o.z;
    switch (o.kind) {
      case "probe":
        put("thermometer", T(Math.floor(x) + 0.5, y, Math.floor(z) + 0.5), { over: { column: { clip: [0, 1, 0, -(1.0 + 10.2 * thermometerLevel(o))] } } });
        return;
      case "dropper": {
        var n = Lab.amountIn(o), main = null, over = {};
        o.contents.forEach(function (c) { if (!main || c.n > main.n) main = c; });
        if (n && main) over.liquid = { col: liquidColour(main.mat), alpha: main.mat === (typeof Shade !== "undefined" ? Shade.WATER_ID : -1) ? 0.12 : 0.55, clip: [0, 1, 0, -(0.05 + 5.95 * n / o.cap)] };
        else over.liquid = { hide: true };
        put("dropper", T(Math.floor(x) + 0.5, y, Math.floor(z) + 0.5), { over: over });
        // A dropper held in a clamp over a container has its stand on the bench beside that container, not in it.
        if (o.clamp) {
          var reach = 3;
          Vessels.list.forEach(function (v) { if (v.shell && Math.hypot(v.shell.cx + 0.5 - x, v.shell.cz + 0.5 - z) < v.radius + 2) reach = Math.max(reach, v.shell.cx + 0.5 - x + v.radius + 3); });
          stand(x + reach, z, y + o.len - 2, Math.floor(x) + 0.5, Math.floor(z) + 0.5);
        }
        return;
      }
      case "supply": {
        var lamp = lampState(o), X = Math.floor(x) + 0.5, Z = Math.floor(z) + 0.5;
        [-o.gap, o.gap].forEach(function (g) { put("rod", chain(T(X + g, y, Z), S(1, o.len / 14, 1))); });
        put("supply", chain(T(X, y + o.len, Z), S((o.gap + 1.4) / 3.4, 1, 1)), { over: { led: { emit: LAMP[lamp] }, lcd: { emit: o.on ? [0.15, 0.7, 0.35] : [0.01, 0.03, 0.02] } } });
        return;
      }
      case "funnel":
        put("funnel", T(Math.floor(x) + 0.5, Math.floor(y), Math.floor(z) + 0.5), { over: o.filter ? {} : { paper: { hide: true } } });
        return;
      case "syringe": {
        var ox = Math.floor(x) + 0.5, oy = Math.floor(y) + 1.5, oz = Math.floor(z) + 0.5, f = Lab.amountIn(o) / o.cap, head = -4 + 9 * f, thumb = 6 + 9 * f;
        var base = T(ox, oy, oz);
        put("syringe", base, { parts: ["barrel", "print", "cradle"] });
        put("syringe", chain(base, T(head, 0, 0)), { parts: ["head"] });
        put("syringe", chain(base, T(head + 0.3, 0, 0), S(thumb - head - 0.45, 1, 1)), { parts: ["rod"] });
        put("syringe", chain(base, T(thumb, 0, 0)), { parts: ["thumb"] });
        var v = o.vessel != null ? Vessels.byId(o.vessel) : null;
        if (v) {
          var m = mouthTop(v), up = Math.max(m[1] + 2, oy + 2);
          hose([[ox - 6.5, oy, oz], [ox - 7.4, oy, oz], [ox - 7.4, up, oz], [m[0], up, oz], [m[0], up, m[2]], [m[0], m[1] - 0.4, m[2]]], 0.3, "latex");
        }
        return;
      }
      case "tongs": {
        var open = o.hold.length || Lab.amountIn(o) ? 0 : 0.13, tb = T(x, y, z), piv = T(0, 6, 0), unpiv = T(0, -6, 0);
        put("tongs", chain(tb, piv, RZ(open), unpiv), { parts: ["arm_l"] });
        put("tongs", chain(tb, piv, RZ(-open), unpiv), { parts: ["arm_r"] });
        put("tongs", tb, { parts: ["pivot"] });
        stand(x + 3, z, y + o.len - 1, x, z);
        return;
      }
      case "igniter":
        put("igniter", T(x, y, z));
        stand(x + 3, z, y + o.len - 2, x, z);
        return;
      case "geiger": {
        var hit = o.hits && o.hits.length && o.hits[o.hits.length - 1] > 0;
        put("geiger", T(x, y, z), { over: { led: { emit: hit ? [3, 0.25, 0.1] : [0.15, 0.01, 0.01] } } });
        stand(x + 3, z, y + o.len - 2, x, z);
        return;
      }
      case "jar": {
        var jo = o.stamp ? [o.stamp.cx + 0.5, o.stamp.by, o.stamp.cz + 0.5] : [Math.floor(x) + 0.5, Math.round(y), Math.floor(z) + 0.5];
        var sr = (o.radius + 1.2) / 9.2;
        put("jar", mul(T(jo[0], jo[1], jo[2]), S(sr, o.len / 16, sr)), { centre: [jo[0], jo[1] + o.len / 2, jo[2]] });
        put("pump", T(jo[0] + (o.radius - 8), jo[1], jo[2]), { over: { led: { emit: LAMP[lampState(o)] } } });
        return;
      }
      case "condenser": condenser(o); return;
    }
  }
  function condenser(o) {
    var v = o.vessel != null ? Vessels.byId(o.vessel) : null, out = [o.x, o.y + 0.5, o.z], top;
    if (v) { var mt = mouthTop(v); tube([mt[0], mt[1] - 0.6, mt[2]], [mt[0], mt[1] + 1.6, mt[2]], 0.42, "glass"); top = [mt[0], mt[1] + 1.6, mt[2]]; }
    else top = [o.x - 10 + 0.5, o.y + 7.5, o.z + 0.5];
    var d = [out[0] - top[0], out[1] - top[1], out[2] - top[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (L < 2) return;
    var u = [d[0] / L, d[1] / L, d[2] / L], at = function (t) { return [top[0] + d[0] * t, top[1] + d[1] * t, top[2] + d[2] * t]; };
    tube(top, out, 0.42, "glass");
    var j0 = at(0.15), j1 = at(0.9), centre = at(0.5);
    tube(j0, j1, 1.35, "glass");
    tube(at(0.155), at(0.895), 1.2, "coolant");
    put("cond_end", alongY(u, j0), { centre: centre });
    put("cond_end", alongY([-u[0], -u[1], -u[2]], j1), { centre: centre });
    // Water in at the low end and out at the high end, through nipples on the jacket's upper side.
    var side = norm(cross(u, cross([0, 1, 0], u))); if (side[1] < 0) side = [-side[0], -side[1], -side[2]];
    if (Math.abs(u[1]) > 0.95) side = [1, 0, 0];
    // The nipple is modelled along +X; turned a quarter about Z it lies along the frame's Y, which points out of the jacket.
    [at(0.22), at(0.83)].forEach(function (p) { put("cond_nipple", mul(alongY(side, [p[0] + side[0] * 1.2, p[1] + side[1] * 1.2, p[2] + side[2] * 1.2]), RZ(Math.PI / 2))); });
    put("cond_tip", alongY([-u[0], -u[1], -u[2]], out));
    stand(centre[0] + 2, centre[2] + 2, centre[1], centre[0], centre[2]);
  }

  // Everything a mesh shows that is not a cell, as a string: when it changes, the frame must be drawn again.
  M.visualKey = function () {
    if (typeof Lab === "undefined") return "";
    var s = "";
    Lab.tools.forEach(function (o) {
      s += o.id + ":" + o.x.toFixed(2) + "," + o.y.toFixed(2) + "," + o.z.toFixed(2);
      if (o.kind === "probe") { var r = readings.get(o); s += "," + (r ? Math.round(r.T) : 0); }
      if (o.kind === "dropper" || o.kind === "syringe" || o.kind === "tongs") s += "," + Lab.amountIn(o);
      if (o.kind === "supply" || o.kind === "jar") s += "," + lampState(o) + (o.on ? "on" : "");
      if (o.kind === "geiger") s += "," + (o.hits && o.hits.length ? o.hits[o.hits.length - 1] : 0);
      s += ";";
    });
    Lab.plates.forEach(function (p) { s += p.id + ":" + p.setT + "," + p.stir + ";"; if (p.stir) s += "t" + Sim.tickN; });
    Vessels.list.forEach(function (v) { s += v.id + ":" + (v.stopper ? 1 : 0) + ";"; });
    return s;
  };

  var warned = new Set();
  function warnOnce(o, e) {
    var k = (o && (o.kind || o.type)) + ":" + (e && e.message);
    if (warned.has(k)) return;
    warned.add(k);
    if (typeof console !== "undefined") console.warn("Lab mesh skipped for " + (o && o.name) + ": " + (e && e.message));
  }

  M.collect = function () {
    items = [];
    if (typeof Lab === "undefined" || typeof Sim === "undefined" || !Sim.ID) return items;
    // One object in a state nobody foresaw must not take every other model with it, so each is placed on its own.
    var safe = function (fn) { return function (o) { try { fn(o); } catch (e) { warnOnce(o, e); } }; };
    Vessels.list.forEach(safe(container));
    Lab.plates.forEach(safe(plate));
    Lab.tools.forEach(safe(tool));
    return items;
  };

  // ---- GL ----
  var VS = [
    "#version 300 es",
    "precision highp float;in vec3 aP;in vec3 aN;uniform mat4 uVP,uM;uniform mat3 uNM;out vec3 vW,vN,vL;",
    "void main(){vec4 w=uM*vec4(aP,1.);vW=w.xyz;vN=uNM*aN;vL=aP;gl_Position=uVP*w;}"
  ].join("\n");
  var FS = [
    "#version 300 es",
    "precision highp float;in vec3 vW,vN,vL;out vec4 o;",
    "uniform vec3 uEye,uCol,uEmit;uniform float uMetal,uRough,uAlpha,uLDR,uFlip;uniform int uGlass;uniform vec4 uClip;",
    "const vec3 SUN=normalize(vec3(-.62,.7,.34));const vec3 SUNC=vec3(3.5,3.2,2.8);",
    // A studio around the bench: dark floor, a soft sky, a big softbox overhead and a window band, so glass and metal have something to reflect.
    "vec3 env(vec3 d,float r){float t=clamp(d.y*.5+.5,0.,1.);vec3 c=mix(vec3(.03,.032,.038),vec3(.15,.17,.21),smoothstep(.3,.75,t));",
    " float k=mix(28.,3.,r);c+=vec3(1.5,1.45,1.38)*pow(max(dot(d,normalize(vec3(.2,.92,.3))),0.),k)*mix(1.,.25,r);",
    " c+=vec3(.55,.6,.7)*smoothstep(-.05,.2,d.y)*smoothstep(.55,.2,d.y)*(.55+.45*d.z)*(1.-r*.6);",
    " c+=SUNC*.25*pow(max(dot(d,SUN),0.),mix(300.,8.,r))*(1.-r*.8);return c;}",
    "void main(){",
    " if(dot(uClip.xyz,vL)+uClip.w>0.)discard;",
    " vec3 N=normalize(vN)*uFlip;if(!gl_FrontFacing)N=-N;vec3 V=normalize(uEye-vW);float nv=max(dot(N,V),1e-3);",
    " vec3 R=reflect(-V,N);float nl=max(dot(N,SUN),0.);vec3 H=normalize(SUN+V);float nh=max(dot(N,H),0.);",
    " float a=max(uRough*uRough,.002),a2=a*a,dd=nh*nh*(a2-1.)+1.,D=a2/(3.14159*dd*dd);float k=(uRough+1.)*(uRough+1.)/8.;",
    " float Gv=nv/(nv*(1.-k)+k),Gl=nl/(nl*(1.-k)+k);",
    " vec3 F0=mix(vec3(.04),uCol,uMetal);vec3 Fv=F0+(1.-F0)*pow(1.-nv,5.);",
    " vec3 spec=D*Gv*Gl/(4.*nv*max(nl,1e-3)+1e-3)*Fv*SUNC*nl;",
    " vec3 hemi=mix(vec3(.035,.035,.04),vec3(.2,.22,.26),N.y*.5+.5);",
    " vec3 refl=env(R,uRough)*Fv*mix(1.,.45,uRough);",
    " vec3 c;float al=1.;",
    " if(uGlass==1){float F=.04+.96*pow(1.-nv,5.);c=env(R,uRough)*F+spec+uCol*uAlpha*(hemi*2.+SUNC*nl*.15)+uCol*.05*pow(1.-nv,2.);al=clamp(F+uAlpha,0.,1.);}",
    " else{vec3 diff=uCol*(1.-uMetal)*(SUNC*nl*.32+hemi*1.2);c=diff+spec+refl;}",
    " c+=uEmit;",
    " if(uLDR>.5){c=c/(1.+c);c=pow(c,vec3(1./2.2));}",
    " o=uGlass==1?vec4(c,al):vec4(c,length(vW-uEye));",
    "}"
  ].join("\n");

  function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function init(g) {
    gl = g;
    try {
      if (typeof LABWARE === "undefined") throw new Error("js/labware.data.js is missing");
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, "aP"); gl.bindAttribLocation(prog, 1, "aN");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      ["uVP", "uM", "uNM", "uEye", "uCol", "uEmit", "uMetal", "uRough", "uAlpha", "uLDR", "uFlip", "uGlass", "uClip"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      Object.keys(LABWARE.models).forEach(function (name) {
        meshes[name] = LABWARE.models[name].map(function (p) {
          var d = M.decode(p), vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, d.pos, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
          var nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, d.nrm, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 0, 0);
          var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.idx, gl.STATIC_DRAW);
          gl.bindVertexArray(null);
          return { part: d.part, mat: d.mat, vao: vao, n: d.idx.length, centre: [d.lo[0] + d.sc[0] / 2, d.lo[1] + d.sc[1] / 2, d.lo[2] + d.sc[2] / 2] };
        });
      });
      M.ready = true;
    } catch (e) {
      M.failed = true; M.error = String(e && e.message || e);
      if (typeof console !== "undefined") console.warn("Lab meshes are off, equipment is drawn as voxels: " + M.error);
    }
  }

  var NO_CLIP = [0, 0, 0, -1];
  function drawPart(it, p, glass, VPeye) {
    var ov = it.o.over && it.o.over[p.part] || {};
    if (ov.hide) return;
    var mat = MATS[ov.mat || p.mat] || MATS.steel;
    if (!!mat.glass !== glass) return;
    var col = ov.col || mat.c, emit = ov.emit || mat.e || [0, 0, 0], clip = ov.clip || NO_CLIP;
    gl.uniform3f(U.uCol, col[0], col[1], col[2]);
    gl.uniform3f(U.uEmit, emit[0], emit[1], emit[2]);
    gl.uniform1f(U.uMetal, ov.metal != null ? ov.metal : mat.m);
    gl.uniform1f(U.uRough, ov.rough != null ? ov.rough : mat.r);
    gl.uniform1f(U.uAlpha, ov.alpha != null ? ov.alpha : (mat.a || 0));
    gl.uniform4f(U.uClip, clip[0], clip[1], clip[2], clip[3]);
    gl.bindVertexArray(p.vao);
    if (!glass) { gl.drawElements(gl.TRIANGLES, p.n, gl.UNSIGNED_SHORT, 0); return; }
    // Glass: far side first, then the near side over it.
    gl.cullFace(gl.FRONT); gl.drawElements(gl.TRIANGLES, p.n, gl.UNSIGNED_SHORT, 0);
    gl.cullFace(gl.BACK); gl.drawElements(gl.TRIANGLES, p.n, gl.UNSIGNED_SHORT, 0);
  }
  function setItem(it) {
    if (!it.nm) it.nm = normalMatrix(it.m);
    gl.uniformMatrix4fv(U.uM, false, it.m);
    gl.uniformMatrix3fv(U.uNM, false, it.nm.m);
    gl.uniform1f(U.uFlip, 1);
    gl.frontFace(it.nm.det < 0 ? gl.CW : gl.CCW);
  }
  function partsOf(it) {
    var list = meshes[it.model];
    if (!list) return [];
    return it.o.parts ? list.filter(function (p) { return it.o.parts.indexOf(p.part) >= 0; }) : list;
  }

  // Draws into the bound framebuffer, depth-tested against what is already there. VP and eye are the camera's.
  // The alpha channel keeps the hit distance the temporal resolve needs: opaque parts write their own, glass leaves it alone.
  M.draw = function (g, VP, eye, opts) {
    if (!M.enabled || M.failed) return;
    if (!gl) init(g);
    if (!M.ready) return;
    frameN++;
    var list = M.collect();
    if (!list.length) return;
    opts = opts || {};
    try { drawList(list, VP, eye, opts); }
    catch (e) { warnOnce(null, e); }
    finally {
      // Whatever happened, hand the renderer back the state it expects.
      gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW); gl.depthFunc(gl.LESS);
      gl.bindVertexArray(null);
    }
  };
  function drawList(list, VP, eye, opts) {
    gl.useProgram(prog);
    gl.uniformMatrix4fv(U.uVP, false, VP);
    gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(U.uLDR, opts.ldr ? 1 : 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.uniform1i(U.uGlass, 0);
    list.forEach(function (it) { setItem(it); partsOf(it).forEach(function (p) { drawPart(it, p, false); }); });
    // Glass, far to near, blended over everything, without writing depth or the alpha the resolve reads.
    var dist = function (it) { var c = it.o.centre || [it.m[12], it.m[13], it.m[14]]; return Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]); };
    var glassy = list.filter(function (it) { return partsOf(it).some(function (p) { var ov = it.o.over && it.o.over[p.part] || {}, m = MATS[ov.mat || p.mat]; return m && m.glass && !ov.hide; }); });
    glassy.forEach(function (it) { it.d = dist(it); });
    glassy.sort(function (a, b) { return b.d - a.d; });
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.depthMask(false); gl.enable(gl.CULL_FACE);
    gl.uniform1i(U.uGlass, 1);
    glassy.forEach(function (it) { setItem(it); partsOf(it).forEach(function (p) { drawPart(it, p, true); }); });
  }
  return M;
})();
