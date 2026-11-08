// Draws lab equipment inside the raymarched volume instead of on a flat overlay, so it is lit, refracts, casts its glow and is hidden
// behind material like everything else. Equipment is turned into "ghost" voxels: cells that exist only in the render buffers, never in the
// simulation. After the shader has filled a chunk, the ghosts in it are painted over it, as glass, contents or the hot plate's ceramic top.
//   loose beaker:   glass walls and floor, with its contents up to their free surface, tipped with the beaker
//   set-down beaker: nothing to do, its glass and contents are real cells already
//   hot plate:       a dark ceramic top that glows red as it heats, painted over its WALL cells, or over air while it is carried
//   gas burner:      plain grey metal, painted the same way; its flame is real FLAME cells in the simulation
//   stopper:         red-brown rubber, over the WALL cells of a set-down vessel's cap, or above the rim of a loose one
//   thermometer:     a steel stem with a dark head, one cell wide
//   dropper:         a glass tube showing what it holds, under a red rubber bulb
//   power supply:    a dark case with a lamp on top, hanging over its rods. Rods that are set down are real ELECTRODE cells; loose ones are steel.
//   stirrer:         a hot plate with a white top
//   funnel:          a glass cone and stem, lined with white filter paper when it has some, with its residue in the bottom of the cone
//   gas syringe:     a glass barrel lying on its side with the plunger drawn out as it fills, and a rubber tube to the container it is on
//   balance:         a plate with a steel pan
//   clamped tools:   a steel clamp stand beside each: tongs (two arms, and the sample while carried), spark igniter (a rod with a handle),
//                    Geiger counter (a steel tube under a dark case) and condenser (a glass tube in a pale blue cooling jacket, from
//                    its source container's stopper down to its outlet)
//   bell jar:        a glass dome while loose (once set down it is real WALL cells), and a dark pump beside it with a hose
// Ghosts are rebuilt only when equipment moves or changes, and only the chunks they leave or enter are reshaded.
var LabRender = (function () {
  var R = { enabled: true };
  var byChunk = new Map(), lastSig = "", lastChunks = new Set();
  var G_GLASS = 1, G_CONTENT = 2, G_CERAMIC = 3, G_RIM = 4, G_METAL = 5, G_CASE = 6, G_RUBBER = 7, G_BULB = 8, G_LAMP = 9, G_STOPPER = 10, G_PAPER = 11, G_JACKET = 12, G_HIDE = 13;
  // With LabMeshes drawing the equipment as smooth models, only two things are left to do here: hide the equipment's own cells (glass shells,
  // plate slabs, rods, the bell jar), so the model is what shows, and draw what a carried container or funnel holds, which is still cells.
  // Without meshes (no WebGL2 data, or they failed to load) everything is drawn as voxels as before.
  function meshMode() { return typeof LabMeshes !== "undefined" && LabMeshes.enabled && LabMeshes.ready; }
  R.meshMode = meshMode;

  function chunkOf(i) {
    var W = Sim.W, WD = Sim.W * Sim.D, CS = Sim.CHUNK, y = (i / WD) | 0, r = i - y * WD, z = (r / W) | 0, x = r - z * W;
    return ((x / CS) | 0) + ((z / CS) | 0) * Sim.cw + ((y / CS) | 0) * Sim.cw * Sim.cd;
  }
  function add(i, kind, mat, form, obj) {
    var k = chunkOf(i), list = byChunk.get(k);
    if (!list) { list = []; byChunk.set(k, list); }
    list.push({ i: i, kind: kind, mat: mat, form: form, obj: obj });
  }
  function hash(i) { var h = Math.imul(i, 2654435761) >>> 0; h ^= h >>> 15; return (Math.imul(h, 2246822519) >>> 0) / 4294967296; }

  // ---- Building ghosts ----
  function beakerGhosts(v, contentsOnly) {
    var f = Vessels.frame(v), r = v.radius, h = v.height, rg = r + 1.2, reach = Math.ceil(Math.hypot(rg, h / 2 + 2.5)) + 1;
    var W = Sim.W, H = Sim.H, D = Sim.D, total = Vessels.amount(v), cont = v.contents.filter(function (c) { return c.n > 0; });
    var x0 = Math.max(1, Math.floor(v.x - reach)), x1 = Math.min(W - 2, Math.ceil(v.x + reach));
    var y0 = Math.max(1, Math.floor(v.y - reach)), y1 = Math.min(H - 2, Math.ceil(v.y + reach));
    var z0 = Math.max(1, Math.floor(v.z - reach)), z1 = Math.min(D - 2, Math.ceil(v.z + reach));
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
      var p = Vessels.toLocal(v, f, x + 0.5, y + 0.5, z + 0.5), rho = Math.hypot(p[0], p[2]), ht = p[1];
      if (contentsOnly) {
        // The model's floor is the cell layer above the base, as it is once set down, so the contents start one cell up.
        ht -= 1;
        if (ht < 0 || ht > h || rho > r || !total || ht > Vessels.surface(v, p[0])) continue;
        var i2 = Sim.idx(x, y, z), c2 = pickContent(cont, total, i2);
        add(i2, G_CONTENT, c2.mat, c2.form, v);
        continue;
      }
      if (v.stopper && ht > h && ht <= h + 1.2 && rho <= rg) { add(Sim.idx(x, y, z), G_RUBBER, 0, 0, v); continue; }
      if (ht < -1.2 || ht > h || rho > rg) continue;
      var i = Sim.idx(x, y, z);
      if (rho > r || ht < 0) { add(i, ht > h - 1 && rho > r ? G_RIM : G_GLASS, 0, 0, v); continue; }
      if (!total || ht > Vessels.surface(v, p[0])) continue;
      // Each inside cell shows one of the contents, in proportion to how much of each there is. The choice is fixed per cell, so it does not flicker.
      var pick = hash(i) * total, c = cont[0];
      for (var q = 0; q < cont.length; q++) { pick -= cont[q].n; if (pick < 0) { c = cont[q]; break; } }
      add(i, G_CONTENT, c.mat, c.form, v);
    }
  }
  function plateGhosts(p) {
    if (p.stamp) { p.stamp.cells.forEach(function (i) { add(i, G_CERAMIC, 0, 0, p); }); return; }
    var cx = Math.floor(p.x), cz = Math.floor(p.z), by = Math.round(p.y);
    for (var y = by; y < by + p.h; y++) for (var dz = -p.half; dz <= p.half; dz++) for (var dx = -p.half; dx <= p.half; dx++) {
      var X = cx + dx, Z = cz + dz;
      if (X < 1 || Z < 1 || y < 1 || X >= Sim.W - 1 || Z >= Sim.D - 1 || y >= Sim.H - 1) continue;
      add(Sim.idx(X, y, Z), G_CERAMIC, 0, 0, p);
    }
  }
  function column(X, Z, y0, y1, kindAt, obj) {
    if (X < 1 || Z < 1 || X >= Sim.W - 1 || Z >= Sim.D - 1) return;
    for (var y = Math.max(1, y0); y <= y1 && y < Sim.H - 1; y++) { var g = kindAt(y - y0); if (g) add(Sim.idx(X, y, Z), g.kind, g.mat || 0, g.form || 0, obj); }
  }
  var METAL = { kind: G_METAL }, CASE = { kind: G_CASE }, RIM = { kind: G_RIM }, BULB = { kind: G_BULB };
  // Spread a list of entries over cells: each cell shows one of them, in proportion to how much there is, fixed per cell.
  function pickContent(list, total, i) {
    var pick = hash(i) * total;
    for (var q = 0; q < list.length; q++) { pick -= list[q].n; if (pick < 0) return list[q]; }
    return list[list.length - 1];
  }
  function funnelGhosts(o, contentsOnly) {
    var X = Math.floor(o.x), Z = Math.floor(o.z), Y = Math.floor(o.y), R = o.rTop + 2, inner = [];
    for (var dy = 0; dy <= o.len; dy++) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var x = X + dx, y = Y + dy, z = Z + dz;
      if (x < 1 || z < 1 || y < 1 || x >= Sim.W - 1 || z >= Sim.D - 1 || y >= Sim.H - 1) continue;
      var rho = Math.hypot(dx, dz), i = Sim.idx(x, y, z);
      if (dy < o.stem) { if (rho < 0.5 && !contentsOnly) add(i, G_RIM, 0, 0, o); continue; }
      var r = L_funnelRadius(o, dy);
      if (rho > r && rho <= r + 0.9) { if (!contentsOnly) add(i, G_RIM, 0, 0, o); }
      else if (o.filter && rho > r - 0.9 && rho <= r) { if (!contentsOnly) add(i, G_PAPER, 0, 0, o); }
      else if (rho <= r) inner.push(i);
    }
    var cont = o.contents.filter(function (c) { return c.n > 0; }), total = Lab.amountIn(o);
    for (var k = 0; k < inner.length && k < total; k++) { var c = pickContent(cont, total, inner[k]); add(inner[k], G_CONTENT, c.mat, c.form, o); }
  }
  function L_funnelRadius(o, dy) { return Lab.funnelRadius(o, dy); }
  // The top of a container, where a delivery tube goes in through its stopper.
  function mouthOf(v) {
    if (v.shell) return [v.shell.cx, v.shell.by + v.shell.h + 2, v.shell.cz];
    var b = Vessels.base(v); return [Math.floor(b[0]), Math.round(b[1] + v.height) + 2, Math.floor(b[2])];
  }
  var TUBE = { kind: G_RUBBER };
  function line(a, b, axis, o) {   // cells from a to b along one axis, inclusive
    var p = a.slice(), step = b[axis] > a[axis] ? 1 : -1;
    for (;;) {
      if (p[0] >= 1 && p[1] >= 1 && p[2] >= 1 && p[0] < Sim.W - 1 && p[1] < Sim.H - 1 && p[2] < Sim.D - 1) add(Sim.idx(p[0], p[1], p[2]), TUBE.kind, 0, 0, o);
      if (p[axis] === b[axis]) break;
      p[axis] += step;
    }
  }
  function syringeGhosts(o) {
    var X = Math.floor(o.x), Z = Math.floor(o.z), Yc = Math.floor(o.y) + 1, f = Lab.amountIn(o) / o.cap, head = -4 + Math.round(9 * f);
    for (var dx = -6; dx <= 6 + Math.round(9 * f) + 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
      var x = X + dx, y = Yc + dy, z = Z + dz, centre = !dy && !dz;
      if (x < 1 || z < 1 || y < 1 || x >= Sim.W - 1 || z >= Sim.D - 1 || y >= Sim.H - 1) continue;
      var i = Sim.idx(x, y, z);
      if (dx === -6) { if (centre) add(i, G_RIM, 0, 0, o); continue; }        // the nozzle
      if (dx <= 5 && !centre) { add(i, G_RIM, 0, 0, o); continue; }          // the barrel
      if (!centre) continue;
      if (dx === head) add(i, G_CASE, 0, 0, o);                               // the plunger's rubber head
      else if (dx > head && dx <= 5 + Math.round(9 * f)) add(i, G_METAL, 0, 0, o);   // its rod, drawn out of the barrel as gas comes in
      else if (dx === 6 + Math.round(9 * f)) add(i, G_CASE, 0, 0, o);         // its thumb rest
    }
    var v = o.vessel != null ? Vessels.byId(o.vessel) : null;
    if (!v) return;
    // The delivery tube: up from the nozzle, across to above the container, and down into its stopper.
    var m = mouthOf(v), n0 = [X - 7, Yc, Z], up = Math.max(m[1] + 2, Yc + 2);
    line(n0, [X - 7, up, Z], 1, o);
    line([X - 7, up, Z], [m[0], up, Z], 0, o);
    line([m[0], up, Z], [m[0], up, m[2]], 2, o);
    line([m[0], up, m[2]], [m[0], m[1], m[2]], 1, o);
  }
  // A clamp stand: a base on whatever is under it and a rod up to height top, at x, z.
  function clampStand(x, z, top, o) {
    var X = Math.floor(x), Z = Math.floor(z), T = Math.min(Sim.H - 2, Math.floor(top)), y = T;
    if (X < 2 || Z < 2 || X >= Sim.W - 2 || Z >= Sim.D - 2) return;
    while (y > 1) { var i = Sim.idx(X, y - 1, Z); if (Sim.ID[i] !== AIR && Sim.PH[i] === P_STATIC) break; y--; }
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) add(Sim.idx(X + dx, y, Z + dz), G_CASE, 0, 0, o);
    for (var yy = y + 1; yy <= T; yy++) add(Sim.idx(X, yy, Z), G_METAL, 0, 0, o);
  }
  // Cells within reach of a straight segment from a to b: dist(t, d) says what each is, given how far along it is and how far from it.
  function segment(a, b, reach, kindAt, o) {
    var x0 = Math.floor(Math.min(a[0], b[0]) - reach), x1 = Math.ceil(Math.max(a[0], b[0]) + reach), y0 = Math.floor(Math.min(a[1], b[1]) - reach), y1 = Math.ceil(Math.max(a[1], b[1]) + reach);
    var z0 = Math.floor(Math.min(a[2], b[2]) - reach), z1 = Math.ceil(Math.max(a[2], b[2]) + reach), ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], L2 = ex * ex + ey * ey + ez * ez || 1;
    for (var y = Math.max(1, y0); y <= Math.min(Sim.H - 2, y1); y++) for (var z = Math.max(1, z0); z <= Math.min(Sim.D - 2, z1); z++) for (var x = Math.max(1, x0); x <= Math.min(Sim.W - 2, x1); x++) {
      var px = x + 0.5 - a[0], py = y + 0.5 - a[1], pz = z + 0.5 - a[2], t = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / L2));
      var d = Math.hypot(px - ex * t, py - ey * t, pz - ez * t), g = kindAt(t, d);
      if (g) add(Sim.idx(x, y, z), g, 0, 0, o);
    }
  }
  function condenserGhosts(o) {
    var v = o.vessel != null ? Vessels.byId(o.vessel) : null, out = [o.x, o.y, o.z];
    var start = v ? mouthOf(v) : [o.x - 10, o.y + 6, o.z], top = [start[0] + 0.5, start[1] + 1.5, start[2] + 0.5];
    if (v) line([start[0], start[1], start[2]], [start[0], start[1] + 1, start[2]], 1, o);   // the neck up from the stopper
    segment(top, [out[0], out[1] + 0.5, out[2]], 1.7, function (t, d) {
      if (d < 0.6) return G_RIM;                                       // the inner tube
      if (d < 1.7 && t > 0.15 && t < 0.9) return G_JACKET;             // the cooling jacket round its middle
      return 0;
    }, o);
    clampStand((top[0] + out[0]) / 2 + 2, (top[2] + out[2]) / 2 + 2, (top[1] + out[1]) / 2, o);
  }
  function jarGhosts(o) {
    var X = Math.floor(o.x), Z = Math.floor(o.z), Y = Math.round(o.y), r = o.radius, R = Math.ceil(r + 1.5), ro2 = (r + 1.5) * (r + 1.5);
    if (!o.stamp) {   // a carried jar; once set down its glass is real cells
      for (var y = Y; y <= Y + o.len && y < Sim.H - 1; y++) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
        var d2 = dx * dx + dz * dz, x = X + dx, z = Z + dz;
        if (d2 > ro2 || (y < Y + o.len && d2 <= r * r) || x < 1 || z < 1 || x >= Sim.W - 1 || z >= Sim.D - 1 || y < 1) continue;
        add(Sim.idx(x, y, z), y === Y + o.len ? G_RIM : G_GLASS, 0, 0, o);
      }
    }
    // The pump: a dark case beside the jar, and a hose into the jar's side.
    for (var py = Y; py < Y + 4; py++) for (var pz = -2; pz <= 2; pz++) for (var px = r + 3; px <= r + 7; px++) {
      var xx = X + px, zz = Z + pz;
      if (xx < 1 || zz < 1 || py < 1 || xx >= Sim.W - 1 || zz >= Sim.D - 1 || py >= Sim.H - 1) continue;
      add(Sim.idx(xx, py, zz), py === Y + 3 && px === r + 5 && pz === 0 ? G_LAMP : G_CASE, 0, 0, o);
    }
    line([X + r + 2, Y + 2, Z], [X + Math.ceil(r + 1.6), Y + 2, Z], 0, o);
  }
  function toolGhosts(o) {
    if (o.kind === "funnel") { funnelGhosts(o); return; }
    if (o.kind === "syringe") { syringeGhosts(o); return; }
    if (o.kind === "condenser") { condenserGhosts(o); return; }
    if (o.kind === "jar") { jarGhosts(o); return; }
    if (o.kind === "tongs") {
      var tx = Math.floor(o.x), tz = Math.floor(o.z), ty = Math.floor(o.y);
      // Two arms that meet at the tip and open out above it.
      for (var k = 1; k < o.len; k++) { var w = k < 3 ? 1 : 2; column(tx - w, tz, ty + k, ty + k, function () { return METAL; }, o); column(tx + w, tz, ty + k, ty + k, function () { return METAL; }, o); }
      column(tx, tz, ty + o.len - 1, ty + o.len, function () { return CASE; }, o);
      if (!o.hold.length && o.contents.length) column(tx, tz, ty, ty, function () { return { kind: G_CONTENT, mat: o.contents[0].mat, form: P_POWDER }; }, o);
      clampStand(o.x + 3, o.z, o.y + o.len - 1, o);
      return;
    }
    if (o.kind === "igniter") {
      var ix = Math.floor(o.x), iz = Math.floor(o.z), iy = Math.floor(o.y);
      column(ix, iz, iy + 1, iy + o.len - 1, function (k) { return k >= o.len - 5 ? CASE : METAL; }, o);
      clampStand(o.x + 3, o.z, o.y + o.len - 2, o);
      return;
    }
    if (o.kind === "geiger") {
      var gx = Math.floor(o.x), gz = Math.floor(o.z), gy = Math.floor(o.y);
      column(gx, gz, gy, gy + o.len - 1, function (k) { return k >= o.len - 4 ? CASE : METAL; }, o);
      clampStand(o.x + 3, o.z, o.y + o.len - 2, o);
      return;
    }
    var X = Math.floor(o.x), Z = Math.floor(o.z), y0 = Math.floor(o.y), n = o.len;
    if (o.kind === "probe") { column(X, Z, y0, y0 + n - 1, function (k) { return k >= n - 2 ? CASE : METAL; }, o); return; }
    if (o.kind === "dropper") {
      var amount = Lab.amountIn(o), tube = n - 3, full = amount ? Math.max(1, Math.round(tube * amount / o.cap)) : 0, main = null;
      o.contents.forEach(function (c) { if (!main || c.n > main.n) main = c; });
      var liquid = main ? { kind: G_CONTENT, mat: main.mat, form: P_LIQUID } : null;
      column(X, Z, y0, y0 + n - 1, function (k) { return k >= tube ? BULB : k < full ? liquid : RIM; }, o);
      return;
    }
    // Power supply: rods (unless they are real cells), then a case three cells high spanning them, with a lamp in the middle of its top.
    if (!o.stamp) [X - o.gap, X + o.gap].forEach(function (x) { column(x, Z, y0, y0 + n - 1, function () { return METAL; }, o); });
    var top = y0 + n;
    for (var y = top; y < top + 3 && y < Sim.H - 1; y++) for (var dz = -1; dz <= 1; dz++) for (var dx = -o.gap - 1; dx <= o.gap + 1; dx++) {
      var x = X + dx, z = Z + dz;
      if (x < 1 || z < 1 || x >= Sim.W - 1 || z >= Sim.D - 1) continue;
      add(Sim.idx(x, y, z), y === top + 2 && dx === 0 && dz === 0 ? G_LAMP : G_CASE, 0, 0, o);
    }
  }
  function meshModeGhosts() {
    var hide = function (o) { return function (i) { add(i, G_HIDE, 0, 0, o); }; };
    Vessels.list.forEach(function (v) {
      if (!v.shell) { beakerGhosts(v, true); return; }
      v.shell.wall.forEach(hide(v));
      if (v.shell.cap) v.shell.cap.forEach(hide(v));
    });
    Lab.plates.forEach(function (p) { if (p.stamp) p.stamp.cells.forEach(hide(p)); });
    Lab.tools.forEach(function (o) {
      if (o.kind === "funnel") funnelGhosts(o, true);
      else if (o.kind === "tongs" && !o.hold.length && o.contents.length) {
        var tx = Math.floor(o.x), ty = Math.floor(o.y), tz = Math.floor(o.z);
        if (tx >= 1 && tz >= 1 && ty >= 1 && tx < Sim.W - 1 && tz < Sim.D - 1 && ty < Sim.H - 1) add(Sim.idx(tx, ty, tz), G_CONTENT, o.contents[0].mat, P_POWDER, o);
      } else if ((o.kind === "supply" || o.kind === "jar") && o.stamp) o.stamp.cells.forEach(hide(o));
    });
  }
  // A short description of everything that changes how equipment looks. Ghosts are rebuilt only when it changes.
  function signature() {
    var s = "";
    Vessels.list.forEach(function (v) {
      // Where the shell is and how many cells it has, so a container set down again anywhere else rebuilds the list.
      if (v.shell) { var sh = v.shell; s += "S" + v.id + ":" + sh.cx + "," + sh.by + "," + sh.cz + "," + sh.wall.length + (sh.cap ? "c" + sh.cap.length : "") + ";"; return; }
      s += "B" + v.id + ":" + v.x.toFixed(1) + "," + v.y.toFixed(1) + "," + v.z.toFixed(1) + "," + v.tilt.toFixed(2) + "," + v.yaw.toFixed(2) + "," + Vessels.amount(v) + (v.stopper ? "c" : "") + ";";
    });
    Lab.plates.forEach(function (p) { s += "P" + p.id + ":" + p.x.toFixed(1) + "," + p.y.toFixed(1) + "," + p.z.toFixed(1) + "," + (p.stamp ? p.stamp.cells.length : 0) + "," + (p.setT == null ? "off" : Math.round(p.setT / 10)) + ";"; });
    Lab.tools.forEach(function (o) {
      s += "T" + o.id + ":" + o.x.toFixed(1) + "," + o.y.toFixed(1) + "," + o.z.toFixed(1) + "," + (o.stamp ? (o.stamp.cells ? o.stamp.cells.length : 1) : 0);
      if (o.kind === "dropper") s += "," + Lab.amountIn(o) + "," + (o.contents[0] ? o.contents[0].mat : 0);
      if (o.kind === "supply") s += "," + lampState(o);
      if (o.kind === "funnel") s += "," + Lab.amountIn(o) + "," + (o.filter ? 1 : 0);
      if (o.kind === "syringe" || o.kind === "condenser") { s += "," + Lab.amountIn(o) + "," + o.vessel; var v = o.vessel != null && Vessels.byId(o.vessel); if (v) s += "," + mouthOf(v).join(","); }
      if (o.kind === "tongs") s += "," + o.hold.length + "," + Lab.amountIn(o);
      if (o.kind === "jar") s += "," + (o.stamp ? 1 : 0) + "," + lampState(o);
      s += ";";
    });
    return s;
  }
  // A supply's lamp: 0 off, 1 on but below the voltage that drives a current, 2 live.
  // A jar's pump lamp: green while it pumps, amber when it holds a vacuum with the pump off, dark at room pressure.
  function lampState(o) {
    if (o.kind === "jar") return o.pump ? 2 : o.kPa < Lab.ROOM_KPA - 0.5 ? 1 : 0;
    return !o.on ? 0 : Lab.live(o) || (!o.stamp && o.volts >= Lab.MIN_VOLTS) ? 2 : 1;
  }
  // Called every frame. Marks the chunks that need reshading when something moved.
  R.update = function () {
    if (!R.enabled || !Sim.DIRTY) return;
    var mesh = meshMode();
    var sig = (mesh ? "M" : "V") + signature() + "|" + Sim.DIRTY.length;   // a resized chamber has different chunks
    if (sig === lastSig) return;
    lastSig = sig;
    byChunk = new Map();
    if (mesh) meshModeGhosts();
    else {
      Vessels.list.forEach(function (v) {
        if (!v.shell) beakerGhosts(v);
        else if (v.shell.cap) v.shell.cap.forEach(function (i) { add(i, G_STOPPER, 0, 0, v); });
      });
      Lab.plates.forEach(plateGhosts);
      Lab.tools.forEach(toolGhosts);
    }
    // Tell the realistic renderer where the set-down containers are, so it can shape the liquid in them to their round walls.
    if (typeof Render !== "undefined" && Render.setContainers) {
      Render.setContainers(mesh ? Vessels.list.filter(function (v) { return v.shell; }).map(function (v) {
        return { x: v.shell.cx + 0.5, z: v.shell.cz + 0.5, r: v.radius + 0.5, y0: v.shell.by, y1: v.shell.by + v.shell.h + 1 };
      }) : []);
    }
    var now = new Set(byChunk.keys());
    lastChunks.forEach(function (k) { Sim.DIRTY[k] = 1; });
    now.forEach(function (k) { Sim.DIRTY[k] = 1; });
    lastChunks = now;
  };
  R.reset = function () { lastSig = "~"; };

  // ---- Painting, from Render after the shader has run ----
  function plateGlow(p) { return p.setT == null ? 0 : Math.max(0, Math.min(1, (p.setT - 340) / 520)); }
  // How frosted a chiller looks, from 0 at freezing point to 1 near liquid nitrogen. It is pale and faintly lit, because nothing that cold glows.
  function plateFrost(p) { return p.setT == null ? 0 : Math.max(0, Math.min(1, (273 - p.setT) / 196)); }
  // Opaque equipment parts: colour, glow, and how shiny (the emit buffer's fourth channel, as the plates use it).
  var SOLID = {};
  SOLID[G_METAL] = [182, 186, 194, 0, 0, 0, 215];
  SOLID[G_CASE] = [46, 50, 58, 0, 0, 0, 150];
  SOLID[G_RUBBER] = [128, 66, 48, 0, 0, 0, 60];
  SOLID[G_STOPPER] = SOLID[G_RUBBER];
  SOLID[G_BULB] = [158, 38, 34, 0, 0, 0, 80];
  SOLID[G_PAPER] = [236, 232, 220, 0, 0, 0, 30];
  var LAMPS = [[70, 22, 20, 0, 0, 0, 120], [230, 160, 40, 200, 120, 20, 120], [60, 235, 110, 40, 255, 90, 120]];
  function paintSolid(o, c, colorBuf, emitBuf, matBuf, CLS, sh) {
    colorBuf[o] = c[0] * sh; colorBuf[o + 1] = c[1] * sh; colorBuf[o + 2] = c[2] * sh; colorBuf[o + 3] = 255;
    emitBuf[o] = c[3]; emitBuf[o + 1] = c[4]; emitBuf[o + 2] = c[5]; emitBuf[o + 3] = c[6];
    matBuf[o] = WALL & 255; matBuf[o + 1] = (WALL >> 8) | (CLS.STATIC << 4); matBuf[o + 2] = 128; matBuf[o + 3] = 255;
  }
  function paint(g, colorBuf, emitBuf, matBuf, CLS) {
    var i = g.i, o = i * 4, id = Sim.ID[i], ph = Sim.PH[i];
    if (g.kind === G_HIDE) {
      // An equipment cell the mesh stands in for: see-through and solid-free to the raymarcher. A hot plate's slab keeps its glow, as
      // light without a surface, so it still lights what stands on it.
      if (id !== WALL && id !== ELECTRODE) return;
      colorBuf[o + 3] = 0;
      if (g.obj.kind === "plate") {
        matBuf[o] = matBuf[o + 1] = matBuf[o + 2] = matBuf[o + 3] = 0;
        var hot = !g.obj.cold && !g.obj.burner && !g.obj.scale ? plateGlow(g.obj) : 0;
        emitBuf[o] = 255 * hot; emitBuf[o + 1] = 64 * hot * hot; emitBuf[o + 2] = 14 * hot; emitBuf[o + 3] = 0;
      } else {
        // Glass with no alpha: the realistic renderer still lets liquid meet it, so water fills a beaker to its wall, but draws nothing.
        matBuf[o] = id & 255; matBuf[o + 1] = (id >> 8) | (CLS.GLASS << 4); matBuf[o + 2] = 128; matBuf[o + 3] = 0;
        emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = emitBuf[o + 3] = 0;
      }
      return;
    }
    if (g.kind === G_JACKET) {   // a condenser's cooling jacket: glass with cold water in it, pale blue
      if (id !== AIR && ph < P_GAS) return;
      colorBuf[o] = 120; colorBuf[o + 1] = 186; colorBuf[o + 2] = 232; colorBuf[o + 3] = 60;
      emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = emitBuf[o + 3] = 0;
      matBuf[o] = WALL & 255; matBuf[o + 1] = (WALL >> 8) | (CLS.GLASS << 4); matBuf[o + 2] = 128; matBuf[o + 3] = 60;
      return;
    }
    if (g.kind >= G_METAL) {
      // A stopper covers its own WALL cells. Everything else here is outside the grid and shows only where the simulation has nothing solid or liquid.
      if (g.kind === G_STOPPER ? id !== WALL : id !== AIR && ph < P_GAS) return;
      paintSolid(o, g.kind === G_LAMP ? LAMPS[lampState(g.obj)] : SOLID[g.kind], colorBuf, emitBuf, matBuf, CLS, 0.94 + hash(i) * 0.06);
      return;
    }
    if (g.kind === G_CERAMIC) {
      // A plate's own cells are WALL; it may also cover air while carried. It never paints over material.
      if (id !== WALL && id !== AIR && ph < P_GAS) return;
      var t = plateGlow(g.obj), fr = plateFrost(g.obj), sh = 0.92 + hash(i) * 0.08;
      if (g.obj.burner) {   // a burner is plain grey metal: its heat goes into the flame, not its body
        colorBuf[o] = 84 * sh; colorBuf[o + 1] = 88 * sh; colorBuf[o + 2] = 96 * sh; colorBuf[o + 3] = 255;
        emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = 0; emitBuf[o + 3] = 200;
        matBuf[o] = WALL & 255; matBuf[o + 1] = (WALL >> 8) | (CLS.STATIC << 4); matBuf[o + 2] = 128; matBuf[o + 3] = 255;
        return;
      }
      if (g.obj.cold) { colorBuf[o] = (46 + 130 * fr) * sh; colorBuf[o + 1] = (58 + 140 * fr) * sh; colorBuf[o + 2] = (78 + 165 * fr) * sh; }
      else if (g.obj.scale) { colorBuf[o] = 176 * sh; colorBuf[o + 1] = 180 * sh; colorBuf[o + 2] = 188 * sh; }   // a balance's steel pan
      else if (g.obj.stir != null) { colorBuf[o] = (214 + 41 * t) * sh; colorBuf[o + 1] = (216 - 90 * t) * sh; colorBuf[o + 2] = (220 - 160 * t) * sh; }   // a stirrer's white top
      else { colorBuf[o] = (34 + 70 * t) * sh; colorBuf[o + 1] = 36 * sh; colorBuf[o + 2] = (42 - 10 * t) * sh; }
      colorBuf[o + 3] = 255;
      if (g.obj.cold) { emitBuf[o] = 26 * fr; emitBuf[o + 1] = 60 * fr; emitBuf[o + 2] = 96 * fr; }
      else { emitBuf[o] = 255 * t; emitBuf[o + 1] = 64 * t * t; emitBuf[o + 2] = 14 * t; }
      emitBuf[o + 3] = 170;
      matBuf[o] = WALL & 255; matBuf[o + 1] = (WALL >> 8) | (CLS.STATIC << 4); matBuf[o + 2] = 128; matBuf[o + 3] = 255;
      return;
    }
    // A carried beaker is drawn only where the simulation has nothing solid or liquid.
    if (id !== AIR && ph < P_GAS) return;
    if (g.kind === G_GLASS || g.kind === G_RIM) {
      var a = g.kind === G_RIM ? 30 : 18;
      colorBuf[o] = 150; colorBuf[o + 1] = 176; colorBuf[o + 2] = 205; colorBuf[o + 3] = a;
      emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = emitBuf[o + 3] = 0;
      matBuf[o] = WALL & 255; matBuf[o + 1] = (WALL >> 8) | (CLS.GLASS << 4); matBuf[o + 2] = 128; matBuf[o + 3] = a;
      return;
    }
    var m = g.mat, m3 = m * 3, v = 0.95 + hash(i) * 0.08;
    if (g.form === P_LIQUID) {
      var metal = m <= 118 && ELEMENTS[m].sigma > 0.3, al = metal ? 255 : (m === Shade.WATER_ID ? 13 : 120);
      colorBuf[o] = Mat.colL[m3] * v; colorBuf[o + 1] = Mat.colL[m3 + 1] * v; colorBuf[o + 2] = Mat.colL[m3 + 2] * v;
      colorBuf[o + 3] = al < 255 ? al | 1 : 255;
      emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = 0; emitBuf[o + 3] = metal ? 240 : 120;
      matBuf[o] = m & 255; matBuf[o + 1] = (m >> 8) | ((al === 255 ? CLS.OPAQUE_LIQUID : CLS.CLEAR_LIQUID) << 4); matBuf[o + 2] = 0; matBuf[o + 3] = colorBuf[o + 3];
    } else {
      var gv = 0.82 + hash(i + 7) * 0.28;
      colorBuf[o] = Mat.colS[m3] * gv; colorBuf[o + 1] = Mat.colS[m3 + 1] * gv; colorBuf[o + 2] = Mat.colS[m3 + 2] * gv; colorBuf[o + 3] = 255;
      emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = 0; emitBuf[o + 3] = 40;
      matBuf[o] = m & 255; matBuf[o + 1] = (m >> 8) | (CLS.POWDER << 4); matBuf[o + 2] = (gv - 0.75) * 510; matBuf[o + 3] = 255;
    }
  }
  R.afterShade = function (list, n) {
    // Bring the ghosts up to date first. Equipment set down since the last frame has already written its cells, and these chunks were
    // shaded from them: painting with last frame's list would show a new beaker's glass as voxels for a frame before the mesh took over.
    R.update();
    if (!R.enabled || !byChunk.size) return;
    var colorBuf = Shade.colorBuf, emitBuf = Shade.emitBuf, matBuf = Shade.matBuf, CLS = Shade.CLASS;
    for (var j = 0; j < n; j++) {
      var k = list[j], ghosts = byChunk.get(k);
      if (!ghosts) continue;
      for (var q = 0; q < ghosts.length; q++) paint(ghosts[q], colorBuf, emitBuf, matBuf, CLS);
      Shade.coarseByIndex(k);
    }
  };
  // How many ghost cells there are, for tests.
  R.count = function () { var n = 0; byChunk.forEach(function (l) { n += l.length; }); return n; };
  return R;
})();
