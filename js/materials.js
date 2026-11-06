// Material table: elements, special cells and compounds. Material id equals atomic number for elements.
// Compounds are built on demand from real oxidation states, then overridden by measured values in KNOWN.
var AIR = 0, FLAME = 119, WALL = 120, ELECTRODE = 121, SMOKE = 122, FIRST_COMPOUND = 123, MAX_MATERIALS = 4096;
var P_STATIC = 0, P_POWDER = 1, P_LIQUID = 2, P_GAS = 3, P_PLASMA = 4;

var Mat = (function () {
  var N = MAX_MATERIALS;
  var M = {
    list: [], byFormula: {},
    mw: new Float32Array(N), rhoS: new Float32Array(N), rhoL: new Float32Array(N), mp: new Float32Array(N), bp: new Float32Array(N),
    lf: new Float32Array(N), lv: new Float32Array(N), cS: new Float32Array(N), cL: new Float32Array(N), cG: new Float32Array(N),
    dS: new Float32Array(N), dL: new Float32Array(N), dG: new Float32Array(N), sublimes: new Uint8Array(N), plasmaT: new Float32Array(N),
    colS: new Uint8Array(N * 3), colL: new Uint8Array(N * 3), colG: new Uint8Array(N * 3), gasA: new Uint8Array(N), glow: new Uint8Array(N * 3),
    decay: new Float32Array(N), sigma: new Float32Array(N), barns: new Float32Array(N), fissile: new Float32Array(N), curie: new Float32Array(N), tc: new Float32Array(N),
    visc: new Float32Array(N), reactive: new Uint8Array(N), decT: new Float32Array(N), n0: new Float32Array(N),
    viscA: new Float32Array(N), viscB: new Float32Array(N), betaL: new Float32Array(N), betaS: new Float32Array(N), rhoT: new Float32Array(N), tension: new Float32Array(N),
    pol: new Uint8Array(N), repose: new Float32Array(N), emiss: new Float32Array(N), uts: new Float32Array(N), brittle: new Uint8Array(N), hsol: new Float32Array(N),
    crit: new Float32Array(N), bpVac: new Float32Array(N), dTm: new Float32Array(N), satK: new Float32Array(N), satA: new Float32Array(N), flaky: new Uint8Array(N)
  };

  var SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  // Subscript only the digits that follow a symbol or bracket, so the 2 in 2H2O stays a coefficient.
  M.pretty = function (f) { return f.replace(/([A-Za-z)\]])(\d+)/g, function (all, before, digits) { return before + digits.replace(/\d/g, function (d) { return SUB[d]; }); }); };

  function hex(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function set3(arr, id, c) { arr[id * 3] = c[0]; arr[id * 3 + 1] = c[1]; arr[id * 3 + 2] = c[2]; }

  // Thermal step strength per neighbour. True diffusivity spans five orders of magnitude, so it is
  // square-root compressed to keep water slow and copper fast at the same time on a small grid.
  function diff(k, rho, cp) {
    var alpha = k / (100 * Math.max(rho, 1e-4) * cp);
    return 0.12 * Math.sqrt(Math.min(1.5, alpha / 1.2));
  }

  function install(m) {
    var id = m.id;
    M.list[id] = m;
    M.mw[id] = m.gasM || m.M;
    // Moles in a full cell of 1 cm3 at this substance's condensed density. For elements this counts atoms, so H2 and Fe share one scale.
    M.n0[id] = m.rhoS > 0 && m.M > 0 ? m.rhoS / m.M : 0.05;
    M.rhoS[id] = m.rhoS; M.rhoL[id] = m.rhoL;
    M.mp[id] = m.mp == null ? -1 : m.mp;
    M.bp[id] = m.bp == null ? 1e9 : m.bp;
    M.sublimes[id] = (m.mp != null && m.bp != null && m.mp >= m.bp) ? 1 : 0;
    var molarCp = Math.max(m.cp * (m.gasM && m.gasM === 2 * m.M ? m.gasM : m.M), 10);   // diatomic gases quote heats per mole of molecules
    // Latent heat is stored as an equivalent temperature rise, halved so a change of phase takes seconds, not minutes.
    M.lf[id] = 0.5 * (m.hf || 1) * 1000 / molarCp;
    M.lv[id] = 0.5 * (m.hv || 10) * 1000 / molarCp;
    M.cS[id] = m.rhoS * m.cp; M.cL[id] = m.rhoL * m.cp;
    // Real gas heat capacity per volume is tiny. A floor stands in for the convection a voxel grid cannot resolve.
    M.cG[id] = Math.max(0.0122 * (m.gasM || m.M) / 300 * m.cp, 0.012);
    M.dS[id] = diff(m.k, m.rhoS, m.cp);
    M.dL[id] = diff(m.kL != null ? m.kL : m.k * (m.k > 5 ? 0.6 : 1), m.rhoL, m.cp);
    // Light gas molecules move faster and carry more heat. Kinetic theory gives k in proportion to 1/sqrt(M), compressed by a square root like the rest.
    M.dG[id] = 0.05 * Math.pow(28.97 / Math.max(M.mw[id], 1), 0.25);
    M.plasmaT[id] = m.ie ? m.ie * 800 : 12000;
    var cS = hex(m.colS), cL = hex(m.colL || m.colS), g = m.colG || [m.colS, 16];
    set3(M.colS, id, cS); set3(M.colL, id, cL); set3(M.colG, id, hex(g[0])); M.gasA[id] = g[1];
    set3(M.glow, id, hex(m.glow || "#ffb060"));
    M.sigma[id] = m.sigma || 0; M.barns[id] = m.barns || 0; M.fissile[id] = m.fissile || 0;
    M.curie[id] = m.curie || 0; M.tc[id] = m.tc || 0;
    M.visc[id] = m.visc || 0.05;
    M.decT[id] = m.decT || 0;
    if (m.halfLifeSim) M.decay[id] = m.halfLifeSim;
    return m;
  }

  // Half-lives run from milliseconds to 10^17 s. A log-compressed clock keeps the whole range watchable while
  // preserving the order: U-238 still far outlasts radium, which far outlasts radon.
  M.simHalfLife = function (seconds) { return 0.5 * Math.pow(10, 0.2 * Math.log10(Math.max(seconds, 1e-3))); };

  // ---- Elements ----
  for (var z = 1; z <= 118; z++) {
    var e = ELEMENTS[z];
    var solid = e.d, liq = e.d * 0.93;
    if (e.d < 0.05) { solid = SOLID_DENSITY[z] || e.d * 900; liq = LIQUID_DENSITY[z] || solid * 0.9; }
    if (LIQUID_DENSITY[z]) liq = LIQUID_DENSITY[z];
    var metal = e.sigma > 0.3;
    var liqCol = ELEMENT_LIQ[z] || (metal ? "#" + hex(e.color).map(function (v) { return ("0" + Math.round(v + (225 - v) * 0.35).toString(16)).slice(-2); }).join("") : e.color);
    var gas = ELEMENT_GAS[z] || (e.z > 2 ? [e.color, metal ? 45 : 28] : ["#ffffff", 10]);
    install({
      id: z, kind: "element", z: z, sym: e.s, name: e.n, formula: e.s, M: e.m, gasM: e.m * e.atoms, rhoS: solid, rhoL: liq, mp: e.mp, bp: e.bp, cp: e.cp, k: e.k, hf: e.hf, hv: e.hv,
      kL: z === 80 ? e.k : (e.bp != null && e.bp < 300 ? 0.15 : undefined),   // mercury's listed k is already its liquid value
      colS: e.color, colL: liqCol, colG: gas, glow: e.flame || "#ffb060", ie: e.ie, sigma: e.sigma, barns: e.barns, fissile: e.fissile, curie: e.curie, tc: e.Tc,
      visc: z === 16 ? 0.2 : (metal ? 0.02 : 0.05), halfLifeSim: e.hl ? M.simHalfLife(e.hl) : 0, en: e.en, E0: e.E0, ign: e.ign
    });
    M.byFormula[e.s] = z;
  }

  // ---- Special cells ----
  install({ id: AIR, kind: "special", name: "Air", formula: "air", M: 28.97, rhoS: 1, rhoL: 1, mp: null, bp: 1, cp: 1.005, k: 0.026, colS: "#000000", colG: ["#000000", 0] });
  install({ id: FLAME, kind: "special", name: "Flame", formula: "flame", M: 20, rhoS: 1, rhoL: 1, mp: null, bp: 1, cp: 1.2, k: 0.05, colS: "#ff8030", colG: ["#ff8030", 90] });
  install({ id: WALL, kind: "special", name: "Containment", formula: "wall", M: 100, rhoS: 50, rhoL: 50, mp: 1e12, bp: 1e13, cp: 1, k: 0.5, hf: 1e6, colS: "#59626e" });
  install({ id: ELECTRODE, kind: "special", name: "Electrode", formula: "electrode", M: 100, rhoS: 50, rhoL: 50, mp: 1e12, bp: 1e13, cp: 1, k: 50, hf: 1e6, colS: "#c9a24a", sigma: 60 });
  install({ id: SMOKE, kind: "special", name: "Smoke", formula: "smoke", M: 30, rhoS: 1, rhoL: 1, mp: null, bp: 1, cp: 1.1, k: 0.03, colS: "#4a4744", colG: ["#55524e", 46] });
  M.list[SMOKE].noteText = "Soot and fine particles from combustion. It drifts upward and thins out.";
  M.cG[AIR] = 0.02; M.cG[FLAME] = 0.06;
  M.list[FLAME].noteText = "Short-lived hot gas from combustion, coloured by the element's flame test.";
  M.list[WALL].noteText = "An idealised ceramic for building vessels. It cannot melt, burn or react.";
  M.list[ELECTRODE].noteText = "A live contact. It sends a pulse of current into any conductor touching it.";

  // ---- Compounds ----
  var nextId = FIRST_COMPOUND;
  var ANIONS = {
    O: { z: 8, q: -2, name: "oxide", f: "O", m: 15.999, kind: "ide", atoms: 1 }, S: { z: 16, q: -2, name: "sulfide", f: "S", m: 32.06, kind: "ide", atoms: 1 },
    F: { z: 9, q: -1, name: "fluoride", f: "F", m: 18.998, kind: "ide", atoms: 1 }, Cl: { z: 17, q: -1, name: "chloride", f: "Cl", m: 35.45, kind: "ide", atoms: 1 },
    Br: { z: 35, q: -1, name: "bromide", f: "Br", m: 79.904, kind: "ide", atoms: 1 }, I: { z: 53, q: -1, name: "iodide", f: "I", m: 126.904, kind: "ide", atoms: 1 },
    H: { z: 1, q: -1, name: "hydride", f: "H", m: 1.008, kind: "ide", atoms: 1 }, N: { z: 7, q: -3, name: "nitride", f: "N", m: 14.007, kind: "ide", atoms: 1 },
    OH: { q: -1, name: "hydroxide", f: "OH", m: 17.007, kind: "poly", atoms: 2 }, SO4: { q: -2, name: "sulfate", f: "SO4", m: 96.06, kind: "poly", atoms: 5 },
    NO3: { q: -1, name: "nitrate", f: "NO3", m: 62.005, kind: "poly", atoms: 4 }, CO3: { q: -2, name: "carbonate", f: "CO3", m: 60.01, kind: "poly", atoms: 4 },
    P: { z: 15, q: -3, name: "phosphide", f: "P", m: 30.974, kind: "ide", atoms: 1 },
    PO4: { q: -3, name: "phosphate", f: "PO4", m: 94.97, kind: "poly", atoms: 5 }, ClO3: { q: -1, name: "chlorate", f: "ClO3", m: 83.45, kind: "poly", atoms: 4 },
    ClO4: { q: -1, name: "perchlorate", f: "ClO4", m: 99.45, kind: "poly", atoms: 5 }, ClO: { q: -1, name: "hypochlorite", f: "ClO", m: 51.45, kind: "poly", atoms: 2 },
    MnO4: { q: -1, name: "permanganate", f: "MnO4", m: 118.94, kind: "poly", atoms: 5 }, CrO4: { q: -2, name: "chromate", f: "CrO4", m: 115.99, kind: "poly", atoms: 5 },
    Cr2O7: { q: -2, name: "dichromate", f: "Cr2O7", m: 215.99, kind: "poly", atoms: 9 }, HCO3: { q: -1, name: "bicarbonate", f: "HCO3", m: 61.02, kind: "poly", atoms: 5 },
    C2O4: { q: -2, name: "oxalate", f: "C2O4", m: 88.02, kind: "poly", atoms: 6 }, CH3COO: { q: -1, name: "acetate", f: "CH3COO", m: 59.04, kind: "poly", atoms: 7 },
    CN: { q: -1, name: "cyanide", f: "CN", m: 26.02, kind: "poly", atoms: 2 }, SCN: { q: -1, name: "thiocyanate", f: "SCN", m: 58.08, kind: "poly", atoms: 3 },
    NO2: { q: -1, name: "nitrite", f: "NO2", m: 46.01, kind: "poly", atoms: 3 }, SO3: { q: -2, name: "sulfite", f: "SO3", m: 80.06, kind: "poly", atoms: 4 },
    S2O3: { q: -2, name: "thiosulfate", f: "S2O3", m: 112.12, kind: "poly", atoms: 5 }, SiO3: { q: -2, name: "silicate", f: "SiO3", m: 76.08, kind: "poly", atoms: 4 },
    BO3: { q: -3, name: "borate", f: "BO3", m: 58.81, kind: "poly", atoms: 4 }
  };
  M.ANIONS = ANIONS;
  var ANION_BY_Z = { 8: "O", 16: "S", 9: "F", 17: "Cl", 35: "Br", 53: "I", 1: "H", 7: "N", 15: "P" };
  // Transition-metal and f-block ions are coloured by their d and f electrons. Default salt colours by atomic number.
  var ION_COL = {
    29: "#3a9fd8", 28: "#5bbf7a", 27: "#d65a8a", 26: "#c08a3a", 24: "#3f8f5e", 25: "#e8b4c0", 23: "#6f4fb0", 79: "#d8b020", 78: "#c89040", 46: "#a86838", 45: "#a04848", 44: "#5a3a30",
    77: "#5a4038", 76: "#605850", 59: "#9fd08a", 60: "#b98ac0", 62: "#e8e0a0", 63: "#f0d0d8", 68: "#e8a0b0", 67: "#e8d080", 69: "#a8e0c0", 92: "#d4d040", 93: "#70a070", 94: "#905030", 95: "#c89080"
  };
  // Measured properties. mp, bp in K, rho in g/cm3, cp in J/g/K, k in W/m/K, hf and hv in kJ/mol.
  var KNOWN = {
    H2O: { name: "Water", mp: 273.15, bp: 373.15, rho: 0.917, rhoL: 1, cp: 4.18, k: 2.2, kL: 0.6, hf: 6.01, hv: 40.65, col: "#dcecff", colL: "#2f7fc8", colG: ["#f0f4f8", 34], note: "Ice floats because water expands as it freezes. High heat capacity makes it hold a boil at 100 C.", visc: 0.03, decT: 3500 },
    CO2: { name: "Carbon dioxide", mp: 194.7, bp: 194.7, rho: 1.56, cp: 0.84, k: 0.2, hf: 9, hv: 16.7, col: "#f0f0f4", colG: ["#d0d4d8", 9], note: "No liquid at 1 atm. Dry ice sublimes at -78.5 C. Heavier than air, so it pools and smothers fires." },
    CO: { name: "Carbon monoxide", mp: 68, bp: 81.6, rho: 0.8, cp: 1.04, k: 0.1, hf: 0.84, hv: 6, col: "#f0f0f4", colG: ["#d8d8dc", 9], note: "Colourless, toxic and flammable. Forms when carbon burns short of oxygen." },
    CH4: { name: "Methane", mp: 90.7, bp: 111.7, rho: 0.45, cp: 2.2, k: 0.2, hf: 0.94, hv: 8.2, col: "#e8f0f8", colG: ["#d4e0ec", 10], note: "Natural gas. Lighter than air and burns with a blue flame." },
    NH3: { name: "Ammonia", mp: 195.4, bp: 239.8, rho: 0.82, rhoL: 0.68, cp: 4.7, k: 0.5, hf: 5.66, hv: 23.3, col: "#f0f4f4", colG: ["#d8e4e4", 10], note: "Pungent base. The Haber process makes it from nitrogen and hydrogen over hot iron." },
    NO2: { name: "Nitrogen dioxide", mp: 261.9, bp: 294.3, rho: 1.45, cp: 0.8, k: 0.1, hf: 14.7, hv: 19, col: "#c88030", colG: ["#a84818", 120], note: "Choking red-brown fumes given off when nitric acid attacks metal." },
    SO2: { name: "Sulfur dioxide", mp: 200, bp: 263, rho: 1.46, cp: 0.62, k: 0.2, hf: 7.4, hv: 25, col: "#f0f0e0", colG: ["#e0e0d0", 14], note: "Sharp-smelling product of burning sulfur. Sinks in air." },
    H2S: { name: "Hydrogen sulfide", mp: 191.5, bp: 213, rho: 0.99, cp: 1.0, k: 0.1, hf: 2.4, hv: 18.7, col: "#f0f0e0", colG: ["#e0e0c8", 10], note: "Rotten-egg gas. Toxic and flammable." },
    HCl: { name: "Hydrochloric acid", mp: 247, bp: 321, rho: 1.18, rhoL: 1.18, cp: 2.5, k: 0.5, hf: 2, hv: 16, col: "#f0f8e8", colL: "#c4e0a0", colG: ["#d8e8c0", 24], note: "Concentrated solution of HCl gas. Dissolves metals above hydrogen in the activity series.", visc: 0.03, acid: 1 },
    HF: { name: "Hydrofluoric acid", mp: 190, bp: 293, rho: 1.15, rhoL: 1.15, cp: 2.5, k: 0.5, hf: 4.6, hv: 7.5, col: "#f0f4f8", colL: "#d4e4ec", colG: ["#e0e8f0", 14], note: "Weak by proton count, yet it dissolves glass, which ordinary acids cannot.", visc: 0.03, acid: 1 },
    HBr: { name: "Hydrobromic acid", mp: 262, bp: 397, rho: 1.49, rhoL: 1.49, cp: 2, k: 0.5, hf: 2.4, hv: 17.6, col: "#f8f0e0", colL: "#e4c8a0", colG: ["#e8d8c0", 20], note: "Strong halogen acid.", acid: 1 },
    HI: { name: "Hydroiodic acid", mp: 222, bp: 400, rho: 1.7, rhoL: 1.7, cp: 2, k: 0.5, hf: 2.9, hv: 19.8, col: "#f8e8e0", colL: "#d8a890", colG: ["#d8c0b8", 20], note: "Strongest of the halogen acids.", acid: 1 },
    H2SO4: { name: "Sulfuric acid", mp: 283.5, bp: 610, rho: 1.83, rhoL: 1.83, cp: 1.4, k: 0.3, hf: 10.7, hv: 50, col: "#f4f0e0", colL: "#d8c890", colG: ["#e0e0d0", 24], note: "Dense, oily and the world's most-made chemical. Dissolves active metals, releasing hydrogen.", visc: 0.25, acid: 1 },
    HNO3: { name: "Nitric acid", mp: 231, bp: 356, rho: 1.51, rhoL: 1.51, cp: 1.7, k: 0.3, hf: 10.5, hv: 39, col: "#f8f4d8", colL: "#e8dc90", colG: ["#e8d8a0", 30], note: "Oxidising acid: dissolves copper and silver, which HCl cannot. Mixed with HCl, it forms aqua regia.", visc: 0.04, acid: 1 },
    NaCl: { name: "Sodium chloride", mp: 1074, bp: 1738, rho: 2.16, rhoL: 1.56, cp: 0.85, k: 6.5, hf: 28, hv: 170, col: "#f4f4f4", note: "Table salt. Dissolves in water, and its molten form splits into sodium and chlorine under current." },
    KCl: { name: "Potassium chloride", mp: 1043, bp: 1693, rho: 1.98, rhoL: 1.53, cp: 0.69, k: 6.7, hf: 26.5, hv: 165, col: "#f4f4f8" },
    NaOH: { name: "Sodium hydroxide", mp: 596, bp: 1661, rho: 2.13, cp: 1.48, k: 1, hf: 6.6, hv: 175, col: "#f4f4f0", note: "Lye. The caustic product when sodium meets water." },
    KOH: { name: "Potassium hydroxide", mp: 633, bp: 1600, rho: 2.12, cp: 1.18, k: 1, hf: 9, hv: 128, col: "#f4f4f0" },
    LiOH: { name: "Lithium hydroxide", mp: 735, bp: 1197, rho: 1.46, cp: 2.04, k: 1, hf: 20.9, hv: 150, col: "#f4f4f0" },
    "Ca(OH)2": { name: "Calcium hydroxide", mp: 853, bp: 2850, rho: 2.21, cp: 1.18, k: 1.2, hf: 20, hv: 100, col: "#f0f0ec", note: "Slaked lime." },
    CaCO3: { name: "Calcium carbonate", mp: 1612, bp: 3000, rho: 2.71, cp: 0.84, k: 2.2, hf: 53, hv: 150, col: "#ece8dc", decT: 1098, note: "Limestone and chalk. Breaks into quicklime and CO2 at 825 C, and fizzes in acid." },
    NaHCO3: { name: "Baking soda", mp: 323, bp: 3000, rho: 2.2, cp: 1.05, k: 1, col: "#f6f6f2" },
    CaO: { name: "Calcium oxide", mp: 2886, bp: 3123, rho: 3.34, cp: 0.75, k: 15, hf: 80, hv: 500, col: "#e8e8dc", note: "Quicklime. Heated in a flame it glows brilliantly: the original limelight." },
    MgO: { name: "Magnesium oxide", mp: 3125, bp: 3873, rho: 3.58, cp: 0.88, k: 30, hf: 77, hv: 500, col: "#f4f4f4", note: "White smoke of burning magnesium, and a top-tier refractory." },
    Al2O3: { name: "Aluminium oxide", mp: 2345, bp: 3250, rho: 3.95, rhoL: 3.0, cp: 0.88, k: 30, kL: 3, hf: 107, hv: 600, col: "#f0ece4", note: "Corundum: sapphire and ruby. Slag of the thermite reaction." },
    SiO2: { name: "Silicon dioxide", mp: 1983, bp: 2503, rho: 2.65, rhoL: 2.2, cp: 0.74, k: 1.4, hf: 9.6, hv: 520, col: "#e8e0c8", colL: "#ffc060", note: "Quartz sand. Melts into a syrup that freezes into glass. Etched only by HF.", visc: 0.92 },
    Fe2O3: { name: "Iron(III) oxide", mp: 1839, bp: 3000, rho: 5.24, cp: 0.65, k: 8, hf: 87, hv: 400, col: "#8e3a22", note: "Rust and hematite. Mixed with aluminium powder, it is thermite." },
    CuO: { name: "Copper(II) oxide", mp: 1599, bp: 2273, rho: 6.31, cp: 0.53, k: 20, col: "#20201c", note: "Black tarnish on hot copper." },
    ZnO: { name: "Zinc oxide", mp: 2248, bp: 2633, rho: 5.61, cp: 0.49, k: 50, col: "#f4f4ec", note: "White sunscreen pigment." },
    TiO2: { name: "Titanium dioxide", mp: 2116, bp: 3245, rho: 4.23, cp: 0.69, k: 8, col: "#f8f8f8", note: "The white in paint." },
    PbO: { name: "Lead(II) oxide", mp: 1161, bp: 1750, rho: 9.53, cp: 0.22, k: 2, col: "#d8a030" },
    HgO: { name: "Mercury(II) oxide", mp: 773, bp: 773, rho: 11.14, cp: 0.21, k: 1, col: "#d04820", decT: 773, note: "Priestley heated this red powder in 1774 and collected oxygen." },
    Ag2O: { name: "Silver(I) oxide", mp: 553, bp: 553, rho: 7.14, cp: 0.3, k: 1, col: "#2a2420", decT: 553 },
    UO3: { name: "Uranium trioxide", mp: 1000, bp: 3000, rho: 7.3, cp: 0.3, k: 2, col: "#e0c830" },
    UO2: { name: "Uranium dioxide", mp: 3138, bp: 3815, rho: 10.97, cp: 0.24, k: 8, col: "#30302a", note: "Reactor fuel." },
    CuCl2: { name: "Copper(II) chloride", mp: 771, bp: 1266, rho: 3.39, cp: 0.6, k: 1, col: "#6a4a28", colSol: "#40b890", note: "Brown solid that dissolves to green-blue, with a blue-green flame." },
    CuSO4: { name: "Copper(II) sulfate", mp: 863, bp: 923, rho: 3.6, cp: 0.63, k: 1, col: "#2070c8", colSol: "#2a80e0", decT: 923, note: "Vivid blue vitriol. Dip zinc in its solution and copper plates out." },
    "Cu(NO3)2": { name: "Copper(II) nitrate", mp: 387, bp: 443, rho: 3.05, cp: 0.6, k: 1, col: "#2a80c8", colSol: "#2a80e0", decT: 443 },
    AgNO3: { name: "Silver nitrate", mp: 485, bp: 713, rho: 4.35, cp: 0.5, k: 1, col: "#f0f0f0", decT: 713, note: "Soluble silver salt. Chloride in solution makes it snow white AgCl." },
    AgCl: { name: "Silver chloride", mp: 728, bp: 1820, rho: 5.56, cp: 0.36, k: 1, col: "#f4f4ec" },
    AgI: { name: "Silver iodide", mp: 831, bp: 1779, rho: 5.68, cp: 0.24, k: 0.4, col: "#f0e070" },
    AgBr: { name: "Silver bromide", mp: 705, bp: 1775, rho: 6.47, cp: 0.27, k: 1, col: "#f0e8a8" },
    PbI2: { name: "Lead(II) iodide", mp: 675, bp: 1145, rho: 6.16, cp: 0.17, k: 1, col: "#f0c810", note: "Falls from clear solution as glittering gold flakes." },
    PbCl2: { name: "Lead(II) chloride", mp: 774, bp: 1223, rho: 5.85, cp: 0.25, k: 1, col: "#f4f4f0" },
    "Pb(NO3)2": { name: "Lead(II) nitrate", mp: 743, bp: 743, rho: 4.53, cp: 0.3, k: 1, col: "#f4f4f4", decT: 743 },
    PbSO4: { name: "Lead(II) sulfate", mp: 1360, bp: 2000, rho: 6.29, cp: 0.3, k: 1, col: "#f4f4f4" },
    KI: { name: "Potassium iodide", mp: 954, bp: 1603, rho: 3.12, cp: 0.32, k: 2, col: "#f8f8f8" },
    BaSO4: { name: "Barium sulfate", mp: 1853, bp: 3000, rho: 4.5, cp: 0.46, k: 1, col: "#f8f8f8", note: "So insoluble that it is safe to swallow for X-ray imaging." },
    CdS: { name: "Cadmium sulfide", mp: 2023, bp: 2253, rho: 4.83, cp: 0.33, k: 20, col: "#f0c018", note: "Cadmium yellow pigment." },
    HgS: { name: "Mercury(II) sulfide", mp: 853, bp: 853, rho: 8.1, cp: 0.21, k: 1, col: "#d02a18", decT: 853, note: "Cinnabar, the vermilion pigment." },
    FeS: { name: "Iron(II) sulfide", mp: 1467, bp: 2500, rho: 4.84, cp: 0.6, k: 4, col: "#4a4238" },
    ZnS: { name: "Zinc sulfide", mp: 2100, bp: 2500, rho: 4.09, cp: 0.47, k: 25, col: "#f0ecc8", note: "Phosphorescent green-glow paint when doped with copper." },
    P2O5: { name: "Phosphorus pentoxide", mp: 613, bp: 633, rho: 2.39, cp: 0.8, k: 0.5, col: "#f8f8f8", colG: ["#f4f4f4", 90], note: "Dense white smoke of burning phosphorus." },
    XeF2: { name: "Xenon difluoride", mp: 402, bp: 500, rho: 4.32, cp: 0.4, k: 0.5, col: "#f4f4f4", note: "Proof that noble gases can react. Forms only with fluorine." },
    KrF2: { name: "Krypton difluoride", mp: 250, bp: 300, rho: 3.24, cp: 0.4, k: 0.5, col: "#f4f4f4", decT: 350 },
    SiF4: { name: "Silicon tetrafluoride", mp: 183, bp: 187, rho: 1.66, cp: 0.7, k: 0.2, col: "#f0f0f0", colG: ["#e8e8e8", 20], note: "Gas released when fluorine or HF eats glass." },
    NaBr: { name: "Sodium bromide", mp: 1020, bp: 1660, rho: 3.2, cp: 0.5, k: 3, col: "#f6f6f6" },
    NaI: { name: "Sodium iodide", mp: 934, bp: 1577, rho: 3.67, cp: 0.35, k: 2, col: "#f6f6f6" },
    NaF: { name: "Sodium fluoride", mp: 1266, bp: 1977, rho: 2.56, cp: 1.1, k: 9, col: "#f6f6f6" },
    FeCl3: { name: "Iron(III) chloride", mp: 579, bp: 588, rho: 2.9, cp: 0.6, k: 1, col: "#4a2a18", colSol: "#c88a28" },
    Na2SO4: { name: "Sodium sulfate", mp: 1157, bp: 1700, rho: 2.66, cp: 0.9, k: 1, col: "#f6f6f6" },
    Na2CO3: { name: "Sodium carbonate", mp: 1124, bp: 1900, rho: 2.54, cp: 1.0, k: 1, col: "#f6f6f6", note: "Washing soda." },
    AuCl3: { name: "Gold(III) chloride", mp: 527, bp: 527, rho: 4.7, cp: 0.3, k: 1, col: "#b86a18", colSol: "#e8c020", decT: 527, note: "Formed when aqua regia dissolves gold. Heat returns the gold." }
  };
  Object.keys(SPECIES).forEach(function (f) { KNOWN[f] = SPECIES[f]; });
  ["NH3", "SO2", "H2S"].forEach(function (f) { KNOWN[f].sol = 1; });   // these gases dissolve readily and react in solution
  KNOWN.CH4.fuel = 810;
  var PAIR_FORMULA = { "1:8": "H2O", "6:8": "CO2", "6:1": "CH4", "7:1": "NH3", "7:8": "NO2", "16:1": "H2S", "15:1": "PH3" };

  // Atom counts of a formula such as Ca(OH)2 or [Cu(NH3)4]SO4. Returns null for materials with no fixed formula.
  M.atoms = function (f) {
    if (KNOWN[f] && KNOWN[f].alloy) return null;
    var i = 0;
    function group() {
      var out = {};
      while (i < f.length && f[i] !== ")" && f[i] !== "]") {
        var part;
        if (f[i] === "(" || f[i] === "[") { i++; part = group(); i++; }
        else {
          var sym = /^[A-Z][a-z]?/.exec(f.slice(i));
          if (!sym) return null;
          i += sym[0].length; part = {}; part[sym[0]] = 1;
        }
        var num = /^\d+/.exec(f.slice(i)), n = 1;
        if (num) { n = +num[0]; i += num[0].length; }
        for (var k in part) out[k] = (out[k] || 0) + part[k] * n;
      }
      return out;
    }
    return group();
  };
  function massOf(f) {
    var a = M.atoms(f), t = 0;
    if (!a) return 100;
    for (var k in a) { var z = M.byFormula[k]; t += (z ? ELEMENTS[z].m : 12) * a[k]; }
    return t;
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function sub(n) { return n > 1 ? String(n) : ""; }
  function romanOx(q) { return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"][q]; }

  function positiveOx(z) {
    var ox = ELEMENTS[z].ox || [];
    for (var i = 0; i < ox.length; i++) if (ox[i] > 0) return ox[i];
    if (z === 8) return 2;    // OF2 is oxygen's one positive state
    return ELEMENTS[z].E0 != null ? 3 : 0;
  }

  function buildCompound(formula, spec) {
    var known = KNOWN[formula];
    if (M.byFormula[formula] !== undefined) return M.list[M.byFormula[formula]];
    var e = spec.catZ ? ELEMENTS[spec.catZ] : null;
    var dChi = spec.dChi || 0;
    var atoms = spec.atoms || 2;
    var mp, bp, rho, cp, k, col, est = !known;
    // Estimates: ionic lattices melt high, covalent molecules melt low. Oxides are the most refractory.
    if (dChi > 1.2) { mp = 800 + 450 * dChi + (spec.an === "O" ? 500 : 0); bp = mp * 1.5; }
    else if (dChi > 0.5) { mp = 600 + 300 * dChi; bp = mp * 1.35; }
    else { mp = 250 + 150 * dChi; bp = mp * 1.3; }
    rho = spec.M / (atoms * 13) + (e ? Math.min(e.d, 12) * 0.25 : 0.3);
    cp = 25 * atoms / spec.M;
    k = 2;
    col = "#f2f0ec";
    if (e && ION_COL[e.z]) {
      col = ION_COL[e.z];
      if (spec.an === "O") col = "#" + hex(col).map(function (v) { return ("0" + Math.round(v * 0.62).toString(16)).slice(-2); }).join("");
    } else if (e && e.sigma > 0 && spec.an === "O") col = "#e6e2d8";
    if (spec.an === "S") col = "#" + hex(col).map(function (v) { return ("0" + Math.round(v * 0.42).toString(16)).slice(-2); }).join("");
    if (spec.an === "I") col = "#" + hex(col).map(function (v, i) { return ("0" + Math.round(v * (i === 2 ? 0.72 : 0.95)).toString(16)).slice(-2); }).join("");
    var m = {
      id: nextId++, kind: "compound", formula: formula, name: (known && known.name) || spec.name || formula, M: spec.M,
      // A substance that is liquid at room temperature has its liquid density listed. Anything else melts about a tenth lighter.
      rhoS: known ? known.rho : rho, rhoL: known ? (known.rhoL || (known.mp < 293.15 && known.bp > 293.15 ? known.rho : known.rho * 0.9)) : rho * 0.9,
      mp: known ? known.mp : mp, bp: known ? known.bp : bp, cp: known ? known.cp : cp, k: known ? known.k : k, kL: known ? known.kL : undefined,
      hf: known && known.hf ? known.hf : 0.0092 * (known ? known.mp : mp), hv: known && known.hv ? known.hv : 0.088 * (known ? known.bp : bp),
      colS: known ? known.col : col, colL: known && known.colL, colG: known && known.colG, visc: known && known.visc,
      decT: (known && known.decT) || spec.decT || 0, catZ: spec.catZ || 0, an: spec.an, q: spec.q, est: est, noteText: known && known.note,
      acid: known && known.acid, base: spec.an === "OH" && spec.catZ && (ELEMENTS[spec.catZ].cat === "alkali" || ELEMENTS[spec.catZ].cat === "alkaline"),
      dH: spec.dH, gasM: spec.M, fuel: known && known.fuel, Hf: SPECIES_HF[formula], S0: SPECIES_S[formula], isAlloy: !!(known && known.alloy), nc: spec.nc, na: spec.na, pKa: ACID_PKA[formula]
    };
    var solCol = (known && known.colSol) || (e && ION_COL[e.z]) || null;
    m.solutionCol = solCol ? hex(solCol) : null;
    m.soluble = known && known.sol !== undefined ? !!known.sol : (spec.an ? solubility(spec.catZ, spec.an) : false);
    if (SALT_KSP[formula] > 1e-7) m.soluble = true;   // limewater, plaster and lead chloride dissolve a little
    if (m.id >= MAX_MATERIALS) { nextId = MAX_MATERIALS - 1; }
    install(m);
    M.byFormula[formula] = m.id;
    return m;
  }

  // Textbook solubility rules for salts in water.
  function solubility(z, an) {
    var cat = ELEMENTS[z] ? ELEMENTS[z].cat : "";
    if (z === 1) return true;
    if (an === "O" || an === "N" || an === "H" || an === "P") return false;
    if (an === "S") return cat === "alkali" || z === 1;   // these react with water or stay put, rather than dissolve
    if (cat === "alkali") return true;
    if (an === "NO3" || an === "ClO3" || an === "ClO4" || an === "CH3COO" || an === "MnO4" || an === "HCO3" || an === "ClO" || an === "NO2") return z !== 47 || an !== "ClO3";
    if (an === "PO4" || an === "CO3" || an === "CrO4" || an === "Cr2O7" || an === "C2O4" || an === "SO3" || an === "SiO3" || an === "BO3" || an === "P") return an === "Cr2O7" && z !== 47 && z !== 82;
    if (an === "CN" || an === "SCN" || an === "S2O3") return !(z === 47 || z === 82 || z === 80 || z === 29);
    if (an === "Cl" || an === "Br" || an === "I") return !(z === 47 || z === 82 || z === 81);
    if (an === "F") return !(cat === "alkaline" || z === 82);
    if (an === "SO4") return !(z === 56 || z === 82 || z === 38 || z === 88 || z === 20);
    if (an === "OH") return z === 56 || z === 38;
    return false;
  }

  function formulaFor(z, anKey, q) {
    var a = ANIONS[anKey], e = ELEMENTS[z], an = -a.q, g = gcd(q, an), nc = an / g, na = q / g;
    return e.s + sub(nc) + (a.kind === "poly" && na > 1 ? "(" + a.f + ")" + na : a.f + (a.kind === "poly" ? "" : sub(na)));
  }

  // Salt of cation z with an anion key. Formula comes from criss-crossing charges.
  M.salt = function (z, anKey, qOverride) {
    var a = ANIONS[anKey], e = ELEMENTS[z];
    if (!a || !e) return 0;
    var pf = PAIR_FORMULA[z + ":" + (a.z || 0)];
    if (pf && a.kind === "ide" && !qOverride) return M.named(pf);
    var q = qOverride || positiveOx(z);
    if (!q) return 0;
    var an = -a.q, g = gcd(q, an), nc = an / g, na = q / g;
    var af = a.kind === "poly" && na > 1 ? "(" + a.f + ")" + na : a.f + (a.kind === "poly" ? "" : sub(na));
    var f = e.s + sub(nc) + af;
    if (M.byFormula[f] !== undefined) return M.byFormula[f];
    if (locked) return qOverride ? M.salt(z, anKey) : 0;
    if (nextId >= MAX_MATERIALS - 1) return 0;
    var mass = e.m * nc + a.m * na;
    var dChi = a.z ? Math.abs((ELEMENTS[a.z].en || 2) - (e.en || 1.5)) : 1.5 + (2 - (e.en || 1.5));
    var multi = (e.ox || []).filter(function (o) { return o > 0; }).length > 1 && e.cat !== "nonmetal";
    var nm = e.n + (multi ? "(" + romanOx(q) + ")" : "") + " " + a.name;
    var dec = 0;
    // Oxides of noble metals fall apart on mild heating.
    if (e.E0 != null && e.E0 > 0.7 && anKey !== "F") dec = 500 + 200 * Math.max(0, 1.5 - e.E0);
    if (a.kind === "poly" && anKey !== "OH" && anKey !== "CO3") dec = dec || 1000;
    return buildCompound(f, { catZ: z, an: anKey, q: q, M: mass, atoms: nc + na * a.atoms, name: nm, dChi: dChi, decT: dec, nc: nc, na: na }).id;
  };

  // A named species. Salts are recognised by splitting off the cation so they join the generated families; anything else is built as a molecule.
  M.named = function (f) {
    if (M.byFormula[f] !== undefined) return M.byFormula[f];
    if (!KNOWN[f]) return 0;
    var k = KNOWN[f];
    var isPair = Object.keys(PAIR_FORMULA).some(function (p) { return PAIR_FORMULA[p] === f; });
    if (!k.alloy && k.cat === undefined && !isPair && !/^\[|^\(NH4/.test(f)) {
      var parsed = f.match(/^([A-Z][a-z]?)(\d*)/), zz = parsed && M.byFormula[parsed[1]];
      if (zz && zz <= 118) {
        var rest = f.slice(parsed[0].length).replace(/^\((.+)\)\d+$/, "$1");
        var anKey = ANIONS[rest] ? rest : (ANIONS[rest.replace(/\d+$/, "")] ? rest.replace(/\d+$/, "") : null);
        if (anKey) for (var q = 1; q <= 8; q++) {   // find the oxidation state that yields exactly this formula, e.g. UO2 rather than UO3
          if (formulaFor(zz, anKey, q) === f) return M.salt(zz, anKey, q);
        }
      }
    }
    return buildCompound(f, { M: massOf(f), atoms: 3, catZ: k.cat || 0, an: k.an || k.acid, q: k.an && ANIONS[k.an] ? -ANIONS[k.an].q : 0, dChi: 0.8, name: k.name }).id;
  };

  // Resolve one token of an equation: H2, O2, S, P4 and Fe mean the elements, anything else a species or salt.
  M.token = function (t) {
    if (KNOWN[t]) return M.named(t);
    var el = /^([A-Z][a-z]?)(\d*)$/.exec(t);
    if (el && M.byFormula[el[1]] <= 118 && (!el[2] || ELEMENTS[M.byFormula[el[1]]].atoms > 1)) return M.byFormula[el[1]];
    if (M.byFormula[t] !== undefined) return M.byFormula[t];
    // A salt not listed by name: split it and build it from oxidation states.
    var p = /^([A-Z][a-z]?)(\d*)(.*)$/.exec(t);
    if (!p || !M.byFormula[p[1]] || M.byFormula[p[1]] > 118) return 0;
    var z = M.byFormula[p[1]], rest = p[3].replace(/^\((.+)\)\d+$/, "$1"), key = ANIONS[rest] ? rest : (ANIONS[rest.replace(/\d+$/, "")] ? rest.replace(/\d+$/, "") : null);
    if (!key) return 0;
    for (var q = 1; q <= 8; q++) if (formulaFor(z, key, q) === t) return M.salt(z, key, q);
    return 0;
  };

  // Compound of two elements, or 0 when chemistry has no sensible binary. Cation is the less electronegative partner.
  M.binary = function (za, zb) {
    var a = ELEMENTS[za], b = ELEMENTS[zb];
    if (!a || !b) return 0;
    var ena = a.en == null ? 2 : a.en, enb = b.en == null ? 2 : b.en;
    var cat = ena <= enb ? a : b, an = ena <= enb ? b : a;
    var pf = PAIR_FORMULA[cat.z + ":" + an.z] || PAIR_FORMULA[an.z + ":" + cat.z];
    if (pf) return M.named(pf);
    var key = ANION_BY_Z[an.z];
    if (!key) return 0;
    return M.salt(cat.z, key);
  };

  M.anionKeyOf = function (z) { return ANION_BY_Z[z] || null; };

  // How concentrated a water cell can get, on a scale where 1 is a full cell of solute. Sparingly soluble salts saturate early.
  // Solubility as a share of a full cell, from measured mol/L where known, or from the solubility product for sparingly soluble salts.
  M.saturation = function (id) {
    var m = M.list[id];
    if (!m) return 0.8;
    var molL = SALT_SOLUBILITY[m.formula], ksp = SALT_KSP[m.formula];
    if (molL === undefined && ksp !== undefined) molL = M.solubilityFromKsp(m.formula);
    if (molL === undefined) molL = 3;
    return Math.min(1, molL / (M.n0[id] * 1000));
  };
  // s = (Ksp / (x^x y^y))^(1/(x+y)) for a salt that gives x cations and y anions.
  M.solubilityFromKsp = function (formula) {
    var ksp = SALT_KSP[formula], id = M.byFormula[formula], m = M.list[id];
    if (ksp === undefined || !m || !m.nc) return undefined;
    var x = m.nc, y = m.na;
    return Math.pow(ksp / (Math.pow(x, x) * Math.pow(y, y)), 1 / (x + y));
  };
  // Salts with an entry fall out of solution by their ion product. Ones with no entry use the textbook solubility rules, with a generic small Ksp.
  M.ksp = function (id) { var m = M.list[id]; if (!m) return 1; var k = SALT_KSP[m.formula]; return k !== undefined ? k : (m.soluble ? Infinity : 1e-12); };

  // Palette entries shown in the Compounds drawer. Thermite ingredients, salts and acids come first.
  M.PALETTE = ["H2O", "NaCl", "H2SO4", "HCl", "HNO3", "HF", "Fe2O3", "SiO2", "CaCO3", "CO2", "CH4", "NH3", "NaOH", "KOH", "Ca(OH)2", "CaO", "CuSO4", "AgNO3", "Pb(NO3)2", "KI", "NaBr", "Al2O3", "CuCl2", "HgO", "CdS", "HgS", "UO2"];
  M.ensurePalette = function () {
    M.PALETTE.forEach(function (f) {
      if (!M.named(f)) console.warn("Palette compound missing:", f);
    });
  };
  M.ensurePalette();
  // Create every named species, then the database's salts come from reactions.js when it compiles.
  Object.keys(KNOWN).forEach(function (f) { M.named(f); });
  // Water captures 0.66 b per molecule. Raised here because the small grid has far less water between fuel and loss than a real core.
  M.barns[M.byFormula.H2O] = 8;
  // Every thread must agree on material ids, so all compounds are created here, in a fixed order, before anything runs.
  (function pregenerate() {
    for (var z = 1; z <= 103; z++) {
      var e = ELEMENTS[z];
      if (e.cat === "noble") continue;
      var isMetal = e.E0 != null;
      Object.keys(ANIONS).forEach(function (key) {
        var a = ANIONS[key];
        if (a.z === z) return;
        if (!isMetal && z !== 1 && a.kind === "poly") return;
        if (a.z && !isMetal && ena(z) >= ena(a.z)) return;
        M.salt(z, key);
        if (isMetal && (a.kind === "ide" || key === "OH" || key === "SO4" || key === "NO3")) {
          (e.ox || []).filter(function (o) { return o > 0; }).slice(1, 3).forEach(function (q) { M.salt(z, key, q); });
        }
      });
    }
  })();
  function ena(z) { return ELEMENTS[z].en == null ? 2 : ELEMENTS[z].en; }

  // ---- Flow, expansion, strength and vapour. Tables hold reference values. Everything else comes from the rule beside it, so these are estimates. ----
  // Viscosity: mPa s at a temperature in K, with an Andrade activation energy in kJ/mol.
  var VISCOSITY = {
    H2O: [1.0, 293, 15], H2O2: [1.25, 293, 16], HCl: [1.9, 293, 12], HF: [1, 293, 10], H2SO4: [25, 293, 25], HNO3: [0.88, 293, 11], H3PO4: [147, 315, 30], CH3COOH: [1.2, 293, 11], NH3: [0.27, 240, 8],
    CH3OH: [0.59, 293, 11], C2H5OH: [1.2, 293, 13], C3H7OH: [2.4, 293, 18], C3H8O3: [1412, 293, 52], C2H6O2: [21, 293, 28], CH3COCH3: [0.32, 293, 7], C2H5OC2H5: [0.23, 293, 7], C6H6: [0.65, 293, 11], C7H8: [0.59, 293, 9],
    C8H18: [0.54, 293, 9.5], C12H26: [1.5, 293, 14], CCl4: [0.97, 293, 11], CHCl3: [0.56, 293, 8], CS2: [0.37, 293, 6], C3H5N3O9: [36, 293, 35], C6H5OH: [11, 318, 22],
    SiO2: [3.2e7, 2273, 520], B2O3: [3e4, 1273, 150], P2O5: [5e7, 613, 100], GeO2: [1e7, 1873, 300], Al2O3: [30, 2345, 120], NaCl: [1.03, 1100, 37], KCl: [1.1, 1043, 30],
    N: [0.16, 77, 1.5], O: [0.2, 90, 1.5], Ar: [0.26, 87, 2], Br: [0.95, 293, 8], Hg: [1.55, 293, 2.5], S: [10, 400, 15], Na: [0.7, 371, 6], K: [0.54, 337, 5], Li: [0.6, 454, 5], Fe: [6, 1811, 41], Al: [1.3, 933, 16],
    Cu: [4.3, 1358, 30], Pb: [2.65, 601, 9], Sn: [1.85, 505, 6], Zn: [3.5, 693, 13], Ag: [3.9, 1235, 22], Au: [5, 1337, 16], Ga: [2, 303, 4]
  };
  // Surface tension in N/m.
  var TENSION = { H2O: 0.072, Hg: 0.485, C2H5OH: 0.022, CH3OH: 0.023, C3H7OH: 0.021, CH3COCH3: 0.023, C3H8O3: 0.063, C2H6O2: 0.048, C6H6: 0.029, C8H18: 0.022, C12H26: 0.025, CCl4: 0.027, H2SO4: 0.055, N: 0.009, O: 0.013, Br: 0.041, Ga: 0.72, Fe: 1.87, Al: 0.87, Cu: 1.3, Pb: 0.46, Sn: 0.56, Zn: 0.78, Ag: 0.93, Au: 1.14, Na: 0.2, K: 0.11 };
  var POLAR = ["H2O", "H2O2", "HCl", "HF", "HBr", "HI", "H2SO4", "HNO3", "H3PO4", "C3H8O3", "C2H6O2", "NH3"];
  var AMPHIPHILIC = ["CH3OH", "C2H5OH", "C3H7OH", "CH3COCH3", "CH3COOH"];   // these mix with water and with oils
  var NONPOLAR = ["CCl4", "CS2", "CHCl3", "C2H5OC2H5", "C6H5Cl", "C6H5Br"];
  // Tensile strength in MPa. Nothing in a chamber this small could load a real cross-section to failure, so the structure code scales these down.
  var STRENGTH = { Fe: 350, Cu: 220, Al: 90, Ti: 400, W: 1500, Au: 120, Ag: 170, Pb: 18, Sn: 15, Zn: 100, Ni: 400, Cr: 300, Mg: 200, Na: 1, K: 0.5, Li: 1, Steel: 400, StainlessSteel: 500, Brass: 350, Bronze: 300, H2O: 1, SiO2: 50, Si: 100, C: 30 };
  // Heat of solution in kJ/mol at infinite dilution. Positive takes heat in, which is what makes a cold pack cold.
  var SOLUTION_HEAT = { NaOH: -44.5, KOH: -57.6, LiOH: -23.6, HCl: -74.8, H2SO4: -95.3, HNO3: -33.3, H3PO4: -11.7, CH3COOH: -1.5, NH3: -30.5, NaCl: 3.9, KCl: 17.2, KBr: 19.9, KI: 20.3, NaBr: -0.6, NaI: -7.5, LiCl: -37, NH4NO3: 25.7, NH4Cl: 14.8, KNO3: 34.9, NaNO3: 20.5, Na2SO4: -2.4, Na2CO3: -26.7, NaHCO3: 16.7, CaCl2: -81.3, MgCl2: -160, MgSO4: -91.2, CuSO4: -73.3, AgNO3: 22.6, "Ca(OH)2": -16.7, KClO3: 41.4, "(NH4)2SO4": 6.6, CH4N2O: 15.4, FeCl3: -151, CuCl2: -51.6 };
  // Heat of vaporisation in kJ/mol, for liquids held together by hydrogen bonds. Trouton's rule falls well short for these.
  var VAPOUR_HEAT = { CH3OH: 35.2, C2H5OH: 38.6, C3H7OH: 39.9, C3H8O3: 91.7, C2H6O2: 52.2, H2O2: 48.5 };
  // Critical temperatures in K. Otherwise Guldberg's rule: a liquid boils at about two thirds of its critical temperature.
  var CRITICAL = { H2O: 647, CO2: 304, N: 126, O: 155, H: 33, He: 5.2, Ne: 44, Ar: 151, Kr: 209, Xe: 290, NH3: 405, CH4: 190.6, C2H5OH: 514, CH3OH: 513, Hg: 1750, Cl: 417, Br: 588 };
  function fromList(ids) { var out = {}; ids.forEach(function (f) { out[f] = 1; }); return out; }
  // Viscosity is compressed the same way everywhere: thin water at 0.03, and each factor of ten adds 0.157. log(mu) is linear in 1/T, so the compressed value is too.
  function setViscosity(id, mu, T0, E) {
    var slope = 0.157 * E * 1000 / (Math.LN10 * 8.314);
    M.viscB[id] = slope; M.viscA[id] = 0.03 + 0.157 * Math.log10(mu) - slope / T0;
    M.visc[id] = Math.max(0.005, Math.min(0.98, M.viscA[id] + M.viscB[id] / Math.max(T0, 293)));
  }
  // Pilling-Bedworth ratio: oxide volume over the metal it replaced. Near 1 to 2 the scale holds on and protects. Outside that it cracks or flakes.
  M.pilling = function (z, ox) { var o = M.list[ox], e = M.list[z]; return o.M * e.rhoS / ((o.nc || 1) * e.M * o.rhoS); };
  function finishPhysics() {
    var polar = fromList(POLAR), amphi = fromList(AMPHIPHILIC), nonpolar = fromList(NONPOLAR), R = 8.314e-3;
    for (var id = 1; id < nextId; id++) {
      var m = M.list[id];
      if (!m) continue;
      var f = m.formula, metal = id <= 118 ? ELEMENTS[id].sigma > 0.3 : !!m.isAlloy, salt = id > 118 && m.catZ > 1 && !!m.an, oxide = salt && m.an === "O", bp = M.bp[id], mp = M.mp[id], hv = VAPOUR_HEAT[f] || m.hv || 0.088 * Math.min(bp, 6000);
      var at = id > 118 && !m.isAlloy ? M.atoms(f) : null, keys = at ? Object.keys(at) : [], hydrocarbon = keys.length > 0 && keys.every(function (k) { return k === "C" || k === "H"; }), organic = at && at.C && at.H;
      // Viscosity: listed, or Andrade's melting-point formula for metals, ionic melts near their melting point, and Eyring's rule for molecules, thin at the boiling point with an activation energy of 0.4 of the heat of vaporisation.
      var vis = VISCOSITY[f], Tm = mp > 0 ? mp : Math.min(bp, 300);
      if (vis) setViscosity(id, vis[0], vis[1], vis[2]);
      else if (metal) { var V = m.M / Math.max(m.rhoL, 0.1); setViscosity(id, 0.075 * Math.sqrt(m.M * Tm) / Math.pow(V, 2 / 3), Tm, 2.2 * R * Tm); }
      else if (salt) setViscosity(id, oxide ? 30 : 2, Tm, (oxide ? 3 : 2.5) * R * Tm);
      else setViscosity(id, 0.3, Math.min(bp, 6000), 0.4 * hv);
      // Thermal expansion. Liquids follow the boiling point, solids Gruneisen's rule. Density data is for the melt near freezing, or for room temperature, or at boiling for cryogens.
      var bL = bp < 1e8 ? 0.25 / bp : 2e-4;
      M.betaL[id] = f === "Hg" ? 1.82e-4 : (f === "C2H5OH" ? 1.09e-3 : Math.max(1e-4, Math.min(2e-3, bL)));
      M.betaS[id] = mp > 0 ? Math.min(3e-4, 0.06 / mp) : 0;
      M.rhoT[id] = bp < 293 ? bp : Math.max(293, mp);
      M.tension[id] = TENSION[f] || (metal ? 0.5 : (salt ? 0.12 : 0.03));
      M.pol[id] = polar[f] ? 1 : (amphi[f] ? 5 : (hydrocarbon || nonpolar[f] ? 2 : (metal ? 3 : (salt ? 4 : 0))));
      // Tangent of the angle of repose: rounded metal grains run freely, angular oxides and organic crystals lock together.
      M.repose[id] = f === "H2O" ? 0.55 : (metal ? 0.62 : (f === "SiO2" ? 0.75 : (oxide ? 1 : (organic ? 1.2 : (salt ? 0.8 : 0.8)))));
      var noble = f === "Au" || f === "Ag" || f === "Pt" || f === "Cu" || f === "Al";
      M.emiss[id] = noble ? 0.05 : (metal ? 0.25 : (f === "C" ? 0.9 : 0.8));
      M.uts[id] = STRENGTH[f] || (metal ? Math.max(1, 0.1 * Tm) : (oxide ? 30 : (salt ? 5 : (organic ? 5 : 10))));
      M.brittle[id] = metal ? 0 : 1;
      M.hsol[id] = SOLUTION_HEAT[f] || 0;
      if (oxide && m.catZ <= 118 && ELEMENTS[m.catZ].sigma > 0.3) { var pb = M.pilling(m.catZ, id); M.flaky[id] = pb < 1 || pb > 2 ? 1 : 0; }
      M.crit[id] = CRITICAL[f] || (bp < 1e8 ? bp * 1.5 : 1e9);
      // Vapour pressure relative to 1 atm by Clausius-Clapeyron. Acid entries stand for strong water solutions, which hold most of their vapour back.
      M.satK[id] = hv / R; M.satA[id] = m.acid ? 0.1 : 1;
      // Boiling point at 1 kPa, the pressure of the pumped-out chamber: ln(1 kPa / 1 atm) is -4.6.
      M.bpVac[id] = bp < 1e8 ? 1 / (1 / bp + R * 4.6 / hv) : bp;
      // Clapeyron: dT/dP = T dV / dH, in K per kPa. Negative for anything that expands as it freezes, like water.
      if (mp > 0 && m.hf && m.rhoS > 0 && m.rhoL > 0) M.dTm[id] = 1e-6 * mp * m.M * (1 / m.rhoL - 1 / m.rhoS) / m.hf;
    }
  }
  M.miscible = function (a, b) { var p = M.pol[a], q = M.pol[b]; return p !== 0 && q !== 0 && (p === q || (p === 5 && q <= 2) || (q === 5 && p <= 2)); };

  var locked = false;
  M.lock = function () { locked = true; finishPhysics(); };
  M.count = function () { return nextId; };
  return M;
})();
if (typeof module !== "undefined") module.exports = Mat;
