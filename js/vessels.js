// Vessels: containers that live outside the voxel grid and exchange material with it.
// A vessel is a cylinder with a position, a tilt and a pour direction. It holds an inventory of material counted in cells.
// It talks to the simulation only through material operations: loose cells inside it are taken out of the grid,
// and when it tilts past its spill angle, cells are placed just outside its lip. Every cell taken is a cell given back,
// so a vessel never creates or destroys material.
// No DOM, no input and no drawing here, so the same module serves the desktop UI, a future VR layer and headless tests.
var Vessels = (function () {
  var V = { list: [], nextId: 1 };
  var MAX_TILT = Math.PI * 0.75;
  var CAPTURE_MAX_TILT = 0.9;     // past about 50 degrees the mouth faces sideways and catches nothing
  var CAPTURE_PER_TICK = 60;      // cells a vessel can swallow in one tick, so dipping looks gradual
  var POWDER_REPOSE = 0.6;        // powders hold a slope of about 35 degrees before they start to slide out

  // ---- Geometry ----
  // Vessel frame: a runs along the pour direction, b along the axis (mouth up), c sideways. The pivot is the centre of the vessel.
  function frame(v) {
    var cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), ct = Math.cos(v.tilt), st = Math.sin(v.tilt);
    return {
      a: [cy * ct, -st, sy * ct],          // pour direction, tipped down with the vessel
      b: [cy * st, ct, sy * st],           // the axis, tipped toward the pour direction
      c: [-sy, 0, cy],                     // sideways, unchanged by tilt
      d: [cy, 0, sy]                       // pour direction on the horizontal
    };
  }
  V.frame = frame;
  // World position of a point given in vessel coordinates (a, height above the base, c).
  function toWorld(v, f, pa, ph, pc) {
    var h = ph - v.height / 2;
    return [v.x + f.a[0] * pa + f.b[0] * h + f.c[0] * pc, v.y + f.a[1] * pa + f.b[1] * h + f.c[1] * pc, v.z + f.a[2] * pa + f.b[2] * h + f.c[2] * pc];
  }
  V.toWorld = toWorld;
  function toLocal(v, f, x, y, z) {
    var dx = x - v.x, dy = y - v.y, dz = z - v.z;
    return [dx * f.a[0] + dy * f.a[1] + dz * f.a[2], dx * f.b[0] + dy * f.b[1] + dz * f.b[2] + v.height / 2, dx * f.c[0] + dy * f.c[1] + dz * f.c[2]];
  }
  V.toLocal = toLocal;
  V.capacity = function (v) { return Math.round(Math.PI * v.radius * v.radius * v.height); };
  V.amount = function (v) { var s = 0; for (var k = 0; k < v.contents.length; k++) s += v.contents[k].n; return s; };

  // Share of a full vessel that stays in at a given tilt. While the free surface still crosses the base it is a straight line
  // in the side view, so the mean depth is height - r tan(tilt). Once it reaches the base a wedge is left, about h / (4 r tan) of the volume.
  // Both pieces meet at a half-full vessel, and nothing stays in past horizontal.
  V.retained = function (v, tilt) {
    if (tilt <= 0) return 1;
    if (tilt >= Math.PI / 2) return 0;
    var t = v.radius * Math.tan(tilt) / v.height;
    return t <= 0.5 ? 1 - t : 1 / (4 * t);
  };
  // Tilt at which the contents first reach the lip.
  V.spillAngle = function (v) {
    var f = V.amount(v) / V.capacity(v);
    if (f <= 0) return Math.PI / 2;
    return f >= 0.5 ? Math.atan((1 - f) * v.height / v.radius) : Math.atan(v.height / (4 * f * v.radius));
  };
  // The free surface in vessel coordinates: height above the base at distance a along the pour direction.
  V.surface = function (v, a) {
    var cap = V.capacity(v), f = cap ? V.amount(v) / cap : 0, t = Math.tan(Math.min(v.tilt, 1.5));
    var mean = f * v.height;
    // Keep the slope's mean on the stored amount but never above the lip, since anything above it has already poured.
    var hLip = v.height - v.radius * t;
    if (t > 0 && mean > hLip) mean = hLip;
    return mean + a * t;
  };
  // The lip is the lowest point of the rim, on the pour side.
  V.lip = function (v) { return toWorld(v, frame(v), v.radius, v.height, 0); };

  // ---- Creating and filling ----
  V.create = function (opts) {
    opts = opts || {};
    var v = {
      id: V.nextId++, x: opts.x || 0, y: opts.y || 0, z: opts.z || 0,
      radius: opts.radius || 4, height: opts.height || 12,
      tilt: 0, yaw: opts.yaw || 0, contents: [], held: false, poured: 0, captured: 0, blocked: false, name: opts.name || "Beaker", shell: null
    };
    V.list.push(v);
    return v;
  };
  V.remove = function (v, Sim) { if (v.shell && Sim) V.pickUp(v, Sim); var k = V.list.indexOf(v); if (k >= 0) V.list.splice(k, 1); };
  V.clear = function () { V.list.length = 0; };
  V.byId = function (id) { for (var k = 0; k < V.list.length; k++) if (V.list[k].id === id) return V.list[k]; return null; };
  // Base centre at a point, as when the vessel is set down on a surface.
  V.setBase = function (v, x, y, z) {
    var f = frame(v);
    v.x = x + f.b[0] * v.height / 2; v.y = y + f.b[1] * v.height / 2; v.z = z + f.b[2] * v.height / 2;
  };
  V.base = function (v) { return toWorld(v, frame(v), 0, 0, 0); };
  V.setTilt = function (v, t) { v.tilt = Math.max(0, Math.min(MAX_TILT, t)); };

  // An inventory entry is a kind of cell and how many of it there are: { mat, form, aux, aux2, n, T, used, u2 }.
  // In water, aux is the dissolved substance and used how far it is from saturation (the solution's strength is (1 - used) of a full cell),
  // and aux2 and u2 a second solute such as an indicator. Strengths are averaged over the cells of an entry, which keeps the amount of
  // solute, so a dilute solution poured from one container into another stays dilute.
  function entryOf(list, mat, form, aux, aux2) {
    for (var k = 0; k < list.length; k++) { var e = list[k]; if (e.mat === mat && e.form === form && e.aux === aux && (e.aux2 || 0) === aux2) return e; }
    var e2 = { mat: mat, form: form, aux: aux, aux2: aux2, n: 0, T: 293.15, used: 0, u2: 0 };
    list.push(e2);
    return e2;
  }
  function entryFor(v, mat, form, aux, aux2) { return entryOf(v.contents, mat, form, aux, aux2 || 0); }
  // Add k cells at temperature t and strengths used, u2 to an entry.
  function addTo(e, k, t, used, u2) {
    var n = e.n + k;
    e.T = (e.T * e.n + t * k) / n; e.used = ((e.used || 0) * e.n + (used || 0) * k) / n; e.u2 = ((e.u2 || 0) * e.n + (u2 || 0) * k) / n; e.n = n;
  }
  V.addTo = addTo;
  // Take grid cell i into a list of entries, with what is dissolved in it. form overrides the cell's phase (picked-up solids come back as grains).
  // A second solute is only kept for water: in other cells AUX2 means something else, such as an element's isotope.
  V.takeCell = function (list, Sim, i, form) {
    var id = Sim.ID[i], aux = Sim.AUX[i] || 0, water = id === Mat.byFormula.H2O, aux2 = water ? Sim.AUX2[i] || 0 : 0;
    var e = entryOf(list, id, form == null ? Sim.PH[i] : form, aux, aux2);
    addTo(e, 1, Sim.T[i], aux ? Sim.USED[i] : 0, aux2 ? Sim.U2[i] : 0);
    return e;
  };
  // After a cell of entry e has been placed at i, give it back what was dissolved in it.
  V.putExtras = function (Sim, i, e) {
    if (e.aux) { Sim.dissolve(i, e.aux); Sim.USED[i] = e.used || 0; }
    if (e.aux2) { Sim.AUX2[i] = e.aux2; Sim.U2[i] = e.u2 || 0; }
  };
  // Add cells straight from the material browser or a reagent bottle. sol, if given, is { aux, used, aux2, u2 } for a solution. Returns how many fit.
  V.fill = function (v, mat, form, n, T, sol) {
    var room = V.capacity(v) - V.amount(v), add = Math.max(0, Math.min(n, room));
    if (!add) return 0;
    sol = sol || {};
    var e = entryFor(v, mat, form, sol.aux || 0, sol.aux2 || 0);
    addTo(e, add, T == null ? 293.15 : T, sol.used, sol.u2);
    return add;
  };
  V.empty = function (v) { v.contents.length = 0; };

  // ---- Exchange with the grid ----
  // Loose cells inside the vessel are in the vessel. This is how pouring from one vessel into another, dipping into a pool
  // and dropping material from above all work, through one rule.
  function capture(v, Sim, f) {
    if (v.tilt > CAPTURE_MAX_TILT) return 0;
    var room = V.capacity(v) - V.amount(v);
    if (room <= 0) return 0;
    var R = Math.ceil(v.radius + v.height), r2 = v.radius * v.radius, W = Sim.W, H = Sim.H, D = Sim.D, ID = Sim.ID, PH = Sim.PH;
    var x0 = Math.max(1, Math.floor(v.x - R)), x1 = Math.min(W - 2, Math.ceil(v.x + R));
    var y0 = Math.max(1, Math.floor(v.y - R)), y1 = Math.min(H - 2, Math.ceil(v.y + R));
    var z0 = Math.max(1, Math.floor(v.z - R)), z1 = Math.min(D - 2, Math.ceil(v.z + R));
    var took = 0, limit = Math.min(room, CAPTURE_PER_TICK);
    // Bottom up, so a dipped vessel fills from the floor of the pool the way water would flow in.
    for (var y = y0; y <= y1 && took < limit; y++) for (var z = z0; z <= z1 && took < limit; z++) for (var x = x0; x <= x1 && took < limit; x++) {
      var i = Sim.idx(x, y, z), ph = PH[i];
      if (ph !== P_LIQUID && ph !== P_POWDER) continue;
      var id = ID[i];
      if (id === AIR || id === WALL || id === ELECTRODE || id === FLAME) continue;
      var p = toLocal(v, f, x + 0.5, y + 0.5, z + 0.5);
      if (p[1] < 0 || p[1] > v.height || p[0] * p[0] + p[2] * p[2] > r2) continue;
      V.takeCell(v.contents, Sim, i);
      Sim.erase(x, y, z);
      took++;
    }
    v.captured += took;
    return took;
  }

  // Choose what leaves next, in proportion to what is inside. Powders stay put until the tilt passes their slope.
  function pickEntry(v, Sim, spillTilt) {
    var total = 0, k;
    for (k = 0; k < v.contents.length; k++) if (canPour(v.contents[k], v, spillTilt)) total += v.contents[k].n;
    if (total <= 0) return null;
    var r = Sim.rf() * total;
    for (k = 0; k < v.contents.length; k++) { var e = v.contents[k]; if (!canPour(e, v, spillTilt)) continue; r -= e.n; if (r < 0) return e; }
    return null;
  }
  // The repose margin is capped so that a vessel tipped near horizontal always empties, however little is left.
  function canPour(e, v, spillTilt) { return e.n > 0 && (e.form !== P_POWDER || v.tilt > Math.min(spillTilt + POWDER_REPOSE, Math.PI / 2 - 0.1)); }

  function pour(v, Sim, f) {
    var cap = V.capacity(v), have = V.amount(v);
    var spill = have - cap * V.retained(v, v.tilt);
    v.blocked = false;
    if (spill <= 0) return 0;
    var spillTilt = V.spillAngle(v);
    // A wider mouth and a steeper tilt pour faster. The stream is capped so a tipped vessel empties over seconds, not one tick.
    var past = Math.min(1, (v.tilt - spillTilt) / 0.5 + 0.15);
    var rate = Math.max(1, Math.round(v.radius * v.radius * 0.5 * past));
    var n = Math.min(Math.ceil(spill), rate), out = 0, W = Sim.W, H = Sim.H, D = Sim.D, ID = Sim.ID;
    // The stream leaves just past the lip and a little below it, so the vessel does not take it straight back.
    var lip = toWorld(v, f, v.radius + 1.2, v.height - 0.6, 0);
    for (var k = 0; k < n * 3 && out < n; k++) {
      var e = pickEntry(v, Sim, spillTilt);
      if (!e) break;
      var sx = (Sim.rf() - 0.5) * 2, sz = (Sim.rf() - 0.5) * 2;
      var X = Math.floor(lip[0] + f.c[0] * sx + f.d[0] * Sim.rf()), Y = Math.floor(lip[1] - Sim.rf()), Z = Math.floor(lip[2] + f.c[2] * sz + f.d[2] * Sim.rf());
      if (X < 1 || Y < 1 || Z < 1 || X >= W - 1 || Y >= H - 1 || Z >= D - 1) continue;
      var i = Sim.idx(X, Y, Z);
      if (ID[i] !== AIR) continue;
      var p = toLocal(v, f, X + 0.5, Y + 0.5, Z + 0.5);
      if (p[1] >= 0 && p[1] <= v.height && p[0] * p[0] + p[2] * p[2] <= v.radius * v.radius) continue;   // still inside the vessel
      Sim.place(X, Y, Z, e.mat, e.form, e.T);
      if (ID[i] !== e.mat) continue;
      V.putExtras(Sim, i, e);
      e.n--; out++;
    }
    for (var q = v.contents.length - 1; q >= 0; q--) if (v.contents[q].n <= 0) v.contents.splice(q, 1);
    if (out === 0) v.blocked = true;   // the lip is outside the chamber or buried; the rest waits in the vessel
    v.poured += out;
    return out;
  }

  // One tick of exchange for a loose vessel. A set-down vessel is part of the grid already, so it has nothing to exchange.
  V.exchange = function (v, Sim) {
    if (v.shell || v.stopper) return;   // a stoppered vessel neither pours nor catches anything
    var f = frame(v);
    pour(v, Sim, f);
    capture(v, Sim, f);
  };
  // One simulation tick of exchange for every vessel. Call it only between ticks, when no worker is writing the grid.
  V.step = function (Sim) { for (var k = 0; k < V.list.length; k++) V.exchange(V.list[k], Sim); };

  // ---- Setting down ----
  // A vessel at rest becomes real: a glass shell is written into the grid and its contents are poured in, so they react, conduct heat,
  // boil and are drawn by the raymarcher like anything else. Picking it up reverses this. The shell is WALL, which the renderer draws as glass.
  // The ring is about one and a half cells thick, so it has no corner gaps for liquid to slip through.
  function shellLayout(v, Sim) {
    var b = V.base(v), cx = Math.floor(b[0]), cz = Math.floor(b[2]), by = Math.round(b[1]);
    var r = v.radius, h = Math.round(v.height), R = Math.ceil(r + 1.5), ro2 = (r + 1.5) * (r + 1.5), r2 = r * r;
    if (cx - R < 1 || cz - R < 1 || cx + R > Sim.W - 2 || cz + R > Sim.D - 2 || by < 1 || by + h > Sim.H - 2) return null;
    var wall = [], inside = [];
    for (var y = by; y <= by + h; y++) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var d2 = dx * dx + dz * dz;
      if (d2 > ro2) continue;
      var i = Sim.idx(cx + dx, y, cz + dz);
      if (y === by || d2 > r2) wall.push(i); else inside.push(i);
    }
    return { cx: cx, by: by, cz: cz, h: h, wall: wall, inside: inside };
  }
  function moveGasUp(Sim, i) {
    var WD = Sim.W * Sim.D, y = (i / WD) | 0, rest = i - y * WD, z = (rest / Sim.W) | 0, x = rest - z * Sim.W;
    for (var yy = y + 1; yy < Sim.H - 1; yy++) {
      var j = Sim.idx(x, yy, z);
      if (Sim.ID[j] === AIR) { Sim.place(x, yy, z, Sim.ID[i], P_GAS, Sim.T[i]); Sim.erase(x, y, z); return true; }
    }
    return false;
  }
  // Returns true when the vessel is now part of the grid. It stays loose when its spot is crowded or it would leave the chamber.
  V.setDown = function (v, Sim) {
    if (v.shell || v.tilt > 0.01) return false;
    if (Sim.busy) Sim.idle();
    var L = shellLayout(v, Sim);
    if (!L) return false;
    var ID = Sim.ID, PH = Sim.PH, k, i, need = 0;
    // Loose material where the glass would go is scooped in, as a beaker pressed into a puddle takes some of it.
    for (k = 0; k < L.wall.length; k++) { i = L.wall[k]; if (ID[i] !== AIR && ID[i] !== WALL && (PH[i] === P_LIQUID || PH[i] === P_POWDER)) need++; }
    if (need > V.capacity(v) - V.amount(v)) return false;
    for (k = 0; k < L.wall.length; k++) {
      i = L.wall[k];
      var id = ID[i];
      if (id === AIR || id === WALL || id === ELECTRODE) continue;
      if (PH[i] === P_LIQUID || PH[i] === P_POWDER) { V.takeCell(v.contents, Sim, i); eraseI(Sim, i); }
      else if (PH[i] >= P_GAS && id !== FLAME) moveGasUp(Sim, i);
    }
    var placed = [];
    for (k = 0; k < L.wall.length; k++) {
      i = L.wall[k];
      if (ID[i] !== AIR && !(PH[i] >= P_GAS && ID[i] !== WALL)) continue;   // solids already there seal that spot themselves
      if (ID[i] !== AIR) eraseI(Sim, i);                                       // a flame or a gas that found no room above
      placeI(Sim, i, WALL, P_STATIC, Sim.ambient);
      placed.push(i);
    }
    v.shell = { cx: L.cx, by: L.by, cz: L.cz, h: L.h, wall: placed, inside: L.inside, cap: null };
    // Line the vessel up with the cells it now occupies.
    V.setBase(v, L.cx + 0.5, L.by, L.cz + 0.5);
    V.settleContents(v, Sim);
    if (v.stopper) V.seal(v, Sim);
    return true;
  };
  // ---- Stopper ----
  // A stopper on a set-down vessel is a disc of WALL one layer above the rim, covering the glass as well, so gas inside has no way out.
  // Gas in the way moves up out of it first. A stopper that cannot fit, because a solid is in the way, still covers what it can.
  V.seal = function (v, Sim) {
    var s = v.shell;
    if (!s || s.cap) return;
    if (Sim.busy) Sim.idle();
    var y = s.by + s.h + 1, R = Math.ceil(v.radius + 1.5), ro2 = (v.radius + 1.5) * (v.radius + 1.5), cap = [];
    if (y >= Sim.H - 1) { s.cap = cap; return; }
    for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > ro2) continue;
      var i = Sim.idx(s.cx + dx, y, s.cz + dz), id = Sim.ID[i];
      if (id !== AIR && Sim.PH[i] >= P_GAS && id !== WALL && !moveGasUp(Sim, i)) eraseI(Sim, i);
      if (Sim.ID[i] !== AIR) continue;
      placeI(Sim, i, WALL, P_STATIC, Sim.ambient);
      cap.push(i);
    }
    s.cap = cap;
  };
  V.unseal = function (v, Sim) {
    var s = v.shell;
    if (!s || !s.cap) return;
    if (Sim.busy) Sim.idle();
    for (var k = 0; k < s.cap.length; k++) if (Sim.ID[s.cap[k]] === WALL) eraseI(Sim, s.cap[k]);
    s.cap = null;
  };
  V.setStopper = function (v, on, Sim) {
    v.stopper = !!on;
    if (!v.shell || !Sim) return;
    if (on) V.seal(v, Sim); else V.unseal(v, Sim);
  };
  // How full of gas the headspace of a sealed vessel is: the share of its open cells taken by gas other than air. An air cell holds
  // vapour as a share of a full cell (AUX says which substance, USED how much), so steam from a hot liquid counts as well as gas cells.
  // 1 means no air is left.
  V.gasShare = function (v, Sim) {
    if (!v.shell) return 0;
    var gas = 0, open = 0, ID = Sim.ID, PH = Sim.PH, AUXa = Sim.AUX, USED = Sim.USED;
    for (var k = 0; k < v.shell.inside.length; k++) {
      var i = v.shell.inside[k], id = ID[i];
      if (id === AIR) { open++; if (AUXa[i]) gas += Math.min(1, USED[i]); }
      else if (PH[i] >= P_GAS && id !== FLAME) { open++; gas++; }
    }
    return open ? gas / open : 1;
  };
  // Pour whatever is held in the inventory into a set-down vessel, filling it from the bottom.
  V.settleContents = function (v, Sim) {
    if (!v.shell || !V.amount(v)) return;
    var inside = v.shell.inside, WD = Sim.W * Sim.D, layer = -1, row = [];
    function flush() {
      for (var q = row.length - 1; q > 0; q--) { var j = Math.floor(Sim.rf() * (q + 1)), t = row[q]; row[q] = row[j]; row[j] = t; }
      for (var k = 0; k < row.length && V.amount(v); k++) {
        var i = row[k];
        if (Sim.ID[i] !== AIR) continue;
        var e = pickAny(v, Sim);
        placeI(Sim, i, e.mat, e.form, e.T);
        if (Sim.ID[i] !== e.mat) continue;
        V.putExtras(Sim, i, e);
        e.n--;
        if (e.n <= 0) v.contents.splice(v.contents.indexOf(e), 1);
      }
      row = [];
    }
    for (var k = 0; k < inside.length; k++) { var y = (inside[k] / WD) | 0; if (y !== layer) { flush(); layer = y; } row.push(inside[k]); }
    flush();
  };
  function pickAny(v, Sim) {
    var r = Sim.rf() * V.amount(v);
    for (var k = 0; k < v.contents.length; k++) { r -= v.contents[k].n; if (r < 0) return v.contents[k]; }
    return v.contents[v.contents.length - 1];
  }
  // Pick a set-down vessel back up: everything that is not a gas goes back into the inventory and the glass is removed.
  // Gas above the contents is left to drift away, as it would from an open beaker. Solids come back as grains.
  V.pickUp = function (v, Sim) {
    if (!v.shell) return;
    if (Sim.busy) Sim.idle();
    var ID = Sim.ID, PH = Sim.PH, k, i;
    for (k = 0; k < v.shell.inside.length; k++) {
      i = v.shell.inside[k];
      var id = ID[i], ph = PH[i];
      if (id === AIR || id === WALL || id === ELECTRODE || id === FLAME || ph >= P_GAS) continue;
      V.takeCell(v.contents, Sim, i, ph === P_LIQUID ? P_LIQUID : P_POWDER);
      eraseI(Sim, i);
    }
    for (k = 0; k < v.shell.wall.length; k++) { i = v.shell.wall[k]; if (ID[i] === WALL) eraseI(Sim, i); }
    V.unseal(v, Sim);   // the stopper stays in the vessel, and goes back on when it is set down again
    v.shell = null;
  };
  // What a vessel holds right now, whether loose or set down: [{mat, form, aux, n, T}].
  V.contentsNow = function (v, Sim) {
    if (!v.shell) return v.contents;
    var map = {}, out = [], k;
    for (k = 0; k < v.contents.length; k++) { var c = v.contents[k]; map[c.mat + ":" + c.form + ":" + c.aux] = out[out.push({ mat: c.mat, form: c.form, aux: c.aux, n: c.n, T: c.T }) - 1]; }
    for (k = 0; k < v.shell.inside.length; k++) {
      var i = v.shell.inside[k], id = Sim.ID[i];
      if (id === AIR || id === WALL) continue;
      var key = id + ":" + Sim.PH[i] + ":" + (Sim.AUX[i] || 0), e = map[key];
      if (!e) { e = map[key] = { mat: id, form: Sim.PH[i], aux: Sim.AUX[i] || 0, n: 0, T: 0 }; out.push(e); }
      e.T = (e.T * e.n + Sim.T[i]) / (e.n + 1); e.n++;
    }
    return out;
  };
  V.amountNow = function (v, Sim) {
    var c = V.contentsNow(v, Sim), n = 0;
    for (var k = 0; k < c.length; k++) if (c[k].form !== P_GAS && c[k].form !== P_PLASMA) n += c[k].n;
    return n;
  };
  function coords(Sim, i) { var WD = Sim.W * Sim.D, y = (i / WD) | 0, r = i - y * WD, z = (r / Sim.W) | 0; return [r - z * Sim.W, y, z]; }
  function placeI(Sim, i, id, form, T) { var c = coords(Sim, i); Sim.place(c[0], c[1], c[2], id, form, T); }
  function eraseI(Sim, i) { var c = coords(Sim, i); Sim.erase(c[0], c[1], c[2]); }

  // Count cells of a material in the grid. Used by the tests to check that nothing is created or lost.
  V.countInGrid = function (Sim, mat) {
    var n = 0, ID = Sim.ID;
    for (var i = 0; i < ID.length; i++) if (ID[i] === mat) n++;
    return n;
  };
  V.countInVessels = function (mat) {
    var n = 0;
    for (var k = 0; k < V.list.length; k++) { var c = V.list[k].contents; for (var q = 0; q < c.length; q++) if (c[q].mat === mat) n += c[q].n; }
    return n;
  };
  return V;
})();
if (typeof module !== "undefined") module.exports = Vessels;
