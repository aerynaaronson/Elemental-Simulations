// Ready-made experiments. Each one sets up the chamber and explains what to look for.
var Scenes = (function () {
  var W, H, D;
  function dims() { W = Sim.W; H = Sim.H; D = Sim.D; }
  var f = function (name) { return Mat.named(name); };

  // Scale helpers so a scene fits any grid size.
  function X(v) { return Math.round(1 + v * (W - 3)); }
  function Z(v) { return Math.round(1 + v * (D - 3)); }
  function Y(v) { return Math.round(1 + v * (H - 3)); }
  function box(x0, y0, z0, x1, y1, z1, id, form, t) { Sim.box(X(x0), Y(y0), Z(z0), X(x1), Y(y1), Z(z1), id, form, t); }

  function tank(x0, z0, x1, z1, y1) {   // open-topped containment basin
    var a = X(x0), b = Z(z0), c = X(x1), d = Z(z1), top = Y(y1);
    Sim.box(a, 1, b, c, top, b, WALL, P_STATIC); Sim.box(a, 1, d, c, top, d, WALL, P_STATIC);
    Sim.box(a, 1, b, a, top, d, WALL, P_STATIC); Sim.box(c, 1, b, c, top, d, WALL, P_STATIC);
  }

  // ---- Lab equipment in experiments ----
  // Sizes are given in cells of the 64-cell chamber and grow with the chamber, so an experiment looks the same at any size.
  function cells(n) { return Math.max(1, Math.round(n * Math.min(W, D) / 64)); }
  // A number of drops, which grows with the volume of what they go into. A dropper holds 1000 at most.
  function drops(n) { var k = Math.min(W, D) / 64; return Math.min(1000, Math.max(1, Math.round(n * k * k * k))); }
  function hasLab() { return typeof Lab !== "undefined" && typeof Vessels !== "undefined"; }

  // A container from the lab standing at (fx, fz) with its floor at y. Its glass goes into the grid at once, so the experiment can fill it
  // cell by cell, and the player can then pick it up, pour it and heat it like any other. Headless tests that do not load the lab get a glass
  // shell of the same shape. Returns { cx, cz, by, h, r, inside, v }: inside lists its open cells, and v is the lab object, if there is one.
  function vessel(type, fx, fz, radius, height, opts) {
    opts = opts || {};
    var x = X(fx), z = Z(fz), y = opts.y || 1, r = opts.exact ? radius : cells(radius), h = opts.exact ? height : cells(height);
    if (hasLab()) {
      var v = Lab.spawnBeaker(x + 0.5, y, z + 0.5, { type: type, radius: r, height: h, name: opts.name });
      v.stopper = !!opts.stopper; v.sealed = !!opts.sealed;
      Lab.setDownNow(v);
      if (v.shell) return { cx: v.shell.cx, cz: v.shell.cz, by: v.shell.by, h: v.shell.h, r: r, inside: v.shell.inside, v: v };
      Lab.remove(v);
    }
    var R = Math.ceil(r + 1.5), ro2 = (r + 1.5) * (r + 1.5), inside = [];
    for (var yy = y; yy <= y + h + (opts.stopper ? 1 : 0); yy++) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var d2 = dx * dx + dz * dz;
      if (d2 > ro2) continue;
      if (yy === y || yy > y + h || d2 > r * r) Sim.place(x + dx, yy, z + dz, WALL, P_STATIC, undefined, true);
      else inside.push(Sim.idx(x + dx, yy, z + dz));
    }
    return { cx: x, cz: z, by: y, h: h, r: r, inside: inside, v: null };
  }
  // Calls fn(x, y, z, i) for each open cell of a vessel in rows from to to, where row 1 is the first above its floor.
  function rows(c, from, to, fn) {
    var WD = W * D;
    c.inside.forEach(function (i) {
      var y = (i / WD) | 0, row = y - c.by;
      if (row < from || row > to) return;
      var rest = i - y * WD, z = (rest / W) | 0;
      fn(rest - z * W, y, z, i);
    });
  }
  // Fill rows of a vessel with one substance, or with water holding a solute at a molarity.
  function pour(c, from, to, id, solute, molar, t) {
    rows(c, from, to, function (x, y, z, i) { Sim.place(x, y, z, id, P_POWDER, t, true); if (solute) dissolve(i, solute, molar); });
  }
  // A molarity is stored as the share of a full cell of solute. No more than water can hold, or the surface crusts over as it dries.
  function dissolve(i, solute, molar) { Sim.AUX[i] = solute; Sim.USED[i] = 1 - Math.min(Mat.saturation(solute), molar / (Mat.n0[solute] * 1000)); }
  // A small block of something held above a vessel, which falls in when the experiment starts. dx, dz are from its centre.
  function dropInto(c, dx, dz, half, high, id, t, above) {
    var y0 = c.by + c.h + (above == null ? cells(3) : above), x = c.cx + dx, z = c.cz + dz;
    Sim.box(x - half, y0, z - half, x + half, y0 + high - 1, z + half, id, P_POWDER, t);
  }
  // A hot plate (or a stirrer) at (fx, fz). Returns the row things stand on. Without the lab, a steel slab at the same temperature stands in.
  function plate(fx, fz, half, setT, opts) {
    opts = opts || {};
    var x = X(fx), z = Z(fz), hw = cells(half);
    if (hasLab()) {
      var o = { half: hw, setT: setT, name: opts.name };
      var p = opts.stir != null ? Lab.spawnStirrer(x + 0.5, 1, z + 0.5, Object.assign(o, { stir: opts.stir })) : Lab.spawnPlate(x + 0.5, 1, z + 0.5, o);
      Lab.placePlateNow(p);
      if (p.stamp) return p.stamp.top;
    }
    Sim.box(x - hw, 1, z - hw, x + hw, 2, z + hw, 26, P_STATIC, setT == null ? undefined : setT);
    return 3;
  }
  // A dropper held in a clamp over a vessel, full of a solution, letting it in a drop a tick from the start. Without the lab the same
  // solution is a small block above the surface instead.
  function dropper(c, surface, solute, molar, n, name) {
    var water = Mat.named("H2O");
    if (hasLab()) {
      var d = Lab.spawnTool("dropper", c.cx + 0.5, surface + 3, c.cz + 0.5, { clamp: true, cap: n, name: name });
      d.contents.push({ mat: water, form: P_LIQUID, aux: solute, aux2: 0, n: n, T: Sim.ambient, used: 1 - Math.min(Mat.saturation(solute), molar / (Mat.n0[solute] * 1000)), u2: 0 });
      Lab.squeeze(d);
      return;
    }
    var hw = Math.max(1, Math.round(Math.cbrt(n) / 2)), y0 = surface + 2;
    for (var y = y0; y < y0 + 2; y++) for (var z = c.cz - hw; z <= c.cz + hw; z++) for (var x = c.cx - hw; x <= c.cx + hw; x++) {
      Sim.place(x, y, z, water, P_POWDER, undefined, true);
      dissolve(Sim.idx(x, y, z), solute, molar);
    }
  }
  // A Geiger counter held in a clamp with its window a few cells over a vessel, near the rim so its stand is outside.
  function geiger(c, surface) {
    if (hasLab()) Lab.spawnTool("geiger", c.cx + c.r - 0.5, surface + 3, c.cz + 0.5);
  }
  // A power supply over a vessel, switched on, whose rods come to rest on its floor. Without the lab, two electrode rods stand there instead.
  function supply(c, volts, name) {
    if (hasLab()) { Lab.spawnSupply(c.cx + 0.5, c.by + c.h + 4, c.cz + 0.5, { on: true, volts: volts, name: name }); return; }
    [-2, 2].forEach(function (g) { Sim.box(c.cx + g, c.by + 1, c.cz, c.cx + g, c.by + c.h - 1, c.cz, ELECTRODE, P_STATIC); });
  }

  var list = [
    {
      id: "alkali", name: "Alkali metals in water", tag: "Group 1",
      text: "Lithium, sodium and potassium in the front row, rubidium and caesium behind, each dropped into its own beaker of water. Ionisation energy drops down the group, so each one reacts with water faster than the last. Rubidium and caesium are so reactive that they catch fire in the air on the way down, and hot lithium sometimes does too.",
      build: function () {
        [[3, 0.2, 0.32, "lithium"], [11, 0.5, 0.32, "sodium"], [19, 0.8, 0.32, "potassium"], [37, 0.35, 0.7, "rubidium"], [55, 0.65, 0.7, "caesium"]].forEach(function (m) {
          var b = vessel("beaker", m[1], m[2], 4, 12, { name: "Beaker (" + m[3] + ")" });
          pour(b, 1, cells(9), f("H2O"));
          dropInto(b, 0, 0, cells(2), cells(3), m[0], undefined, cells(2));
        });
      }
    },
    {
      id: "thermite", name: "Thermite in a crucible", tag: "Redox",
      text: "Aluminium grains and rust fill a crucible. They sit still until the hot spot on top reaches about 1100 K. The front then spreads by itself, and molten iron sinks through the slag to the bottom.",
      build: function () {
        var c = vessel("crucible", 0.5, 0.5, 7, 9, { name: "Crucible (thermite)" }), fe = f("Fe2O3"), top = cells(7);
        rows(c, 1, top, function (x, y, z) { Sim.place(x, y, z, (x + y + z) & 1 ? 13 : fe, P_POWDER, undefined, true); });
        Sim.forSphere(c.cx, c.by + top, c.cz, 2, function (x, y, z, i) { if (Sim.ID[i] !== AIR && Sim.ID[i] !== WALL) Sim.T[i] = 1600; });
      }
    },
    {
      id: "reactor", name: "Reactor in a water pool", tag: "Fission",
      text: "Nine rods of 80% enriched uranium sit in water, each sleeved in cadmium, which swallows neutrons before they can reach another rod. Withdraw the rods and fission climbs until the pool boils. Watch for iodine and xenon-135 poison in the log.",
      action: {
        label: "Withdraw control rods",
        run: function () {
          var water = f("H2O"), n = Sim.ID.length, y, i;
          for (i = 0; i < n; i++) if (Sim.ID[i] === 48) { Sim.ID[i] = water; Sim.PH[i] = P_LIQUID; Sim.T[i] = Sim.ambient; Sim.AUX2[i] = 0; }
          for (i = 0; i < 40; i++) Sim.spawnP(PT_NEUTRON, X(0.5), Y(0.25), Z(0.5), 1.5, 0, 240);
          Sim.wakeAll();
        }
      },
      build: function () {
        tank(0.15, 0.15, 0.85, 0.85, 0.72);
        box(0.16, 0, 0.16, 0.84, 0.66, 0.84, f("H2O"), P_POWDER);
        Sim.enrichment = 0.8;   // far more U-235 than power reactors use (3-5%), because a voxel-scale core is so small
        for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
          var cx = X(0.3 + a * 0.2), cz = Z(0.3 + b * 0.2), top = Y(0.5), r = 3;
          Sim.box(cx - r - 1, 1, cz - r - 1, cx + r + 1, top + 1, cz + r + 1, 48, P_STATIC);
          Sim.box(cx - r, 1, cz - r, cx + r, top, cz + r, 92, P_STATIC);
        }
        Sim.enrichment = null;
      }
    },
    {
      id: "decay", name: "Decay chains", tag: "Radioactivity",
      text: "Four crucibles hold oganesson, plutonium, radium and polonium, each decaying at its own pace, and a Geiger counter hangs over the polonium. Watch the census: alpha and beta decay walk everything down the chart to stable lead, while the heaviest nuclei split into mid-table fission fragments.",
      build: function () {
        [[118, 0.3, 0.3, "oganesson"], [94, 0.7, 0.3, "plutonium"], [88, 0.3, 0.7, "radium"], [84, 0.7, 0.7, "polonium"]].forEach(function (s) {
          var c = vessel("crucible", s[1], s[2], 6, 6, { name: "Crucible (" + s[3] + ")" });
          pour(c, 1, cells(5), s[0]);
          if (s[0] === 84) geiger(c, c.by + cells(5));
        });
        Sim.setDecayScale(3);
      }
    },
    {
      id: "discharge", name: "Noble gas discharge tubes", tag: "Group 18",
      text: "Five sealed glass tubes hold He, Ne, Ar, Kr and Xe, each with an electrode at its foot. Each gas glows in its own emission colour.",
      build: function () {
        [[2, "helium"], [10, "neon"], [18, "argon"], [36, "krypton"], [54, "xenon"]].forEach(function (g, k) {
          var t = vessel("tube", 0.14 + k * 0.18, 0.5, 2, 24, { stopper: true, sealed: true, name: "Discharge tube (" + g[1] + ")" });
          pour(t, 1, t.h, g[0]);
          Sim.place(t.cx, t.by + 1, t.cz, ELECTRODE, P_STATIC, undefined, true);
        });
      }
    },
    {
      id: "flames", name: "Flame tests", tag: "Emission",
      text: "Eight gas burners, each with a ring of a metal salt or oxide around its nozzle. The flame takes its colour from the metal, as in a real flame test: lithium crimson, sodium yellow, potassium lilac, copper blue-green, barium apple green, strontium red, calcium orange-red and boron green. They burn for as long as the gas is on, and the Lab tool turns each one off.",
      build: function () {
        // Burners grow with the chamber: s is 1 in the 64-cell chamber and 2 in the 128-cell one.
        var s = Math.max(1, Math.round(Math.min(W, D) / 64)), r = s - 1, rim = r + s + 1, deep = 2 * s, core = 5 * s, h = 3 + s;
        ["LiCl", "NaCl", "KCl", "CuO", "BaCl2", "SrCl2", "CaCl2", "B2O3"].forEach(function (salt, k) {
          var cx = X(0.14 + (k % 4) * 0.24), cz = Z(0.3 + (k >> 2) * 0.4), top = 1 + h;
          // A burner is lab equipment. Headless tests that do not load the lab still get the stand and the sample, only without the flame.
          if (hasLab()) top = Lab.placePlateNow(Lab.spawnBurner(cx + 0.5, 1, cz + 0.5, { name: "Burner (" + salt + ")", nozzle: r, core: core, half: rim, h: h })).stamp.top;
          else Sim.box(cx - rim, 1, cz - rim, cx + rim, top - 1, cz + rim, WALL, P_STATIC);
          // The sample is a cake of salt around the nozzle, in a dish whose rim keeps it there once the flame melts it.
          for (var dy = 0; dy < deep; dy++) for (var dz = -rim; dz <= rim; dz++) for (var dx = -rim; dx <= rim; dx++) {
            var ring = Math.max(Math.abs(dx), Math.abs(dz));
            if (ring === rim) Sim.place(cx + dx, top + dy, cz + dz, WALL, P_STATIC, undefined, true);
            else if (ring > r) Sim.place(cx + dx, top + dy, cz + dz, f(salt), P_STATIC, undefined, true);
          }
        });
      }
    },
    {
      id: "density", name: "Density column", tag: "Buoyancy",
      text: "Mercury, carbon tetrachloride, water and octane stack by real density in a tall beaker. Four things drop in. Iron and aluminium sink through the top three and float on the mercury. Gold is heavier still, so it sinks into the mercury and dissolves as an amalgam. Ice stops where the water meets the octane, and slowly melts.",
      build: function () {
        var c = vessel("flask", 0.5, 0.5, 8, 28, { name: "Large beaker (density column)" }), L = cells(5), q = cells(3), hw = cells(2), hi = cells(3);
        pour(c, 1, L, 80); pour(c, L + 1, 2 * L, f("CCl4")); pour(c, 2 * L + 1, 3 * L, f("H2O")); pour(c, 3 * L + 1, 4 * L, f("C8H18"));
        dropInto(c, -q, -q, hw, hi, 26); dropInto(c, q, -q, hw, hi, 79); dropInto(c, -q, q, hw, hi, 13); dropInto(c, q, q, hw, hi, f("H2O"), 240);
      }
    },
    {
      id: "acid", name: "Acids and the activity series", tag: "Electrochemistry",
      text: "Zinc, iron and copper drop into three beakers of hydrochloric acid: zinc fizzes fastest, copper not at all. In the fourth beaker, aqua regia dissolves gold, which no single acid can touch.",
      build: function () {
        var hcl = f("HCl"), hno3 = f("HNO3"), deep = cells(6);
        [[30, 0.3, 0.3, "zinc"], [26, 0.7, 0.3, "iron"], [29, 0.3, 0.7, "copper"]].forEach(function (m) {
          var b = vessel("beaker", m[1], m[2], 4, 12, { name: "Beaker (" + m[3] + " in hydrochloric acid)" });
          pour(b, 1, deep, hcl);
          dropInto(b, 0, 0, cells(2), cells(2), m[0]);
        });
        // Aqua regia is three parts hydrochloric acid to one of nitric, mixed.
        var g = vessel("beaker", 0.7, 0.7, 4, 12, { name: "Beaker (gold in aqua regia)" });
        rows(g, 1, deep, function (x, y, z) { Sim.place(x, y, z, (x + 2 * y + 3 * z) % 4 ? hcl : hno3, P_POWDER, undefined, true); });
        dropInto(g, 0, 0, cells(2), cells(3), 79);
      }
    },
    {
      id: "golden", name: "Golden rain", tag: "Precipitation",
      text: "In a large beaker, clear lead nitrate solution on one side and potassium iodide on the other meet in the middle and throw down bright yellow lead iodide, exactly as the bench demonstration does.",
      build: function () {
        var c = vessel("flask", 0.5, 0.5, 11, 10, { name: "Large beaker (golden rain)" });
        // Both at real strengths a bench could make: lead nitrate saturated, and twice as many moles of iodide, as the equation takes.
        // A full share would be over eight times what water can hold, and its surface crusts over white as soon as it starts to dry.
        var w = f("H2O"), pb = f("Pb(NO3)2"), ki = f("KI"), pbShare = Mat.saturation(pb), kiShare = Math.min(Mat.saturation(ki), 2 * pbShare * Mat.n0[pb] / Mat.n0[ki]);
        rows(c, 1, cells(7), function (x, y, z, i) {
          Sim.place(x, y, z, w, P_POWDER, undefined, true);
          if (x < c.cx - 1) { Sim.AUX[i] = pb; Sim.USED[i] = 1 - pbShare; }
          else if (x > c.cx + 1) { Sim.AUX[i] = ki; Sim.USED[i] = 1 - kiShare; }
        });
      }
    },
    {
      id: "filament", name: "Lamp filament and electrolysis", tag: "Electricity",
      text: "The same current runs through two wires. Tungsten's higher resistance makes it glow white-hot from Joule heating, while copper stays far cooler. In air the hot tungsten soon burns through, which is why real lamps are filled with argon. At the front, a power supply's rods stand in a beaker of water and split it into hydrogen and oxygen.",
      build: function () {
        var y = Y(0.45), z1 = Z(0.25), z2 = Z(0.37);
        Sim.box(X(0.1), 1, z1, X(0.1), y, z1, 74, P_STATIC); Sim.box(X(0.1), y, z1, X(0.9), y, z1, 74, P_STATIC); Sim.box(X(0.9), 1, z1, X(0.9), y, z1, 74, P_STATIC);
        Sim.place(X(0.1), 1, z1, ELECTRODE, P_STATIC, undefined, true);
        Sim.box(X(0.1), 1, z2, X(0.1), y, z2, 29, P_STATIC); Sim.box(X(0.1), y, z2, X(0.9), y, z2, 29, P_STATIC); Sim.box(X(0.9), 1, z2, X(0.9), y, z2, 29, P_STATIC);
        Sim.place(X(0.1), 1, z2, ELECTRODE, P_STATIC, undefined, true);
        var c = vessel("flask", 0.5, 0.74, 7, 14, { name: "Large beaker (water)" });
        pour(c, 1, cells(10), f("H2O"));
        supply(c, 12, "Power supply (electrolysis)");
      }
    },
    {
      id: "chain", name: "The uranium-238 decay chain", tag: "Isotopes",
      text: "A dish of pure U-238 on a very fast clock, with a Geiger counter over it. It walks the real chain, Th-234, Pa-234, U-234, Th-230, Ra-226, Rn-222 and on down to stable lead-206. Radon, being a gas, drifts away. Follow the log.",
      build: function () {
        Sim.setDecayScale(600);
        var c = vessel("dish", 0.5, 0.5, 11, 4, { name: "Evaporating dish (uranium-238)" });
        Sim.isotopeOverride = { 92: 238 };
        pour(c, 1, cells(3), 92);
        Sim.isotopeOverride = null;
        geiger(c, c.by + cells(3));
      }
    },
    {
      id: "breeder", name: "Breeding plutonium", tag: "Isotopes",
      text: "A hot core of highly enriched uranium sits inside a blanket of U-238, which cannot sustain a chain reaction on its own. Neutrons turn the blanket into U-239, then neptunium, then plutonium-239.",
      build: function () {
        Sim.setDecayScale(200);
        var cx = X(0.5), cy = Y(0.2), cz = Z(0.5), r = Math.floor(Math.min(W, D) * 0.13);
        Sim.isotopeOverride = { 92: 238 };
        Sim.forSphere(cx, cy, cz, r, function (x, y, z) { Sim.place(x, y, z, 92, P_STATIC, undefined, true); });
        Sim.isotopeOverride = { 92: 235 };
        Sim.forSphere(cx, cy, cz, r * 0.5, function (x, y, z) { Sim.place(x, y, z, 92, P_STATIC, undefined, true); });
        Sim.isotopeOverride = null;
        for (var n2 = 0; n2 < 40; n2++) Sim.spawnP(PT_NEUTRON, cx, cy, cz, 1.5, 0, 240);
      }
    },
    {
      id: "daniell", name: "Daniell cell", tag: "Battery",
      text: "Zinc in zinc sulfate, copper in copper sulfate, a salt bridge between them and a copper wire on top. The Nernst equation gives 1.10 V. Zinc dissolves, copper plates out, and the log shows the voltage as the cell runs down.",
      build: function () {
        var w = f("H2O"), zn = f("ZnSO4"), cu = f("CuSO4"), y1 = Y(0.16), z1 = Z(0.3), z2 = Z(0.7), mid = X(0.5);
        tank(0.12, 0.3, 0.42, 0.7, 0.2); tank(0.58, 0.3, 0.88, 0.7, 0.2);
        tank(0.42, 0.45, 0.58, 0.55, 0.1);
        function fill(a, b, zLo, zHi, top, solute) {
          for (var y = 1; y <= top; y++) for (var z = zLo; z <= zHi; z++) for (var x = a; x <= b; x++) {
            Sim.place(x, y, z, w, P_POWDER, undefined, true);
            if (solute) { var i = Sim.idx(x, y, z); Sim.AUX[i] = solute; Sim.USED[i] = 0.97; }
          }
        }
        fill(X(0.12) + 1, X(0.42) - 1, z1 + 1, z2 - 1, y1, zn);
        fill(X(0.58) + 1, X(0.88) - 1, z1 + 1, z2 - 1, y1, cu);
        fill(X(0.42), X(0.58), Z(0.45) + 1, Z(0.55) - 1, Y(0.08), 0);
        var mz = Z(0.5), xa = X(0.27), xb = X(0.73), topY = Y(0.34);
        Sim.box(xa - 2, 1, mz - 3, xa + 2, topY, mz + 3, 30, P_STATIC);
        Sim.box(xb - 2, 1, mz - 3, xb + 2, topY, mz + 3, 29, P_STATIC);
        Sim.box(xa, topY, mz, xb, topY, mz, 29, P_STATIC);
      }
    },
    {
      id: "titration", name: "Acid-base titration", tag: "pH",
      text: "A beaker of dilute hydrochloric acid with phenolphthalein in it, colourless, stands on a magnetic stirrer. A dropper lets in sodium hydroxide drop by drop, and the stirrer carries each drop round. At first the acid uses up each drop. Once the acid is gone, the end point, every drop that falls stays pink. Switch on pH view to see the whole field in colour.",
      build: function () {
        var top = plate(0.5, 0.5, 8, null, { stir: 2, name: "Stirrer" });
        var c = vessel("beaker", 0.5, 0.5, 6, 12, { y: top, name: "Beaker (acid and phenolphthalein)" }), deep = cells(8), hcl = f("HCl"), ind = f("Phenolphthalein");
        // The acid holds 45% as much as the dropper of 1 M base, so the end point comes a little before halfway, at any chamber size.
        // That is about 0.02 M, as dilute as a school titration.
        var n = drops(40), filled = 0;
        rows(c, 1, deep, function () { filled++; });
        rows(c, 1, deep, function (x, y, z, i) {
          Sim.place(x, y, z, f("H2O"), P_POWDER, undefined, true);
          dissolve(i, hcl, 0.45 * n / filled); Sim.AUX2[i] = ind; Sim.U2[i] = 0.9;
        });
        dropper(c, c.by + deep, f("NaOH"), 1, n, "Dropper (sodium hydroxide, 1 M)");
      }
    },
    {
      id: "bridge", name: "Melting supports", tag: "Structure",
      text: "A steel deck rests on lead pillars standing on a hot plate. As the lead softens and melts, the deck loses support and falls in one piece.",
      build: function () {
        var top = plate(0.5, 0.5, 10, 900, { name: "Hot plate" }), cx = X(0.5), cz = Z(0.5), ox = cells(7), oz = cells(5), w = cells(3) - 1, y = top + cells(11);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
          var x0 = cx + q[0] * ox - (q[0] < 0 ? w : 0), z0 = cz + q[1] * oz - (q[1] < 0 ? w : 0);
          Sim.box(x0, top, z0, x0 + w, y, z0 + w, 82, P_STATIC, 560);
        });
        Sim.box(cx - ox - w - 1, y + 1, cz - oz - w - 1, cx + ox + w + 1, y + 2, cz + oz + w + 1, 26, P_STATIC);
      }
    },
    {
      id: "volcano", name: "Dichromate volcano", tag: "Decomposition",
      text: "A heap of ammonium dichromate in an evaporating dish is lit at the peak. It decomposes in a shower of sparks, leaving a fluffy heap of green chromium oxide, with nitrogen and steam carrying it upward.",
      build: function () {
        var R0 = Math.floor(Math.min(W, D) * 0.2), a = f("(NH4)2Cr2O7"), c = vessel("dish", 0.5, 0.5, R0 + 1, cells(3), { exact: true, name: "Evaporating dish (ammonium dichromate)" });
        for (var y = 1; y <= R0; y++) Sim.forSphere(c.cx, c.by + y, c.cz, R0 - y + 1, function (x, yy, z) { if (yy === c.by + y) Sim.place(x, yy, z, a, P_POWDER, undefined, true); });
        // Dichromate conducts heat poorly, so a small warm spot dies out before it can light what is next to it.
        Sim.forSphere(c.cx, c.by + R0, c.cz, Math.max(3, R0 >> 2), function (x, y, z, i) { if (Sim.ID[i] !== AIR && Sim.ID[i] !== WALL) Sim.T[i] = 900; });
      }
    },
    {
      id: "toothpaste", name: "Hydrogen peroxide and catalyst", tag: "Catalysis",
      text: "A large beaker of peroxide is almost stable at room temperature. Manganese dioxide falling through it sets off a rush of oxygen, without being used up.",
      build: function () {
        var c = vessel("flask", 0.5, 0.5, 8, 18, { name: "Large beaker (hydrogen peroxide)" });
        pour(c, 1, cells(10), f("H2O2"));
        dropInto(c, 0, 0, cells(3), cells(2), f("MnO2"));
      }
    },
    {
      id: "snake", name: "Sugar and sulfuric acid", tag: "Dehydration",
      text: "Concentrated sulfuric acid poured over table sugar in a beaker rips the water out of it. A hot, steaming column of black carbon is left behind.",
      build: function () {
        var c = vessel("flask", 0.5, 0.5, 8, 22, { name: "Large beaker (sugar)" }), s = cells(8);
        pour(c, 1, s, f("C12H22O11"));
        pour(c, s + 1, s + cells(3), f("H2SO4"));
      }
    },
    {
      id: "gunpowder", name: "Black powder", tag: "Explosive",
      text: "Saltpetre, sulfur and charcoal in an evaporating dish, mixed as they have been for a thousand years, hold still until they reach 600 K. Then the hot spot runs through the whole charge.",
      build: function () {
        var k = f("KNO3"), c = vessel("dish", 0.5, 0.5, 10, 5, { name: "Evaporating dish (black powder)" }), deep = cells(5);
        rows(c, 1, deep, function (x, y, z) { var r = (x * 7 + y * 13 + z * 5) % 8; Sim.place(x, y, z, r < 5 ? k : (r < 7 ? 6 : 16), P_POWDER, undefined, true); });
        Sim.forSphere(c.cx, c.by + deep, c.cz, 2, function (x, y, z, i) { if (Sim.ID[i] !== AIR && Sim.ID[i] !== WALL) Sim.T[i] = 900; });
      }
    },
    {
      id: "triiodide", name: "Contact explosive", tag: "Explosive",
      text: "Nitrogen triiodide sits on a warm hot plate. It only needs the slightest disturbance, and it goes up in a cloud of violet iodine vapour.",
      build: function () {
        var top = plate(0.5, 0.5, 12, 310, { name: "Hot plate" }), cx = X(0.5), cz = Z(0.5), s = cells(3), n = f("NI3");
        for (var k = 0; k < 6; k++) {
          var a = cx + ((k % 3) - 1) * cells(8) - (s >> 1), c = cz + (k < 3 ? -1 : 1) * cells(5) - (s >> 1);
          Sim.box(a, top, c, a + s, top + cells(2) - 1, c + s, n, P_POWDER, 305);
        }
      }
    },
    {
      id: "colours", name: "Colour tests", tag: "Complexes",
      text: "Four beakers, each with a dropper of reagent over it. Ammonia turns pale copper sulfate royal blue. Thiocyanate turns iron(III) blood red. Chromate falls out of lead solution as chrome yellow, and of silver as brick red.",
      build: function () {
        // Pools at bench strength, molar, and reagents at dropM. A full share of salt in every cell would be 14 to 26 M, far past what water
        // holds, and the pools crusted over white as soon as their surface began to dry. The reagent goes in as a solution, from a dropper,
        // as it does on the bench. Dry grains sat on the bottom and hid the colours, because the products soon fill the water's room for a third solute.
        function test(fx, fz, solute, drop, molar, dropM, name, dropName) {
          var c = vessel("beaker", fx, fz, 6, 9, { name: "Beaker (" + name + ")" }), deep = cells(5);
          pour(c, 1, deep, f("H2O"), f(solute), molar);
          dropper(c, c.by + deep, f(drop), dropM, drops(60), "Dropper (" + dropName + ")");
        }
        // The copper complex takes four ammonia for each copper, so that pool is dilute and its ammonia as strong as water will hold, as on the bench.
        test(0.27, 0.27, "CuSO4", "NH3", 0.1, 15, "copper sulfate", "ammonia");
        test(0.73, 0.27, "FeCl3", "NH4SCN", 0.5, 2, "iron(III) chloride", "ammonium thiocyanate");
        test(0.27, 0.73, "Pb(NO3)2", "K2CrO4", 0.5, 2, "lead nitrate", "potassium chromate");
        test(0.73, 0.73, "AgNO3", "K2CrO4", 0.5, 2, "silver nitrate", "potassium chromate");
      }
    },
    {
      id: "cryo", name: "Cryogenic bench", tag: "Low temperature",
      text: "A large beaker of liquid nitrogen at 77 K boils off around an iron block dropped into it. A beaker of liquid oxygen is pale blue. At the front, gallium melts in a crucible on a hot plate set no warmer than a hand.",
      build: function () {
        var n2 = vessel("flask", 0.27, 0.58, 8, 12, { name: "Large beaker (liquid nitrogen)" }), o2 = vessel("flask", 0.73, 0.58, 8, 12, { name: "Large beaker (liquid oxygen)" }), deep = cells(8);
        pour(n2, 1, deep, 7, 0, 0, 70);
        pour(o2, 1, deep, 8, 0, 0, 80);
        dropInto(n2, 0, 0, cells(2), cells(3), 26);
        var top = plate(0.5, 0.16, 5, 330, { name: "Hot plate" }), ga = vessel("crucible", 0.5, 0.16, 3, 4, { y: top, name: "Crucible (gallium)" });
        pour(ga, 1, cells(3), 31);
      }
    }
  ];

  // Build a small sealed test rig for one database reaction: the reactants touching, at their reaction temperature, with any catalyst
  // and current in place. Used by the reaction browser, and by tools/test_reactions.js to prove each reaction really fires.
  var WATERID = Mat.named("H2O");
  function demoTemperature(d) {
    var T = d.minT ? d.minT + 25 : Sim.ambient;
    if (d.maxT && T > d.maxT) T = (d.minT + d.maxT) / 2;
    if (d.maxT && !d.minT) T = Math.min(Sim.ambient, d.maxT - 5);
    // Alloys need both metals molten. Electrolysis needs the salt molten or dissolved.
    if (d.liq) d.L.forEach(function (t) { T = Math.max(T, Mat.mp[t.id] + 80); });
    if (d.elec && d.minT) d.L.forEach(function (t) { T = Math.max(T, Mat.mp[t.id] + 40); });
    // If Gibbs energy forbids the reaction here, move to the side of its crossover temperature where it can run, while staying in its window.
    if (d.dS && Chem.thermo(d, T, 0) < 0.05) {
      var cross = Math.abs(d.dH * 1000 / d.dS), better = d.dS > 0 ? cross * 1.25 : cross * 0.75;
      if (d.waterN && better > 373) { var dh = d.dH * 1000 + d.waterN * 44000, ds = d.dS + d.waterN * 118.9; if (ds) better = Math.abs(dh / ds) * (ds > 0 ? 1.25 : 0.75); }
      if (better >= d.minT * 0.9 && (!d.maxT || better <= d.maxT) && Chem.thermo(d, better, 0) > Chem.thermo(d, T, 0)) T = better;
    }
    return T;
  }
  // Fill a block with one reactant. Anything that would be a gas or a liquid at this temperature stays where it is put, because the rig is a sealed box.
  function fillBlock(x0, y0, z0, x1, y1, z1, id, T, form) {
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) Sim.place(x, y, z, id, form, T, true);
  }
  function demo(d) {
    dims();
    Sim.clear(); Sim.lid = true; Sim.setDecayScale(1); Sim.star = null;
    var cx = W >> 1, cz = D >> 1, r = Math.min(10, Math.floor(Math.min(W, D) / 3)), h = Math.min(14, H - 6), y0 = 1, T = demoTemperature(d);
    var ax = cx - r, bx = cx + r, az = cz - r, bz = cz + r, top = y0 + h;
    Sim.box(ax - 1, 1, az - 1, bx + 1, top + 1, az - 1, WALL, P_STATIC); Sim.box(ax - 1, 1, bz + 1, bx + 1, top + 1, bz + 1, WALL, P_STATIC);
    Sim.box(ax - 1, 1, az - 1, ax - 1, top + 1, bz + 1, WALL, P_STATIC); Sim.box(bx + 1, 1, az - 1, bx + 1, top + 1, bz + 1, WALL, P_STATIC);
    Sim.box(ax - 1, top + 1, az - 1, bx + 1, top + 1, bz + 1, WALL, P_STATIC);
    var ids = d.L.map(function (t) { return t.id; }), n = ids.length, mid = y0 + (h >> 1);
    // Interleave the reactants through the rig in a fine pattern so every kind touches every other.
    for (var y = y0; y <= top; y++) for (var z = az; z <= bz; z++) for (var x = ax; x <= bx; x++) {
      if (y > y0 + h - 2 && (x + z) % 3) continue;
      var id = ids[(x + y * 2 + z * 3) % n];
      Sim.place(x, y, z, id, P_STATIC, T, true);
    }
    // Catalysts go in as scattered grains.
    if (d.cat) for (var k = 0; k < 200; k++) {
      var X = ax + ((k * 7) % (2 * r + 1)), Y = y0 + ((k * 3) % h), Z = az + ((k * 11) % (2 * r + 1));
      if ((X + Y + Z) % 4 === 0) Sim.place(X, Y, Z, d.cat, P_STATIC, T, true);
    }
    // Reactions that need current get an electrode rod up the middle, and the rig is kept molten or dissolved as needed.
    if (d.elec) {
      for (var ey = 2; ey < top - 1; ey++) Sim.place(cx, ey, cz, ELECTRODE, P_STATIC, T, true);
      if (T < 340 && ids.indexOf(WATERID) < 0) fillWater(ax, az, bx, bz, top, ids[0]);
    }
    Sim.wakeAll();
    Sim.updateCensus();
  }
  // Salts that need water to conduct: dissolve them through a pool.
  function fillWater(ax, az, bx, bz, top, solute) {
    for (var y = 1; y <= top; y++) for (var z = az; z <= bz; z++) for (var x = ax; x <= bx; x++) {
      var i = Sim.idx(x, y, z);
      if (Sim.ID[i] === ELECTRODE) continue;
      Sim.place(x, y, z, WATERID, P_POWDER, undefined, true);
      Sim.AUX[i] = solute;
    }
  }
  // Light-driven reactions need the lamp on: the browser and the tests shine it through the rig each tick.
  function demoTick(d) {
    var isLight = d.light;
    if (!isLight) return;
    var cx = W >> 1, cz = D >> 1;
    Sim.forSphere(cx, 8, cz, 9, function (x, y, z, i) { if (Sim.ID[i] !== AIR && Sim.ID[i] !== WALL) Chem.illuminate(i, x, y, z); });
  }

  // Guided lessons. Each step says what to do, and moves on when its check passes.
  function logged(text) { return Sim.log.some(function (l) { return l.msg.indexOf(text) >= 0; }); }
  function amount(id) { var c = Sim.census || []; for (var k = 0; k < c.length; k++) if (c[k][0] === id) return c[k][1]; return 0; }
  var lessons = [
    { id: "heating", title: "What a heating curve shows", steps: [
      { text: "This chamber is empty. Pick H2O in the Compounds tab, set Fixed block, and place a block of water.", setup: function () { Sim.clear(); }, check: function () { return amount(f("H2O")) > 20; } },
      { text: "Press P while pointing at the water to pin a cell. The Pinned cell graph appears in the panel.", check: function (ui) { return ui.state.pinned; } },
      { text: "Choose the Heat tool and hold it on the water. The temperature climbs, then stops at 373 K while the water boils, because the energy goes into turning liquid to steam.", check: function () { return amount(f("H2O")) > 0 && hottest() > 370; } }
    ] },
    { id: "flame", title: "Why flames have colours", steps: [
      { text: "Gas burners heat a ring of metal salt each. Each element gives off its own colours of light as its excited electrons fall back. Watch for lithium crimson and barium green.", setup: function (ui) { ui.loadScene("flames"); }, check: function () { return logged("O"); } },
      { text: "Try it yourself. Select copper in the periodic table, then heat some with the Heat tool until it burns blue-green.", setup: function (ui) { Sim.clear(); }, check: function () { return logged("Cu"); } }
    ] },
    { id: "ratios", title: "Reaction ratios and limiting reagents", steps: [
      { text: "Thermite is running. Aluminium and iron oxide react 2 to 1 by equation, but by volume they do not, because they have different densities. Look in the census: one runs out first, the limiting reagent.", setup: function (ui) { ui.loadScene("thermite"); }, check: function () { return logged("Fe₂O₃"); } },
      { text: "Hover on a cell. Partly used reactant shows how much of it is left, as a percentage. Press Next when you have found one.", manual: true }
    ] },
    { id: "ph", title: "Acids, bases and pH", steps: [
      { text: "Sodium hydroxide drips into acid. Phenolphthalein stays colourless in acid and turns pink above pH 8.2. Watch for pink where the base wins.", setup: function (ui) { ui.loadScene("titration"); }, check: function () { return logged("NaOH") || logged("H₂O"); } },
      { text: "Press the pH view button. Now every water cell shows its computed pH, on the universal indicator scale. Hover to read the number.", check: function () { return Render.viewMode === "ph"; } }
    ] },
    { id: "battery", title: "How a battery works", steps: [
      { text: "A Daniell cell is running. Zinc gives up electrons more easily than copper, so electrons run through the wire from zinc to copper. The log shows the voltage, 1.10 V when fresh.", setup: function (ui) { ui.loadScene("daniell"); }, check: function () { return logged("Cell Zn | Cu"); } },
      { text: "The voltage comes from the difference in electrode potentials. Try erasing the salt bridge in the middle. With no path for ions, the current stops.", manual: true }
    ] },
    { id: "fission", title: "Chain reactions and control rods", steps: [
      { text: "Cadmium sleeves swallow almost every neutron, so fission is rare. Find the fission count in the status bar.", setup: function (ui) { ui.loadScene("reactor"); }, check: function () { return Sim.stats.fissions > 0 || Sim.tickN > 60; } },
      { text: "Press Withdraw control rods. Neutrons now reach the other rods and the rate climbs steeply. Watch the Events per second graph.", check: function () { return Sim.stats.fissions > 80; } },
      { text: "Iodine-135 and xenon-135 appear among the products in the log. Xenon-135 absorbs neutrons more strongly than any other nuclide, and it can choke a real reactor.", check: function () { return logged("I-135") || logged("Xe-135"); } }
    ] }
  ];
  function hottest() { var h = Sim.history; return h && h.length ? h[h.length - 1].hot : 0; }

  return {
    lessons: lessons,
    demo: demo, demoTick: demoTick, demoT: demoTemperature,
    list: list,
    load: function (id) {
      dims();
      var s = null;
      for (var k = 0; k < list.length; k++) if (list[k].id === id) s = list[k];
      if (!s) return null;
      Sim.lid = false; Sim.setDecayScale(1); Sim.enrichment = null; Sim.isotopeOverride = null;
      Sim.clear();
      s.build();
      Sim.wakeAll();
      Sim.updateCensus();
      return s;
    }
  };
})();
