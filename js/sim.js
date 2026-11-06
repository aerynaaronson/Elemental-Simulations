// Voxel simulation: heat, phases, movement, electricity, radioactivity and neutrons. Temperatures are in kelvin.
// Cell index: x + z*W + y*W*D, y up. The grid's outer shell is an invisible wall, so neighbour lookups need no bounds checks.
var PT_NEUTRON = 0, PT_ALPHA = 1, PT_BETA = 2, PT_GAMMA = 3, PT_DEBRIS = 4, PT_SPARK = 5;

var Sim = (function (Math, Atomics, Mat, ELEMENTS, MAX_MATERIALS, AIR, FLAME, WALL, ELECTRODE, P_STATIC, P_POWDER, P_LIQUID, P_GAS, P_PLASMA, PT_NEUTRON, PT_ALPHA, PT_BETA, PT_GAMMA, PT_DEBRIS, PT_SPARK) {
  var TICKS_PER_SEC = 30, CHUNK = 16, MAX_PARTICLES = 30000, SMOKE = 122;
  var S = {
    W: 0, H: 0, D: 0, tickN: 0, ambient: 293.15, gravity: 1, atmosphere: "air", lid: false, decayScale: 1, busy: false, tickMs: 99, useDriver: true,
    log: [], census: [], stats: { active: 0 }, magnet: null, TICKS_PER_SEC: TICKS_PER_SEC, MAX_PARTICLES: MAX_PARTICLES, isWorker: false
  };
  // Counters live in shared memory so that every thread adds to the same totals.
  ["fissions", "decays", "reactions", "fusions"].forEach(function (name, k) {
    Object.defineProperty(S.stats, name, { get: function () { return STATS[k]; }, set: function (v) { STATS[k] = v; } });
  });
  Object.defineProperty(S, "pCount", { get: function () { return PC[0]; } });
  var W, H, D, WD, dx, dz, dy, N, ID, PH, T, PR, AUX, CH, STAMP, cw, ch, cd, AWAKE, DIRTY, P, VX, VY, VZ, USED, AUX2, U2;
  var rngState = 123456789;
  var px, py, pz, pvx, pvy, pvz, ptype, pmat, plife, pT, pphase, PC, STATS;
  var decayP = new Float32Array(MAX_MATERIALS);
  // Isotopes. An element cell stores its mass number in AUX2. Each isotope has its own half-life and decay mode; any not listed is stable.
  var ISO_RANGE = 320, isoP = new Float32Array(119 * ISO_RANGE), isoMode = new Uint8Array(119 * ISO_RANGE), isoHalf = new Float64Array(119 * ISO_RANGE), hasIso = new Uint8Array(MAX_MATERIALS);
  var MODE_A = 1, MODE_BM = 2, MODE_BP = 3, MODE_SF = 4;
  Object.keys(ISOTOPE_DATA).forEach(function (zs) {
    var z = +zs; hasIso[z] = 1;
    ISOTOPE_DATA[zs].forEach(function (row) {
      var k = z * ISO_RANGE + row[0];
      isoHalf[k] = row[1];
      isoMode[k] = row[2] === "A" ? MODE_A : (row[2] === "B-" ? MODE_BM : (row[2] === "SF" ? MODE_SF : MODE_BP));
    });
  });
  // Neutron behaviour by isotope: chance of fission per neutron crossing a cell, for slow and fast neutrons, and overrides for strong absorbers.
  var FISSION = { "92,235": [0.75, 0.1], "92,233": [0.8, 0.14], "94,239": [0.85, 0.22], "94,241": [0.85, 0.2], "92,238": [0, 0.012], "90,232": [0, 0.004], "93,237": [0, 0.08], "95,241": [0.1, 0.1], "96,245": [0.8, 0.2], "98,251": [0.9, 0.3] };
  var ABSORB = { "54,135": 2.6e6, "62,149": 40000, "48,113": 20000 };
  var fisT = new Float32Array(119 * ISO_RANGE), fisF = new Float32Array(119 * ISO_RANGE), absorb = new Float32Array(119 * ISO_RANGE);
  Object.keys(FISSION).forEach(function (k) { var p = k.split(","), q = +p[0] * ISO_RANGE + +p[1]; fisT[q] = FISSION[k][0]; fisF[q] = FISSION[k][1]; });
  Object.keys(ABSORB).forEach(function (k) { var p = k.split(","); absorb[+p[0] * ISO_RANGE + +p[1]] = ABSORB[k]; });
  // Mass number given to a newly placed element cell: a natural abundance draw where the element has any, otherwise its longest-lived isotope.
  S.enrichment = null;
  S.isotopeOverride = null;
  function chooseIsotope(z) {
    if (S.isotopeOverride && S.isotopeOverride[z]) return S.isotopeOverride[z];
    if (z === 92 && S.enrichment !== null) return rf() < S.enrichment ? 235 : 238;
    var nat = ISOTOPE_NATURAL[z];
    if (nat) { var r = rf(), a = 0; for (var k = 0; k < nat.length; k++) { a += nat[k][1]; if (r <= a) return nat[k][0]; } return nat[nat.length - 1][0]; }
    return ELEMENTS[z].hlA || ELEMENTS[z].iso || 0;
  }
  function massOf(i, z) { var A = AUX2[i]; if (!A || A >= ISO_RANGE) { A = chooseIsotope(z); AUX2[i] = A; } return A; }
  S.isotopeInfo = function (z, A) { var k = z * ISO_RANGE + A; return { half: isoHalf[k], mode: isoMode[k] }; };
  S.massNumber = function (i) { var id = ID[i]; return id <= 118 && hasIso[id] ? massOf(i, id) : 0; };
  var electrodes = [], ChemL = null, S_ambient = 293.15, WATER = Mat.byFormula.H2O;

  function rnd() { rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5; return rngState >>> 0; }
  function rf() { return rnd() / 4294967296; }
  S.rf = rf;
  S.seed = function (v) { rngState = (v | 0) || 1; };

  S.init = function (w, h, d) {
    if (S.busy) S.idle();
    driverOwned = false;
    W = S.W = w; H = S.H = h; D = S.D = d; WD = w * d; dx = 1; dz = w; dy = WD; N = WD * h;
    var A = Pool.alloc;
    ID = S.ID = A(Uint16Array, N); PH = S.PH = A(Uint8Array, N); T = S.T = A(Float32Array, N); PR = S.PR = A(Float32Array, N);
    AUX = S.AUX = A(Uint16Array, N); CH = S.CH = A(Uint8Array, N); STAMP = A(Uint8Array, N);
    // P is excess pressure in kPa. VX, VY, VZ are velocities in eighths of a cell per tick. USED is the share of a cell's substance already
    // consumed, or for a solution how far below full strength it is, so zero means a whole, fresh cell. AUX2 and U2 are a second dissolved species.
    P = S.P = A(Float32Array, N); VX = A(Int8Array, N); VY = A(Int8Array, N); VZ = A(Int8Array, N); USED = S.USED = A(Float32Array, N); AUX2 = S.AUX2 = A(Uint16Array, N); U2 = S.U2 = A(Float32Array, N);
    falling = []; inComp = new Uint8Array(N); anchored = new Uint8Array(N);
    allocFluid(A);
    cw = S.cw = Math.ceil(w / CHUNK); ch = S.ch = Math.ceil(h / CHUNK); cd = S.cd = Math.ceil(d / CHUNK);
    AWAKE = S.AWAKE = A(Int32Array, cw * ch * cd); DIRTY = S.DIRTY = A(Uint8Array, cw * ch * cd);
    px = S.px = A(Float32Array, MAX_PARTICLES); py = S.py = A(Float32Array, MAX_PARTICLES); pz = S.pz = A(Float32Array, MAX_PARTICLES);
    pvx = A(Float32Array, MAX_PARTICLES); pvy = A(Float32Array, MAX_PARTICLES); pvz = A(Float32Array, MAX_PARTICLES);
    ptype = S.ptype = A(Uint8Array, MAX_PARTICLES); pmat = S.pmat = A(Uint16Array, MAX_PARTICLES); plife = A(Float32Array, MAX_PARTICLES);
    pT = A(Float32Array, MAX_PARTICLES); pphase = A(Uint8Array, MAX_PARTICLES);
    PC = A(Int32Array, 1); STATS = A(Int32Array, 8);
    electrodes = [];
    S.clear();
    if (typeof Chem !== "undefined") { ChemL = Chem; Chem.bind(S); }
    updateDecayTable();
  };

  // ---- Shared-memory plumbing ----
  S.sharedBuffers = function () {
    return { W: W, H: H, D: D, ID: ID, PH: PH, T: T, PR: PR, AUX: AUX, CH: CH, STAMP: STAMP, AWAKE: AWAKE, DIRTY: DIRTY, px: px, py: py, pz: pz, pvx: pvx, pvy: pvy, pvz: pvz,
      ptype: ptype, pmat: pmat, plife: plife, pT: pT, pphase: pphase, PC: PC, STATS: STATS, P: P, VX: VX, VY: VY, VZ: VZ, USED: USED, AUX2: AUX2, U2: U2, FU: FU, FV: FV, FW: FW, FLAG: FLAG, FB: new Int32Array([FB]) };
  };
  S.attachShared = function (b, index) {
    W = S.W = b.W; H = S.H = b.H; D = S.D = b.D; WD = W * D; dx = 1; dz = W; dy = WD; N = WD * H;
    ID = S.ID = b.ID; PH = S.PH = b.PH; T = S.T = b.T; PR = S.PR = b.PR; AUX = S.AUX = b.AUX; CH = S.CH = b.CH; STAMP = b.STAMP;
    cw = S.cw = Math.ceil(W / CHUNK); ch = S.ch = Math.ceil(H / CHUNK); cd = S.cd = Math.ceil(D / CHUNK);
    AWAKE = S.AWAKE = b.AWAKE; DIRTY = S.DIRTY = b.DIRTY; px = S.px = b.px; py = S.py = b.py; pz = S.pz = b.pz; pvx = b.pvx; pvy = b.pvy; pvz = b.pvz;
    ptype = S.ptype = b.ptype; pmat = S.pmat = b.pmat; plife = b.plife; pT = b.pT; pphase = b.pphase; PC = b.PC; STATS = b.STATS;
    P = S.P = b.P; VX = b.VX; VY = b.VY; VZ = b.VZ; USED = S.USED = b.USED; AUX2 = S.AUX2 = b.AUX2; U2 = S.U2 = b.U2;
    FU = b.FU; FV = b.FV; FW = b.FW; FLAG = b.FLAG; FB = b.FB[0]; fx = Math.ceil(W / FB); fy = Math.ceil(H / FB); fz = Math.ceil(D / FB);
    S.isWorker = true; rngState = (index * 2654435761) | 1;
    ChemL = Chem; Chem.bind(S); updateDecayTable();
  };
  var ATM = ["air", "oxygen", "argon", "vacuum"];
  S.writeParams = function (P) {
    P[0] = S.ambient; P[1] = S.gravity; P[2] = ATM.indexOf(S.atmosphere); P[3] = S.lid ? 1 : 0;
    P[4] = S.magnet ? 1 : 0; if (S.magnet) { P[5] = S.magnet.x; P[6] = S.magnet.y; P[7] = S.magnet.z; }
    P[8] = S.star ? 1 : 0; if (S.star) { P[9] = S.star.x; P[10] = S.star.y; P[11] = S.star.z; }
    P[12] = S.decayScale; P[13] = S.tickN; P[14] = S.structural ? 1 : 0; P[15] = S.fluid === false ? 0 : 1;
    var oz = S.isotopeOverride ? Object.keys(S.isotopeOverride)[0] : 0;
    P[19] = S.enrichment === null ? -1 : S.enrichment; P[20] = oz ? +oz : 0; P[21] = oz ? S.isotopeOverride[oz] : 0;
  };
  var pending = null, pendingN = 0, lastFlush = 0;
  S.readParams = function (P) {
    S.ambient = P[0]; S_ambient = Math.fround(P[0]); S.gravity = P[1]; S.atmosphere = ATM[P[2]]; S.lid = P[3] === 1;
    S.magnet = P[4] === 1 ? { x: P[5], y: P[6], z: P[7] } : null;
    S.star = P[8] === 1 ? { x: P[9], y: P[10], z: P[11] } : null;
    if (S.decayScale !== P[12]) { S.decayScale = P[12]; updateDecayTable(); }
    S.tickN = P[13]; S.structural = P[14] === 1; S.fluid = P[15] === 1;
    // Particles run on the sim thread, and a neutron can settle a cell's isotope, so that thread needs the same settings the main thread has.
    if (S.isDriver) {
      S.enrichment = P[19] < 0 ? null : P[19];
      if (P[20]) { S.isotopeOverride = {}; S.isotopeOverride[P[20]] = P[21]; } else S.isotopeOverride = null;
    }
    if (pendingN) {
      var now = Date.now();
      if (now - lastFlush > 200) { S.flushLog(Object.keys(pending).map(function (k) { return pending[k]; })); pending = null; pendingN = 0; lastFlush = now; }
    }
  };
  S.noteLost = function (mass) { STATS[5] += Math.round(mass * 1000); };
  S.lostMass = function () { return STATS[5] / 1000; };
  S.mergeLog = function (entries) { for (var k = 0; k < entries.length; k++) S.addLog(entries[k].msg, entries[k].kind, entries[k].n); };

  function updateDecayTable() {
    for (var k = 0; k < isoP.length; k++) {
      var hl = isoHalf[k];
      isoP[k] = hl > 0 ? Math.min(0.5, Math.LN2 / (Mat.simHalfLife(hl) * TICKS_PER_SEC) * S.decayScale) : 0;
    }
  }
  S.setDecayScale = function (v) { S.decayScale = v; updateDecayTable(); };

  S.clear = function () {
    if (S.busy) S.idle();
    S.star = null;
    ID.fill(0); PH.fill(P_GAS); T.fill(S.ambient); PR.fill(0); AUX.fill(0); CH.fill(0); STAMP.fill(0);
    P.fill(0); VX.fill(0); VY.fill(0); VZ.fill(0); USED.fill(0); AUX2.fill(0); U2.fill(0); falling = []; S.history = [];
    FU.fill(0); FV.fill(0); FW.fill(0); FLAG.fill(0); fluidOn = false;
    AWAKE.fill(0); DIRTY.fill(1); PC[0] = 0; electrodes = []; S.log.length = 0; STATS.fill(0); STATS[7] = 2;
    for (var y = 0; y < H; y++) for (var z = 0; z < D; z++) for (var x = 0; x < W; x++) {
      if (x === 0 || z === 0 || x === W - 1 || z === D - 1 || y === 0 || y === H - 1) { var i = x + z * W + y * WD; ID[i] = WALL; PH[i] = P_STATIC; }
    }
  };

  // Open-lid mode: the top shell cells stay walls for lookups, but gas reaching them vents out in moveGas.

  function wake(x, y, z) {
    var cx = x >> 4, cy = y >> 4, cz = z >> 4, u = S.tickN + 40;
    var x0 = (x & 15) === 0 && cx > 0 ? cx - 1 : cx, x1 = (x & 15) === 15 && cx < cw - 1 ? cx + 1 : cx;
    var y0 = (y & 15) === 0 && cy > 0 ? cy - 1 : cy, y1 = (y & 15) === 15 && cy < ch - 1 ? cy + 1 : cy;
    var z0 = (z & 15) === 0 && cz > 0 ? cz - 1 : cz, z1 = (z & 15) === 15 && cz < cd - 1 ? cz + 1 : cz;
    for (var c = y0; c <= y1; c++) for (var b = z0; b <= z1; b++) for (var a = x0; a <= x1; a++) {
      var k = a + b * cw + c * cw * cd; AWAKE[k] = u; DIRTY[k] = 1;
    }
  }
  S.wake = wake;
  function wakeI(i) { var y = (i / WD) | 0, r = i - y * WD, z = (r / W) | 0; wake(r - z * W, y, z); }
  S.wakeI = wakeI;
  S.wakeAll = function () { var u = S.tickN + 40; for (var k = 0; k < AWAKE.length; k++) { AWAKE[k] = u; DIRTY[k] = 1; } };

  // ---- Phase and density helpers ----
  function phaseFor(id, t, prev) {
    if (Mat.sublimes[id]) { if (t >= Mat.bp[id]) return t > Mat.plasmaT[id] ? P_PLASMA : P_GAS; return prev === P_STATIC ? P_STATIC : P_POWDER; }
    if (t >= Mat.bp[id]) return t > Mat.plasmaT[id] ? P_PLASMA : P_GAS;
    var mp = Mat.mp[id];
    if (mp >= 0 && t < mp) return prev === P_STATIC ? P_STATIC : P_POWDER;
    return P_LIQUID;
  }
  S.phaseFor = phaseFor;

  function gasDensity(id, t) { return 0.0122 * Mat.mw[id] / Math.max(t, 1); }
  // Water from a fit to measured densities, with its maximum at 4 C. Anything dissolved replaces its share of the water at the solid's own density, which puts saturated brine close to the measured 1.2 g/cm3.
  function liquidRho(i, id) {
    var t = T[i], r;
    if (id === WATER) {
      var c = t - 273.15, e = c - 3.98;
      r = 1 - e * e * (c + 283) / (503570 * (c + 67.26));
      if (AUX[i]) r += (Mat.rhoS[AUX[i]] - r) * (1 - USED[i]);
      if (AUX2[i]) r += (Mat.rhoS[AUX2[i]] - r) * (1 - U2[i]);
      return r;
    }
    r = 1 - Mat.betaL[id] * (t - Mat.rhoT[id]);
    return Mat.rhoL[id] * (r < 0.5 ? 0.5 : r);
  }
  function solidRho(id, t) { var r = 1 - Mat.betaS[id] * (t - 293); return Mat.rhoS[id] * (r < 0.7 ? 0.7 : r); }
  function densityOf(i) {
    var id = ID[i], ph = PH[i];
    if (ph === P_STATIC) return 1e9;
    if (ph === P_POWDER) return solidRho(id, T[i]);
    if (ph === P_LIQUID) return liquidRho(i, id);
    return gasDensity(id, T[i]);
  }
  // Compressed viscosity at a temperature, from 0 for runny to 1 for glassy. Anything thinner than about 0.7 mPa s flows alike, because this is what stops a cell moving and there is nothing below none.
  function viscOf(id, t) { var v = Mat.viscA[id] + Mat.viscB[id] / (t < 1 ? 1 : t); return v < 0.005 ? 0.005 : (v > 0.98 ? 0.98 : v); }
  S.viscOf = viscOf;
  // Equilibrium vapour in an air cell, on the scale where a full cell of gas holds one cell of the liquid. Partial pressure over 1 atm, by Clausius-Clapeyron.
  function saturation(id, t) { var v = Mat.satA[id] * Math.exp(Mat.satK[id] * (1 / Mat.bp[id] - 1 / (t < 1 ? 1 : t))); return v > 1 ? 1 : v; }
  S.saturation = saturation;

  function setCell(i, id, ph, t) {
    if (id !== AIR && ph !== P_STATIC && ID[i] === ELECTRODE) removeElectrode(i);
    if (PH[i] === P_STATIC) STATS[4] = 1;
    ID[i] = id; PH[i] = ph; T[i] = t; PR[i] = 0; AUX[i] = 0; CH[i] = 0; USED[i] = 0; AUX2[i] = 0; U2[i] = 0; VX[i] = VY[i] = VZ[i] = 0;
    wakeI(i);
  }
  S.setCell = setCell;
  function removeElectrode(i) { var k = electrodes.indexOf(i); if (k >= 0) electrodes.splice(k, 1); }

  function swap(i, j) {
    var a = ID[i]; ID[i] = ID[j]; ID[j] = a;
    a = PH[i]; PH[i] = PH[j]; PH[j] = a;
    var f = T[i]; T[i] = T[j]; T[j] = f;
    f = PR[i]; PR[i] = PR[j]; PR[j] = f;
    a = AUX[i]; AUX[i] = AUX[j]; AUX[j] = a;
    a = CH[i]; CH[i] = CH[j]; CH[j] = a;
    f = USED[i]; USED[i] = USED[j]; USED[j] = f;
    a = AUX2[i]; AUX2[i] = AUX2[j]; AUX2[j] = a;
    f = U2[i]; U2[i] = U2[j]; U2[j] = f;
    a = VX[i]; VX[i] = VX[j]; VX[j] = a;
    a = VY[i]; VY[i] = VY[j]; VY[j] = a;
    a = VZ[i]; VZ[i] = VZ[j]; VZ[j] = a;
    STAMP[i] = STAMP[j] = S.tickN & 255;
  }
  S.swap = swap;

  // ---- Movement ----
  function canEnter(i, j, rho) {
    var jd = ID[j];
    if (jd === AIR) return true;
    var ph = PH[j];
    if (ph === P_STATIC) return false;
    if (ph >= P_GAS) return true;
    var r = ph === P_POWDER ? solidRho(jd, T[j]) : liquidRho(j, jd);
    return rho > r * 1.0001;
  }

  var DIR_X = [1, -1, 0, 0], DIR_Z = [0, 0, 1, -1];

  // Ballistic motion for grains and liquids. Fractions of a cell are resolved by chance, so slow speeds still average out correctly.
  // Top speed is 6 cells a tick, which stays well inside the 16-cell gap that makes multi-threading safe.
  function steps(v) { var a = v < 0 ? -v : v, n = a >> 3; if ((a & 7) && rf() * 8 < (a & 7)) n++; return n; }
  function drag(v) { return v > 1 ? v - 1 - (v >> 4) : (v < -1 ? v + 1 - (v >> 4) : 0); }
  function ballistic(i, x, y, z, ph) {
    var vx = VX[i], vy = VY[i], vz = VZ[i], nx = steps(vx), ny = steps(vy), nz = steps(vz), moved = false;
    var sx = vx < 0 ? -1 : 1, sy = vy < 0 ? -1 : 1, sz = vz < 0 ? -1 : 1, count = nx > ny ? (nx > nz ? nx : nz) : (ny > nz ? ny : nz);
    for (var k = 0; k < count; k++) {
      if (nx > k) {
        var a = i + sx;
        if (ID[a] === AIR || (PH[a] >= P_GAS && ID[a] !== WALL)) { swap(i, a); i = a; x += sx; moved = true; }
        else { VX[i] = -vx >> 2; nx = 0; }
      }
      if (nz > k) {
        var c = i + sz * dz;
        if (ID[c] === AIR || (PH[c] >= P_GAS && ID[c] !== WALL)) { swap(i, c); i = c; z += sz; moved = true; }
        else { VZ[i] = -vz >> 2; nz = 0; }
      }
      if (ny > k) {
        var b = i + sy * dy;
        if (ID[b] === AIR || (PH[b] >= P_GAS && ID[b] !== WALL)) {
          if (y + sy >= H - 1) { VY[i] = 0; ny = 0; continue; }
          swap(i, b); i = b; y += sy; moved = true;
        } else if (sy < 0 && ph === P_LIQUID) {
          // A falling liquid hitting something throws its speed sideways: a splash.
          var sp = (vy < 0 ? -vy : vy) >> 1, o = rnd() & 3;
          VX[i] = DIR_X[o] * sp; VZ[i] = DIR_Z[o] * sp; VY[i] = 0; ny = 0; nx = 0; nz = 0;
        } else if (sy < 0) {
          VY[i] = 0; VX[i] >>= 1; VZ[i] >>= 1; ny = 0;
        } else { VY[i] = -vy >> 2; ny = 0; }
      }
    }
    VX[i] = drag(VX[i]); VZ[i] = drag(VZ[i]);
    // A thick liquid soaks up a kick or a splash. Falling is left alone, because air barely resists it.
    if (ph === P_LIQUID) {
      var thick = viscOf(ID[i], T[i]);
      if (thick > 0.1) { VX[i] *= 1 - thick; VZ[i] *= 1 - thick; if (VY[i] > 0) VY[i] *= 1 - thick; }
    }
    if (moved) { wake(x, y, z); }
    return moved;
  }
  S.ballistic = ballistic;

  // ---- Pressure. Excess pressure in kPa spreads through anything that is not solid, and pushes what it passes through. ----
  function pressurePair(i, j) {
    var pi = P[i], pj = P[j], d = pj - pi;
    if (d < 0.4 && d > -0.4) return;
    if (PH[j] === P_STATIC) return;
    var f = d * 0.22;
    P[i] = pi + f; P[j] = pj - f;
  }
  function pv(j, cur) { return PH[j] === P_STATIC ? cur : P[j]; }

  // Strength in kPa, weaker as a metal nears its melting point. A rough model: real strength depends on far more than melting point.
  function burstStrength(id, t) {
    var mp = Mat.mp[id];
    if (mp <= 0) return 40;
    var soft = 1 - t / mp;
    return (10 + mp * 0.05) * (soft < 0.1 ? 0.1 : soft);
  }
  function pressureStep(i, x, y, z, id, ph) {
    var p = P[i];
    if (S.atmosphere === "vacuum" && id === AIR) p *= 0.5;
    else if (id === AIR) p *= S.lid ? 0.999 : 0.95;
    if (y >= H - 2 && !S.lid) p *= 0.5;
    if (p < (id === AIR ? 1 : 0.2)) { P[i] = 0; return; }
    P[i] = p;
    if (ph === P_STATIC) return;
    if (p > 1.5) {
      var gx = pv(i - dx, p) - pv(i + dx, p), gy = pv(i - dy, p) - pv(i + dy, p), gz = pv(i - dz, p) - pv(i + dz, p);
      if (ph <= P_LIQUID) {
        var rho = ph === P_POWDER ? Mat.rhoS[id] : Mat.rhoL[id], k = 0.5 / (rho < 0.5 ? 0.7 : Math.sqrt(rho));
        var ax = gx * k, ay = gy * k, az = gz * k, lim = 48;
        var nvx = VX[i] + ax, nvy = VY[i] + ay, nvz = VZ[i] + az;
        VX[i] = nvx > lim ? lim : (nvx < -lim ? -lim : nvx); VY[i] = nvy > lim ? lim : (nvy < -lim ? -lim : nvy); VZ[i] = nvz > lim ? lim : (nvz < -lim ? -lim : nvz);
      }
    }
    if (p > 25) {   // enough pressure breaks a solid wall open
      var dirs = [dx, -dx, dz, -dz, dy, -dy], j = i + dirs[rnd() % 6];
      if (PH[j] === P_STATIC && ID[j] !== WALL && ID[j] !== ELECTRODE && p > burstStrength(ID[j], T[j])) {
        PH[j] = P_POWDER; markStatic(); wakeI(j);
        P[j] = p * 0.5; P[i] = p * 0.5;
        S.addLog(Mat.list[ID[j]].name + " ruptures under pressure", "chem");
      }
    }
  }
  S.addPressure = function (i, kPa) { P[i] += kPa; };
  // Boiling point rises with pressure, by Clausius-Clapeyron with Trouton's rule standing in for each liquid's own heat of vaporisation.
  // Below 30 kPa is local noise from bubbles forming, not a sustained rise in the liquid's pressure. No liquid survives above the critical temperature, whatever the pressure.
  // A pumped-out chamber boils things at its own low pressure.
  function boilingPoint(id, p) {
    var bp = S.atmosphere === "vacuum" ? Mat.bpVac[id] : Mat.bp[id];
    if (p <= 30) return bp;
    bp *= 1 + 0.094 * Math.log(1 + p / 100);
    return bp > Mat.crit[id] ? Mat.crit[id] : bp;
  }
  S.boilingPoint = boilingPoint;

  function markStatic() { STATS[4] = 1; }
  S.markStatic = markStatic;

  // Gravity adds to a falling cell's speed. Speeds are whole eighths of a cell per tick, so a fraction of a step is resolved by chance.
  function fallSpeed(v) { var a = S.gravity * 3, n = a | 0; if (rf() < a - n) n++; v -= n; return v < -48 ? -48 : v; }
  function touchesLiquid(i) { return PH[i - dy] === P_LIQUID || PH[i + 1] === P_LIQUID || PH[i - 1] === P_LIQUID || PH[i + dz] === P_LIQUID || PH[i - dz] === P_LIQUID; }

  function movePowder(i, x, y, z, id) {
    if (S.gravity === 0) return false;
    var rho = solidRho(id, T[i]), down = i - dy;
    var dd = ID[down], dp = PH[down];
    if (dd === AIR || dp >= P_GAS) {
      VY[i] = fallSpeed(VY[i]);
      if (VY[i] > -8 && !(VX[i] | VZ[i])) { if (steps(VY[i])) { swap(i, down); wake(x, y - 1, z); } wake(x, y, z); return true; }
      if (ballistic(i, x, y, z, P_POWDER)) return true;
      return false;
    }
    VY[i] = 0;
    if (dp === P_LIQUID) {
      var rl = liquidRho(down, dd);
      if (rho > rl) {
        // Sinking speed scales with how much denser the grain is, how thick the liquid is, and how hard gravity pulls.
        var sink = (0.15 + (rho - rl) / rho) * (1 - viscOf(dd, T[down])) * S.gravity;
        if (rf() < (sink > 0.9 ? 0.9 : sink)) { swap(i, down); wake(x, y, z); wake(x, y - 1, z); return true; }
        return false;
      }
    }
    if (dp === P_POWDER && rho > Mat.rhoS[dd] * 1.5 && rf() < 0.04) { swap(i, down); wake(x, y, z); wake(x, y - 1, z); return true; }
    if (rf() < 0.75) {
      // Friction sets the angle of repose. Below 45 degrees a grain slides toward a drop a few cells away. Above it, a grain only moves over a drop deeper than one cell.
      // Liquid bridges make damp grains cling, which is why wet sand holds a steep face.
      var tan = Mat.repose[id];
      if (tan < 1.7 && touchesLiquid(i)) tan = 1.7;
      var whole = tan | 0, deep = tan >= 1 ? whole + (rf() < tan - whole ? 1 : 0) : 1, far = tan < 1 ? 1 / tan : 1, reach = far | 0;
      if (rf() < far - reach) reach++;
      var s = rnd() & 3;
      for (var k = 0; k < 4; k++) {
        var o = (s + k) & 3, ax = DIR_X[o], az = DIR_Z[o], step = ax + az * dz, side = i + step, tgt = down + step;
        if (canEnter(i, tgt, rho) && ID[tgt] !== WALL && PH[side] !== P_STATIC && PH[side] !== P_POWDER) {
          if (deep < 2 || canEnter(i, tgt - dy, rho)) { swap(i, tgt); wake(x, y, z); wake(x + ax, y - 1, z + az); return true; }
          continue;
        }
        if (reach > 1 && (ID[side] === AIR || PH[side] >= P_GAS)) {
          for (var d = 2; d <= reach; d++) {
            var c = i + step * d;
            if (ID[c] !== AIR && PH[c] < P_GAS) break;
            if (ID[c - dy] === AIR || PH[c - dy] >= P_GAS) { swap(i, side); wake(x, y, z); wake(x + ax, y, z + az); return true; }
          }
        }
      }
    }
    return false;
  }

  function ownNeighbour(c, id, skip) {
    return (c + 1 !== skip && ID[c + 1] === id && PH[c + 1] === P_LIQUID) || (c - 1 !== skip && ID[c - 1] === id && PH[c - 1] === P_LIQUID) || (c + dz !== skip && ID[c + dz] === id && PH[c + dz] === P_LIQUID) ||
      (c - dz !== skip && ID[c - dz] === id && PH[c - dz] === P_LIQUID) || (c + dy !== skip && ID[c + dy] === id && PH[c + dy] === P_LIQUID) || (c - dy !== skip && ID[c - dy] === id && PH[c - dy] === P_LIQUID);
  }
  // Surface tension: a liquid keeps its cells together, so a film stops spreading instead of breaking up into lone cells. The chance reflects how strongly it holds.
  function holdsTogether(id) { var g = Mat.tension[id]; return g > 0.3 || rf() < g / (g + 0.002); }

  function moveLiquid(i, x, y, z, id) {
    var visc = viscOf(id, T[i]);
    if (S.gravity !== 0) {
      var down = i - dy, dd = ID[down], dp = PH[down];
      if (dd === AIR || dp >= P_GAS) {
        VY[i] = fallSpeed(VY[i]);
        if (VY[i] > -8 && !(VX[i] | VZ[i])) { if (steps(VY[i])) { swap(i, down); wake(x, y - 1, z); } wake(x, y, z); return true; }
        return ballistic(i, x, y, z, P_LIQUID);
      }
      if (VY[i] < -8) { ballistic(i, x, y, z, P_LIQUID); }   // landing throws up a splash
      // Heavier sinks, and this is what drives convection: heating thins a liquid, so warm liquid under cold changes places with it. Small differences overturn slowly. Liquids that mix do not layer.
      var tDown = T[down] - T[i];
      if (dp <= P_LIQUID && dp !== P_STATIC && !(dd === id && dp === P_LIQUID && tDown < 0.05 && tDown > -0.05 && AUX[i] === 0 && AUX[down] === 0) && !(dp === P_LIQUID && dd !== id && Mat.miscible(id, dd))) {
        var rho = liquidRho(i, id), r2 = dp === P_POWDER ? solidRho(dd, T[down]) : liquidRho(down, dd);
        if (rho > r2 * 1.00002) {
          var gap = (rho - r2) / rho, p = (gap < 0.01 ? gap * 20 : 0.2 + gap) * (1 - visc) * S.gravity;
          if (rf() < (p > 0.85 ? 0.85 : p)) { swap(i, down); wake(x, y, z); wake(x, y - 1, z); return true; }
        }
      }
    }
    // Liquids that mix wander into each other until the blend is even.
    if (Mat.pol[id]) {
      var mo = rnd() % 6, mj = i + (mo === 4 ? dy : (mo === 5 ? -dy : DIR_X[mo] + DIR_Z[mo] * dz)), mid = ID[mj];
      if (mid !== id && PH[mj] === P_LIQUID && Mat.miscible(id, mid) && rf() < 0.15 * (1 - visc)) { swap(i, mj); wakeI(mj); wake(x, y, z); return true; }
    }
    if (rf() < visc) return false;
    var s = rnd() & 3;
    if (S.gravity !== 0) {
      for (var k = 0; k < 4; k++) {
        var o = (s + k) & 3, ax = DIR_X[o], az = DIR_Z[o], tgt = i - dy + ax + az * dz, side = i + ax + az * dz;
        if ((ID[tgt] === AIR || PH[tgt] >= P_GAS) && ID[tgt] !== WALL && (ID[side] === AIR || PH[side] >= P_GAS)) {
          // Molten metal does not wet what it sits on, so a shallow pool stays beaded at two cells deep rather than running out flat.
          if (Mat.tension[id] > 0.3 && ID[i - dy] === id && ID[i - dy - dy] !== id && holdsTogether(id)) continue;
          if (!ownNeighbour(tgt, id, i) && holdsTogether(id)) continue;
          swap(i, tgt); wake(x, y, z); wake(x + ax, y - 1, z + az); return true;
        }
      }
    }
    // Spreads sideways up to a few cells per tick, which lets pools level out on a coarse grid. Thick liquids creep one cell at a time.
    var o2 = s, ax2 = DIR_X[o2], az2 = DIR_Z[o2], reach = 1 + (((rnd() & 3) * (1 - visc) + 0.5) | 0), best = 0;
    for (var d = 1; d <= reach; d++) {
      var t2 = i + (ax2 + az2 * dz) * d;
      if (ID[t2] === AIR || PH[t2] >= P_GAS) best = d; else break;
    }
    if (best > 0) {
      var nx = i + (ax2 + az2 * dz) * best;
      if (!ownNeighbour(nx, id, i) && holdsTogether(id)) return false;
      swap(i, nx); wake(x, y, z); wake(x + ax2 * best, y, z + az2 * best); return true;
    }
    return false;
  }

  // Evaporation below the boiling point, into the air above. An air cell holds its vapour in AUX (which substance) and USED (how much, as a share of a full cell).
  // The liquid only ever disappears whole, so it goes with a chance equal to the share that left, which conserves mass on average. It cools by the latent heat that left with the vapour.
  // It runs on one tick in four per cell, at four times the amount.
  var EVAP_RATE = 0.096;
  function evaporate(i, x, y, z, id, t) {
    var up = i + dy, sat = saturation(id, t), have = AUX[up] ? USED[up] : 0;
    if (AUX[up] && AUX[up] !== id) return false;
    var vac = S.atmosphere === "vacuum", amount = vac ? EVAP_RATE * 3 * sat : EVAP_RATE * (sat - have);
    if (amount < 1e-6) return false;
    // A part-used cell has less to give, but the chance of it going stays the same, or the leftovers would last too long.
    if (!vac) { AUX[up] = id; USED[up] = have + (id === WATER ? amount : amount * (1 - USED[i])); }
    T[i] = t - amount * Mat.lv[id];
    if (rf() < amount) {
      if (AUX[i]) dropSolute(i);
      ID[i] = AIR; PH[i] = P_GAS; PR[i] = 0; AUX[i] = 0; AUX2[i] = 0; USED[i] = 0; U2[i] = 0; VX[i] = VY[i] = VZ[i] = 0;
      wake(x, y, z);
    }
    return amount > 1e-4;
  }
  // Vapour and spent oxygen spread between air cells. U2 in an air cell is its oxygen debt, as a share of what the cell normally holds, and can run above 1 next to a fire until it spreads out.
  function airPair(i, j) {
    if (ID[j] !== AIR) return false;
    var busy = false, ai = AUX[i], aj = AUX[j];
    if ((ai || aj) && (!ai || !aj || ai === aj)) {
      var vi = ai ? USED[i] : 0, vj = aj ? USED[j] : 0, f = (vj - vi) * 0.45, sp = ai || aj;
      vi += f; vj -= f;
      if (vi < 1e-6) { AUX[i] = 0; USED[i] = 0; } else { AUX[i] = sp; USED[i] = vi; }
      if (vj < 1e-6) { AUX[j] = 0; USED[j] = 0; } else { AUX[j] = sp; USED[j] = vj; }
      if (f > 2e-3 || f < -2e-3) busy = true;
    }
    var du = U2[j] - U2[i];
    if (du > 0.002 || du < -0.002) { var g = du * 0.45; U2[i] += g; U2[j] -= g; if (du > 0.02 || du < -0.02) busy = true; }
    else if (U2[i] < 0.002) U2[i] = 0;
    return busy;
  }
  // Air only needs this on one tick in four, staggered from cell to cell, so a humid chamber costs little. The staggering also means a pair is never visited twice in a tick.
  function airStep(i, x, y, z) {
    var busy = airPair(i, i + dx);
    if (airPair(i, i + dz)) busy = true;
    if (airPair(i, i + dy)) busy = true;
    if (busy && (((x + 1) & 15) < 2 || ((y + 1) & 15) < 2 || ((z + 1) & 15) < 2)) wake(x, y, z);
    if (y >= H - 2 && !S.lid) { U2[i] *= 0.5; if (AUX[i]) { USED[i] *= 0.5; if (USED[i] < 1e-6) { AUX[i] = 0; USED[i] = 0; } } }   // an open top lets stale air out and fresh air in
    if (AUX[i]) airCondense(i, x, y, z, T[i]);
    return busy;
  }
  // Air holding more vapour than it can at its temperature gives up the rest as fog or frost.
  function airCondense(i, x, y, z, t) {
    var vid = AUX[i], over = USED[i] - saturation(vid, t);
    if (over <= 0) return;
    USED[i] -= over;
    if (rf() < over) { ID[i] = vid; PH[i] = phaseFor(vid, t, P_POWDER); PR[i] = 0; AUX[i] = 0; USED[i] = 0; U2[i] = 0; VX[i] = VY[i] = VZ[i] = 0; wake(x, y, z); }
  }

  function moveGas(i, x, y, z, id, t) {
    var rho = gasDensity(id, t), up = i + dy, down = i - dy;
    // Expanding gas rushes toward lower pressure before anything else.
    var pHere = P[i];
    if (pHere > 2) {
      var bestJ = -1, bestP = pHere - 0.5, dirsG = [dy, -dy, dx, -dx, dz, -dz], s0 = rnd() % 6;
      for (var dk = 0; dk < 6; dk++) { var cand = i + dirsG[(dk + s0) % 6]; if ((ID[cand] === AIR) && P[cand] < bestP) { bestP = P[cand]; bestJ = cand; } }
      if (bestJ >= 0) { swap(i, bestJ); var yy = (bestJ / WD) | 0, rr = bestJ - yy * WD, zz = (rr / W) | 0; wake(rr - zz * W, yy, zz); wake(x, y, z); return true; }
    }
    // Self-gravity holds a star together: very hot plasma falls toward the centre of mass instead of rising like hot gas.
    if (S.star && t > 1e6 && rf() < 0.6) {
      var gx = S.star.x - x, gy = S.star.y - y, gz = S.star.z - z, agx = Math.abs(gx), agy = Math.abs(gy), agz = Math.abs(gz), jj, mx = x, my = y, mz = z;
      if (agx >= agy && agx >= agz) { mx += gx > 0 ? 1 : -1; jj = i + (gx > 0 ? 1 : -1); }
      else if (agy >= agz) { my += gy > 0 ? 1 : -1; jj = i + (gy > 0 ? dy : -dy); }
      else { mz += gz > 0 ? 1 : -1; jj = i + (gz > 0 ? dz : -dz); }
      if (ID[jj] === AIR) { swap(i, jj); wake(x, y, z); wake(mx, my, mz); return true; }
      if (agx + agy + agz > 2) return false;
    }
    // The surrounding flow carries gas along with it.
    var fb = ((x / FB) | 0) + ((z / FB) | 0) * fx + ((y / FB) | 0) * fx * fz, fu = FU[fb], fv = FV[fb], fw = FW[fb], speed2 = fu * fu + fv * fv + fw * fw;
    if (speed2 > 0.0025) {
      var r0 = rf() * (Math.abs(fu) + Math.abs(fv) + Math.abs(fw) + 0.5), jf, ox = 0, oy = 0, oz = 0;
      if (r0 < Math.abs(fu)) ox = fu > 0 ? 1 : -1; else if (r0 < Math.abs(fu) + Math.abs(fv)) oy = fv > 0 ? 1 : -1; else if (r0 < Math.abs(fu) + Math.abs(fv) + Math.abs(fw)) oz = fw > 0 ? 1 : -1;
      if (ox | oy | oz) {
        jf = i + ox + oz * dz + oy * dy;
        if (ID[jf] === AIR && y + oy < H - 1) { swap(i, jf); wake(x, y, z); wake(x + ox, y + oy, z + oz); return true; }
      }
    }
    // Buoyancy compares this gas with the surrounding atmosphere at the temperature of the air next to it.
    var envT = ID[up] === AIR ? T[up] : (ID[down] === AIR ? T[down] : t);
    var env = S.atmosphere === "vacuum" ? rho : gasDensity(S.atmosphere === "argon" ? 18 : (S.atmosphere === "oxygen" ? 8 : AIR), envT);
    if (S.atmosphere === "argon") env = 0.0122 * 39.95 / Math.max(envT, 1);
    if (S.atmosphere === "oxygen") env = 0.0122 * 32 / Math.max(envT, 1);
    var bias = S.gravity === 0 ? 0 : Math.max(-1, Math.min(1, (env - rho) / Math.max(env, rho) * 1.4)) * (S.gravity < 1 ? S.gravity : 1);
    var pUp = 0.22 + 0.42 * bias, pDown = 0.22 - 0.42 * bias;
    if (pUp < 0.02) pUp = 0.02; if (pDown < 0.02) pDown = 0.02;
    var r = rf(), j, nx = x, ny = y, nz = z;
    if (r < pUp) { j = up; ny = y + 1; }
    else if (r < pUp + pDown) { j = down; ny = y - 1; }
    else { var o = rnd() & 3; nx = x + DIR_X[o]; nz = z + DIR_Z[o]; j = i + DIR_X[o] + DIR_Z[o] * dz; }
    if (ny === H - 1 && !S.lid) { ID[i] = AIR; PH[i] = P_GAS; AUX[i] = 0; USED[i] = 0; U2[i] = 0; wake(x, y, z); return true; }
    var jd = ID[j];
    if (jd === AIR) { swap(i, j); wake(x, y, z); wake(nx, ny, nz); return true; }
    if (PH[j] >= P_GAS && jd !== id) {
      var r2 = gasDensity(jd, T[j]);
      var ok = ny > y ? rho < r2 : (ny < y ? rho > r2 : false);
      if (ok || rf() < 0.03) { swap(i, j); wake(x, y, z); wake(nx, ny, nz); return true; }
    }
    if (ny > y && PH[j] === P_LIQUID) { if (rf() < 0.7) { swap(i, j); wake(x, y, z); wake(nx, ny, nz); return true; } }
    return false;
  }

  // ---- Magnetism ----
  function magnetPull(i, x, y, z) {
    var m = S.magnet, ax = m.x - x, ay = m.y - y, az = m.z - z;
    var d2 = ax * ax + ay * ay + az * az;
    if (d2 > 2500 || d2 < 2) return false;
    if (rf() > 900 / (d2 + 300)) return false;
    var j, nx = x, ny = y, nz = z, aax = Math.abs(ax), aay = Math.abs(ay), aaz = Math.abs(az);
    if (aay >= aax && aay >= aaz) { ny += ay > 0 ? 1 : -1; j = i + (ay > 0 ? dy : -dy); }
    else if (aax >= aaz) { nx += ax > 0 ? 1 : -1; j = i + (ax > 0 ? 1 : -1); }
    else { nz += az > 0 ? 1 : -1; j = i + (az > 0 ? dz : -dz); }
    if (ID[j] === AIR || PH[j] >= P_LIQUID) { swap(i, j); wake(x, y, z); wake(nx, ny, nz); return true; }
    return false;
  }

  // ---- Phase changes with latent heat ----
  function supported(i) { var d = i - dy; return ID[d] !== AIR && PH[d] <= P_POWDER; }

  // PR holds latent heat in transit, as an equivalent temperature: positive while absorbing on the way up, negative
  // while releasing on the way down. The cell sits at the transition point until the bank is full, which gives
  // the plateaus of a real heating curve. Surplus carries over and a reversed transition refunds the bank, so energy is conserved.
  function phaseStep(i, id, ph, t) {
    var mp = Mat.mp[id], bp = boilingPoint(id, P[i]), pr = PR[i], L, g;
    if (mp > 0 && P[i] > 1) mp += Mat.dTm[id] * P[i];   // melting moves with pressure, down for anything that shrinks as it melts
    if (ph <= P_POWDER) {
      var top = Mat.sublimes[id] ? bp : mp;
      if (top < 0) return false;
      if (t > top) {
        L = Mat.sublimes[id] ? Mat.lf[id] + Mat.lv[id] : Mat.lf[id];
        pr += t - top;
        if (pr >= L) {
          if (ph === P_STATIC) markStatic();
          if (Mat.sublimes[id]) P[i] += 10;
          PH[i] = Mat.sublimes[id] ? P_GAS : P_LIQUID; T[i] = top + pr - L; PR[i] = 0;
          return true;
        }
        T[i] = top; PR[i] = pr;
        return true;
      }
      if (pr > 0) { g = Math.min(pr, top - t); T[i] = t + g; PR[i] = pr - g; }
      else if (pr < 0) PR[i] = 0;
      return false;
    }
    if (ph === P_LIQUID) {
      if (t > bp && pr >= 0) {
        // Bubbles need somewhere to start. Deep in still liquid, with nothing but more liquid around, the temperature climbs a little past boiling first.
        if (pr === 0 && t < bp * 1.008 && !boilSite(i)) return false;
        L = Mat.lv[id]; pr += t - bp;
        if (pr >= L) { PH[i] = P_GAS; T[i] = bp + pr - L; PR[i] = 0; P[i] += 60; if (AUX[i]) dropSolute(i); return true; }   // liquid to vapour expands enormously
        T[i] = bp; PR[i] = pr;
        return true;
      }
      if (mp >= 0 && t < mp && pr <= 0) {
        // Crystals need a seed. Touching its own solid a liquid freezes at once, a foreign surface needs some supercooling, and on its own it can go far below freezing.
        // When it does start, the bank below takes the cell straight back up to the freezing point, as real supercooled water does.
        if (pr === 0 && !freezeSeed(i, id, mp, t)) return false;
        L = Mat.lf[id]; pr -= mp - t;
        if (-pr >= L) { PH[i] = supported(i) ? P_STATIC : P_POWDER; if (PH[i] === P_STATIC) markStatic(); T[i] = mp - (-pr - L); PR[i] = 0; if (AUX[i]) dropSolute(i); return true; }
        T[i] = mp; PR[i] = pr;
        return true;
      }
      if (pr > 0) { g = Math.min(pr, Math.max(bp - t, 0)); T[i] = t + g; PR[i] = pr - g; if (g === 0) PR[i] = 0; }
      else if (pr < 0) { g = Math.min(-pr, Math.max(t - mp, 0)); T[i] = t - g; PR[i] = pr + g; if (g === 0) PR[i] = 0; }
      return false;
    }
    if (t < bp) {
      L = Mat.sublimes[id] ? Mat.lv[id] + Mat.lf[id] : Mat.lv[id];
      pr -= bp - t;
      if (-pr >= L) {
        PH[i] = Mat.sublimes[id] || (mp >= 0 && bp < mp) ? (supported(i) ? P_STATIC : P_POWDER) : P_LIQUID;
        if (PH[i] === P_STATIC) markStatic();
        T[i] = bp - (-pr - L); PR[i] = 0;
        return true;
      }
      T[i] = bp; PR[i] = pr;
      return true;
    }
    if (pr < 0) { g = Math.min(-pr, t - bp); T[i] = t - g; PR[i] = pr + g; }
    var pt = Mat.plasmaT[id];
    if (ph === P_GAS && t > pt) PH[i] = P_PLASMA; else if (ph === P_PLASMA && t < pt * 0.8) PH[i] = P_GAS;
    return false;
  }

  function boilSite(i) {
    return PH[i - dy] !== P_LIQUID || PH[i + dy] !== P_LIQUID || PH[i + 1] !== P_LIQUID || PH[i - 1] !== P_LIQUID || PH[i + dz] !== P_LIQUID || PH[i - dz] !== P_LIQUID;
  }
  function freezeSeed(i, id, mp, t) {
    var under = mp - t;
    if (under >= 0.15 * mp) return true;
    var dirs = [dx, -dx, dz, -dz, dy, -dy], surface = false;
    for (var k = 0; k < 6; k++) {
      var j = i + dirs[k];
      if (PH[j] <= P_POWDER && ID[j] !== AIR) { if (ID[j] === id) return true; surface = true; }
    }
    return surface && under >= 0.02 * mp;
  }

  // Evaporation or freezing pushes a dissolved salt back out as a grain beside the water.
  function dropSolute(i) {
    var dirs = [-dy, dx, -dx, dz, -dz, dy], slots = [[AUX[i], USED[i]], [AUX2[i], U2[i]]];
    AUX[i] = 0; AUX2[i] = 0; USED[i] = 0; U2[i] = 0;
    for (var q = 0; q < 2; q++) {
      if (!slots[q][0]) continue;
      for (var k = 0; k < 6; k++) {
        var j = i + dirs[k];
        if (ID[j] === AIR) { setCell(j, slots[q][0], P_POWDER, T[i]); USED[j] = slots[q][1]; break; }
      }
    }
  }

  // ---- Heat ----
  // Loose grains touch only at points, so a heap conducts roughly a tenth as well as the lump, or a third on the square-root scale used for diffusivity. Two different solids meet across a thin resistive gap.
  var POWDER_CONTACT = 0.35, CONTACT = 0.7;
  // Radiation. A hot surface sends its heat along a ray, and the first solid or liquid it meets absorbs it, so a furnace wall warms what faces it. Stefan-Boltzmann for a 1 cm face over one tick: 0.19 (T/1000)^4 J,
  // scaled by emissivity and divided by heat capacity. One random face is tried per tick with six faces' worth, which averages out. Rays stop short of the 16-cell gap that makes threads safe. Gases are nearly transparent and only lose heat.
  function radiate(i, id, ph, t) {
    var q = t / 1000, q4 = q * q * q * q, loss, cap;
    if (ph >= P_GAS) {
      if (t <= 1200) return false;
      loss = 0.02 * q4; cap = t * (t > 1e6 ? 0.0015 : 0.02);
      T[i] = t - (loss < cap ? loss : cap);
      return true;
    }
    var o = rnd() % 6, d = o === 0 ? dx : (o === 1 ? -dx : (o === 2 ? dz : (o === 3 ? -dz : (o === 4 ? dy : -dy)))), c = i + d;
    if (ID[c] !== AIR && PH[c] < P_GAS) return false;
    var heat = ph === P_LIQUID ? Mat.cL[id] : Mat.cS[id];
    loss = 6 * Mat.emiss[id] * 0.19 * q4 / (heat < 0.2 ? 0.2 : heat); cap = t * 0.02;
    if (loss > cap) loss = cap;
    T[i] = t - loss;
    for (var k = 0; k < 14; k++, c += d) {
      var cd = ID[c];
      if (cd === WALL) return true;
      if (cd !== AIR && PH[c] < P_GAS) {
        var hc = PH[c] === P_LIQUID ? Mat.cL[cd] : Mat.cS[cd], tc = T[c] + loss * heat / (hc < 0.2 ? 0.2 : hc);
        T[c] = tc < t ? tc : (T[c] > t ? T[c] : t);
        wakeI(c);
        return true;
      }
    }
    return true;
  }

  function thermalPair(i, j, id, ph) {
    var jd = ID[j], ti = T[i], tj = T[j], d = tj - ti;
    if (d < 0.02 && d > -0.02) return false;
    if (id === AIR && jd === AIR && d < 3 && d > -3) return false;
    if (jd === WALL && j !== i) { if (rf() > 0.1) return false; }
    if ((id === AIR || jd === AIR) && (S.atmosphere === "vacuum" || ti > 1e6 || tj > 1e6)) return false;   // stellar plasma does not heat the room by conduction
    var pj = PH[j], Di, Dj, Ci, Cj;
    if (ph <= P_POWDER) { Di = Mat.dS[id] * (ph === P_POWDER ? POWDER_CONTACT : 1); Ci = Mat.cS[id]; } else if (ph === P_LIQUID) { Di = Mat.dL[id]; Ci = Mat.cL[id]; } else { Di = Mat.dG[id]; Ci = Mat.cG[id]; }
    if (pj <= P_POWDER) { Dj = Mat.dS[jd] * (pj === P_POWDER ? POWDER_CONTACT : 1); Cj = Mat.cS[jd]; } else if (pj === P_LIQUID) { Dj = Mat.dL[jd]; Cj = Mat.cL[jd]; } else { Dj = Mat.dG[jd]; Cj = Mat.cG[jd]; }
    // Solid contact is limited by the poorer conductor. Contact with a gas is convective, so the faster side sets the rate.
    var De = (ph >= P_GAS || pj >= P_GAS) ? (Di > Dj ? Di : Dj) : (Di < Dj ? Di : Dj);
    if (id !== jd && ph <= P_POWDER && pj <= P_POWDER) De *= CONTACT;
    var inv = 2 * De * d / (Ci + Cj);
    T[i] = ti + inv * Cj; T[j] = tj - inv * Ci;
    if (jd === WALL) T[j] += (S.ambient - T[j]) * 0.02;   // the outer shell is never stepped, so it sheds the heat here
    if (id === AIR && jd === AIR) return d > 25 || d < -25;
    return d > 1 || d < -1;
  }

  // ---- Electricity: pulses run through conductors, Joule-heat them in proportion to resistance, and light up gases ----
  var CH_HEAD = 4;
  function conducts(i, id, ph, t) {
    var sigma = Mat.sigma[id];
    if (id === ELECTRODE) return true;
    if (ph === P_GAS || ph === P_PLASMA) return id <= 118 && (ELEMENTS[id].cat === "noble" || id === 1 || id === 7 || id === 80 || id === 11);
    if (id > 118) {
      var m = Mat.list[id];
      if (ph === P_LIQUID) return id === Mat.byFormula.H2O ? AUX[i] > 0 || rf() < 0.35 : !!(m.acid || m.catZ);
      return false;
    }
    if (sigma < 0.1) return ph !== P_GAS && (id === 14 || id === 32 || id === 5 || id === 52 || id === 34) && t > 500;   // semiconductors wake up when hot
    return ph <= P_LIQUID;
  }

  function electricStep(i, x, y, z, id, ph, t) {
    if (CH[i] === CH_HEAD) {
      var dirs = [dx, -dx, dz, -dz, dy, -dy];
      for (var k = 0; k < 6; k++) {
        var j = i + dirs[k], jd = ID[j];
        if (jd === AIR || jd === WALL || CH[j] !== 0) continue;
        if (conducts(j, jd, PH[j], T[j])) { CH[j] = CH_HEAD + 1; wakeI(j); }
      }
      var sigma = Mat.sigma[id];
      if (id !== ELECTRODE && sigma > 0 && ph <= P_LIQUID && !(Mat.tc[id] > 0 && t < Mat.tc[id])) {
        var C = ph === P_LIQUID ? Mat.cL[id] : Mat.cS[id];
        var joule = 3000 / (sigma * Math.max(C, 0.2));
        T[i] = t + (joule < 400 ? joule : 400);
      }
      if (ph === P_LIQUID && id > 118) ChemL.electrolyse(i, id);
    }
    if (CH[i] > 0) { CH[i]--; }
  }

  S.addElectrode = function (i) { if (electrodes.indexOf(i) < 0) electrodes.push(i); };
  function pulseElectrodes() {
    if (S.tickN % 6 !== 0) return;
    for (var k = 0; k < electrodes.length; k++) {
      var i = electrodes[k];
      if (ID[i] !== ELECTRODE) { electrodes.splice(k--, 1); continue; }
      CH[i] = CH_HEAD; wakeI(i);
    }
  }

  // ---- Radioactivity ----
  var BE = { 1: 0, 2: 7.07, 3: 5.33, 4: 6.46, 5: 6.93, 6: 7.68, 7: 7.48, 8: 7.98, 9: 7.78, 10: 8.03, 11: 8.11, 12: 8.26, 13: 8.33, 14: 8.45, 15: 8.48, 16: 8.49, 17: 8.52, 18: 8.52, 19: 8.58, 20: 8.55, 21: 8.62, 22: 8.72, 23: 8.74, 24: 8.78, 25: 8.77, 26: 8.79 };

  function replaceElement(i, nz, heat) {
    var t = T[i] + heat, prev = PH[i];
    if (prev === P_STATIC) markStatic();
    ID[i] = nz; PH[i] = phaseFor(nz, t, prev); T[i] = t; PR[i] = 0; AUX[i] = 0; USED[i] = 0;
    wakeI(i);
  }

  function setIsotope(i, z, A) { AUX2[i] = hasIso[z] ? A : 0; }

  function decay(i, id, A, mode, x, y, z) {
    S.stats.decays++;
    var C = Math.max(PH[i] <= P_POWDER ? Mat.cS[id] : Mat.cL[id], 0.3);
    if (mode === MODE_A) {
      replaceElement(i, id - 2, 80 / C); setIsotope(i, id - 2, A - 4);
      spawnP(PT_ALPHA, x + 0.5, y + 0.5, z + 0.5, 0.9, 0, 8);
      // The alpha particle slows and picks up two electrons: helium gas.
      var dirs = [dy, dx, -dx, dz, -dz, -dy];
      // Shown as a thin sprinkling of gas cells. Real amounts of helium would fill the chamber on this sped-up clock.
      if (rf() < 0.1) for (var k = 0; k < 6; k++) { var j = i + dirs[k]; if (ID[j] === AIR) { setCell(j, 2, P_GAS, T[i]); AUX2[j] = 4; break; } }
      noteDecay(id, A, id - 2, A - 4, "α");
    } else if (mode === MODE_BM) {
      replaceElement(i, id + 1, 25 / C); setIsotope(i, id + 1, A);
      spawnP(PT_BETA, x + 0.5, y + 0.5, z + 0.5, 1.4, 0, 12);
      noteDecay(id, A, id + 1, A, "β⁻");
    } else if (mode === MODE_BP) {
      replaceElement(i, id - 1, 25 / C); setIsotope(i, id - 1, A);
      spawnP(PT_GAMMA, x + 0.5, y + 0.5, z + 0.5, 2, 0, 6);
      noteDecay(id, A, id - 1, A, "β⁺/EC");
    } else if (mode === MODE_SF) {
      fission(i, id, A, x, y, z, true);
    }
  }

  function noteDecay(z, A, nz, nA, sym) {
    S.addLog(ELEMENTS[z].s + "-" + A + " → " + ELEMENTS[nz].s + "-" + nA + " + " + sym, "nuclear");
  }

  function fission(i, id, A, x, y, z, spontaneous) {
    S.stats.fissions++;
    // Fission is asymmetric: fragments cluster near mass 95 and mass 140. Iodine-135 is a common product, and it decays to xenon-135, the great reactor poison.
    var z1 = Math.round(id * (0.38 + rf() * 0.06)), z2 = id - z1, A1 = Math.round(A * (0.38 + rf() * 0.06)), A2 = A - A1 - 2;
    if (rf() < 0.15) { z2 = 53; A2 = 135; z1 = id - 53; A1 = A - 137; }
    var dirs = [dy, dx, -dx, dz, -dz, -dy];
    // A voxel is a bulk lump, so one fission only burns part of it. It turns into fission products after enough events.
    if (spontaneous || rf() < 0.05) {
      replaceElement(i, z1, 400); setIsotope(i, z1, A1);
      for (var k = 0; k < 6; k++) {
        var j = i + dirs[k];
        if (ID[j] === AIR || PH[j] >= P_GAS) { setCell(j, z2, phaseFor(z2, T[i], P_POWDER), T[i]); setIsotope(j, z2, A2); break; }
      }
    } else { T[i] += 260; wakeI(i); }
    var n = 2 + (rnd() & 1);
    for (var q = 0; q < n; q++) spawnP(PT_NEUTRON, x + 0.5, y + 0.5, z + 0.5, 1.5, 0, 240);
    spawnP(PT_GAMMA, x + 0.5, y + 0.5, z + 0.5, 2, 0, 5);
    S.addLog(ELEMENTS[id].s + "-" + A + " → " + ELEMENTS[z1].s + "-" + A1 + " + " + ELEMENTS[z2].s + "-" + A2 + " + " + n + "n", "nuclear");
    P[i] += 3;
    if (T[i] > 12000 && rf() < 0.2) S.blast(x, y, z, 2 + (rnd() & 1), 0.8);
  }
  S.fission = fission;

  var SPONT = { 92: 1.2e-5, 94: 4e-5, 90: 1e-6, 95: 2e-5, 96: 4e-4, 98: 2e-3, 99: 5e-4, 100: 2e-3 };
  var SCATTER;
  function scatterChance(id) {
    if (!SCATTER) {
      SCATTER = new Float32Array(MAX_MATERIALS);
      for (var k = 1; k < MAX_MATERIALS; k++) SCATTER[k] = 0.03;
      SCATTER[1] = 0.5; SCATTER[6] = 0.3; SCATTER[4] = 0.35; SCATTER[WALL] = 0.9; SCATTER[82] = 0.1;
    }
    if (id === Mat.byFormula.H2O) return 0.45;
    return SCATTER[id];
  }

  function neutronHit(p, i, x, y, z) {
    var id = ID[i], speed = Math.abs(pvx[p]) + Math.abs(pvy[p]) + Math.abs(pvz[p]);
    var thermal = speed < 0.9, ph = PH[i];
    var dens = ph >= P_GAS ? 0.08 : 1;
    var A = id <= 118 && hasIso[id] ? massOf(i, id) : 0, ik = id <= 118 ? id * ISO_RANGE + A : 0;
    if (A) {
      var pf = thermal ? fisT[ik] : fisF[ik];
      if (pf > 0 && rf() < pf) { fission(i, id, A, x, y, z, false); return true; }
    }
    var b = A && absorb[ik] ? absorb[ik] : Mat.barns[id];
    if (b > 0 && rf() < (1 - Math.exp(-b / 150)) * dens * (thermal ? 1 : 0.25)) {
      // Neutron capture adds one to the mass number. U-238 becomes U-239, whose own beta decays lead to plutonium-239, and thorium breeds uranium the same way.
      if (A) {
        if (rf() < 0.5 || absorb[ik]) { AUX2[i] = A + 1; S.addLog(ELEMENTS[id].s + "-" + A + " + n → " + ELEMENTS[id].s + "-" + (A + 1), "nuclear"); }
      } else if (id === 80 && rf() < 0.3) { replaceElement(i, 79, 30); S.addLog("Hg + n → Au", "nuclear"); }
      T[i] += 30;
      return true;
    }
    if (rf() < scatterChance(id) * dens) {
      var mod = id === 1 || id === Mat.byFormula.H2O ? 0.55 : (id === 6 || id === 4 ? 0.75 : 0.97);
      var v = Math.max(speed / 1.73 * mod, 0.35);
      var a = rf() * 6.283, c = rf() * 2 - 1, s = Math.sqrt(1 - c * c);
      pvx[p] = Math.cos(a) * s * v; pvy[p] = c * v; pvz[p] = Math.sin(a) * s * v;
    }
    return false;
  }

  // ---- Particles ----
  function spawnP(type, x, y, z, speed, mat, life) {
    var p = Atomics.add(PC, 0, 1);
    if (p >= MAX_PARTICLES) { Atomics.sub(PC, 0, 1); return -1; }
    var a = rf() * 6.283, c = rf() * 2 - 1, s = Math.sqrt(1 - c * c);
    px[p] = x; py[p] = y; pz[p] = z;
    pvx[p] = Math.cos(a) * s * speed; pvy[p] = c * speed; pvz[p] = Math.sin(a) * s * speed;
    ptype[p] = type; pmat[p] = mat || 0; plife[p] = life; pT[p] = 0; pphase[p] = 0;
    return p;
  }
  S.spawnP = spawnP;
  function killP(p) {
    var l = --PC[0];
    if (p !== l) {
      px[p] = px[l]; py[p] = py[l]; pz[p] = pz[l]; pvx[p] = pvx[l]; pvy[p] = pvy[l]; pvz[p] = pvz[l];
      ptype[p] = ptype[l]; pmat[p] = pmat[l]; plife[p] = plife[l]; pT[p] = pT[l]; pphase[p] = pphase[l];
    }
  }

  function stepParticles() {
    for (var p = PC[0] - 1; p >= 0; p--) {
      var type = ptype[p];
      plife[p] -= 1;
      if (plife[p] <= 0) { killP(p); continue; }
      if (type === PT_SPARK) pvy[p] -= 0.035 * S.gravity;
      var steps = type === PT_NEUTRON ? 2 : 1, dead = false;
      for (var st = 0; st < steps && !dead; st++) {
        var f = 1 / steps, nx = px[p] + pvx[p] * f, ny = py[p] + pvy[p] * f, nz = pz[p] + pvz[p] * f;
        var ix = nx | 0, iy = ny | 0, iz = nz | 0;
        if (ix < 1 || iy < 1 || iz < 1 || ix >= W - 1 || iz >= D - 1 || iy >= H - 1) {
          killP(p); dead = true; break;
        }
        var i = ix + iz * W + iy * WD, id = ID[i];
        if (type === PT_NEUTRON) { if (id !== AIR && id !== WALL && neutronHit(p, i, ix, iy, iz)) { killP(p); dead = true; break; } if (id === WALL && rf() < 0.5) { killP(p); dead = true; break; } }
        else if (type === PT_ALPHA) {
          if (id !== AIR && PH[i] <= P_LIQUID) { killP(p); dead = true; break; }   // stopped by a sheet of paper, or a single voxel
        } else if (type === PT_BETA) {
          if (id !== AIR && PH[i] <= P_LIQUID && rf() < 0.4) { killP(p); dead = true; break; }
        } else if (type === PT_SPARK) {
          if (id !== AIR && PH[i] <= P_LIQUID) { killP(p); dead = true; break; }
        } else if (type === PT_GAMMA && id !== AIR && PH[i] <= P_LIQUID) {
          // Gamma rays are stopped in proportion to density: about 0.06 cm2/g near 1 MeV, so a centimetre of lead halves them and water barely does. In water they split molecules.
          var rg = PH[i] === P_LIQUID ? Mat.rhoL[id] : Mat.rhoS[id];
          if (rf() < 1 - Math.exp(-0.06 * rg)) {
            if (id === WATER && rf() < 0.02) ChemL.radiolyse(i);
            else { T[i] += 2 / Math.max(PH[i] === P_LIQUID ? Mat.cL[id] : Mat.cS[id], 0.2); wakeI(i); }
            killP(p); dead = true; break;
          }
        }
        px[p] = nx; py[p] = ny; pz[p] = nz;
      }
    }
  }

  // Radial blast: a pressure spike at the centre, loose cells thrown outward, static cells broken into grains, and heat for everything nearby.
  S.blast = function (x, y, z, r, strength) {
    var r2 = r * r, heat = 300 * strength;
    for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) for (var c = -r; c <= r; c++) {
      var d2 = a * a + b * b + c * c;
      if (d2 > r2) continue;
      var X = x + a, Y = y + b, Z = z + c;
      if (X < 1 || Y < 1 || Z < 1 || X >= W - 1 || Y >= H - 1 || Z >= D - 1) continue;
      var i = X + Z * W + Y * WD, id = ID[i];
      T[i] += heat * (1 - d2 / (r2 + 1));
      P[i] += 40 * strength * (1 - d2 / (r2 + 1));
      wake(X, Y, Z);
      if (id === AIR || id === WALL || id === ELECTRODE) continue;
      if (PH[i] === P_STATIC) { if (rf() < 0.5 * strength) { PH[i] = P_POWDER; markStatic(); } continue; }
      if (PH[i] >= P_GAS || d2 === 0) continue;
      var v = (24 + rf() * 24) * strength / Math.sqrt(d2), lim = 48;
      var vx = a * v, vy = b * v + 8 * strength, vz = c * v;
      VX[i] = vx > lim ? lim : (vx < -lim ? -lim : vx); VY[i] = vy > lim ? lim : (vy < -lim ? -lim : vy); VZ[i] = vz > lim ? lim : (vz < -lim ? -lim : vz);
    }
    for (var s = 0; s < 8; s++) spawnP(PT_SPARK, x + 0.5, y + 0.5, z + 0.5, 0.5 + rf() * 0.5, 0, 14 + (rnd() & 15));
  };

  // ---- Fusion. Coulomb barrier scales with Z1*Z2; energy comes from the binding-energy curve, which peaks at iron ----
  function fusionStep(i, x, y, z, id, t) {
    if (id > 26) return;
    var dirs = [dx, -dx, dz, -dz, dy, -dy], j = i + dirs[rnd() % 6], jd = ID[j];
    if (jd === AIR || jd > 26 || PH[j] !== P_PLASMA) return;
    var Zs = id + jd;
    if (Zs > 26 || t < id * jd * 1.2e7) return;
    if (rf() > 0.2) return;
    if (Zs === 4 || (id === 2 && jd === 2)) {   // He + He gives Be-8, which falls apart at once unless a third helium arrives: the triple-alpha route
      var k = i + dirs[rnd() % 6];
      if (ID[k] !== 2 || k === j || k === i) return;
      ID[k] = AIR; PH[k] = P_GAS; Zs = 6;
    }
    if (Zs === 3 || Zs === 5 || (Zs < 6 && Zs !== 2)) { if (id !== 1 && jd !== 1) return; if (Zs !== 2) return; }
    var A1 = id === 1 ? 1 : ELEMENTS[id].m, A2 = jd === 1 ? 1 : ELEMENTS[jd].m;
    var dE = (BE[Zs] || 0) * (A1 + A2) - (BE[id] || 0) * A1 - (BE[jd] || 0) * A2;
    if (dE <= 0) return;
    ID[j] = AIR; PH[j] = P_GAS; AUX[j] = 0;
    ID[i] = Zs; PH[i] = P_PLASMA; T[i] = t + dE * 3e5; T[j] = t;
    S.stats.fusions++;
    S.addLog(ELEMENTS[id].s + " + " + ELEMENTS[jd].s + " → " + ELEMENTS[Zs].s + " (fusion)", "nuclear");
    spawnP(PT_GAMMA, x + 0.5, y + 0.5, z + 0.5, 2, 0, 6);
    wake(x, y, z);
  }

  // ---- Main loop ----
  function cellStep(i, x, y, z, stamp) {
    var id = ID[i], ph = PH[i], t = T[i], busy = false;
    if (id === AIR && t === S_ambient && T[i + 1] === t && T[i + dz] === t && T[i + dy] === t && P[i] === 0 && P[i + 1] === 0 && P[i + dz] === 0 && P[i + dy] === 0) {
      if (((x + y + z + stamp) & 3) !== 0) return false;
      if (AUX[i] === 0 && AUX[i + 1] === 0 && AUX[i + dz] === 0 && AUX[i + dy] === 0 && U2[i] === 0 && U2[i + 1] === 0 && U2[i + dz] === 0 && U2[i + dy] === 0) return false;
      return airStep(i, x, y, z);
    }
    // Heat exchange with the three forward neighbours; each pair is visited once per tick.
    if (id !== WALL) {
      if (thermalPair(i, i + dx, id, ph)) busy = true;
      if (thermalPair(i, i + dz, id, ph)) busy = true;
      if (thermalPair(i, i + dy, id, ph)) busy = true;
      // Walls are not stepped, so a cell also has to reach back to any wall behind it, or the floor would conduct nothing.
      if (id !== AIR) {
        if (ID[i - dx] === WALL && thermalPair(i, i - dx, id, ph)) busy = true;
        if (ID[i - dz] === WALL && thermalPair(i, i - dz, id, ph)) busy = true;
        if (ID[i - dy] === WALL && thermalPair(i, i - dy, id, ph)) busy = true;
      }
      // Heat moving across a chunk's edge has to wake the chunk beside it, or it stops dead at the seam.
      if (busy && (((x + 1) & 15) < 2 || ((y + 1) & 15) < 2 || ((z + 1) & 15) < 2)) wake(x, y, z);
      if (ph !== P_STATIC) {
        if (P[i] !== 0 || P[i + 1] !== 0) pressurePair(i, i + dx);
        if (P[i] !== 0 || P[i + dz] !== 0) pressurePair(i, i + dz);
        if (P[i] !== 0 || P[i + dy] !== 0) pressurePair(i, i + dy);
      }
      // Gas that warms at fixed volume gains pressure, as Gay-Lussac's law says. Scaled by the same factor as the rest of the pressure field.
      if (ph >= P_GAS && id !== AIR) { var dT0 = T[i] - t; if (dT0 > 1 && t > 1) P[i] += dT0 / t * 25; }
      if (P[i] !== 0) { pressureStep(i, x, y, z, id, ph); if (P[i] > 1) busy = true; }
    }
    if (id === AIR) {
      if (((x + y + z + stamp) & 3) === 0 && airStep(i, x, y, z)) busy = true;
      if (ID[i] !== AIR) return true;
      if (S.atmosphere !== "vacuum") {
        if (T[i] > 20000) T[i] = 20000;
        var dT = S.ambient - T[i];
        if (dT > 3 || dT < -3) {
          if (!S.lid) T[i] += dT * 0.015;   // under a lid the air keeps its heat, and only loses it through the walls
          if (dT > 25 || dT < -25) busy = true;
          var fbA = ((x / FB) | 0) + ((z / FB) | 0) * fx + ((y / FB) | 0) * fx * fz, ua = FU[fbA], va = FV[fbA], wa = FW[fbA], next = i + dy;
          // Hot air rides the flow. With no flow worth mentioning, it rises on its own.
          if (ua * ua + va * va + wa * wa > 0.01) {
            var ra = rf() * (Math.abs(ua) + Math.abs(va) + Math.abs(wa) + 0.3), nextA = 0;
            if (ra < Math.abs(ua)) nextA = ua > 0 ? 1 : -1; else if (ra < Math.abs(ua) + Math.abs(va)) nextA = va > 0 ? dy : -dy; else if (ra < Math.abs(ua) + Math.abs(va) + Math.abs(wa)) nextA = wa > 0 ? dz : -dz;
            if (nextA) next = i + nextA;
          }
          if (ID[next] === AIR && Math.abs(T[next] - T[i]) > 1 && rnd() & 1) { var f = T[next]; T[next] = T[i]; T[i] = f; }
        } else if (!S.lid) T[i] = S_ambient;
      } else T[i] = S_ambient;
      return busy;
    }
    if (id === WALL) { if (T[i] !== S.ambient) { T[i] += (S.ambient - T[i]) * 0.02; if (Math.abs(T[i] - S.ambient) < 0.3) T[i] = S.ambient; } return false; }
    t = T[i];

    if (id === SMOKE) {
      if (rf() < 0.012) { ID[i] = AIR; PH[i] = P_GAS; wake(x, y, z); return true; }
      if (STAMP[i] !== stamp) moveGas(i, x, y, z, id, t > 500 ? t : 500);
      return true;
    }
    if (id === FLAME) {
      T[i] = t * 0.945;
      if (T[i] < 900 || rf() < 0.02) { ID[i] = AIR; PH[i] = P_GAS; AUX[i] = 0; wake(x, y, z); return true; }
      if (STAMP[i] !== stamp) { moveFlame(i, x, y, z); }
      return true;
    }

    if (id <= 118 && hasIso[id]) {
      var massA = massOf(i, id), pd = isoP[id * ISO_RANGE + massA];
      if (pd > 0) { busy = true; if (rf() < pd) { decay(i, id, massA, isoMode[id * ISO_RANGE + massA], x, y, z); return true; } }
    }
    if (SPONT[id] && rf() < SPONT[id]) spawnP(PT_NEUTRON, x + 0.5, y + 0.5, z + 0.5, 1.5, 0, 240);

    if (phaseStep(i, id, ph, t)) { busy = true; ph = PH[i]; t = T[i]; wake(x, y, z); }

    if (t > 800 && radiate(i, id, ph, t)) busy = true;

    if (CH[i] > 0) { electricStep(i, x, y, z, id, ph, t); busy = true; if (ID[i] !== id) return true; }

    if (ph === P_PLASMA && t > 1e7) fusionStep(i, x, y, z, id, t);
    if (ID[i] !== id) return true;

    if (ChemL.step(i, x, y, z, id, ph, t)) { wake(x, y, z); return true; }

    if (ph === P_LIQUID && ((x + z + stamp) & 3) === 0 && ID[i + dy] === AIR && S.atmosphere !== "argon" && t < Mat.bp[id] && evaporate(i, x, y, z, id, t)) { busy = true; if (ID[i] !== id) return true; }
    if (STAMP[i] === stamp) return busy;
    if (S.magnet && Mat.curie[id] > T[i] && ph <= P_POWDER && ph !== P_STATIC && magnetPull(i, x, y, z)) return true;
    if (ph <= P_LIQUID && ph !== P_STATIC && (VX[i] | VZ[i] | (VY[i] > 0 ? 1 : 0))) { if (ballistic(i, x, y, z, ph)) return true; }
    if (ph === P_POWDER) { if (movePowder(i, x, y, z, id)) return true; }
    else if (ph === P_LIQUID) { if (moveLiquid(i, x, y, z, id)) return true; }
    else if (ph >= P_GAS) { if (moveGas(i, x, y, z, id, T[i])) return true; }
    return busy;
  }

  function moveFlame(i, x, y, z) {
    var r = rf(), j, nx = x, ny = y, nz = z;
    if (r < 0.7) { j = i + dy; ny++; } else { var o = rnd() & 3; nx += DIR_X[o]; nz += DIR_Z[o]; j = i + DIR_X[o] + DIR_Z[o] * dz; }
    if (ny === H - 1) { ID[i] = AIR; AUX[i] = 0; return; }
    if (ID[j] === AIR) { swap(i, j); wake(nx, ny, nz); }
    else if (T[j] < 2000 && PH[j] <= P_LIQUID) { T[j] += 0.5; }
  }

  // Process one chunk. Chunks of one colour sit at least 16 cells apart and no cell reaches further than that in a tick, so they can run at once.
  S.runChunk = function (k) {
    var tick = S.tickN, stamp = tick & 255, rev = tick & 1, cy = (k / (cw * cd)) | 0, r = k - cy * cw * cd, cz = (r / cw) | 0, cx = r - cz * cw;
    var y0 = cy << 4, y1 = Math.min(H - 1, y0 + CHUNK), z0 = cz << 4, z1 = Math.min(D - 1, z0 + CHUNK), x0 = cx << 4, x1 = Math.min(W - 1, x0 + CHUNK);
    if (y0 === 0) y0 = 1; if (z0 === 0) z0 = 1; if (x0 === 0) x0 = 1;
    var busy = false;
    for (var y = y0; y < y1; y++) {
      for (var z = z0; z < z1; z++) {
        var row = z * W + y * WD;
        if (rev) { for (var x = x0; x < x1; x++) { if (cellStep(x + row, x, y, z, stamp)) busy = true; } }
        else { for (var x2 = x1 - 1; x2 >= x0; x2--) { if (cellStep(x2 + row, x2, y, z, stamp)) busy = true; } }
      }
    }
    if (busy) { DIRTY[k] = 1; if (AWAKE[k] < tick + 20) AWAKE[k] = tick + 20; }
  };

  // A tick has three parts, always in this order. The first and last stay on the main thread, which owns electrodes, the census and the journal.
  // With threads, the middle runs on a dedicated sim thread, so the main thread can keep drawing while it works. Without them, it all runs here.
  // The main thread only touches cells while no tick is running: see tickStart, tickPoll and idle.
  var passes = null, driverOwned = false;
  function tickBegin() {
    S.tickN++;
    var tick = S.tickN;
    S_ambient = Math.fround(S.ambient);
    pulseElectrodes();
    // Slow reactions such as rust and spontaneous ignition still happen in chunks that have gone quiet.
    if (tick % 2 === 0) AWAKE[rnd() % AWAKE.length] = tick + 2;
    if (S.magnet) S.wakeAll();
    if (Pool.PARAMS) S.writeParams(Pool.PARAMS);
  }
  function tickCells() {
    var tick = S.tickN;
    if (!passes || passes.total !== AWAKE.length) {
      passes = { total: AWAKE.length, list: [], n: new Int32Array(8) };
      for (var q = 0; q < 8; q++) passes.list.push(new Int32Array(AWAKE.length));
    }
    passes.n.fill(0);
    var active = 0, k = 0;
    for (var cy = 0; cy < ch; cy++) for (var cz = 0; cz < cd; cz++) for (var cx = 0; cx < cw; cx++, k++) {
      if (AWAKE[k] < tick) continue;
      var c = (cx & 1) | ((cz & 1) << 1) | ((cy & 1) << 2);
      passes.list[c][passes.n[c]++] = k; active++;
    }
    // Lower layers first so falling material is not moved twice. Sideways order rotates each tick so no seam builds up at chunk edges.
    var rot = tick & 3;
    for (var layer = 0; layer < 2; layer++) for (var e = 0; e < 4; e++) {
      var col = ((e + rot) & 3) | (layer << 2);
      Pool.run(JOB_CELLS, passes.list[col], passes.n[col], S.runChunk);
    }
    STATS[6] = active;
  }
  function tickRest() {
    var tick = S.tickN;
    // Rigid pieces and air currents belong to whichever thread runs this part. A clear or restore on the main thread asks it to forget them here.
    if (STATS[7]) { falling = []; if (STATS[7] === 2) fluidOn = false; STATS[7] = 0; }
    stepParticles();
    if (S.structural) structureStep(tick);
    if (S.fluid !== false && tick % 2 === 0) fluidStep();
  }
  function tickEnd() {
    var tick = S.tickN;
    if (S.galvanic !== false && tick % 15 === 7 && S.hasCellMaterials) galvanicStep();
    S.stats.active = STATS[6];
    if (tick % (N > 3.2e6 ? 30 : 15) === 0) S.updateCensus();
  }
  function useThread() { return S.useDriver && Pool.driverReady; }
  function finishThreaded() {
    S.busy = false;
    S.tickMs = Pool.PARAMS[22];
    tickEnd();
  }
  Object.defineProperty(S, "threaded", { get: useThread });
  // Runs one whole tick and returns when it is done.
  S.tick = function () {
    if (S.busy) S.idle();
    if (useThread()) { S.tickStart(); S.idle(); return; }
    tickBegin(); tickCells(); tickRest(); tickEnd();
  };
  // Sets a tick going on the sim thread and returns at once.
  S.tickStart = function () {
    if (S.busy) return;
    // The main thread ran any ticks before the sim thread was ready. Rigid pieces it was tracking are found again by a fresh search.
    if (!driverOwned) { driverOwned = true; STATS[4] = 1; }
    tickBegin();
    S.busy = true;
    Pool.startTick();
  };
  // True once, when a running tick has finished.
  S.tickPoll = function () {
    if (!S.busy || !Pool.tickDone()) return false;
    finishThreaded();
    return true;
  };
  // Waits for a running tick to finish. Anything about to change cells calls this first.
  S.idle = function () {
    if (!S.busy) return;
    var t0 = performance.now();
    while (!Pool.tickDone()) { if (performance.now() - t0 > 20000) { console.error("Sim thread stalled."); break; } }
    finishThreaded();
  };
  // Sim thread: the middle of the tick, and the private working memory it needs.
  S.becomeDriver = function () {
    S.isDriver = true;
    inComp = new Uint8Array(N); anchored = new Uint8Array(N); falling = [];
    var n = fx * fy * fz;
    FT = new Float32Array(n); FP = new Float32Array(n); FDIV = new Float32Array(n); U0 = new Float32Array(n); V0 = new Float32Array(n); W0 = new Float32Array(n); FRho = new Float32Array(n);
  };
  S.driveTick = function (params) {
    var t0 = performance.now();
    S.readParams(params);
    S_ambient = Math.fround(S.ambient);
    tickCells();
    tickRest();
    params[22] = performance.now() - t0;
  };

  // ---- Fluid. Stable-fluids solver on a coarse grid: buoyancy and pressure drive it, advection carries it, and projection keeps it divergence free
  // around solid obstacles. It runs on the CPU because the cells it moves live in CPU memory. Reading a GPU result back would add frames of lag.
  var FU, FV, FW, FLAG, FB = 4, fx, fy, fz, fluidOn = false, FT, FP, FDIV, U0, V0, W0, FRho;
  function allocFluid(A) {
    FB = N > 3.2e6 ? 8 : 4;
    fx = Math.ceil(W / FB); fy = Math.ceil(H / FB); fz = Math.ceil(D / FB);
    var n = fx * fy * fz;
    FU = S.FU = A(Float32Array, n); FV = S.FV = A(Float32Array, n); FW = S.FW = A(Float32Array, n); FLAG = A(Uint8Array, n);
    FT = new Float32Array(n); FP = new Float32Array(n); FDIV = new Float32Array(n); U0 = new Float32Array(n); V0 = new Float32Array(n); W0 = new Float32Array(n); FRho = new Float32Array(n);
    S.FB = FB; S.fluidDims = [fx, fy, fz];
  }
  function fluidGather() {
    var any = false, amb = S.ambient, k = 0, half = FB >> 1, fxz = fx * fz;
    for (var by = 0; by < fy; by++) for (var bz = 0; bz < fz; bz++) for (var bx = 0; bx < fx; bx++, k++) {
      var y = by * FB + half, z = bz * FB + half, x = bx * FB + half;
      if (y >= H - 1) y = H - 2; if (z >= D - 1) z = D - 2; if (x >= W - 1) x = W - 2;
      var i = x + z * W + y * WD, i2 = (x > 1 ? x - 1 : x) + (z > 1 ? z - 1 : z) * W + (y > 1 ? y - 1 : y) * WD;
      var ph = PH[i], solidCell = ID[i] !== AIR && ph <= P_LIQUID && ID[i2] !== AIR && PH[i2] <= P_LIQUID;
      FLAG[k] = solidCell || bx === 0 || bz === 0 || by === 0 || bx === fx - 1 || bz === fz - 1 ? 1 : 0;
      var tt = (T[i] + T[i2]) * 0.5, pp = P[i] > P[i2] ? P[i] : P[i2];
      FT[k] = tt - amb; FRho[k] = pp;
      if (tt - amb > 8 || pp > 1) any = true;
    }
    return any;
  }
  function fluidIdx(a, b, c) { return (a < 0 ? 0 : (a >= fx ? fx - 1 : a)) + (c < 0 ? 0 : (c >= fz ? fz - 1 : c)) * fx + (b < 0 ? 0 : (b >= fy ? fy - 1 : b)) * fx * fz; }
  function sample(f, a, b, c) {
    var ia = a | 0, ib = b | 0, ic = c | 0, ta = a - ia, tb = b - ib, tc = c - ic;
    var c00 = f[fluidIdx(ia, ib, ic)] * (1 - ta) + f[fluidIdx(ia + 1, ib, ic)] * ta, c10 = f[fluidIdx(ia, ib + 1, ic)] * (1 - ta) + f[fluidIdx(ia + 1, ib + 1, ic)] * ta;
    var c01 = f[fluidIdx(ia, ib, ic + 1)] * (1 - ta) + f[fluidIdx(ia + 1, ib, ic + 1)] * ta, c11 = f[fluidIdx(ia, ib + 1, ic + 1)] * (1 - ta) + f[fluidIdx(ia + 1, ib + 1, ic + 1)] * ta;
    return (c00 * (1 - tb) + c10 * tb) * (1 - tc) + (c01 * (1 - tb) + c11 * tb) * tc;
  }
  function fluidStep() {
    var active = fluidGather();
    if (!active && !fluidOn) return;
    var n = fx * fy * fz, fxz = fx * fz, k, a, b, c, gInv = 1 / FB;
    // Forces: hot air rises, and pressure pushes from high to low.
    k = 0;
    for (b = 0; b < fy; b++) for (c = 0; c < fz; c++) for (a = 0; a < fx; a++, k++) {
      if (FLAG[k]) { FU[k] = FV[k] = FW[k] = 0; continue; }
      if (S.gravity) { var tk = FT[k]; FV[k] += 0.0008 * S.gravity * (tk > 3000 ? 3000 : tk) * (S.atmosphere === "vacuum" ? 0 : 1); }
      FU[k] -= (FRho[fluidIdx(a + 1, b, c)] - FRho[fluidIdx(a - 1, b, c)]) * 0.004;
      FV[k] -= (FRho[fluidIdx(a, b + 1, c)] - FRho[fluidIdx(a, b - 1, c)]) * 0.004;
      FW[k] -= (FRho[fluidIdx(a, b, c + 1)] - FRho[fluidIdx(a, b, c - 1)]) * 0.004;
    }
    // Vorticity confinement puts back the small swirls the coarse grid smooths away, which is what makes smoke curl.
    U0.set(FU); V0.set(FV); W0.set(FW);
    k = 0;
    for (b = 1; b < fy - 1; b++) for (c = 1; c < fz - 1; c++) for (a = 1; a < fx - 1; a++) {
      k = a + c * fx + b * fxz;
      if (FLAG[k]) continue;
      var wx = (W0[k + fxz] - W0[k - fxz] - V0[k + fx] + V0[k - fx]), wy = (U0[k + fx] - U0[k - fx] - W0[k + 1] + W0[k - 1]), wz = (V0[k + 1] - V0[k - 1] - U0[k + fxz] + U0[k - fxz]);
      FU[k] += (wy * W0[k] - wz * V0[k]) * 0.02; FV[k] += (wz * U0[k] - wx * W0[k]) * 0.02; FW[k] += (wx * V0[k] - wy * U0[k]) * 0.02;
    }
    // Semi-Lagrangian advection, in block units.
    U0.set(FU); V0.set(FV); W0.set(FW);
    k = 0;
    for (b = 0; b < fy; b++) for (c = 0; c < fz; c++) for (a = 0; a < fx; a++, k++) {
      if (FLAG[k]) continue;
      var ba = a - U0[k] * gInv, bb = b - V0[k] * gInv, bc = c - W0[k] * gInv;
      if (ba < 0) ba = 0; if (bb < 0) bb = 0; if (bc < 0) bc = 0;
      FU[k] = sample(U0, ba, bb, bc) * 0.985; FV[k] = sample(V0, ba, bb, bc) * 0.985; FW[k] = sample(W0, ba, bb, bc) * 0.985;
    }
    // Projection by Jacobi iteration: pressure makes the flow divergence free, with solid blocks as walls and an open top unless the lid is on.
    var maxSpeed = 0;
    k = 0;
    for (b = 0; b < fy; b++) for (c = 0; c < fz; c++) for (a = 0; a < fx; a++, k++) {
      if (FLAG[k]) { FDIV[k] = 0; continue; }
      FDIV[k] = 0.5 * (FU[fluidIdx(a + 1, b, c)] - FU[fluidIdx(a - 1, b, c)] + FV[fluidIdx(a, b + 1, c)] - FV[fluidIdx(a, b - 1, c)] + FW[fluidIdx(a, b, c + 1)] - FW[fluidIdx(a, b, c - 1)]);
    }
    FP.fill(0);
    var open = !S.lid;
    for (var it = 0; it < 14; it++) {
      for (b = 1; b < fy - 1; b++) for (c = 1; c < fz - 1; c++) for (a = 1; a < fx - 1; a++) {
        k = a + c * fx + b * fxz;
        if (FLAG[k]) continue;
        var pc = FP[k], s = 0, m = 0, q2;
        q2 = k + 1; if (!FLAG[q2]) { s += FP[q2]; m++; }
        q2 = k - 1; if (!FLAG[q2]) { s += FP[q2]; m++; }
        q2 = k + fx; if (!FLAG[q2]) { s += FP[q2]; m++; }
        q2 = k - fx; if (!FLAG[q2]) { s += FP[q2]; m++; }
        q2 = k - fxz; if (!FLAG[q2]) { s += FP[q2]; m++; }
        if (b === fy - 2) { if (open) m++; else { q2 = k + fxz; if (!FLAG[q2]) { s += FP[q2]; m++; } } }
        else { q2 = k + fxz; if (!FLAG[q2]) { s += FP[q2]; m++; } }
        FP[k] = m ? (s - FDIV[k]) / m : pc;
      }
    }
    for (b = 1; b < fy - 1; b++) for (c = 1; c < fz - 1; c++) for (a = 1; a < fx - 1; a++) {
      k = a + c * fx + b * fxz;
      if (FLAG[k]) continue;
      var pr2 = FP[k], pxp = FLAG[k + 1] ? pr2 : FP[k + 1], pxm = FLAG[k - 1] ? pr2 : FP[k - 1], pzp = FLAG[k + fx] ? pr2 : FP[k + fx], pzm = FLAG[k - fx] ? pr2 : FP[k - fx], pyp = FLAG[k + fxz] ? pr2 : FP[k + fxz], pym = FLAG[k - fxz] ? pr2 : FP[k - fxz];
      FU[k] -= 0.5 * (pxp - pxm); FV[k] -= 0.5 * (pyp - pym); FW[k] -= 0.5 * (pzp - pzm);
      var sp = FU[k] * FU[k] + FV[k] * FV[k] + FW[k] * FW[k];
      if (sp > 16) { var sc = 4 / Math.sqrt(sp); FU[k] *= sc; FV[k] *= sc; FW[k] *= sc; sp = 16; }
      if (sp > maxSpeed) maxSpeed = sp;
    }
    fluidOn = maxSpeed > 1e-4;
    if (!fluidOn && !active) { FU.fill(0); FV.fill(0); FW.fill(0); }
    S.fluidSpeed = Math.sqrt(maxSpeed);
  }
  S.fluidStep = fluidStep;

  // ---- Galvanic cells. Two different metals joined by a conductor and standing in connected solution make a battery. Voltage follows the Nernst equation. ----
  S.cells = [];
  function galvanicStep() {
    var wet = {}, H2O = Mat.byFormula.H2O, dirs = [1, -1, W, -W, WD, -WD], seen = new Set(), cells = [];
    for (var i = 0; i < N; i++) {
      var id = ID[i];
      if (id > 118 || id === AIR || PH[i] > P_LIQUID || !ELEMENTS[id] || ELEMENTS[id].E0 == null || seen.has(i)) continue;
      // Flood through touching metal, collecting which metals have a surface in water.
      var stack = [i], parts = {}, count = 0;
      seen.add(i);
      while (stack.length && count < 40000) {
        var c = stack.pop(), cid = ID[c]; count++;
        for (var k = 0; k < 6; k++) {
          var n = c + dirs[k], nid = ID[n];
          if (nid === H2O && PH[n] === P_LIQUID) { if (cid <= 118) { var e = parts[cid] = parts[cid] || []; if (e.length < 400) e.push({ m: c, w: n }); } continue; }
          if (nid <= 118 && nid !== AIR && PH[n] <= P_LIQUID && ELEMENTS[nid] && ELEMENTS[nid].E0 != null && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      var kinds = Object.keys(parts).map(Number);
      if (kinds.length < 2) continue;
      kinds.sort(function (a, b) { return ELEMENTS[a].E0 - ELEMENTS[b].E0; });
      var an = kinds[0], ca = kinds[kinds.length - 1];
      var cathSite = parts[ca].filter(function (s) { var o = Mat.list[AUX[s.w]]; return o && o.catZ === ca; })[0], anSite = parts[an][rnd() % parts[an].length];
      if (!cathSite) continue;
      if (!waterConnected(anSite.w, cathSite.w, H2O, dirs)) { cells.push({ an: an, ca: ca, E: null }); continue; }
      var catSalt = AUX[cathSite.w], qa = positiveCharge(an), qc = positiveCharge(ca);
      var cA = AUX[anSite.w] && Mat.list[AUX[anSite.w]].catZ === an ? Mat.n0[AUX[anSite.w]] * 1000 * (1 - USED[anSite.w]) : 0.01, cC = Mat.n0[catSalt] * 1000 * (1 - USED[cathSite.w]);
      var E = S.nernst(ELEMENTS[ca].E0, ELEMENTS[an].E0, qa, qc, cA, cC, T[cathSite.w]);
      cells.push({ an: an, ca: ca, E: E });
      if (E <= 0) continue;
      S.addLog("Cell " + ELEMENTS[an].s + " | " + ELEMENTS[ca].s + ": " + E.toFixed(2) + " V", "chem");
      if (rf() > Math.min(1, E)) continue;
      // Anode metal goes into solution as the cathode's anion allows. Cathode ions plate out. Charge balances through the electron counts.
      var anSalt = Mat.salt(an, Mat.list[catSalt].an), d = 0.08, molA = d * Mat.n0[an], molC = molA * qa / qc;
      if (!anSalt) continue;
      USED[anSite.m] += d;
      if (USED[anSite.m] >= 0.98) { setCell(anSite.m, H2O, P_LIQUID, T[anSite.m]); STATS[4] = 1; }
      var share = molA / (Mat.n0[anSalt] * (Mat.list[anSalt].nc || 1));
      if (!AUX[anSite.w]) { AUX[anSite.w] = anSalt; USED[anSite.w] = 1 - Math.min(1, share); }
      else if (AUX[anSite.w] === anSalt) USED[anSite.w] = Math.max(0, USED[anSite.w] - share);
      var taken = molC / (Mat.n0[catSalt] * (Mat.list[catSalt].nc || 1));
      USED[cathSite.w] += taken;
      if (USED[cathSite.w] > 0.99) { AUX[cathSite.w] = 0; USED[cathSite.w] = 0; }
      PLATE[ca] = (PLATE[ca] || 0) + molC;
      if (PLATE[ca] > Mat.n0[ca]) { PLATE[ca] -= Mat.n0[ca]; setCell(cathSite.w, ca, P_STATIC, T[cathSite.w]); AUX2[cathSite.w] = 0; }
      S.wakeI(anSite.m); S.wakeI(cathSite.w); S.wakeI(anSite.w); S.wakeI(cathSite.m);
    }
    S.cells = cells;
  }
  var PLATE = {};
  function positiveCharge(z) { var ox = (ELEMENTS[z].ox || []).filter(function (o) { return o > 0; }); return ox.length ? (z === 29 ? 2 : ox[0]) : 2; }
  // E = E(cathode) - E(anode) - (RT / nF) ln Q, where n is the electrons moved per reaction as written.
  S.nernst = function (Ec, Ea, qa, qc, cA, cC, T0) {
    var g = function (a, b) { return b ? g(b, a % b) : a; }, n = qa * qc / g(qa, qc);
    var Q = Math.pow(cA, n / qa) / Math.pow(cC, n / qc);
    return Ec - Ea - 8.314 * (T0 || 298) / (n * 96485) * Math.log(Q);
  };
  function waterConnected(a, b, H2O, dirs) {
    if (a === b) return true;
    var seen = new Set([a]), stack = [a], steps = 0;
    while (stack.length && steps++ < 60000) {
      var c = stack.pop();
      for (var k = 0; k < 6; k++) {
        var n = c + dirs[k];
        if (n === b) return true;
        if (ID[n] === H2O && PH[n] === P_LIQUID && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    return false;
  }
  S.galvanicStep = galvanicStep;

  // ---- Structure. Solid pieces no longer connected to a wall or the floor fall as one rigid body. Runs on the main thread between passes. ----
  var falling = [], inComp, anchored, flood = null, depth = null, load = null;
  // A cell's breaking load in grams, at this scale: strength in MPa times 20, softening toward the melting point. Stone and ice take far more in compression than in tension. Metals take a little more.
  function breakingLoad(id, t, below) {
    var mp = Mat.mp[id], soft = mp > 0 ? 1 - t / mp : 1, base = Mat.uts[id] * 20 * (soft < 0.1 ? 0.1 : soft);
    return below ? base * (Mat.brittle[id] ? 10 : 4) : base;
  }
  // Each solid cell passes its weight, plus what rests on it, to its neighbours closer to an anchor, mostly downward. Load carried sideways through a join also bends it, which costs a factor of three.
  // Anything overloaded fails: brittle cells snap at once and ductile ones give way over time.
  function checkLoads(tail) {
    var dirs = [1, -1, W, -W, WD, -WD];
    for (var q = tail - 1; q >= 0; q--) {
      var c = flood[q], id = ID[c];
      if (id === WALL || id === ELECTRODE) continue;
      var own = load[c] + Mat.rhoS[id], dc = depth[c], lower = 0, hasBelow = false, k, n;
      load[c] = 0;
      for (k = 0; k < 6; k++) {
        n = c + dirs[k];
        if (n < 0 || n >= N || !anchored[n] || depth[n] >= dc || PH[n] !== P_STATIC) continue;
        if (k === 5) { hasBelow = true; lower += 4; } else lower++;
      }
      if (!lower) continue;
      var hanging = !hasBelow && c + WD < N && anchored[c + WD] && depth[c + WD] < dc;
      if (own * (hasBelow || hanging ? 1 : 3) > breakingLoad(id, T[c], hasBelow) && (Mat.brittle[id] || rf() < 0.2)) {
        PH[c] = P_POWDER; STATS[4] = 1; wakeI(c);
        S.addLog(Mat.list[id].name + (Mat.brittle[id] ? " cracks under its load" : " gives way under its load"), "chem");
        continue;
      }
      for (k = 0; k < 6; k++) {
        n = c + dirs[k];
        if (n < 0 || n >= N || !anchored[n] || depth[n] >= dc || PH[n] !== P_STATIC || ID[n] === WALL || ID[n] === ELECTRODE) continue;
        load[n] += own * (k === 5 ? 4 : 1) / lower;
      }
    }
  }
  function structureStep(tick) {
    if (S.gravity === 0) { falling = []; return; }   // with nothing pulling, an unsupported solid stays where it is
    if (falling.length) stepFalling();
    if (tick % 60 === 0) STATS[4] = 1;   // a regular full check catches any support that went without being flagged
    if (!STATS[4] || tick % 4 !== 0) return;
    STATS[4] = 0;
    anchored.fill(0);
    if (!flood || flood.length !== N) { flood = new Int32Array(N); depth = new Int32Array(N); load = new Float32Array(N); }
    var head = 0, tail = 0, i, k, dirs = [1, -1, W, -W, WD, -WD];
    for (i = 0; i < N; i++) { depth[i] = 0; load[i] = 0; if ((ID[i] === WALL || ID[i] === ELECTRODE) && PH[i] === P_STATIC) { anchored[i] = 1; flood[tail++] = i; } }
    while (head < tail) {
      var c = flood[head++];
      for (k = 0; k < 6; k++) {
        var n = c + dirs[k];
        if (n >= 0 && n < N && !anchored[n] && PH[n] === P_STATIC && ID[n] !== AIR) { anchored[n] = 1; depth[n] = depth[c] + 1; flood[tail++] = n; }
      }
    }
    checkLoads(tail);
    // Anything solid left over is unsupported. Group it into connected pieces. This finds pieces already falling too, so the list starts fresh.
    falling = [];
    for (i = 0; i < N; i++) {
      if (PH[i] !== P_STATIC || anchored[i] || ID[i] === AIR) continue;
      var piece = [i]; anchored[i] = 1;
      for (var q = 0; q < piece.length && piece.length < 200000; q++) {
        for (k = 0; k < 6; k++) { var m = piece[q] + dirs[k]; if (m >= 0 && m < N && !anchored[m] && PH[m] === P_STATIC && ID[m] !== AIR) { anchored[m] = 1; piece.push(m); } }
      }
      piece.sort(function (a, b) { return a - b; });
      falling.push(piece);
    }
  }
  // Cells that a piece walls in on all four sides of their own layer, so a hull displaces water with the air inside it. Marked 2 in inComp. Liquid already inside takes no part.
  function markInterior(piece, y0, layer) {
    var x0 = W, x1 = 0, z0 = D, z1 = 0, k, cells = [];
    for (k = 0; k < piece.length; k++) { var r = piece[k] % WD, cz = (r / W) | 0, cx = r - cz * W; if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz; }
    var bw = x1 - x0 + 1, bd = z1 - z0 + 1;
    if (bw < 3 || bd < 3) return cells;
    var rows = layer.length - 2, out = new Uint8Array(bw * bd), stack = [], base = 0;
    function seed(a, b) { var q = a + b * bw; if (!out[q] && !inComp[base + x0 + a + (z0 + b) * W]) { out[q] = 1; stack.push(q); } }
    for (var row = 1; row <= rows; row++) {
      base = (y0 + row - 1) * WD;
      out.fill(0); stack.length = 0;
      for (var a = 0; a < bw; a++) { seed(a, 0); seed(a, bd - 1); }
      for (var b = 0; b < bd; b++) { seed(0, b); seed(bw - 1, b); }
      while (stack.length) {
        var q0 = stack.pop(), qa = q0 % bw, qb = (q0 / bw) | 0;
        if (qa > 0) seed(qa - 1, qb);
        if (qa < bw - 1) seed(qa + 1, qb);
        if (qb > 0) seed(qa, qb - 1);
        if (qb < bd - 1) seed(qa, qb + 1);
      }
      for (var e = 0; e < bd; e++) for (var f = 0; f < bw; f++) {
        var c = base + x0 + f + (z0 + e) * W;
        if (out[f + e * bw] || inComp[c]) continue;
        cells.push(c);
        if (PH[c] >= P_GAS) layer[row]++;
      }
    }
    for (k = 0; k < cells.length; k++) inComp[cells[k]] = 2;
    return cells;
  }
  // Which way a piece wants to go. Archimedes, one layer at a time. env holds the density of the liquid around each layer, averaged over its exposed faces so that a trickle
  // down one side lifts far less than a full surround. It has one extra layer below and above the piece. Also sets pieceWet if liquid is carrying it, and pieceBias for how strongly.
  var pieceWet = false, pieceBias = 0, pieceHollow = 0, GRAIN_BEARING = 150;
  function pieceDirection(piece) {
    var k, q;
    for (k = 0; k < piece.length; k++) inComp[piece[k]] = 1;
    var y0 = (piece[0] / WD) | 0, rows = ((piece[piece.length - 1] / WD) | 0) - y0 + 3, env = new Float32Array(rows), faces = new Int32Array(rows), layer = new Int32Array(rows);
    var mass = 0, blockedDown = false, blockedUp = false, thick = 0, sideways = [dx, -dx, dz, -dz], wetted = false, inner = null, grit = 0;
    for (k = 0; k < piece.length && !wetted; k++) {
      var w0 = piece[k];
      if (PH[w0 + 1] === P_LIQUID || PH[w0 - 1] === P_LIQUID || PH[w0 + dz] === P_LIQUID || PH[w0 - dz] === P_LIQUID || PH[w0 - dy] === P_LIQUID || PH[w0 + dy] === P_LIQUID) wetted = true;
    }
    if (wetted) inner = markInterior(piece, y0, layer);
    for (k = 0; k < piece.length; k++) {
      var c = piece[k], row = ((c / WD) | 0) - y0 + 1;
      mass += Mat.rhoS[ID[c]]; layer[row]++;
      for (q = 0; q < 4; q++) {
        var s = c + sideways[q];
        if (inComp[s]) continue;
        faces[row]++;
        if (PH[s] === P_LIQUID) { env[row] += liquidRho(s, ID[s]); var vs = viscOf(ID[s], T[s]); if (vs > thick) thick = vs; }
      }
      var below = c - dy, above = c + dy;
      if (!inComp[below]) {
        if (row === 1) faces[0]++;
        if (PH[below] === P_LIQUID) { if (row === 1) env[0] += liquidRho(below, ID[below]); }
        else if (PH[below] === P_POWDER) grit++;
        else if (ID[below] !== AIR && PH[below] < P_GAS) blockedDown = true;
      }
      if (!inComp[above]) {
        if (row === rows - 2) faces[rows - 1]++;
        if (PH[above] === P_LIQUID) { if (row === rows - 2) env[rows - 1] += liquidRho(above, ID[above]); }
        else if (ID[above] !== AIR && PH[above] < P_GAS) blockedUp = true;
      }
    }
    // Loose grains bear a piece only if there are enough of them. Too few under too much weight get squeezed aside.
    if (grit && mass / grit < GRAIN_BEARING) blockedDown = true;
    for (k = 0; k < piece.length; k++) inComp[piece[k]] = 0;
    pieceHollow = inner ? inner.length : 0;
    if (inner) for (k = 0; k < inner.length; k++) inComp[inner[k]] = 0;
    for (q = 0; q < rows; q++) if (faces[q]) env[q] /= faces[q];
    // Weight is compared with the lift halfway to the next position, so a piece settles at the nearest whole layer instead of bobbing.
    var lift = 0, liftDown = 0, liftUp = 0;
    for (q = 1; q < rows - 1; q++) { lift += layer[q] * env[q]; liftDown += layer[q] * env[q - 1]; liftUp += layer[q] * env[q + 1]; }
    pieceWet = lift + liftDown > 0;
    pieceBias = Math.min(0.9, 0.15 + Math.abs(mass - lift) / mass) * (1 - thick);
    return !blockedDown && (lift + liftDown) * 0.5 < mass ? -1 : (!blockedUp && lift > 0 && (lift + liftUp) * 0.5 > mass ? 1 : 0);
  }
  // Moves a piece one layer. Indices ascend with height, so the cells leading the way move first.
  function shiftPiece(piece, move) {
    for (var k = 0; k < piece.length; k++) {
      var at = move < 0 ? k : piece.length - 1 - k, from = piece[at], to = from + move * dy;
      swap(from, to); wakeI(to); wakeI(from);
      piece[at] = to;
    }
    if (move < 0 && pieceHollow) bail(piece);
  }
  // A hull pressing down into water pushes that water aside, around the outside. Swapping cells alone would stand it on the floor of the hull and along the rim, where it would run in.
  function bail(piece) {
    var k, x0 = W, x1 = 0, z0 = D, z1 = 0;
    for (k = 0; k < piece.length; k++) { inComp[piece[k]] = 1; var r = piece[k] % WD, cz = (r / W) | 0, cx = r - cz * W; if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz; }
    for (k = 0; k < piece.length; k++) {
      var p = piece[k] + dy;
      if (inComp[p] || PH[p] !== P_LIQUID) continue;
      // Any spot outside the hull will do, so the whole surface rises together and the lift arrives at once. Walk up from the floor to the water's surface there.
      for (var tries = 0; tries < 32; tries++) {
        var ox = 1 + rnd() % (W - 2), oz = 1 + rnd() % (D - 2);
        if (ox >= x0 && ox <= x1 && oz >= z0 && oz <= z1) continue;
        var c = ox + oz * W + WD, top = (H - 1) * WD;
        while (ID[c] !== AIR && c < top) c += dy;
        if (ID[c] === AIR) { swap(p, c); wakeI(c); wakeI(p); break; }
      }
    }
    for (k = 0; k < piece.length; k++) inComp[piece[k]] = 0;
  }
  function setPieceSpeed(piece, v) { for (var k = 0; k < piece.length; k++) VY[piece[k]] = v; }
  function stepFalling() {
    var still = [];
    for (var f = 0; f < falling.length; f++) {
      var piece = falling[f].filter(function (i) { return PH[i] === P_STATIC && ID[i] !== AIR; });
      if (!piece.length) continue;
      var move = pieceDirection(piece);
      if (!move) { setPieceSpeed(piece, 0); STATS[4] = 1; continue; }
      // In liquid a piece moves as grains do: faster with more difference in density, slower in a thicker liquid.
      if (pieceWet) {
        setPieceSpeed(piece, 0);
        if (rf() < pieceBias * S.gravity) shiftPiece(piece, move);
        still.push(piece);
        continue;
      }
      // In open air it speeds up as it falls. The speed lives in the cells, so it survives the search that finds pieces afresh.
      var v = fallSpeed(VY[piece[0]]), n = steps(v), landed = false;
      for (var s = 0; s < n; s++) {
        shiftPiece(piece, -1);
        if (pieceDirection(piece) !== -1 || pieceWet) { landed = true; break; }
      }
      setPieceSpeed(piece, landed ? 0 : v);
      still.push(piece);
    }
    falling = still;
  }

  // ---- Snapshots for undo and for saved files ----
  var SNAP = ["ID", "PH", "T", "PR", "AUX", "USED", "AUX2", "U2"];
  // Total mass in grams of everything in the chamber, counting dissolved solutes, for checking conservation.
  S.totalMass = function () {
    var total = 0, n0 = Mat.n0, list = Mat.list, water = Mat.byFormula.H2O;
    for (var i = 0; i < N; i++) {
      var id = ID[i];
      if (id === AIR && AUX[i]) { total += USED[i] * n0[AUX[i]] * list[AUX[i]].M; continue; }
      if (id === AIR || id === WALL || id === ELECTRODE || id === FLAME || id === SMOKE) continue;
      var m = list[id];
      total += (1 - (id === water ? 0 : USED[i])) * n0[id] * m.M;
      if (id === water && AUX[i]) total += (1 - USED[i]) * n0[AUX[i]] * list[AUX[i]].M;
      if (id === water && AUX2[i]) total += (1 - U2[i]) * n0[AUX2[i]] * list[AUX2[i]].M;
    }
    return total;
  };
  S.snapshot = function () {
    if (S.busy) S.idle();
    var out = { W: W, H: H, D: D, tick: S.tickN, ambient: S.ambient, atmosphere: S.atmosphere, lid: S.lid, count: Mat.count() };
    SNAP.forEach(function (name) { out[name] = S[name].slice(); });
    return out;
  };
  S.restore = function (snap) {
    if (S.busy) S.idle();
    SNAP.forEach(function (name) { S[name].set(snap[name]); });
    P.fill(0); VX.fill(0); VY.fill(0); VZ.fill(0); CH.fill(0); PC[0] = 0; falling = [];
    electrodes = [];
    for (var i = 0; i < N; i++) if (ID[i] === ELECTRODE) electrodes.push(i);
    S.ambient = snap.ambient; S.atmosphere = snap.atmosphere; S.lid = snap.lid;
    S.wakeAll(); STATS[4] = 1; STATS[7] = 1;
    S.updateCensus();
  };
  S.snapshotFields = SNAP;

  var censusCounts = new Int32Array(MAX_MATERIALS);
  S.updateCensus = function () {
    censusCounts.fill(0);
    for (var i = 0; i < N; i++) censusCounts[ID[i]]++;
    var arr = [], total = 0;
    for (var id = 1; id < MAX_MATERIALS; id++) { var n = censusCounts[id]; if (n && id !== WALL && id !== FLAME) { arr.push([id, n]); total += n; } }
    arr.sort(function (a, b) { return b[1] - a[1]; });
    S.census = arr.slice(0, 14);
    S.totalCells = total;
    // A battery needs water and two kinds of metal, so most scenes can skip the search for one.
    var metals = 0;
    for (var a2 = 0; a2 < arr.length && metals < 2; a2++) if (arr[a2][0] <= 118 && ELEMENTS[arr[a2][0]] && ELEMENTS[arr[a2][0]].E0 != null) metals++;
    S.hasCellMaterials = metals >= 2 && censusCounts[Mat.byFormula.H2O] > 0;
    // Readings for the graphs. The hottest and highest-pressure cells of real matter, and how many reactions have run.
    var hot = 0, press = 0;
    for (var c = 0; c < N; c++) { if (ID[c] !== AIR && ID[c] !== WALL && ID[c] !== FLAME) { if (T[c] > hot) hot = T[c]; } if (P[c] > press) press = P[c]; }
    S.history = S.history || [];
    S.history.push({ t: S.tickN / TICKS_PER_SEC, hot: hot, press: press, reactions: STATS[2] + STATS[0] + STATS[3] });
    if (S.history.length > 240) S.history.shift();
  };

  var seenMsg = {};
  S.addLog = function (msg, kind, n) {
    if (S.isWorker) {
      if (!pending) pending = {};
      if (pending[msg]) pending[msg].n++; else { pending[msg] = { msg: msg, kind: kind || "chem", n: 1 }; }
      pendingN++;
      return;
    }
    if (!seenMsg[msg]) { seenMsg[msg] = 1; if (S.onDiscover) S.onDiscover(msg); }
    var L = S.log, add = n || 1;
    for (var k = 0; k < L.length; k++) if (L[k].msg === msg) { L[k].n += add; L[k].t = S.tickN; if (k > 0) { var e = L.splice(k, 1)[0]; L.unshift(e); } return; }
    L.unshift({ msg: msg, kind: kind || "chem", n: add, t: S.tickN });
    if (L.length > 40) L.pop();
  };

  // ---- Editing ----
  S.idx = function (x, y, z) { return x + z * W + y * WD; };

  S.place = function (x, y, z, id, form, t, overwrite) {
    if (S.busy) S.idle();
    if (x < 1 || y < 1 || z < 1 || x >= W - 1 || y >= H - 1 || z >= D - 1) return;
    var i = x + z * W + y * WD;
    if (!overwrite && ID[i] !== AIR) return;
    if (ID[i] === ELECTRODE) removeElectrode(i);
    var T0 = t === undefined || t === null ? S.ambient : t;
    var ph = id === WALL || id === ELECTRODE ? P_STATIC : phaseFor(id, T0, form);
    if (PH[i] === P_STATIC || ph === P_STATIC) STATS[4] = 1;
    ID[i] = id; PH[i] = ph; T[i] = T0; PR[i] = 0; AUX[i] = 0; CH[i] = 0; USED[i] = 0; AUX2[i] = 0; U2[i] = 0; VX[i] = VY[i] = VZ[i] = 0;
    if (id === ELECTRODE) S.addElectrode(i);
    if (id <= 118 && hasIso[id]) AUX2[i] = chooseIsotope(id);
    wake(x, y, z);
  };

  S.erase = function (x, y, z) {
    if (S.busy) S.idle();
    if (x < 1 || y < 1 || z < 1 || x >= W - 1 || y >= H - 1 || z >= D - 1) return;
    var i = x + z * W + y * WD;
    if (ID[i] === ELECTRODE) removeElectrode(i);
    STATS[4] = 1;   // solids can rest on loose grains as well as on other solids
    ID[i] = AIR; PH[i] = P_GAS; T[i] = S.ambient; PR[i] = 0; AUX[i] = 0; CH[i] = 0; USED[i] = 0; AUX2[i] = 0; U2[i] = 0; VX[i] = VY[i] = VZ[i] = 0; P[i] = 0;
    wake(x, y, z);
  };

  S.box = function (x0, y0, z0, x1, y1, z1, id, form, t) {
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) S.place(x, y, z, id, form, t, true);
  };

  S.dissolve = function (i, solute) { AUX[i] = solute; };

  S.forSphere = function (cx, cy, cz, r, fn) {
    var r2 = r * r + 0.5, R = Math.ceil(r);
    for (var a = -R; a <= R; a++) for (var b = -R; b <= R; b++) for (var c = -R; c <= R; c++) {
      if (a * a + b * b + c * c > r2) continue;
      var X = cx + a, Y = cy + b, Z = cz + c;
      if (X < 1 || Y < 1 || Z < 1 || X >= W - 1 || Y >= H - 1 || Z >= D - 1) continue;
      fn(X, Y, Z, X + Z * W + Y * WD);
    }
  };

  // Brush shapes. Spray thins a sphere, disc is one layer thick, cube fills its bounding box.
  S.forBrush = function (shape, cx, cy, cz, r, fn) {
    if (shape === "cube" || shape === "disc") {
      var ry = shape === "disc" ? 0 : r;
      for (var a = -r; a <= r; a++) for (var b = -ry; b <= ry; b++) for (var c = -r; c <= r; c++) {
        if (shape === "disc" && a * a + c * c > r * r + 0.5) continue;
        var X = cx + a, Y = cy + b, Z = cz + c;
        if (X < 1 || Y < 1 || Z < 1 || X >= W - 1 || Y >= H - 1 || Z >= D - 1) continue;
        fn(X, Y, Z, X + Z * W + Y * WD);
      }
      return;
    }
    S.forSphere(cx, cy, cz, r, shape === "spray" ? function (x, y, z, i) { if (rf() < 0.12) fn(x, y, z, i); } : fn);
  };

  S.spark = function (cx, cy, cz, r) {
    S.forSphere(cx, cy, cz, r, function (x, y, z, i) {
      if (ID[i] === AIR) { if (rf() < 0.04) spawnP(PT_SPARK, x + 0.5, y + 0.5, z + 0.5, 0.4, 0, 8); return; }
      if (conducts(i, ID[i], PH[i], T[i])) { CH[i] = CH_HEAD; wake(x, y, z); }
    });
  };

  S.CHUNK = CHUNK;
  S.gasDensity = gasDensity;
  S.densityOf = densityOf;
  S.CH_HEAD = CH_HEAD;
  return S;
})(Math, Atomics, Mat, ELEMENTS, MAX_MATERIALS, AIR, FLAME, WALL, ELECTRODE, P_STATIC, P_POWDER, P_LIQUID, P_GAS, P_PLASMA, PT_NEUTRON, PT_ALPHA, PT_BETA, PT_GAMMA, PT_DEBRIS, PT_SPARK);
if (typeof module !== "undefined") module.exports = Sim;
