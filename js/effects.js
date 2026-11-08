// Reaction effects: short-lived sprites that show what a reaction is doing, read from the simulation's event ring (Sim.fx).
// Nothing here touches the simulation. A flash marks a burst of heat, fizz hops off a liquid's surface when gas forms in it, a wisp rises
// where gas is given off into the air, and a tinted cloud sinks from the surface where a solid falls out of solution.
// Events are many and the screen is small, so they are thinned out: one effect per small region per moment, and a budget per frame.
var Effects = (function () {
  var E = { enabled: true, active: 0 };
  var MAX = 1600, BUDGET = 140, n = 0;
  var x = new Float32Array(MAX), y = new Float32Array(MAX), z = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  var life = new Float32Array(MAX), span = new Float32Array(MAX), size = new Float32Array(MAX), grow = new Float32Array(MAX), fall = new Float32Array(MAX);
  var cr = new Float32Array(MAX), cg = new Float32Array(MAX), cb = new Float32Array(MAX), op = new Float32Array(MAX), glow = new Uint8Array(MAX);
  var read = 0, buf = null, recent = new Map(), clock = 0;
  var QUIET = [0, 0.14, 0.09, 0.3, 0.2];   // seconds before the same small region shows the same kind of effect again

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function spawn(px, py, pz, s, t, r, g, b, o, isGlow) {
    if (n >= MAX) return -1;
    var k = n++;
    x[k] = px; y[k] = py; z[k] = pz; vx[k] = vy[k] = vz[k] = 0; size[k] = s; grow[k] = 0; fall[k] = 0;
    life[k] = span[k] = t; cr[k] = r; cg[k] = g; cb[k] = b; op[k] = o; glow[k] = isGlow ? 1 : 0;
    return k;
  }
  // The first cell above that is not liquid, so effects in water appear at its surface where they can be seen.
  function surfaceAbove(cx, cy, cz) {
    for (var yy = cy; yy < Math.min(Sim.H - 1, cy + 40); yy++) {
      var i = Sim.idx(cx, yy, cz);
      if (Sim.PH[i] !== P_LIQUID || Sim.ID[i] === AIR) return yy;
    }
    return -1;
  }
  function colourOf(mat, gasForm) {
    var c = gasForm ? Mat.colG : Mat.colS, m3 = mat * 3;
    if (!c || mat <= 0 || !Mat.list[mat]) return [0.85, 0.88, 0.92];
    return [c[m3] / 255, c[m3 + 1] / 255, c[m3 + 2] / 255];
  }

  function react(i, kind, mat, heat) {
    var W = Sim.W, WD = Sim.W * Sim.D, cy = (i / WD) | 0, r0 = i - cy * WD, cz = (r0 / W) | 0, cx = r0 - cz * W;
    var key = ((cx >> 2) * 4096 + (cy >> 2) * 64 + (cz >> 2)) * 8 + kind, until = recent.get(key);
    if (until !== undefined && until > clock) return;
    recent.set(key, clock + QUIET[kind]);
    var k, q, c;
    if (kind === Sim.FX_HEAT) {
      // Material hot enough to glow already shows its heat, so a flash there only adds glare. It marks heat that would otherwise be invisible.
      if (Sim.T[i] > 950) return;
      // Brighter and wider for a bigger jump in temperature. Added light, so it feeds the bloom and never darkens anything.
      var s = Math.min(1, heat / 1500);
      k = spawn(cx + 0.5, cy + 0.5, cz + 0.5, 2.2 + 4 * s, 0.22 + 0.12 * s, 2.2, 1.35, 0.55, 1, true);
      if (k >= 0) grow[k] = 6 * s;
    } else if (kind === Sim.FX_FIZZ) {
      var top = surfaceAbove(cx, cy, cz);
      if (top < 0) return;
      for (q = 0; q < 3; q++) {
        k = spawn(cx + rnd(0.1, 0.9), top + 0.05, cz + rnd(0.1, 0.9), rnd(0.35, 0.65), rnd(0.3, 0.55), 1.1, 1.15, 1.2, 0.85, false);
        if (k < 0) return;
        vx[k] = rnd(-1.2, 1.2); vz[k] = rnd(-1.2, 1.2); vy[k] = rnd(3, 6.5); fall[k] = 16;
      }
    } else if (kind === Sim.FX_GAS) {
      c = colourOf(mat, true);
      var faint = c[0] + c[1] + c[2] > 2.4;   // a colourless gas only shows as a thin haze
      k = spawn(cx + 0.5, cy + 0.8, cz + 0.5, 1.2, rnd(0.9, 1.4), c[0], c[1], c[2], faint ? 0.1 : 0.38, false);
      if (k >= 0) { vy[k] = rnd(2, 4); vx[k] = rnd(-0.5, 0.5); vz[k] = rnd(-0.5, 0.5); grow[k] = 2.4; }
    } else if (kind === Sim.FX_PRECIPITATE) {
      var top2 = surfaceAbove(cx, cy, cz);
      if (top2 < 0) return;
      c = colourOf(mat, false);
      for (q = 0; q < 3; q++) {
        k = spawn(cx + rnd(0, 1), top2 - 0.2, cz + rnd(0, 1), rnd(0.5, 0.9), rnd(0.7, 1.1), c[0], c[1], c[2], 0.9, false);
        if (k < 0) return;
        vy[k] = rnd(-1.2, -0.6); vx[k] = rnd(-0.4, 0.4); vz[k] = rnd(-0.4, 0.4);
      }
    }
  }

  // Once a frame: take in new events, then move and age everything.
  E.update = function (dt) {
    clock += dt;
    if (!Sim.FX) return;
    if (buf !== Sim.FX) { buf = Sim.FX; read = Atomics.load(Sim.FXH, 0); n = 0; recent.clear(); }   // a new chamber starts with nothing
    var head = Atomics.load(Sim.FXH, 0), size0 = Sim.FX_SIZE;
    if (head - read > size0) read = head - size0;   // fell behind: the oldest events have been overwritten
    if (!E.enabled) { read = head; n = 0; E.active = 0; return; }
    var take = Math.min(head - read, BUDGET), skip = head - read - take;
    read += skip;   // when there is a flood, the newest events are the ones worth showing
    for (; read < head; read++) {
      var o = (read & (size0 - 1)) * 4;
      react(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    }
    if (recent.size > 4000) recent.forEach(function (v, key) { if (v <= clock) recent.delete(key); });
    for (var k = 0; k < n; k++) {
      life[k] -= dt;
      if (life[k] <= 0) { n--; if (k !== n) copy(n, k); k--; continue; }
      vy[k] -= fall[k] * dt;
      x[k] += vx[k] * dt; y[k] += vy[k] * dt; z[k] += vz[k] * dt;
      size[k] += grow[k] * dt;
    }
    E.active = n;
  };
  function copy(a, b) { x[b] = x[a]; y[b] = y[a]; z[b] = z[a]; vx[b] = vx[a]; vy[b] = vy[a]; vz[b] = vz[a]; life[b] = life[a]; span[b] = span[a]; size[b] = size[a]; grow[b] = grow[a]; fall[b] = fall[a]; cr[b] = cr[a]; cg[b] = cg[a]; cb[b] = cb[a]; op[b] = op[a]; glow[b] = glow[a]; }

  // Writes the live effects into a point buffer as x, y, z, size, r, g, b, mode. Mode 0.25 to 0.5 is added light; above 0.5 it is opacity.
  E.fill = function (out, at) {
    var o = at;
    for (var k = 0; k < n; k++) {
      var f = life[k] / span[k], fade = f < 0.35 ? f / 0.35 : 1;
      out[o++] = x[k]; out[o++] = y[k]; out[o++] = z[k]; out[o++] = size[k];
      if (glow[k]) { var g = f * f; out[o++] = cr[k] * g; out[o++] = cg[k] * g; out[o++] = cb[k] * g; out[o++] = 0.3; }
      else { out[o++] = cr[k]; out[o++] = cg[k]; out[o++] = cb[k]; out[o++] = 0.5 + 0.5 * op[k] * fade; }
    }
    return n;
  };
  E.capacity = MAX;
  E.clear = function () { n = 0; E.active = 0; recent.clear(); if (Sim.FXH) read = Atomics.load(Sim.FXH, 0); };
  return E;
})();
if (typeof module !== "undefined") module.exports = Effects;
