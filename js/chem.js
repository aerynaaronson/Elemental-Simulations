// Reaction engine. Three layers, checked in order for each pair of touching cells:
//   1. The reaction database in reactions.js: balanced equations with conditions and thermochemistry.
//   2. Generated families: acid + base, acid + carbonate, oxide + acid, sulfide roasting, hydride + water and so on, for every metal.
//   3. Rules from periodic trends: electronegativity, electrode potential, ionisation energy and ignition point.
// Rules are derived on demand and cached per pair, so every thread builds an identical table without sharing one.
var Chem = (function (Math, Mat, ELEMENTS, MAX_MATERIALS, AIR, FLAME, WALL, ELECTRODE, P_STATIC, P_POWDER, P_LIQUID, P_GAS, REACTIONS) {
  var C = { database: [], invalid: [] };
  var S, W, WD, ID, PH, T, AUX, CH, PR, USED, AUX2, U2, P;
  var SMOKE = 122;
  var RULES = new Array(MAX_MATERIALS);   // per material: -1 unknown, 0 none, n rule index
  var list = [null];
  var EXP = {};       // explicit rules: "a,b" -> first rule in a chain
  var UNI = {};       // explicit one-reactant rules by material id
  var UNIC = new Array(MAX_MATERIALS);
  var dirs;
  var FLAME_CAP = 3600;
  // Moles of oxygen atoms one air cell stands for. Gas cells hold far more than real gas does, so a fire needs a few air cells per fuel cell, not thousands. Combustion stops once the air is this far depleted.
  var AIR_OXYGEN = 0.06, SMOTHERED = 0.7;

  C.bind = function (sim) {
    S = sim; W = S.W; WD = S.W * S.D; ID = S.ID; PH = S.PH; T = S.T; AUX = S.AUX; CH = S.CH; PR = S.PR; USED = S.USED; AUX2 = S.AUX2; U2 = S.U2; P = S.P;
    dirs = [1, -1, W, -W, WD, -WD];
  };

  var mol = Mat.named, H2O = mol("H2O"), CO2 = mol("CO2"), NH3 = mol("NH3"), NO2 = mol("NO2"), SO2 = mol("SO2"), SO3 = mol("SO3"), HCl = mol("HCl"), HNO3 = mol("HNO3"), H2SO4 = mol("H2SO4"), SiO2 = mol("SiO2");
  var H2S = mol("H2S"), NO = mol("NO"), HCN = mol("HCN"), ACETIC = mol("CH3COOH"), CO = mol("CO"), PH3 = mol("PH3");

  function E(z) { return ELEMENTS[z]; }
  function isMetal(z) { var e = E(z); return e && e.E0 != null; }
  function en(z) { var e = E(z); return e && e.en != null ? e.en : 2; }
  function pf(id) { return Mat.pretty(Mat.list[id].formula); }

  // Kelvin rise per cell from a reaction enthalpy, over a typical molar heat capacity. The 0.25 accounts for heat lost to dissociation
  // and surroundings, which gets flame temperatures close to measured ones: methane in air near 2200 K.
  function heatFromEnthalpy(dH, moles) { return Math.max(-400, Math.min(3200, -dH * 1000 / (Math.max(moles, 1) * 35) * 0.25)); }

  // Pauling's bond-energy relation: an ionic bond is stabilised by about 96.5 kJ/mol times the electronegativity gap squared.
  function paulingHeat(za, zb, bonds) {
    var d = Math.abs(en(za) - en(zb));
    return Math.min(96.5 * d * d * (bonds || 1) * 1000 / 70 * 0.45, 3200);
  }

  function add(rule) { list.push(rule); return list.length - 1; }

  // ---- Layer 1: the database ----
  function parseSide(side) {
    return side.split(" + ").map(function (term) {
      var m = /^(\d+)?\s*(.+)$/.exec(term.trim());
      var id = Mat.token(m[2]), n = m[1] ? +m[1] : 1, el = id <= 118 ? /\d+$/.exec(m[2]) : null;
      // Amounts work in atoms for elements, so H2, S and P4 are all on the same scale as a cell of that element.
      return { n: n, f: m[2], id: id, mol: n * (el ? +el[0] : 1) };
    });
  }
  function hfOf(term) {
    var id = term.id;
    if (id <= 118) return 0;
    var v = Mat.list[id].Hf;
    return v === undefined ? null : v;
  }

  function S_phase(id, t) { return id > AIR && Mat.bp[id] <= t; }
  // Equilibrium constant term of a reaction at temperature T. Returns the share of events that go forward: K / (1 + K), with pressure shifting K by Le Chatelier.
  function thermo(r, T, p) {
    if (r.dS === null || r.dS === undefined) return 1;
    var dG = r.dH * 1000 - T * r.dS;
    // Water's table values are for the liquid. Above its boiling point it is steam, 44 kJ/mol less stable and 118.9 J/mol/K higher in entropy.
    if (r.waterN && T > 373) dG += r.waterN * (44000 - T * 118.9);
    var lnK = -dG / (8.314 * (T > 1 ? T : 1));
    if (r.dn && p > 1) lnK -= r.dn * Math.log(1 + p / 100);
    if (lnK > 12) return 1;
    if (lnK < -12) return 0;
    var K = Math.exp(lnK);
    return K / (1 + K);
  }
  // Arrhenius rate relative to the reaction's onset temperature. The activation energy is derived: about 20 RT at onset. Reactions with no onset follow a gentler rule.
  function arrhenius(minT, T) {
    if (!minT) { if (T >= 293) { var a = Math.exp(6 * (1 - 293 / T)); return a > 3 ? 3 : a; } return Math.exp(6 * (1 - 293 / T)); }
    var f = Math.exp(20 * (1 - minT / T));
    return f > 3 ? 3 : f;
  }
  C.thermo = thermo; C.arrhenius = arrhenius;
  C.gibbs = function (d, T) { return d.dS === null || d.dH === null ? null : d.dH - T * d.dS / 1000; };

  // Balance an equation from its formulas with a small exact-ish linear solve. Returns coefficients for [left..., right...] in atom-scaled units, or null.
  function balance(left, right) {
    var ids = left.concat(right), atoms = ids.map(function (id) { var m = Mat.list[id]; return id <= 118 ? (function () { var o = {}; o[ELEMENTS[id].s] = 1; return o; })() : (m.isAlloy ? null : Mat.atoms(m.formula)); });
    if (atoms.some(function (a) { return !a; })) return null;
    var syms = {}; atoms.forEach(function (a) { for (var k in a) syms[k] = 1; });
    var rows = Object.keys(syms).map(function (k) { return atoms.map(function (a, c) { return (a[k] || 0) * (c < left.length ? 1 : -1); }); });
    var n = ids.length, pivot = [], row = 0;
    for (var col = 0; col < n && row < rows.length; col++) {
      var best = row;
      for (var q = row; q < rows.length; q++) if (Math.abs(rows[q][col]) > Math.abs(rows[best][col])) best = q;
      if (Math.abs(rows[best][col]) < 1e-9) continue;
      var tmp = rows[row]; rows[row] = rows[best]; rows[best] = tmp;
      var pv = rows[row][col];
      for (var j2 = 0; j2 < n; j2++) rows[row][j2] /= pv;
      for (q = 0; q < rows.length; q++) if (q !== row) { var fct = rows[q][col]; if (fct) for (j2 = 0; j2 < n; j2++) rows[q][j2] -= fct * rows[row][j2]; }
      pivot.push(col); row++;
    }
    if (pivot.length !== n - 1) return null;   // no unique balance
    var free = 0; while (pivot.indexOf(free) >= 0) free++;
    var x = new Array(n); x[free] = 1;
    pivot.forEach(function (pc, ri) { x[pc] = -rows[ri][free]; });
    if (x.some(function (v) { return v <= 1e-9; })) return null;
    for (var m2 = 1; m2 <= 120; m2++) if (x.every(function (v) { return Math.abs(v * m2 - Math.round(v * m2)) < 1e-6; })) return x.map(function (v) { return Math.round(v * m2); });
    return null;
  }
  C.balance = balance;
  // Give a generated rule true amounts by balancing what it reacts and what it makes.
  function finalize(r, a, b) {
    if (r.prods) return r;
    var R = [];
    if (r.a) R.push(r.a);
    if (r.b && r.b !== r.a) R.push(r.b);
    if (r.rest) r.rest.forEach(function (x) { if (R.indexOf(x) < 0) R.push(x); });
    var L = [a, b === AIR ? 8 : b];
    var co = balance(L, R);
    if (co) {
      r.nA = co[0]; r.nB = co[1]; r.prods = R.map(function (id, k) { return { id: id, n: co[k + 2] }; });
    } else {
      r.prods = R.map(function (id) { return { id: id, n: 1 }; });
    }
    return r;
  }

  function compile(entry) {
    var parts = entry.eq.split(" -> ");
    var L = parseSide(parts[0]), R = parseSide(parts[1]), o = entry.o;
    var missing = L.concat(R).filter(function (t) { return !t.id; }).map(function (t) { return t.f; });
    if (missing.length) { C.invalid.push(entry.eq + " (unknown: " + missing.join(", ") + ")"); return null; }
    var dH = 0, known = true;
    L.forEach(function (t) { var h = hfOf(t); if (h === null) known = false; else dH -= h * t.n; });
    R.forEach(function (t) { var h = hfOf(t); if (h === null) known = false; else dH += h * t.n; });
    // Entropy of reaction, for Gibbs energy. Only when every species has a measured value. Light and current supply outside energy, so they are exempt.
    // Equations marked nothermo happen in solution, where the tabulated gas or pure-liquid values for the acids would mislead.
    var dS = 0, entropyKnown = known && !o.light && !o.elec && !o.nothermo;
    var waterN = 0;
    L.forEach(function (t) { if (t.id === H2O) waterN -= t.n; }); R.forEach(function (t) { if (t.id === H2O) waterN += t.n; });
    function entropy(t, sign) { var v = t.id <= 118 ? ELEMENT_S[t.id] : Mat.list[t.id].S0; if (v === undefined) entropyKnown = false; else dS += sign * v * t.mol; }
    L.forEach(function (t) { entropy(t, -1); }); R.forEach(function (t) { entropy(t, 1); });
    var gasAt = o.T || 293, dn = 0;
    L.forEach(function (t) { if (S_phase(t.id, gasAt)) dn -= t.n; }); R.forEach(function (t) { if (S_phase(t.id, gasAt)) dn += t.n; });
    var moles = R.reduce(function (a, t) { return a + t.n; }, 0);
    var heat = o.h !== undefined ? o.h : (known ? heatFromEnthalpy(dH, moles) : 40);
    return {
      eq: entry.eq, group: entry.group, msg: Mat.pretty(entry.eq).replace(" -> ", " → "), L: L, R: R, dH: known ? dH : null, dS: entropyKnown ? dS : null, dn: dn, rev: !!o.rev, waterN: waterN,
      p: o.p || 0.1, minT: o.T || 0, maxT: o.Tmax || 0, cat: o.cat ? Mat.token(o.cat) : 0, light: !!o.light, elec: !!o.elec, liq: !!o.liq,
      heat: heat, flame: o.fl ? Mat.token(o.fl) : 0, alwaysFlame: !!o.flame, violent: o.v || 0, cap: o.cap || (entry.group === "Thermite and metal reduction" ? 2900 : undefined)
    };
  }

  // Rules for one pair are tried in order: catalysed routes first, then the hottest route that the temperature allows.
  // Routes with identical conditions take turns, since both happen in reality.
  function rank(r) { return (r.cat ? 1e6 : 0) + (r.need && r.need.length ? 5e5 : 0) + (r.minT || 0); }
  function chain(key, rule) {
    var head = EXP[key];
    if (!head || rank(rule) > rank(head)) { rule.alt = head || null; EXP[key] = rule; markSplit(rule); return; }
    var r = head;
    while (r.alt && rank(r.alt) >= rank(rule)) r = r.alt;
    rule.alt = r.alt; r.alt = rule;
    markSplit(r); markSplit(rule);
  }
  function markSplit(r) {
    var n = r.alt;
    r.split = !!(n && n.minT === r.minT && n.maxT === r.maxT && n.cat === r.cat && n.light === r.light && n.elec === r.elec && n.liq === r.liq);
  }

  function register(c) {
    C.database.push(c);
    if (c.L.length === 1) {
      var u = { eq: c.eq, group: c.group, msg: c.msg, p: c.p, minT: c.minT, maxT: c.maxT, cat: c.cat, light: c.light, elec: c.elec, heat: c.heat, flame: c.flame, violent: c.violent, products: c.R.map(function (t) { return t.id; }), nA: c.L[0].mol, prods: c.R.map(function (t) { return { id: t.id, n: t.mol }; }), dH: c.dH, dS: c.dS, dn: c.dn, waterN: c.waterN };
      c.uni = u;
      (UNI[c.L[0].id] = UNI[c.L[0].id] || []).push(u);
      return;
    }
    var a = c.L[0].id, b = c.L[1].id, extra = c.L.slice(2).map(function (t) { return t.id; });
    var p1 = c.R[0].id, p2 = c.R[1] ? c.R[1].id : (c.R[0].n >= 2 ? c.R[0].id : AIR);
    var rest = c.R.slice(2).map(function (t) { return t.id; });
    // Products in the order they should fill cells, with their coefficients, so each event uses and makes the right amounts.
    function prodList(mirror) {
      var out = c.R.map(function (t) { return { id: t.id, n: t.mol }; });
      if (mirror && out.length > 1) { var f = out[0]; out[0] = out[1]; out[1] = f; }
      return out;
    }
    function make(pa, pb, air, mirror) {
      return { eq: c.eq, group: c.group, msg: c.msg, p: c.p, minT: c.minT, maxT: c.maxT, cat: c.cat, light: c.light, elec: c.elec, liq: c.liq, heat: c.heat, flame: c.flame, alwaysFlame: c.alwaysFlame, violent: air ? 0 : c.violent, a: pa, b: pb, rest: rest, need: extra, air: air, cap: c.cap, nA: mirror ? c.L[1].mol : c.L[0].mol, nB: mirror ? c.L[0].mol : c.L[1].mol, prods: prodList(mirror), dH: c.dH, dS: c.dS, dn: c.dn, waterN: c.waterN };
    }
    chain(a + "," + b, make(p1, p2, false));
    if (a !== b) chain(b + "," + a, make(p2, p1, false, true));
    // Oxygen in the air can stand in for an oxygen cell, and the second product is pushed out into a neighbouring cell.
    if (b === 8 || a === 8) {
      var fuel = b === 8 ? a : b;
      var air = make(p1, AIR, true, false);
      if (a === 8) { air.nA = c.L[1].mol; }
      air.p = c.p * 0.6;
      air.cap = c.cap || 2300;
      chain(fuel + ",air", air);
    }
  }

  // Burning of every species marked as a fuel, balanced from its formula.
  function fuelEquations() {
    Mat.list.forEach(function (m) {
      if (!m || !m.fuel || m.isAlloy) return;
      var at = Mat.atoms(m.formula);
      if (!at) return;
      for (var q in at) if ("CHONS".indexOf(q) < 0) return;
      var c = at.C || 0, h = at.H || 0, o = at.O || 0, n = at.N || 0, s = at.S || 0;
      var o2 = c + h / 4 - o / 2 + s, k = 1;
      for (k = 1; k <= 8; k++) { if (Number.isInteger(o2 * k) && Number.isInteger(h * k / 2) && Number.isInteger(n * k / 2)) break; }
      if (o2 <= 0 || !Number.isInteger(o2 * k)) return;
      if (C.database.some(function (d) { return d.L.length === 2 && d.L[0].id === m.id && d.L[1].id === 8; })) return;
      var out = [];
      if (c) out.push((c * k > 1 ? c * k : "") + "CO2");
      if (h) out.push((h * k / 2 > 1 ? h * k / 2 : "") + "H2O");
      if (s) out.push((s * k > 1 ? s * k : "") + "SO2");
      if (n) out.push((n * k / 2 > 1 ? n * k / 2 : "") + "N2");
      var eq = (k > 1 ? k : "") + m.formula + " + " + (o2 * k > 1 ? o2 * k : "") + "O2 -> " + out.join(" + ");
      var c2 = compile({ group: "Combustion and oxidation", eq: eq, o: { T: m.fuel, p: 0.3, fl: "C" } });
      if (c2) register(c2);
    });
  }

  // A reversible equation also registers its reverse, which runs at the same temperature and gets the other share of events.
  function reversed(c) {
    var msg = c.msg.split(" → ").reverse().join(" ⇌ ");
    return { eq: c.eq.split(" -> ").reverse().join(" -> "), group: c.group, msg: msg, L: c.R, R: c.L, dH: c.dH === null ? null : -c.dH, dS: c.dS === null ? null : -c.dS, dn: -c.dn, rev: true, reverse: true, waterN: -c.waterN,
      p: c.p, minT: c.minT, maxT: c.maxT, cat: c.cat, light: false, elec: false, liq: false, heat: Math.max(-300, -c.heat), flame: 0, alwaysFlame: false, violent: 0 };
  }
  REACTIONS.forEach(function (e) {
    var c = compile(e);
    if (!c) return;
    if (c.rev) c.msg = c.msg.replace(" → ", " ⇌ ");
    register(c);
    if (c.rev) register(reversed(c));
  });
  fuelEquations();

  // ---- Layers 2 and 3: generated rules ----
  var FACTOR = { 8: 1, 9: 0.02, 17: 0.55, 35: 0.7, 53: 0.85, 16: 0.85 };
  var STRONG_ACIDS = {};
  [HCl, HNO3, H2SO4, mol("HBr"), mol("HI"), mol("HClO4")].forEach(function (id) { STRONG_ACIDS[id] = true; });
  var VOLATILE_ACID = { Cl: "HCl", Br: "HBr", I: "HI", F: "HF", NO3: "HNO3" };

  function deriveElementPair(a, b) {
    var ea = E(a), eb = E(b);
    if (a === b) return null;
    if (ea.cat === "noble" || eb.cat === "noble") return null;   // all known noble gas compounds are in the database
    if (ea.z > 103 || eb.z > 103) return null;
    if (en(a) >= en(b)) return null;
    if (eb.z === 1) {   // saline hydrides
      if (ea.cat === "alkali" || ea.cat === "alkaline") { var hy = Mat.salt(a, "H"); return hy ? { p: 0.02, minT: 620, a: hy, b: AIR, heat: 90, msg: ea.s + " + H₂ → " + pf(hy) } : null; }
      return null;
    }
    if (eb.z === 7) {   // only strong reductants make nitrides
      if (a !== 12 && a !== 20 && a !== 22 && a !== 13 && a !== 5 && a !== 38 && a !== 56 && ea.cat !== "lanthanide") return null;
      var ni = Mat.salt(a, "N");
      return ni ? { p: 0.05, minT: 1300, a: ni, b: AIR, heat: 200, flame: a, msg: ea.s + " + N₂ → " + pf(ni) } : null;
    }
    if (eb.z === 15) {   // phosphides of active metals
      if (!isMetal(a) || ea.E0 > -1) return null;
      var ph = Mat.salt(a, "P");
      return ph ? { p: 0.1, minT: 900, a: ph, b: AIR, heat: 150, msg: ea.s + " + P → " + pf(ph) } : null;
    }
    var f = FACTOR[eb.z];
    if (f === undefined) return null;
    if (en(b) - en(a) < 0.25) return null;
    // Nonmetal pairs only form the compounds actually known to exist, and those are in the database.
    if (!isMetal(a) && a !== 5 && a !== 14 && a !== 15 && a !== 33 && a !== 34 && a !== 52) return null;
    var base = ea.ign;
    if (b === 8 && !base) return null;                        // gold, platinum and friends do not burn
    if (!base) base = isMetal(a) ? 800 : 600;
    var product = Mat.binary(a, b);
    if (!product) return null;
    var charge = Mat.list[product].q || 2;
    return {
      p: b === 9 ? 0.5 : 0.15, minT: base * f, a: product, b: AIR, heat: paulingHeat(a, b, charge),
      flame: a, violent: ea.cat === "alkali" && b !== 8 ? 0.4 : 0,
      msg: ea.s + " + " + Mat.pretty(eb.s + (eb.atoms > 1 ? eb.atoms : "")) + " → " + pf(product)
    };
  }

  function deriveMetalWater(a) {
    var e = E(a), E0 = e.E0;
    if (E0 == null) return null;
    if (e.cat === "alkali" || (e.cat === "alkaline" && a !== 4 && a !== 12)) {
      var rate = Math.min(0.9, 0.012 * Math.exp((5.4 - e.ie) * 2.4));
      if (e.cat === "alkaline") rate = Math.min(rate, 0.03);
      var hyd = Mat.salt(a, "OH");
      return hyd ? { p: rate, minT: 0, a: hyd, b: 1, heat: Math.max(30, (5.6 - e.ie) * 200), flame: e.ie < 5.2 ? a : 0, alwaysFlame: e.ie < 4.5, violent: e.ie < 4.0 ? 1 : (e.ie < 4.25 ? 0.7 : 0), msg: e.s + " + H₂O → " + pf(hyd) + " + H₂" } : null;
    }
    if ((e.cat === "lanthanide" || e.cat === "actinide") && E0 < -1.9) { var ho = Mat.salt(a, "OH"); return ho ? { p: 0.003, minT: 0, a: ho, b: 1, heat: 60, msg: e.s + " + H₂O → " + pf(ho) + " + H₂ (slow)" } : null; }
    if (E0 < 0) {   // hot metal strips oxygen from steam, which is why water cannot put out a magnesium fire
      var oxi = Mat.salt(a, "O");
      return oxi ? { p: 0.08, minT: E0 < -2 ? 600 : (E0 < -1 ? 950 : 1000), a: oxi, b: 1, heat: paulingHeat(a, 8, 2) * 0.3, flame: E0 < -2 ? a : 0, msg: e.s + " + H₂O(g) → " + pf(oxi) + " + H₂" } : null;
    }
    return null;
  }

  function deriveMetalCompound(a, b) {
    var e = E(a), m = Mat.list[b];
    if (b === H2O) return deriveMetalWater(a);
    if (m.acid && e.E0 != null) {
      if (b === HNO3) {   // nitric acid oxidises through nitrogen, so it attacks metals below hydrogen too
        if (e.E0 < 1.0) { var nit = Mat.salt(a, "NO3"); return nit ? { p: 0.1, minT: 0, a: nit, b: NO2, heat: 40, msg: e.s + " + HNO₃ → " + pf(nit) + " + NO₂" } : null; }
        return null;
      }
      if (e.E0 < 0 && m.an) {
        var salt = Mat.salt(a, m.an);
        if (!salt) return null;
        return { p: Math.min(0.5, (STRONG_ACIDS[b] ? 0.02 : 0.005) + (STRONG_ACIDS[b] ? 0.08 : 0.02) * -e.E0), minT: 0, a: salt, b: 1, heat: 30 + 30 * -e.E0, msg: e.s + " + " + pf(b) + " → " + pf(salt) + " + H₂" };
      }
      return null;
    }
    // A more active metal takes the anion from a less active one.
    if (m.catZ && m.an && m.catZ > 1 && E(m.catZ) && E(m.catZ).E0 != null && e.E0 != null && e.E0 < E(m.catZ).E0 - 0.3) {
      var prod = Mat.salt(a, m.an), gap = E(m.catZ).E0 - e.E0, oxide = m.an === "O";
      if (!prod) return null;
      var heat = oxide ? Math.min(1500, 380 * gap * (m.q || 2)) : 120 * gap, ms = e.s + " + " + pf(b) + " → " + pf(prod) + " + " + E(m.catZ).s;
      if (m.an === "O" || m.an === "S") return { p: 0.6, minT: oxide ? 1100 : 800, a: prod, b: m.catZ, heat: heat, flame: a, cap: 2900, msg: ms };
      return { p: 0.2, minT: 500, a: prod, b: m.catZ, heat: heat, msg: ms };
    }
    return null;
  }

  function deriveNonmetalCompound(a, b) {
    var m = Mat.list[b];
    // Halogen displacement: F2 > Cl2 > Br2 > I2.
    var ha = Mat.anionKeyOf(a);
    if (ha && m.an && (m.an === "Cl" || m.an === "Br" || m.an === "I" || m.an === "F") && (a === 9 || a === 17 || a === 35 || a === 53)) {
      var anz = Mat.ANIONS[m.an].z;
      if (en(a) > en(anz) + 0.2 && m.catZ > 1) {
        var p = Mat.salt(m.catZ, ha);
        return p ? { p: 0.25, minT: 0, a: p, b: anz, heat: 40, msg: E(a).s + "₂ + " + pf(b) + " → " + pf(p) + " + " + E(anz).s + "₂" } : null;
      }
    }
    if (a === 8 && m.an === "S" && m.catZ > 1) { var ox = Mat.salt(m.catZ, "O"); return ox ? { p: 0.1, minT: 800, a: ox, b: SO2, heat: 200, msg: pf(b) + " + O₂ → " + pf(ox) + " + SO₂ (roasting)" } : null; }
    // Carbon smelts oxides of metals that are not too active. Hydrogen reduces the easy ones.
    if (a === 6 && m.an === "O" && m.catZ > 1 && E(m.catZ).E0 != null && E(m.catZ).E0 > -1.3) return { p: 0.1, minT: 1100, a: CO2, b: m.catZ, heat: 30, msg: "C + " + pf(b) + " → " + E(m.catZ).s + " + CO₂" };
    if (a === 1 && m.an === "O" && m.catZ > 1 && E(m.catZ).E0 != null && E(m.catZ).E0 > -0.5) return { p: 0.1, minT: 650, a: H2O, b: m.catZ, heat: 30, msg: "H₂ + " + pf(b) + " → " + E(m.catZ).s + " + H₂O" };
    return null;
  }

  var COVALENT_HALIDE = { 13: 1, 14: 1, 15: 1, 22: 1, 50: 1, 51: 1, 5: 1, 40: 1, 72: 1, 73: 1, 41: 1 };

  function deriveCompoundPair(a, b) {
    var A = Mat.list[a], B = Mat.list[b];
    if (!A || !B) return null;
    if (b === H2O && A.catZ > 1 && E(A.catZ)) {
      var cat = E(A.catZ).cat, hy;
      if (A.an === "O" && (cat === "alkali" || (cat === "alkaline" && A.catZ !== 4 && A.catZ !== 12))) { hy = Mat.salt(A.catZ, "OH"); return hy ? { p: 0.15, minT: 0, a: hy, b: AIR, heat: 150, msg: pf(a) + " + H₂O → " + pf(hy) } : null; }
      if (A.an === "H") { hy = Mat.salt(A.catZ, "OH"); return hy ? { p: 0.4, minT: 0, a: hy, b: 1, heat: 120, msg: pf(a) + " + H₂O → " + pf(hy) + " + H₂" } : null; }
      if (A.an === "N") { hy = Mat.salt(A.catZ, "OH"); return hy ? { p: 0.1, minT: 0, a: hy, b: NH3, heat: 60, msg: pf(a) + " + H₂O → " + pf(hy) + " + NH₃" } : null; }
      if (A.an === "P") { hy = Mat.salt(A.catZ, "OH"); return hy ? { p: 0.15, minT: 0, a: hy, b: PH3, heat: 60, msg: pf(a) + " + H₂O → " + pf(hy) + " + PH₃" } : null; }
      if (COVALENT_HALIDE[A.catZ] && (A.an === "Cl" || A.an === "Br" || A.an === "I")) { hy = Mat.salt(A.catZ, "O"); var hx = mol(VOLATILE_ACID[A.an]); return hy && hx ? { p: 0.4, minT: 0, a: hy, b: hx, heat: 100, msg: pf(a) + " + H₂O → " + pf(hy) + " + " + pf(hx) } : null; }
    }
    if (A.acid && A.an && Mat.ANIONS[A.an]) {
      var cz = B.catZ, strong = STRONG_ACIDS[a];
      if (cz > 1 && E(cz) && B.an) {
        var s = Mat.salt(cz, A.an, B.q && B.q > 0 ? B.q : undefined) || Mat.salt(cz, A.an);
        if (!s || s === b) return null;
        var mk = function (other, p, h) { return { p: p, minT: 0, a: other, b: s, heat: h, msg: pf(a) + " + " + pf(b) + " → " + pf(s) + " + " + pf(other) }; };
        if (B.an === "OH") return { p: strong ? 0.4 : 0.15, minT: 0, a: H2O, b: s, heat: 60, msg: pf(a) + " + " + pf(b) + " → " + pf(s) + " + H₂O" };
        if (B.an === "CO3" || B.an === "HCO3") { var r1 = mk(CO2, strong ? 0.3 : 0.08, 20); r1.rest = [H2O]; r1.msg += " + H₂O"; return r1; }
        if (B.an === "O") return { p: strong ? 0.08 : 0.02, minT: 0, a: H2O, b: s, heat: 40, msg: pf(a) + " + " + pf(b) + " → " + pf(s) + " + H₂O" };
        if (B.an === "S") return mk(H2S, 0.2, 20);
        if (B.an === "SO3") { var r2 = mk(SO2, 0.3, 15); r2.rest = [H2O]; r2.msg += " + H₂O"; return r2; }
        if (B.an === "CN") return mk(HCN, 0.4, 10);
        if (B.an === "CH3COO" && strong) return mk(ACETIC, 0.3, 5);
        if (B.an === "NO2" && strong) { var r3 = mk(NO, 0.3, 10); r3.rest = [NO2]; r3.msg += " + NO₂"; return r3; }
        // Nonvolatile sulfuric acid drives volatile acids out of their salts when hot.
        if (a === H2SO4 && VOLATILE_ACID[B.an]) { var r4 = mk(mol(VOLATILE_ACID[B.an]), 0.2, 15); r4.minT = 400; return r4; }
      }
    }
    // Bases with acidic gases, and basic oxides with acidic oxides.
    if (A.an === "OH" && A.catZ > 1 && E(A.catZ) && (E(A.catZ).cat === "alkali" || E(A.catZ).cat === "alkaline")) {
      var map = {}; map[CO2] = "CO3"; map[SO2] = "SO3"; map[SO3] = "SO4"; map[NO2] = "NO3"; map[H2S] = "S"; map[SiO2] = "SiO3";
      if (map[b]) { var sa = Mat.salt(A.catZ, map[b]); return sa ? { p: b === SiO2 ? 0.02 : 0.1, minT: b === SiO2 ? 500 : 0, a: sa, b: H2O, heat: 50, msg: pf(a) + " + " + pf(b) + " → " + pf(sa) + " + H₂O" } : null; }
    }
    if (A.an === "O" && A.catZ > 1 && E(A.catZ) && (E(A.catZ).cat === "alkali" || E(A.catZ).cat === "alkaline")) {
      var mop = {}; mop[CO2] = ["CO3", 0]; mop[SO2] = ["SO3", 400]; mop[SO3] = ["SO4", 0]; mop[SiO2] = ["SiO3", 1300];
      if (mop[b]) { var so = Mat.salt(A.catZ, mop[b][0]); return so ? { p: 0.1, minT: mop[b][1], a: so, b: AIR, heat: 80, msg: pf(a) + " + " + pf(b) + " → " + pf(so) } : null; }
    }
    // Carbon monoxide reduces easy metal oxides, the core of the blast furnace.
    if (a === CO && B.an === "O" && B.catZ > 1 && E(B.catZ) && E(B.catZ).E0 != null && E(B.catZ).E0 > -1) return { p: 0.15, minT: 700, a: CO2, b: B.catZ, heat: 30, msg: "CO + " + pf(b) + " → " + E(B.catZ).s + " + CO₂" };
    return null;
  }

  function derive(a, b) {
    if (a === AIR || a === WALL || a === ELECTRODE || a === FLAME || a === SMOKE || b === WALL || b === ELECTRODE || b === FLAME || b === SMOKE) return null;
    var exp = EXP[a + "," + (b === AIR ? "air" : b)];
    if (exp) return exp;
    if (b === AIR) {
      if (a > 118) {
        var m = Mat.list[a];
        if (m.an === "S" && m.catZ > 1) { var rx = deriveNonmetalCompound(8, a); if (rx) return { p: 0.06, minT: 800, a: rx.a, b: AIR, rest: [SO2], heat: rx.heat, air: true, msg: rx.msg, cap: 2300 }; }
        return null;
      }
      var r = deriveElementPair(a, 8);
      if (r) { r.air = true; r.b = AIR; r.p *= 0.6; r.violent = 0; r.cap = a === 12 ? 3300 : 2300; return r; }
      return null;
    }
    if (a <= 118 && b <= 118) return deriveElementPair(a, b);
    if (a <= 118) return isMetal(a) ? deriveMetalCompound(a, b) : deriveNonmetalCompound(a, b);
    return deriveCompoundPair(a, b);
  }

  function ruleFor(a, b) {
    var row = RULES[a];
    if (!row) { row = RULES[a] = new Int32Array(MAX_MATERIALS).fill(-1); }
    var r = row[b];
    if (r === -1) {
      var rule = derive(a, b);
      if (rule && rule.a === undefined) rule = null;
      if (rule && !rule.prods) finalize(rule, a, b);
      r = rule ? add(rule) : 0;
      row[b] = r;
    }
    return r;
  }
  C.ruleFor = function (a, b) { var r = ruleFor(a, b); return r ? list[r] : null; };

  // One-reactant rules: the database first, then the thermal behaviour of each anion family.
  function genericUni(id) {
    var m = Mat.list[id];
    if (!m || id <= 118 || m.isAlloy) return null;
    var z = m.catZ, an = m.an;
    if (!z || z <= 1 || !E(z) || !an) return null;
    var e = E(z), alkali = e.cat === "alkali", heavyAlk = e.cat === "alkaline", noble = e.E0 != null && e.E0 > 0.7;
    var oxide = Mat.salt(z, "O"), mk = function (T, products) {
      if (products.some(function (p) { return !p; })) return null;
      var co = balance([id], products);
      return [{ p: 0.1, minT: T, maxT: 0, cat: 0, heat: -30, products: products, nA: co ? co[0] : 1, prods: products.map(function (p, k) { return { id: p, n: co ? co[k + 1] : 1 }; }), msg: pf(id) + " → " + products.map(pf).join(" + ") }];
    };
    if (an === "CO3") { if (alkali) return null; return mk(heavyAlk ? 1200 : 700, [noble ? z : oxide, CO2]); }
    if (an === "HCO3") return mk(400, [Mat.salt(z, "CO3"), CO2, H2O]);
    if (an === "OH") { if (alkali) return null; return mk(heavyAlk ? 850 : 500, [noble ? z : oxide, H2O]); }
    if (an === "NO3") { if (alkali) return mk(700, [Mat.salt(z, "NO2"), 8]); return mk(noble ? 600 : 650, [noble ? z : oxide, NO2, 8]); }
    if (an === "NO2") { if (alkali) return null; return mk(500, [oxide, NO]); }
    if (an === "SO4") { if (alkali || heavyAlk) return null; return mk(1100, [noble ? z : oxide, SO3]); }
    if (an === "SO3") { if (alkali) return null; return mk(900, [oxide, SO2]); }
    if (an === "ClO3") return mk(650, [Mat.salt(z, "Cl"), 8]);
    if (an === "ClO4") return mk(800, [Mat.salt(z, "Cl"), 8]);
    if (an === "ClO") return mk(370, [Mat.salt(z, "Cl"), 8]);
    if (an === "C2O4") return mk(700, [alkali || heavyAlk ? Mat.salt(z, "CO3") : oxide, CO]);
    if (an === "CH3COO") return mk(650, [alkali || heavyAlk ? Mat.salt(z, "CO3") : oxide, mol("CH3COCH3")]);
    if (an === "MnO4") return mk(520, [mol("MnO2"), 8]);
    if (an === "O" && noble) return mk(500 + 200 * Math.max(0, 1.5 - e.E0), [z, 8]);
    if (m.decT > 0 && noble && Mat.ANIONS[an] && Mat.ANIONS[an].z) return mk(m.decT, [z, Mat.ANIONS[an].z]);
    return null;
  }
  function uniFor(id) {
    var u = UNIC[id];
    if (u === undefined) u = UNIC[id] = UNI[id] || genericUni(id) || 0;
    return u;
  }
  C.uniFor = uniFor;

  function neighbourHas(i, id) { for (var k = 0; k < 6; k++) { var n = i + dirs[k]; if (ID[n] === id || (ID[n] === H2O && (AUX[n] === id || AUX2[n] === id))) return true; } return false; }

  function spawnFlame(i, t, z) {
    var o = S.rf() * 4 | 0;
    for (var k = 0; k < 6; k++) {
      var j = i + (k === 0 ? dirs[4] : dirs[(k + o) % 6]);
      if (ID[j] === AIR) { ID[j] = FLAME; PH[j] = P_GAS; T[j] = Math.max(t, 1300); AUX[j] = z || 0; S.wakeI(j); return; }
    }
  }

  var FAR = [[0, 2, 0], [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, -2, 0], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]];
  function emit(i, id, t, amount) {
    // Water cells hold a whole share or none, since their USED field records dissolved strength. Rounding at random keeps the average right.
    if (id === H2O && amount !== undefined && amount < 1) { if (S.rf() > amount) return true; amount = 1; }
    if (id === AIR) return true;
    var used = amount === undefined || amount >= 1 ? 0 : 1 - amount;
    var o = S.rf() * 4 | 0;
    for (var k = 0; k < 6; k++) {
      var j = i + (k === 0 ? dirs[4] : dirs[(k + o) % 6]);
      if (ID[j] === AIR) { ID[j] = id; PH[j] = S.phaseFor(id, t, P_POWDER); T[j] = t; PR[j] = 0; AUX[j] = 0; AUX2[j] = 0; U2[j] = 0; USED[j] = used; S.wakeI(j); return true; }
    }
    // A packed mixture has no room right beside it, so look one cell further out.
    for (var f = 0; f < FAR.length; f++) {
      var far = i + FAR[f][0] + FAR[f][1] * W + FAR[f][2] * WD;
      if (far > 0 && far < ID.length && ID[far] === AIR) { ID[far] = id; PH[far] = S.phaseFor(id, t, P_POWDER); T[far] = t; PR[far] = 0; AUX[far] = 0; AUX2[far] = 0; U2[far] = 0; USED[far] = used; S.wakeI(far); return true; }
    }
    // No free neighbour: a soluble product joins nearby water, and anything else can take a liquid cell's place, as a gas bubbles up through water.
    var m = Mat.list[id];
    for (var q = 0; q < 6; q++) {
      var l = i + dirs[q];
      if (ID[l] === H2O && PH[l] === P_LIQUID) {
        if (m && m.soluble && !AUX[l]) { AUX[l] = id; USED[l] = used; S.wakeI(l); return true; }
        if (m && !m.soluble) { ID[l] = id; PH[l] = S.phaseFor(id, t, P_POWDER); T[l] = t; PR[l] = 0; AUX[l] = 0; AUX2[l] = 0; USED[l] = used; S.wakeI(l); return true; }
      }
    }
    // Still no room: pile it onto a neighbour of the same substance. That cell holds more than a full share and sheds it once space opens up.
    var extra = amount === undefined ? 1 : amount;
    for (var e2 = 0; e2 < 6; e2++) { var same = i + dirs[e2]; if (ID[same] === id && id !== H2O) { USED[same] -= extra; S.wakeI(same); return true; } }
    if (ID[i] === id && id !== H2O) { USED[i] -= extra; return true; }
    return false;
  }

  // Put a product into a cell. In a water cell, soluble products stay dissolved and anything else replaces the water.
  function deposit(c, prod, t, form, inWater, amount) {
    var used = amount === undefined || amount >= 1 ? 0 : 1 - amount;
    if (PH[c] === P_STATIC) S.markStatic();
    if (inWater) {
      if (prod === AIR || prod === H2O) { AUX[c] = 0; USED[c] = 0; T[c] = Math.min(t, 372); return; }
      var pm = Mat.list[prod];
      if (pm && pm.soluble) { AUX[c] = prod; USED[c] = used; T[c] = Math.min(t, 372); return; }
    }
    if (prod === AIR) { ID[c] = AIR; PH[c] = P_GAS; AUX[c] = 0; AUX2[c] = 0; USED[c] = 0; U2[c] = 0; T[c] = t; return; }
    ID[c] = prod; PH[c] = S.phaseFor(prod, t, form); T[c] = t; PR[c] = 0; AUX[c] = 0; AUX2[c] = 0; USED[c] = used;
  }

  function smoke(i, t) {
    for (var k = 0; k < 6; k++) {
      var j = i + (k === 0 ? dirs[4] : dirs[(k + 2) % 6]);
      if (ID[j] === AIR) { ID[j] = SMOKE; PH[j] = P_GAS; T[j] = t * 0.5; AUX[j] = 0; S.wakeI(j); return; }
    }
  }

  // A solute whose water has been used up moves into water beside it if that has room, and otherwise comes out as a grain. Only if neither can happen is it lost, and then it is counted.
  function leaveBehind(c, id, share, t) {
    if (share < 1e-5) return;
    for (var q = 0; q < 6; q++) {
      var n = c + dirs[q];
      if (ID[n] !== H2O || PH[n] !== P_LIQUID) continue;
      if (AUX[n] === id && USED[n] >= share) { USED[n] -= share; return; }
      if (AUX2[n] === id && U2[n] >= share) { U2[n] -= share; return; }
      if (!AUX[n] && AUX2[n] !== id) { AUX[n] = id; USED[n] = 1 - share; S.wakeI(n); return; }
      if (AUX[n] !== id && !AUX2[n]) { AUX2[n] = id; U2[n] = 1 - share; S.wakeI(n); return; }
    }
    if (!emit(c, id, t, share)) S.noteLost(share * Mat.n0[id] * Mat.list[id].M);
  }

  // One reaction event in true amounts. A cell holds (1 - USED) of its full share of moles, set by the substance's density and formula mass.
  // The limiting cell is used up and the other keeps what is left. Products get the moles the equation says, which is why mass balances.
  function applyRule(i, j, x, y, z, r, t, solI, solJ, sa, sb) {
    var tj = T[j], avg = r.air ? t : (t + tj) * 0.5, air = r.air;
    var cap = r.cap || FLAME_CAP, tNew = Math.max(30, Math.min(avg + r.heat, Math.max(cap, avg)));
    var formI = PH[i] === P_STATIC ? P_STATIC : P_POWDER, formJ = PH[j] === P_STATIC ? P_STATIC : P_POWDER;
    var condensed = PH[i] <= P_LIQUID || (!air && PH[j] <= P_LIQUID);
    if (solI || solJ) tNew = Math.min(tNew, Math.max(avg + r.heat * 0.2, 340));   // water soaks up most of the heat
    var idA = sa || ID[i], idB = sb || ID[j], n0 = Mat.n0;
    // In a water cell USED says how strong its solute is. When the water itself reacts, the whole cell's worth is there.
    var nA = r.nA || 1, nB = r.nB || 1, molI = (idA === H2O && !solI ? 1 : 1 - USED[i]) * n0[idA], molJ = air ? 1e9 : (idB === H2O && !solJ ? 1 : 1 - USED[j]) * n0[idB];
    var e = molI / nA < molJ / nB ? molI / nA : molJ / nB;
    var remI = (molI - e * nA) / n0[idA], remJ = air ? 0 : (molJ - e * nB) / n0[idB];
    if (air && S.atmosphere === "air") U2[j] += e * nB / AIR_OXYGEN;
    if (idA === H2O && !solI) remI = remI >= 1 ? 1 : (S.rf() < remI ? 1 : 0);
    if (idB === H2O && !solJ && !air) remJ = remJ >= 1 ? 1 : (S.rf() < remJ ? 1 : 0);
    // Concentrated acid is mostly water, so what it makes stays dissolved and fresh acid can reach the metal.
    var aq = solI || solJ || (PH[i] === P_LIQUID && Mat.list[idA].acid) || (!air && PH[j] === P_LIQUID && Mat.list[idB].acid);
    var freeI = remI < (solI ? 1e-5 : 0.01), freeJ = !air && remJ < (solJ ? 1e-5 : 0.01);
    if (!freeI && idA !== H2O) { USED[i] = 1 - remI; T[i] = solI ? Math.min(tNew, 372) : tNew; }
    if (!air && !freeJ && idB !== H2O) { USED[j] = 1 - remJ; T[j] = solJ ? Math.min(tNew, 372) : tNew; }
    if (!freeI && idA === H2O) T[i] = Math.min(tNew, 372);
    if (!air && !freeJ && idB === H2O) T[j] = Math.min(tNew, 372);
    var usedWater = freeJ && idB === H2O && !solJ, heldA = usedWater ? AUX[j] : 0, heldB = usedWater ? AUX2[j] : 0, shareA = 1 - USED[j], shareB = 1 - U2[j];
    var list = r.prods || [], gas = 0, slotI = freeI, slotJ = freeJ;
    for (var q = 0; q < list.length; q++) {
      var pid = list[q].id, share = n0[pid] > 0 ? e * list[q].n / n0[pid] : 0, guard = 0;
      if (pid > AIR && S.phaseFor(pid, tNew, P_POWDER) >= P_GAS) gas += e * list[q].n;
      while (share > (aq ? 1e-6 : 0.005) && guard++ < 16) {
        var take = share < 1 ? share : 1, pm = Mat.list[pid];
        if (pid === H2O && take < 1) { if (S.rf() > take) { share -= take; continue; } take = 1; }
        if (slotI) { slotI = false; putProduct(i, pid, tNew, formI, solI, aq, pm, take); }
        else if (slotJ) { slotJ = false; putProduct(j, pid, tNew, formJ, solJ, aq, pm, take); }
        else if (!emit(i, pid, tNew, take) && !emit(j, pid, tNew, take)) S.noteLost(take * n0[pid] * (pm ? pm.M : 1));
        share -= take;
      }
    }
    if (slotI) deposit(i, AIR, tNew, formI, solI);
    if (slotJ) deposit(j, AIR, tNew, formJ, solJ);
    if (heldA) leaveBehind(j, heldA, shareA, tNew);
    if (heldB) leaveBehind(j, heldB, shareB, tNew);
    // Gas from a condensed mixture needs room, and that is what builds pressure. A mole of gas in 1 cm3 would be about 25000 atmospheres; the factor is scaled down.
    if (condensed && gas > 0) { var dp = gas * 400; P[i] += dp > 60 ? 60 : dp; }
    if (r.violent) P[i] += r.violent * 150;
    S.wakeI(i); S.wakeI(j);
    S.stats.reactions++;
    S.addLog(r.msg, air ? "burn" : "chem");
    if (C.onFire) C.onFire(r);
    if (r.flame && (tNew > 800 || r.alwaysFlame)) { spawnFlame(i, Math.max(tNew, 2400), r.flame); spawnFlame(air ? i : j, Math.max(tNew, 2400), r.flame); if ((r.flame === 6 || r.flame === 16) && S.rf() < 0.5) smoke(i, tNew); }
    if (r.violent && S.rf() < r.violent * 0.5) S.blast(x, y, z, 2 + (S.rf() < r.violent ? 1 : 0), r.violent);
  }
  function putProduct(c, pid, t, form, inWater, aq, pm, amount) {
    if (!inWater && aq && pid > 118 && pm && pm.soluble) { ID[c] = H2O; PH[c] = P_LIQUID; AUX[c] = pid; AUX2[c] = 0; USED[c] = amount >= 1 ? 0 : 1 - amount; T[c] = Math.min(t, 372); PR[c] = 0; return; }
    deposit(c, pid, t, form, inWater, amount);
  }

  function applyUni(i, x, y, z, u, t, reactant) {
    var tNew = Math.max(30, Math.min(t + u.heat, Math.max(FLAME_CAP, t)));
    var inWater = ID[i] === H2O, condensed = PH[i] <= P_LIQUID, a = reactant || ID[i], mol = (1 - USED[i]) * Mat.n0[a], e = mol / (u.nA || 1), list = u.prods;
    var first = true, gas = 0;
    for (var q = 0; q < list.length; q++) {
      var pid = list[q].id, pm = Mat.list[pid], share = Mat.n0[pid] > 0 ? e * list[q].n / Mat.n0[pid] : 0, guard = 0;
      if (pid > AIR && S.phaseFor(pid, tNew, P_POWDER) >= P_GAS) gas += e * list[q].n;
      while (share > 0.005 && guard++ < 16) {
        var take = share < 1 ? share : 1;
        if (pid === H2O && take < 1) { if (S.rf() > take) { share -= take; continue; } take = 1; }
        if (first) { first = false; deposit(i, pid, tNew, P_POWDER, inWater, take); }
        else if (!emit(i, pid, tNew, take)) S.noteLost(take * Mat.n0[pid] * (pm ? pm.M : 1));
        share -= take;
      }
    }
    if (first) deposit(i, AIR, tNew, P_POWDER, inWater);
    if (condensed && gas > 0) { var dp = gas * 400; P[i] += dp > 60 ? 60 : dp; }
    if (u.violent) P[i] += u.violent * 200;
    S.wakeI(i);
    S.stats.reactions++;
    S.addLog(u.msg, "chem");
    if (C.onFire) C.onFire(u);
    if (u.flame && tNew > 800) spawnFlame(i, Math.max(tNew, 2400), u.flame);
    if (u.violent && S.rf() < u.violent * 0.5) S.blast(x, y, z, 2 + (S.rf() < u.violent ? 1 : 0), u.violent);
  }

  // Concentration in mol/L of a solute at a given share of a full cell.
  function molar(id, used) { return (1 - used) * Mat.n0[id] * 1000; }
  C.molar = molar;

  // pH of a water cell from what is dissolved in it. Strong acids and bases dissociate fully, weak ones through their Ka or Kb, salts of weak
  // acids hydrolyse, and a weak acid sharing a cell with its own salt is a buffer, by Henderson-Hasselbalch.
  var AN_ACID = { CH3COO: "CH3COOH", F: "HF", CO3: "H2CO3", HCO3: "H2CO3", CN: "HCN", ClO: "HClO", SO3: "H2SO3", S: "H2S", C2O4: "H2C2O4", PO4: "H3PO4", BO3: "H3BO3", NO2: "HNO2" };
  // A fully stripped anion takes back its last proton first, so it goes by the acid's last pKa, not the first one listed for the acid.
  var LAST_PKA = { CO3: 10.33, SO3: 7.2, S: 12.9, C2O4: 4.27, PO4: 12.35 };
  // How much of a weak acid or base has ionised, by the exact quadratic. The usual square root gives more ions than there are molecules once it is dilute.
  function ionised(K, c) { return (-K + Math.sqrt(K * K + 4 * K * c)) / 2; }
  function acidity(id, c) {
    var m = Mat.list[id], f = m.formula;
    if (m.acid) {
      if (m.pKa !== undefined) return { h: ionised(Math.pow(10, -m.pKa), c), oh: 0, pKa: m.pKa, c: c, acid: true };
      var at = Mat.atoms(f);
      return { h: c * (at && at.H ? Math.min(at.H, 2) : 1), oh: 0 };
    }
    if (f === "NH3") return { h: 0, oh: ionised(1.8e-5, c) };
    if (m.an === "OH" && m.catZ) {
      var sat = Mat.solubilityFromKsp(f), cc = sat !== undefined && c > sat ? sat : c;
      return { h: 0, oh: cc * (m.q || 1) };
    }
    if (m.an && AN_ACID[m.an] && ACID_PKA[AN_ACID[m.an]] !== undefined) {
      var pKa = LAST_PKA[m.an] || ACID_PKA[AN_ACID[m.an]], kb = Math.pow(10, pKa - 14);
      return { h: 0, oh: ionised(kb, c), salt: AN_ACID[m.an], pKa: pKa, c: c };
    }
    return { h: 0, oh: 0 };
  }
  C.pHfromSolutes = function (idA, cA, idB, cB) {
    var a = idA ? acidity(idA, cA) : null, b = idB ? acidity(idB, cB) : null;
    if (a && b && ((a.acid && b.salt === Mat.list[idA].formula) || (b.acid && a.salt === Mat.list[idB].formula))) {
      var ac = a.acid ? a : b, sl = a.acid ? b : a;
      return ac.pKa + Math.log10(sl.c / ac.c);
    }
    var h = (a ? a.h : 0) + (b ? b.h : 0), oh = (a ? a.oh : 0) + (b ? b.oh : 0), net = h - oh;
    // Water's own ions, exactly. Worked from whichever side is in excess, because subtracting from a strong base would lose every digit.
    var root = Math.sqrt(net * net + 4e-14);
    return net >= 0 ? -Math.log10((net + root) / 2) : 14 + Math.log10((root - net) / 2);
  };
  C.pH = function (i) {
    if (ID[i] !== H2O) return null;
    var a = AUX[i], b = AUX2[i];
    return C.pHfromSolutes(a, a ? molar(a, USED[i]) : 0, b, b ? molar(b, U2[i]) : 0);
  };

  // Dissolved ions moving through still water, displacement by metals and precipitation.
  function solutionStep(i, x, y, z) {
    var sol = AUX[i], s = Mat.list[sol];
    if (!s) { AUX[i] = 0; return false; }
    var j = i + dirs[S.rf() * 6 | 0], jd = ID[j];
    if (jd === WALL || jd === AIR || jd === ELECTRODE) return false;
    if (jd <= 118 && isMetal(jd) && s.catZ > 1 && E(s.catZ) && E(s.catZ).E0 != null && E(jd).E0 < E(s.catZ).E0 - 0.1 && PH[j] <= P_LIQUID) {
      if (S.rf() < 0.08 * (1 - USED[i] > 0.1 ? 1 : 10 * (1 - USED[i]))) {
        var ns = Mat.salt(jd, s.an);
        if (!ns) return false;
        var dk = "d" + jd + "," + sol, dr = SWAP[dk];
        if (!dr) dr = SWAP[dk] = finalize({ a: ns, b: s.catZ, heat: 10, msg: E(jd).s + " + " + pf(sol) + "(aq) → " + pf(ns) + "(aq) + " + E(s.catZ).s }, jd, sol);
        applyRule(j, i, x, y, z, dr, T[j], false, true, jd, sol);
        return true;
      }
      return false;
    }
    // Ions spread through still water by diffusion, thinning out as they go. Only every other cell moves each tick, checkerboard style,
    // otherwise an ion gets carried along with the sweep and drifts into a corner.
    if (jd === H2O && PH[j] === P_LIQUID) {
      var conc = 1 - USED[i];
      if (conc < 1e-5) { AUX[i] = 0; USED[i] = 0; return true; }
      if (((x + y + z + S.tickN) & 1) !== 0) return false;
      if (!AUX[j]) {
        if (conc > 2e-4) { AUX[j] = sol; USED[i] = USED[j] = 1 - conc * 0.5; }
        else { AUX[j] = sol; USED[j] = USED[i]; AUX[i] = 0; USED[i] = 0; }
        S.wakeI(j);
        return true;
      }
      if (AUX[j] === sol) {
        var cj = 1 - USED[j], d = conc - cj;
        var dLim = (conc > cj ? conc : cj) * 0.05 + 1e-5;
        if (d > dLim || d < -dLim) { USED[i] = 1 - (conc - d * 0.25); USED[j] = 1 - (cj + d * 0.25); return true; }
        return false;
      }
      // A different solute: try a swap of ions first, otherwise share the cell as a mixture.
      var o = Mat.list[AUX[j]];
      if (s.catZ > 1 && o.catZ > 1 && s.an && o.an && s.catZ !== o.catZ) {
        var ppt = Mat.salt(s.catZ, o.an, s.q > 0 ? s.q : undefined), other = Mat.salt(o.catZ, s.an);
        if (ppt && exceedsKsp(ppt, sol, USED[i], AUX[j], USED[j])) { precipitate(i, j, ppt, other, sol, AUX[j], x, y, z); return true; }
        var ppt2 = Mat.salt(o.catZ, s.an, o.q > 0 ? o.q : undefined), other2 = Mat.salt(s.catZ, o.an);
        if (ppt2 && exceedsKsp(ppt2, AUX[j], USED[j], sol, USED[i])) { precipitate(j, i, ppt2, other2, AUX[j], sol, x, y, z); return true; }
      }
      if (!AUX2[j] && conc > 2e-4) { AUX2[j] = sol; U2[j] = 1 - conc * 0.5; USED[i] = 1 - conc * 0.5; S.wakeI(j); return true; }
      return false;
    }
    return false;
  }

  // The ion product decides whether a salt falls out. Each solute's strength is halved because the two solutions mix between their cells.
  function exceedsKsp(solid, catSalt, usedC, anSalt, usedA) {
    var m = Mat.list[solid], k = Mat.ksp(solid);
    if (k === Infinity || !m.nc) return false;
    var catS = Mat.list[catSalt], anS = Mat.list[anSalt];
    var cCat = molar(catSalt, usedC) * 0.5 * (catS.nc || 1), cAn = molar(anSalt, usedA) * 0.5 * (anS.na || 1);
    return Math.pow(cCat, m.nc) * Math.pow(cAn, m.na) > k;
  }
  var SWAP = {};
  function precipitate(i, j, solid, remaining, sa, sb, x, y, z) {
    var key = sa + "," + sb, r = SWAP[key];
    if (!r) {
      var o2 = remaining && Mat.list[remaining].soluble ? remaining : 0;
      r = SWAP[key] = finalize({ a: solid, b: o2, heat: 5, msg: pf(sa) + " + " + pf(sb) + " → " + pf(solid) + "↓" + (o2 ? " + " + pf(o2) : "") }, sa, sb);
    }
    applyRule(i, j, x, y, z, r, T[i], true, true, sa, sb);
  }

  // Above about 5000 K no compound survives. Each element keeps the atoms it had: the first takes over this cell and the rest find room nearby.
  function dissociate(i, id, t) {
    var m = Mat.list[id], at = m.isAlloy ? null : Mat.atoms(m.formula), syms = at ? Object.keys(at) : [];
    if (!syms.length) { ID[i] = AIR; PH[i] = P_GAS; AUX[i] = 0; AUX2[i] = 0; return true; }
    var moles = (id === H2O ? 1 : 1 - USED[i]) * Mat.n0[id], z0 = Mat.byFormula[syms[0]], own = moles * at[syms[0]] / Mat.n0[z0];
    ID[i] = z0; PH[i] = S.phaseFor(z0, t, P_POWDER); AUX[i] = 0; AUX2[i] = 0; U2[i] = 0; PR[i] = 0; USED[i] = own < 1 ? 1 - own : 0;
    for (var q = 0; q < syms.length; q++) {
      var z = Mat.byFormula[syms[q]], share = q ? moles * at[syms[q]] / Mat.n0[z] : own - 1;
      for (var guard = 0; share > 0.005 && guard < 16; guard++) {
        var take = share < 1 ? share : 1;
        if (!emit(i, z, t, take)) S.noteLost(take * Mat.n0[z] * Mat.list[z].M);
        share -= take;
      }
    }
    return true;
  }

  function splitWater(i, t) {
    var water = Mat.n0[H2O];   // one cell of water holds 2n atoms of H and n of O
    ID[i] = 1; PH[i] = P_GAS; AUX[i] = 0; AUX2[i] = 0; USED[i] = 1 - Math.min(1, 2 * water / Mat.n0[1]); emit(i, 8, t, Math.min(1, water / Mat.n0[8]));
    S.stats.reactions++;
    S.wakeI(i);
  }
  // Ionising radiation breaks water apart, a real hazard in reactor cooling water.
  C.radiolyse = function (i) { splitWater(i, T[i]); S.addLog("2H₂O → 2H₂ + O₂ (radiolysis)", "nuclear"); };

  // Current through a liquid, called from the electricity code.
  C.electrolyse = function (i, id) {
    var t = T[i], key = id === H2O && AUX[i] ? AUX[i] : id, us = UNI[key];
    if (us) for (var k = 0; k < us.length; k++) {
      var u = us[k];
      if (u.elec && t >= u.minT && S.rf() < u.p * 0.3) { applyUni(i, 0, 0, 0, u, t, key); return; }
    }
    if (S.rf() > 0.006) return;
    if (id === H2O) {
      if (AUX[i] && S.rf() < 0.5) {
        var s = Mat.list[AUX[i]];
        if (s.catZ > 1 && E(s.catZ) && E(s.catZ).E0 != null && E(s.catZ).E0 > -0.8) {   // reducible metal plates out instead of hydrogen
          emit(i, s.catZ, t); AUX[i] = 0; S.addLog(E(s.catZ).s + "⁺ + e⁻ → " + E(s.catZ).s + " (electroplating)", "chem"); return;
        }
      }
      splitWater(i, t);
      S.addLog("2H₂O → 2H₂ + O₂ (electrolysis)", "chem");
      return;
    }
    var m = Mat.list[id];
    if (m.catZ > 1 && m.an && Mat.ANIONS[m.an] && Mat.ANIONS[m.an].z) {
      ID[i] = m.catZ; PH[i] = S.phaseFor(m.catZ, t, P_POWDER); emit(i, Mat.ANIONS[m.an].z, t);
      S.addLog(pf(id) + " → " + E(m.catZ).s + " + " + E(Mat.ANIONS[m.an].z).s + " (electrolysis)", "chem");
      S.stats.reactions++;
      S.wakeI(i);
    }
  };

  function conditionsOK(r, i, j, ph, phj) {
    if (r.light) return false;
    if (r.elec && !CH[i] && !CH[j]) return false;
    if (r.liq && (ph !== P_LIQUID || phj !== P_LIQUID)) return false;
    if (r.cat && !neighbourHas(i, r.cat) && !neighbourHas(j, r.cat)) return false;
    if (r.need && r.need.length) for (var q = 0; q < r.need.length; q++) if (!neighbourHas(i, r.need[q]) && !neighbourHas(j, r.need[q])) return false;
    return true;
  }

  C.step = function (i, x, y, z, id, ph, t) {
    if (id === WALL || id === ELECTRODE) return false;
    if (id > 118 && t > 5000) return dissociate(i, id, t);
    // A cell holding more than a full share sheds the extra as soon as there is room.
    if (USED[i] < -0.02 && id !== H2O) {
      var roomy = i + dirs[S.rf() * 6 | 0];
      if (ID[roomy] === AIR) { var shed = -USED[i] < 1 ? -USED[i] : 1; ID[roomy] = id; PH[roomy] = ph; T[roomy] = t; PR[roomy] = 0; AUX[roomy] = 0; USED[roomy] = 1 - shed; USED[i] += shed; S.wakeI(roomy); return true; }
    }
    if (t > 6000) return false;   // no molecules survive here, only ionised atoms

    // A mixed solution offers one of its two solutes at random, so both get to react.
    if (id === H2O && AUX2[i] > 0) {
      if (!AUX[i] || S.rf() < 0.5) { var ta = AUX[i], tu = USED[i]; AUX[i] = AUX2[i]; USED[i] = U2[i]; AUX2[i] = ta; U2[i] = tu; }
      if (AUX2[i] > 0) {   // the two can also react with each other in place
        var rm = ruleFor(AUX[i], AUX2[i]);
        if (rm && t >= list[rm].minT && (!list[rm].maxT || t <= list[rm].maxT) && !list[rm].cat && !list[rm].light && !list[rm].elec && (!list[rm].need || !list[rm].need.length) && S.rf() < list[rm].p) {
          var rr = list[rm], em = rr.prods || [{ id: rr.a, n: 1 }, { id: rr.b, n: 1 }], sa = AUX[i], sb = AUX2[i], na = rr.nA || 1, nb = rr.nB || 1;
          // True amounts here too: the scarcer solute runs out and the other keeps what it has left. The heat goes by how much reacted, and water soaks up most of it, as in applyRule.
          var ma = (1 - USED[i]) * Mat.n0[sa], mb = (1 - U2[i]) * Mat.n0[sb], ev = Math.min(ma / na, mb / nb), lefta = ma - ev * na, leftb = mb - ev * nb, whole = Math.min(Mat.n0[sa] / na, Mat.n0[sb] / nb);
          AUX[i] = 0; AUX2[i] = 0; USED[i] = 0; U2[i] = 0;
          if (lefta > 1e-9) { AUX[i] = sa; USED[i] = 1 - lefta / Mat.n0[sa]; }
          if (leftb > 1e-9) { if (AUX[i]) { AUX2[i] = sb; U2[i] = 1 - leftb / Mat.n0[sb]; } else { AUX[i] = sb; USED[i] = 1 - leftb / Mat.n0[sb]; } }
          T[i] = Math.max(30, Math.min(372, t + (rr.heat || 0) * 0.2 * ev / whole));
          for (var pq = 0; pq < em.length; pq++) {
            var pp = em[pq].id;
            if (!pp || pp === H2O) continue;
            var pm0 = Mat.list[pp], part = ev * em[pq].n / Mat.n0[pp], fill = part < 1 ? part : 1;
            if (pm0.soluble && !AUX[i]) { AUX[i] = pp; USED[i] = 1 - fill; }
            else if (pm0.soluble && !AUX2[i]) { AUX2[i] = pp; U2[i] = 1 - fill; }
            else if (part > 0.005) emit(i, pp, t, fill);
          }
          S.stats.reactions++; S.addLog(rr.msg, "chem"); if (C.onFire) C.onFire(rr);
          S.wakeI(i);
          return true;
        }
      }
    }
    var isSolI = id === H2O && ph === P_LIQUID && AUX[i] > 0, a = isSolI ? AUX[i] : id;

    // One-reactant reactions: thermal decomposition, catalytic breakdown.
    var us = uniFor(a);
    if (us) for (var u = 0; u < us.length; u++) {
      var ur = us[u];
      if (ur.light || ur.elec) continue;
      if (t < ur.minT * 0.85 || (ur.maxT && t > ur.maxT)) continue;
      if (ur.cat && !neighbourHas(i, ur.cat)) continue;
      if (S.rf() < ur.p * arrhenius(ur.minT, t) * thermo(ur, t, P[i])) { applyUni(i, x, y, z, ur, t, a); return true; }
    }

    if (isSolI && solutionStep(i, x, y, z)) return true;
    var j = i + dirs[S.rf() * 6 | 0], jd = ID[j];
    if (jd === WALL) return false;

    // Dissolving, into either solute slot that is free. Solids dissolve slowly, miscible liquids and soluble gases faster.
    if (id > 118 && jd === H2O && PH[j] === P_LIQUID && (!AUX[j] || !AUX2[j]) && AUX[j] !== id && AUX2[j] !== id && id !== H2O) {
      var m = Mat.list[id];
      if (m.soluble && ph <= P_GAS) {
        if (S.rf() < (ph <= P_POWDER ? 0.08 : 0.15)) {
          // A grain gives up only what the water can hold. Sparingly soluble salts saturate quickly and most of the grain stays.
          var have = 1 - USED[i], sat = Mat.saturation(id), give = have < sat ? have : sat;
          if (AUX[j]) { AUX2[j] = id; U2[j] = 1 - give; } else { AUX[j] = id; USED[j] = 1 - give; }   // both shares of a full cell of this solute
          // Dissolving gives out or takes in its heat of solution, shared between the water and the grain. Eutectic freezing and boiling bound how far that goes.
          if (Mat.hsol[id]) {
            var dTs = -give * Mat.n0[id] * Mat.hsol[id] * 1000 / (Mat.cL[H2O] + Mat.cS[id] * give), hotter = T[j] + dTs;
            T[j] = hotter > 372 ? 372 : (hotter < 250 ? 250 : hotter);
            if (have - give >= 0.02) T[i] = T[j];
          }
          if (have - give < 0.02) { ID[i] = AIR; PH[i] = P_GAS; AUX[i] = 0; USED[i] = 0; if (ph === P_STATIC) S.markStatic(); }
          else USED[i] = 1 - (have - give);
          S.wakeI(i); S.wakeI(j); S.addLog(pf(id) + " dissolves in water", "chem");
          return true;
        }
        return false;
      }
    }

    // A scale that fits holds on and protects what is under it. One that is too bulky or too thin, like rust, slowly flakes away in the wet and lets the attack carry on.
    if (ph === P_STATIC && Mat.flaky[id] && jd === H2O && S.rf() < 0.0001) { PH[i] = P_POWDER; S.markStatic(); S.wakeI(i); S.addLog(pf(id) + " flakes off", "chem"); return true; }

    // Gallium and mercury embrittle aluminium.
    if ((id === 31 || id === 80) && ph === P_LIQUID && jd === 13 && PH[j] === P_STATIC && S.rf() < 0.01) { PH[j] = P_POWDER; S.wakeI(j); S.addLog(E(id).s + " embrittles Al", "chem"); return true; }

    if (jd === AIR && (S.atmosphere === "vacuum" || S.atmosphere === "argon")) return false;

    var isSolJ = jd === H2O && PH[j] === P_LIQUID && AUX[j] > 0, b = isSolJ ? AUX[j] : jd;
    if (isSolI && b === AIR) return false;
    var k = ruleFor(a, b);
    // A solute with nothing to react with here leaves the water itself to react. Dissolving something in water does not stop it being water.
    if (!k && isSolJ) { k = ruleFor(a, H2O); if (k) { b = H2O; isSolJ = false; } }
    if (!k) {
      if (jd === H2O && PH[j] === P_LIQUID && id <= 118 && E(id).E0 != null && E(id).E0 < 0 && E(id).E0 > -1.2 && S.rf() < 0.0015 && neighbourHas(i, AIR) && S.atmosphere !== "argon") return rust(i, id);
      return false;
    }
    var r = list[k], phj = PH[j], first = r, dust = false;
    // A reaction front is as hot as the hotter partner, so burning grains can light their cold neighbours.
    var tc = T[j] > t && jd !== AIR ? T[j] : t, hot = tc;
    // Pick the first rule in the chain whose conditions hold: low and high temperature routes can differ.
    while (r) {
      hot = tc;
      if (r.minT && tc < r.minT && r.minT < 2000) { for (var n = 0; n < 6; n++) { var hn = T[i + dirs[n]]; if (hn > r.minT) { hot = hn; break; } } }
      if (hot >= r.minT && (!r.maxT || tc <= r.maxT) && conditionsOK(r, i, j, ph, phj) && !(r.split && S.rf() < 0.5)) break;
      r = r.alt;
    }
    // Nothing is past its onset, but a reaction just below onset still runs slowly, as the Arrhenius curve says.
    if (!r) {
      r = first;
      while (r) {
        if (r.minT && tc >= r.minT * 0.85 && (!r.maxT || tc <= r.maxT) && conditionsOK(r, i, j, ph, phj)) break;
        r = r.alt;
      }
    }
    if (!r) {
      if (jd === H2O && PH[j] === P_LIQUID && id <= 118 && E(id).E0 != null && E(id).E0 < 0 && E(id).E0 > -1.2 && S.rf() < 0.0015 && neighbourHas(i, AIR)) return rust(i, id);
      return false;
    }
    var rate = r.p * (hot >= r.minT && r.minT ? 1 : arrhenius(r.minT, tc));
    if (!r.minT) rate = r.p * arrhenius(0, tc);
    rate *= thermo(r, tc, P[i]);
    if (jd === AIR && S.atmosphere === "oxygen") rate *= 3;
    // Fire uses up the air it touches, and stops when too little oxygen is left.
    if (jd === AIR && r.air && S.atmosphere === "air") { var o2Left = 1 - U2[j] / SMOTHERED; if (o2Left <= 0) return false; rate *= o2Left; }
    // Squeezing a gas packs in more of it.
    if (ph >= P_GAS && P[i] > 10) rate *= P[i] > 300 ? 4 : 1 + P[i] / 100;
    // Surface area. A lump only reacts on its outside, loose grains expose far more, and dust hanging in air the most: enough to burn as an explosion.
    if (ph === P_STATIC || PH[j] === P_STATIC) rate *= 0.25;
    else if (ph === P_POWDER && jd === AIR && r.air && airborne(i)) { rate *= 4; dust = true; }
    // Grains burn. Bulk or molten metal only grows a protective oxide skin unless it is very reactive, like magnesium.
    if (r.air && id <= 118 && ph !== P_POWDER && E(id).E0 != null && E(id).E0 > -2) rate *= 0.02;
    // Dilute solutions react more slowly, in proportion to how much reactant is in the cell.
    if (isSolI) rate *= 1 - USED[i];
    if (isSolJ) rate *= 1 - USED[j];
    if (S.rf() > rate) return false;
    consumeNeeds(r, i, j);
    if (dust) P[i] += 25;
    applyRule(i, j, x, y, z, r, t, isSolI, isSolJ, a, b);
    return true;
  };

  function airborne(i) { var n = 0; for (var q = 0; q < 6; q++) if (ID[i + dirs[q]] === AIR) n++; return n >= 5; }

  // Third reactants in an equation get used up from a touching cell. Catalysts do not.
  function consumeNeeds(r, i, j) {
    if (!r.need || !r.need.length) return;
    for (var q = 0; q < r.need.length; q++) {
      var want = r.need[q], done = false;
      for (var n = 0; n < 6 && !done; n++) {
        var c = i + dirs[n];
        if (c === j) continue;
        if (ID[c] === want) { ID[c] = AIR; PH[c] = P_GAS; AUX[c] = 0; AUX2[c] = 0; USED[c] = 0; S.wakeI(c); done = true; }
        else if (ID[c] === H2O && AUX[c] === want) { AUX[c] = 0; done = true; }
      }
    }
  }

  function rust(i, id) {
    var ox = Mat.salt(id, "O");
    if (!ox) return false;
    ID[i] = ox; USED[i] = 0; PH[i] = PH[i] === P_STATIC ? P_STATIC : P_POWDER;
    S.addLog(E(id).s + " corrodes → " + pf(ox), "chem");
    S.stats.reactions++;
    S.wakeI(i);
    return true;
  }

  // UV lamp: fires photochemical rules for cells in the beam. Runs on the main thread between ticks.
  C.illuminate = function (i, x, y, z) {
    var id = ID[i], a = id === H2O && AUX[i] ? AUX[i] : id;
    var us = UNI[a];
    if (us) for (var u = 0; u < us.length; u++) if (us[u].light && S.rf() < us[u].p) { if (!us[u].cat || neighbourHas(i, us[u].cat)) { applyUni(i, x, y, z, us[u], T[i], a); return true; } }
    var j = i + dirs[S.rf() * 6 | 0], b = ID[j];
    if (b === WALL) return false;
    if (b === H2O && AUX[j]) b = AUX[j];
    var r = EXP[a + "," + b];
    while (r) {
      if (r.light && S.rf() < r.p && (!r.cat || neighbourHas(i, r.cat) || neighbourHas(j, r.cat))) { applyRule(i, j, x, y, z, r, T[i], id === H2O && AUX[i] > 0, ID[j] === H2O && AUX[j] > 0, a, b); return true; }
      r = r.alt;
    }
    return false;
  };

  // Everything a material reacts with, for the data card. Includes generated rules.
  C.partners = function (id) {
    var out = [], n = Mat.count();
    var r = ruleFor(id, AIR);
    if (r) out.push({ b: AIR, rule: list[r] });
    for (var b = 1; b < n; b++) {
      if (b === WALL || b === ELECTRODE || b === FLAME) continue;
      var k = ruleFor(id, b);
      if (k) out.push({ b: b, rule: list[k] });
    }
    return out;
  };

  Mat.lock();   // every thread has now built the same material table; no new ids may appear at run time
  return C;
})(Math, Mat, ELEMENTS, MAX_MATERIALS, AIR, FLAME, WALL, ELECTRODE, P_STATIC, P_POWDER, P_LIQUID, P_GAS, REACTIONS);
if (typeof module !== "undefined") module.exports = Chem;
