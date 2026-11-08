// Saved chambers: the file format and its checks. No DOM and no drawing, so the same code serves the desktop app, a browser and the tests.
// A file is gzip around one JSON header line and then the raw cell arrays, in the order of FIELDS.
// decode() checks everything and builds a separate copy before anything in the simulation is touched, so a bad file can only produce an error message.
var SaveFile = (function () {
  var F = { FORMAT: "elemental-2" };
  var FIELDS = [["ID", Uint16Array], ["PH", Uint8Array], ["T", Float32Array], ["PR", Float32Array], ["AUX", Uint16Array], ["USED", Float32Array], ["AUX2", Uint16Array], ["U2", Float32Array]];
  var ATMOSPHERES = ["air", "oxygen", "argon", "vacuum"];
  var MIN_SIDE = 16, MAX_SIDE = 512, MAX_CELLS = 20e6, MAX_HEADER = 16 * 1048576;
  var MSG_NOT_SAVE = "That is not a saved chamber.", MSG_VERSION = "This file was saved by a different version, and its materials do not match.", MSG_NEWER = "This file was saved by a newer version of the game.", MSG_DAMAGED = "This save is damaged and could not be loaded.";

  function fail(msg) { var e = new Error(msg); e.friendly = true; return e; }
  F.FIELDS = FIELDS.map(function (f) { return f[0]; });

  // A fingerprint of the material list. Cell arrays store material ids, so a file only means anything against the same list.
  var fingerprint = null;
  F.materials = function (Mat) {
    if (fingerprint) return fingerprint;
    var h = 2166136261 | 0, n = Mat.count();
    for (var id = 0; id < n; id++) {
      var m = Mat.list[id], s = m ? (m.formula || m.name || "") : "";
      for (var k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
      h = Math.imul(h ^ 59, 16777619);
    }
    fingerprint = { count: n, hash: h >>> 0 };
    return fingerprint;
  };

  // ---- Writing ----
  // state is a Sim.snapshot() with optional lab (Lab.serialize()), scene and camera added. Returns the pieces of the uncompressed file.
  F.encode = function (state, Mat) {
    var mats = F.materials(Mat);
    var head = { format: F.FORMAT, W: state.W, H: state.H, D: state.D, ambient: state.ambient, atmosphere: state.atmosphere, lid: !!state.lid, tick: state.tick, count: mats.count, matHash: mats.hash, world: state.world || null, lab: state.lab || null, scene: state.scene || "", camera: state.camera || null };
    var parts = [new TextEncoder().encode(JSON.stringify(head) + "\n")];
    FIELDS.forEach(function (f) { var a = state[f[0]]; parts.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); });
    return parts;
  };

  // ---- Reading ----
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function checkWorld(w) {
    if (w === null || w === undefined) return null;
    if (typeof w !== "object") throw fail(MSG_DAMAGED);
    if (!isNum(w.gravity) || w.gravity < 0 || w.gravity > 100 || !isNum(w.decayScale) || w.decayScale <= 0 || w.decayScale > 1e6) throw fail(MSG_DAMAGED);
    if (w.star !== null && w.star !== undefined && !(w.star && isNum(w.star.x) && isNum(w.star.y) && isNum(w.star.z))) throw fail(MSG_DAMAGED);
    if (w.enrichment !== null && w.enrichment !== undefined && !(isNum(w.enrichment) && w.enrichment >= 0 && w.enrichment <= 1)) throw fail(MSG_DAMAGED);
    var over = null;
    if (w.isotopeOverride) {
      if (typeof w.isotopeOverride !== "object") throw fail(MSG_DAMAGED);
      over = {};
      Object.keys(w.isotopeOverride).forEach(function (z) { var A = w.isotopeOverride[z]; if (!(+z >= 1 && +z <= 118) || !isNum(A) || A < 0 || A >= 320) throw fail(MSG_DAMAGED); over[z] = A; });
    }
    return { gravity: w.gravity, decayScale: w.decayScale, star: w.star ? { x: w.star.x, y: w.star.y, z: w.star.z } : null, structural: !!w.structural, fluid: w.fluid !== false, enrichment: w.enrichment === undefined ? null : w.enrichment, isotopeOverride: over };
  }
  function checkCamera(c) {
    if (!c || typeof c !== "object") return null;
    return ["yaw", "pitch", "dist", "tx", "ty", "tz"].every(function (k) { return isNum(c[k]); }) ? { yaw: c.yaw, pitch: c.pitch, dist: c.dist, tx: c.tx, ty: c.ty, tz: c.tz } : null;
  }
  // The outer shell has to stay solid wall: the simulation reads neighbours without bounds checks, because of it.
  function checkShell(ID, PH, W, H, D, wall) {
    var WD = W * D;
    for (var y = 0; y < H; y++) for (var z = 0; z < D; z++) {
      var edge = y === 0 || y === H - 1 || z === 0 || z === D - 1, step = edge ? 1 : W - 1;
      for (var x = 0; x < W; x += step) { var i = x + z * W + y * WD; if (ID[i] !== wall || PH[i] !== 0) throw fail(MSG_DAMAGED); }
    }
  }
  // env: { Mat, WALL, ambient-independent }. labCheck(lab, cellCount, materialCount) says whether saved equipment is sound.
  // Returns a state that can go to Sim.restore, or throws an error with friendly set and a message fit to show. repaired counts bad numbers replaced.
  F.decode = function (buf, env) {
    var mats = F.materials(env.Mat), nl = buf.indexOf(10);
    if (nl < 1 || nl > MAX_HEADER) throw fail(MSG_NOT_SAVE);
    var head;
    try { head = JSON.parse(new TextDecoder().decode(buf.subarray(0, nl))); } catch (e) { throw fail(MSG_NOT_SAVE); }
    if (!head || typeof head !== "object" || typeof head.format !== "string" || !/^elemental-\d+$/.test(head.format)) throw fail(MSG_NOT_SAVE);
    var version = +head.format.split("-")[1];
    if (version > 2 || version < 1) throw fail(MSG_NEWER);
    if (head.count !== mats.count || (version >= 2 && head.matHash !== mats.hash)) throw fail(MSG_VERSION);
    var W = head.W, H = head.H, D = head.D;
    [W, H, D].forEach(function (s) { if (!Number.isInteger(s) || s < MIN_SIDE || s > MAX_SIDE) throw fail(MSG_DAMAGED); });
    var N = W * H * D;
    if (N > MAX_CELLS) throw fail(MSG_DAMAGED);
    if (!isNum(head.ambient) || head.ambient <= 0 || head.ambient > 1e10 || ATMOSPHERES.indexOf(head.atmosphere) < 0) throw fail(MSG_DAMAGED);
    var need = 0;
    FIELDS.forEach(function (f) { need += N * f[1].BYTES_PER_ELEMENT; });
    if (buf.length - nl - 1 !== need) throw fail(MSG_DAMAGED);
    var world = checkWorld(head.world);
    if (head.lab && env.labCheck && !env.labCheck(head.lab, N, mats.count)) throw fail(MSG_DAMAGED);

    var state = { W: W, H: H, D: D, tick: isNum(head.tick) ? head.tick : 0, ambient: head.ambient, atmosphere: head.atmosphere, lid: !!head.lid, count: mats.count, world: world, lab: head.lab || null, scene: typeof head.scene === "string" ? head.scene : "", camera: checkCamera(head.camera), repaired: 0 };
    var off = nl + 1;
    FIELDS.forEach(function (f) {
      var bytes = N * f[1].BYTES_PER_ELEMENT;
      state[f[0]] = new f[1](buf.slice(off, off + bytes).buffer);   // slice copies, so the array starts at offset 0 and is aligned
      off += bytes;
    });
    var k;
    for (k = 0; k < N; k++) {
      if (state.ID[k] >= mats.count || state.PH[k] > 4 || state.AUX[k] >= mats.count || state.AUX2[k] >= mats.count) throw fail(MSG_DAMAGED);
    }
    checkShell(state.ID, state.PH, W, H, D, env.WALL);
    // A stray bad float would spread through the heat solver, but it does not make the rest of the chamber wrong, so only that number is replaced.
    var T = state.T, PR = state.PR, USED = state.USED, U2 = state.U2, fixed = 0;
    for (k = 0; k < N; k++) {
      if (!(T[k] > 0 && T[k] < Infinity)) { T[k] = head.ambient; fixed++; }
      if (PR[k] !== PR[k] || PR[k] === Infinity || PR[k] === -Infinity) { PR[k] = 0; fixed++; }
      if (USED[k] !== USED[k] || USED[k] === Infinity || USED[k] === -Infinity) { USED[k] = 0; fixed++; }
      if (U2[k] !== U2[k] || U2[k] === Infinity || U2[k] === -Infinity) { U2[k] = 0; fixed++; }
    }
    state.repaired = fixed;
    return state;
  };

  // ---- Files and blobs, where the browser's compression streams exist ----
  F.toBlob = function (state, Mat) {
    var gz = new Blob(F.encode(state, Mat)).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(gz).blob();
  };
  F.fromBlob = function (blob, env) {
    return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer().then(
      function (ab) { return F.decode(new Uint8Array(ab), env); },
      function () { throw fail(MSG_NOT_SAVE); }
    );
  };
  return F;
})();
if (typeof module !== "undefined") module.exports = SaveFile;
