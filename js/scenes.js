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

  var list = [
    {
      id: "alkali", name: "Alkali metals in water", tag: "Group 1",
      text: "Li, Na, K, Rb and Cs fall into a pool, left to right. Ionisation energy drops down the group, so each one reacts harder than the last.",
      build: function () {
        box(0, 0, 0, 1, 0.16, 1, f("H2O"), P_POWDER);
        [3, 11, 19, 37, 55].forEach(function (z, k) {
          var c = 0.14 + k * 0.18;
          box(c - 0.035, 0.26, 0.46, c + 0.035, 0.32, 0.54, z, P_POWDER);
        });
      }
    },
    {
      id: "thermite", name: "Thermite on a steel plate", tag: "Redox",
      text: "Aluminium grains and rust sit still until the hot spot on top reaches about 1100 K. The front then spreads by itself, and molten iron sinks through the slag.",
      build: function () {
        box(0.2, 0.22, 0.2, 0.8, 0.26, 0.8, 26, P_STATIC);
        box(0.2, 0, 0.2, 0.26, 0.21, 0.26, 26, P_STATIC); box(0.74, 0, 0.74, 0.8, 0.21, 0.8, 26, P_STATIC);
        box(0.74, 0, 0.2, 0.8, 0.21, 0.26, 26, P_STATIC); box(0.2, 0, 0.74, 0.26, 0.21, 0.8, 26, P_STATIC);
        var fe = f("Fe2O3");
        for (var y = Y(0.27); y <= Y(0.48); y++) for (var z = Z(0.36); z <= Z(0.64); z++) for (var x = X(0.36); x <= X(0.64); x++) {
          Sim.place(x, y, z, (x + y + z) & 1 ? 13 : fe, P_POWDER, undefined, true);
        }
        Sim.forSphere(X(0.5), Y(0.48), Z(0.5), 2, function (x, y, z, i) { if (Sim.ID[i] !== AIR) Sim.T[i] = 1600; });
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
      text: "Four piles decay at their own pace: oganesson, plutonium, radium and polonium. Watch the census: alpha and beta decay walk everything down the chart to stable lead, while the heaviest nuclei split into mid-table fission fragments.",
      build: function () {
        [[118, 0.2, 0.2], [94, 0.8, 0.2], [88, 0.2, 0.8], [84, 0.8, 0.8]].forEach(function (r) {
          box(r[1] - 0.1, 0, r[2] - 0.1, r[1] + 0.1, 0.16, r[2] + 0.1, r[0], P_POWDER);
        });
        Sim.setDecayScale(3);
      }
    },
    {
      id: "discharge", name: "Noble gas discharge tubes", tag: "Group 18",
      text: "Five sealed tubes hold He, Ne, Ar, Kr and Xe, each with an electrode at its foot. Each gas glows in its own emission colour.",
      build: function () {
        [2, 10, 18, 36, 54].forEach(function (z, k) {
          var a = X(0.12 + k * 0.17), b = Z(0.42), c = a + 8, d = b + 8, top = Y(0.8);
          Sim.box(a, 1, b, c, top, b, WALL, P_STATIC); Sim.box(a, 1, d, c, top, d, WALL, P_STATIC);
          Sim.box(a, 1, b, a, top, d, WALL, P_STATIC); Sim.box(c, 1, b, c, top, d, WALL, P_STATIC);
          Sim.box(a, top, b, c, top, d, WALL, P_STATIC);
          Sim.box(a + 1, 2, b + 1, c - 1, top - 1, d - 1, z, P_POWDER);
          Sim.place(a + 4, 1, b + 4, ELECTRODE, P_STATIC, undefined, true);
        });
      }
    },
    {
      id: "flames", name: "Flame tests", tag: "Emission",
      text: "Metal powders burn on a hot plate. The colours are the real flame-test colours: lithium crimson, sodium yellow, potassium lilac, copper blue-green and barium apple green.",
      build: function () {
        [3, 11, 19, 29, 56, 38, 20, 5].forEach(function (z, k) {
          var a = 0.1 + (k % 4) * 0.26, c = 0.25 + (k >> 2) * 0.5;
          box(a - 0.06, 0, c - 0.08, a + 0.06, 0.05, c + 0.08, WALL, P_STATIC);
          box(a - 0.045, 0.06, c - 0.06, a + 0.045, 0.1, c + 0.06, z, P_POWDER, Math.max(ELEMENTS[z].ign + 30, 500));
        });
      }
    },
    {
      id: "density", name: "Density column", tag: "Buoyancy",
      text: "Mercury, bromine and water stack by real density. Four metals drop in: iron floats on the mercury and gold sinks through it, while aluminium and magnesium stop on the bromine.",
      build: function () {
        tank(0.25, 0.25, 0.75, 0.75, 0.9);
        box(0.26, 0, 0.26, 0.74, 0.14, 0.74, 80, P_POWDER);
        box(0.26, 0.15, 0.26, 0.74, 0.27, 0.74, 35, P_POWDER);
        box(0.26, 0.28, 0.26, 0.74, 0.42, 0.74, f("H2O"), P_POWDER);
        box(0.3, 0.6, 0.3, 0.38, 0.65, 0.38, 26, P_POWDER);
        box(0.62, 0.6, 0.3, 0.7, 0.65, 0.38, 79, P_POWDER);
        box(0.3, 0.6, 0.62, 0.38, 0.65, 0.7, 13, P_POWDER);
        box(0.62, 0.6, 0.62, 0.7, 0.65, 0.7, 12, P_POWDER);
      }
    },
    {
      id: "star", name: "Stellar forge", tag: "Fusion",
      text: "A self-gravitating ball of hydrogen plasma at 800 million K burns to helium, then carbon and beyond. It stops at iron, where fusion stops paying. Watch the census climb the table.",
      build: function () {
        Sim.lid = true;
        var cx = X(0.5), cy = Y(0.45), cz = Z(0.5), r = Math.floor(Math.min(W, H, D) * 0.2);
        Sim.star = { x: cx, y: cy, z: cz };
        Sim.forSphere(cx, cy, cz, r, function (x, y, z, i) { Sim.place(x, y, z, 1, P_POWDER, 8e8, true); Sim.PH[i] = P_PLASMA; });
      }
    },
    {
      id: "acid", name: "Acids and the activity series", tag: "Electrochemistry",
      text: "Zinc, iron and copper drop into hydrochloric acid: zinc fizzes fastest, copper not at all. Next door, aqua regia dissolves gold, which no single acid can touch.",
      build: function () {
        tank(0.08, 0.2, 0.48, 0.8, 0.3); tank(0.52, 0.2, 0.92, 0.8, 0.3);
        box(0.09, 0, 0.21, 0.47, 0.18, 0.79, f("HCl"), P_POWDER);
        box(0.53, 0, 0.21, 0.72, 0.18, 0.79, f("HCl"), P_POWDER);
        box(0.73, 0, 0.21, 0.91, 0.18, 0.79, f("HNO3"), P_POWDER);
        box(0.13, 0.4, 0.3, 0.21, 0.45, 0.4, 30, P_POWDER); box(0.24, 0.4, 0.3, 0.32, 0.45, 0.4, 26, P_POWDER); box(0.35, 0.4, 0.3, 0.43, 0.45, 0.4, 29, P_POWDER);
        box(0.66, 0.4, 0.42, 0.78, 0.46, 0.58, 79, P_POWDER);
      }
    },
    {
      id: "golden", name: "Golden rain", tag: "Precipitation",
      text: "Clear solutions of lead nitrate and potassium iodide meet in the middle and throw down bright yellow lead iodide, exactly as the bench demonstration does.",
      build: function () {
        tank(0.15, 0.15, 0.85, 0.85, 0.5);
        var w = f("H2O"), pb = f("Pb(NO3)2"), ki = f("KI"), mid = X(0.5);
        for (var y = 1; y <= Y(0.22); y++) for (var z = Z(0.16); z <= Z(0.84); z++) for (var x = X(0.16); x <= X(0.84); x++) {
          Sim.place(x, y, z, w, P_POWDER, undefined, true);
          Sim.AUX[Sim.idx(x, y, z)] = x < mid - 1 ? pb : (x > mid + 1 ? ki : 0);
        }
      }
    },
    {
      id: "filament", name: "Lamp filament and electrolysis", tag: "Electricity",
      text: "The same current runs through two wires. Tungsten's higher resistance makes it glow from Joule heating, while copper only gets warm. Electrodes in the tank split water into hydrogen and oxygen.",
      build: function () {
        var y = Y(0.45), z1 = Z(0.3), z2 = Z(0.42);
        Sim.box(X(0.1), 1, z1, X(0.1), y, z1, 74, P_STATIC); Sim.box(X(0.1), y, z1, X(0.9), y, z1, 74, P_STATIC); Sim.box(X(0.9), 1, z1, X(0.9), y, z1, 74, P_STATIC);
        Sim.place(X(0.1), 1, z1, ELECTRODE, P_STATIC, undefined, true);
        Sim.box(X(0.1), 1, z2, X(0.1), y, z2, 29, P_STATIC); Sim.box(X(0.1), y, z2, X(0.9), y, z2, 29, P_STATIC); Sim.box(X(0.9), 1, z2, X(0.9), y, z2, 29, P_STATIC);
        Sim.place(X(0.1), 1, z2, ELECTRODE, P_STATIC, undefined, true);
        tank(0.25, 0.58, 0.75, 0.9, 0.24);
        box(0.26, 0, 0.59, 0.74, 0.17, 0.89, f("H2O"), P_POWDER);
        Sim.box(X(0.36), 1, Z(0.74), X(0.36), Y(0.12), Z(0.74), ELECTRODE, P_STATIC);
        Sim.box(X(0.64), 1, Z(0.74), X(0.64), Y(0.12), Z(0.74), ELECTRODE, P_STATIC);
      }
    },
    {
      id: "chain", name: "The uranium-238 decay chain", tag: "Isotopes",
      text: "A sample of pure U-238 on a very fast clock. It walks the real chain, Th-234, Pa-234, U-234, Th-230, Ra-226, Rn-222 and on down to stable lead-206. Radon, being a gas, drifts away. Follow the log.",
      build: function () {
        Sim.setDecayScale(600);
        Sim.isotopeOverride = { 92: 238 };
        box(0.35, 0, 0.35, 0.65, 0.16, 0.65, 92, P_POWDER);
        Sim.isotopeOverride = null;
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
      text: "A pool of dilute acid with phenolphthalein in it, colourless. Pour in sodium hydroxide, and where the base wins the water turns pink. Switch on pH view to see the whole field in colour.",
      build: function () {
        tank(0.2, 0.2, 0.8, 0.8, 0.3);
        var w = f("H2O"), hcl = f("HCl"), ind = f("Phenolphthalein");
        for (var y = 1; y <= Y(0.22); y++) for (var z = Z(0.21); z <= Z(0.79); z++) for (var x = X(0.21); x <= X(0.79); x++) {
          Sim.place(x, y, z, w, P_POWDER, undefined, true);
          var i = Sim.idx(x, y, z); Sim.AUX[i] = hcl; Sim.USED[i] = 0.995; Sim.AUX2[i] = ind; Sim.U2[i] = 0.9;
        }
        box(0.45, 0.4, 0.45, 0.55, 0.46, 0.55, f("NaOH"), P_POWDER);
      }
    },
    {
      id: "boiler", name: "Boiler explosion", tag: "Pressure",
      text: "A sealed steel tank of water sits on a hot plate. Boiling has nowhere to go, so pressure climbs and the boiling point rises with it. When the walls give way, the steam blows out. Watch the pressure graph.",
      build: function () {
        var a = X(0.36), b = X(0.64), c = Z(0.36), d = Z(0.64), bot = Y(0.08), top = Y(0.42);
        Sim.box(a - 3, 1, c - 3, b + 3, bot - 1, d + 3, 26, P_STATIC, 1750);
        Sim.box(a, bot, c, b, top, d, 26, P_STATIC);
        Sim.box(a + 1, bot + 1, c + 1, b - 1, top - 1, d - 1, f("H2O"), P_POWDER, 360);
      }
    },
    {
      id: "bridge", name: "Melting supports", tag: "Structure",
      text: "A steel deck rests on lead pillars standing on a hot plate. As the lead softens and melts, the deck loses support and falls in one piece.",
      build: function () {
        var y = Y(0.3);
        Sim.box(X(0.22), 1, Z(0.3), X(0.78), Y(0.04), Z(0.7), 26, P_STATIC, 1100);
        [[0.26, 0.34], [0.7, 0.34], [0.26, 0.62], [0.7, 0.62]].forEach(function (q) {
          Sim.box(X(q[0]), Y(0.05), Z(q[1]), X(q[0] + 0.05), y, Z(q[1] + 0.05), 82, P_STATIC, 560);
        });
        Sim.box(X(0.24), y + 1, Z(0.32), X(0.78), y + 2, Z(0.68), 26, P_STATIC);
      }
    },
    {
      id: "volcano", name: "Dichromate volcano", tag: "Decomposition",
      text: "Ammonium dichromate is lit at the peak. It decomposes in a shower of sparks, leaving a fluffy heap of green chromium oxide, with nitrogen and steam carrying it upward.",
      build: function () {
        var cx = X(0.5), cz = Z(0.5), R0 = Math.floor(Math.min(W, D) * 0.2), a = f("(NH4)2Cr2O7");
        for (var y = 1; y <= R0; y++) Sim.forSphere(cx, y, cz, R0 - y + 1, function (x, yy, z) { if (yy === y) Sim.place(x, yy, z, a, P_POWDER, undefined, true); });
        // Dichromate conducts heat poorly, so a small warm spot dies out before it can light what is next to it.
        Sim.forSphere(cx, R0, cz, Math.max(3, R0 >> 2), function (x, y, z, i) { if (Sim.ID[i] !== AIR) Sim.T[i] = 900; });
      }
    },
    {
      id: "toothpaste", name: "Hydrogen peroxide and catalyst", tag: "Catalysis",
      text: "Peroxide on its own is almost stable at room temperature. Manganese dioxide falling through it sets off a rush of oxygen, without being used up.",
      build: function () {
        tank(0.3, 0.3, 0.7, 0.7, 0.34);
        box(0.31, 0, 0.31, 0.69, 0.24, 0.69, f("H2O2"), P_POWDER);
        box(0.44, 0.5, 0.44, 0.56, 0.54, 0.56, f("MnO2"), P_POWDER);
      }
    },
    {
      id: "snake", name: "Sugar and sulfuric acid", tag: "Dehydration",
      text: "Concentrated sulfuric acid rips the water out of table sugar. A hot, steaming column of black carbon is left behind.",
      build: function () {
        tank(0.32, 0.32, 0.68, 0.68, 0.3);
        box(0.33, 0, 0.33, 0.67, 0.14, 0.67, f("C12H22O11"), P_POWDER);
        box(0.4, 0.3, 0.4, 0.6, 0.36, 0.6, f("H2SO4"), P_POWDER);
      }
    },
    {
      id: "gunpowder", name: "Black powder", tag: "Explosive",
      text: "Saltpetre, sulfur and charcoal, mixed as they have been for a thousand years, hold still until they reach 600 K. Then the hot spot runs through the whole charge.",
      build: function () {
        var k = f("KNO3");
        for (var y = 1; y <= Y(0.2); y++) for (var z = Z(0.38); z <= Z(0.62); z++) for (var x = X(0.38); x <= X(0.62); x++) {
          var r = (x * 7 + y * 13 + z * 5) % 8;
          Sim.place(x, y, z, r < 5 ? k : (r < 7 ? 6 : 16), P_POWDER, undefined, true);
        }
        Sim.forSphere(X(0.5), Y(0.2), Z(0.5), 2, function (x, y, z, i) { if (Sim.ID[i] !== AIR) Sim.T[i] = 900; });
      }
    },
    {
      id: "triiodide", name: "Contact explosive", tag: "Explosive",
      text: "Nitrogen triiodide sits on a warm plate. It only needs the slightest disturbance, and it goes up in a cloud of violet iodine vapour.",
      build: function () {
        box(0.3, 0, 0.3, 0.7, 0.05, 0.7, 26, P_STATIC, 300);
        for (var k = 0; k < 6; k++) {
          var a = 0.34 + (k % 3) * 0.13, c = 0.38 + (k >> 1 & 1) * 0.24;
          box(a, 0.06, c, a + 0.06, 0.1, c + 0.06, f("NI3"), P_POWDER, 305);
        }
      }
    },
    {
      id: "colours", name: "Colour tests", tag: "Complexes",
      text: "Four pools. Ammonia turns pale copper sulfate royal blue. Thiocyanate turns iron(III) blood red. Chromate falls out of lead solution as chrome yellow, and of silver as brick red.",
      build: function () {
        function pool(ax, az, bx, bz, solute, drop) {
          tank(ax, az, bx, bz, 0.2);
          var w = f("H2O"), s = f(solute);
          for (var y = 1; y <= Y(0.14); y++) for (var z = Z(az) + 1; z < Z(bz); z++) for (var x = X(ax) + 1; x < X(bx); x++) {
            Sim.place(x, y, z, w, P_POWDER, undefined, true); Sim.AUX[Sim.idx(x, y, z)] = s;
          }
          box((ax + bx) / 2 - 0.05, 0.16, (az + bz) / 2 - 0.05, (ax + bx) / 2 + 0.05, 0.2, (az + bz) / 2 + 0.05, f(drop), P_POWDER);
        }
        pool(0.06, 0.06, 0.46, 0.46, "CuSO4", "NH3");
        pool(0.54, 0.06, 0.94, 0.46, "FeCl3", "NH4SCN");
        pool(0.06, 0.54, 0.46, 0.94, "Pb(NO3)2", "K2CrO4");
        pool(0.54, 0.54, 0.94, 0.94, "AgNO3", "K2CrO4");
      }
    },
    {
      id: "furnace", name: "Blast furnace", tag: "Industry",
      text: "Layers of iron ore, coke and limestone are heated from below. Carbon and carbon monoxide reduce the ore, limestone turns to lime and then slag, and molten iron collects at the bottom.",
      build: function () {
        tank(0.3, 0.3, 0.7, 0.7, 0.75);
        var ore = f("Fe2O3"), lime = f("CaCO3"), sand = f("SiO2");
        for (var y = 1; y <= Y(0.6); y++) for (var z = Z(0.31); z <= Z(0.69); z++) for (var x = X(0.31); x <= X(0.69); x++) {
          var band = (y >> 2) % 4, id = band === 0 ? 6 : (band === 1 ? ore : (band === 2 ? 6 : ((x + z) % 3 ? lime : sand)));
          Sim.place(x, y, z, id, P_POWDER, y < 6 ? 1500 : undefined, true);
        }
      }
    },
    {
      id: "cryo", name: "Cryogenic bench", tag: "Low temperature",
      text: "A pool of liquid nitrogen at 77 K boils off around a warm iron block. A pool of liquid oxygen is pale blue. Gallium melts from nothing more than a warm block's heat.",
      build: function () {
        tank(0.08, 0.2, 0.48, 0.8, 0.22); tank(0.52, 0.2, 0.92, 0.8, 0.22);
        box(0.09, 0, 0.21, 0.47, 0.14, 0.79, 7, P_POWDER, 70);
        box(0.53, 0, 0.21, 0.91, 0.14, 0.79, 8, P_POWDER, 80);
        box(0.22, 0.2, 0.42, 0.34, 0.3, 0.58, 26, P_POWDER);
        box(0.42, 0.45, 0.4, 0.58, 0.48, 0.6, WALL, P_STATIC);
        box(0.45, 0.49, 0.43, 0.55, 0.55, 0.57, 31, P_POWDER);
        box(0.45, 0.56, 0.43, 0.55, 0.6, 0.57, 29, P_STATIC, 700);
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
      { text: "Metal powders are burning on hot plates. Each element gives off its own colours of light as its excited electrons fall back. Watch for lithium crimson and barium green.", setup: function (ui) { ui.loadScene("flames"); }, check: function () { return logged("O"); } },
      { text: "Try it yourself. Select copper in the periodic table, then heat some with the Heat tool until it burns blue-green.", setup: function (ui) { Sim.clear(); }, check: function () { return logged("Cu"); } }
    ] },
    { id: "ratios", title: "Reaction ratios and limiting reagents", steps: [
      { text: "Thermite is running. Aluminium and iron oxide react 2 to 1 by equation, but by volume they do not, because they have different densities. Look in the census: one runs out first, the limiting reagent.", setup: function (ui) { ui.loadScene("thermite"); }, check: function () { return logged("Fe₂O₃"); } },
      { text: "Hover on a cell. Partly used reactant shows how much of it is left, as a percentage. Press Next when you have found one.", manual: true }
    ] },
    { id: "ph", title: "Acids, bases and pH", steps: [
      { text: "Sodium hydroxide falls into acid. Phenolphthalein stays colourless in acid and turns pink above pH 8.2. Watch for pink where the base wins.", setup: function (ui) { ui.loadScene("titration"); }, check: function () { return logged("NaOH") || logged("H₂O"); } },
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
