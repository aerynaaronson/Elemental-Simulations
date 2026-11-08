// Turns simulation state into voxel colours and emission. Pure CPU work with no GL calls, so worker threads can share it.
var Shade = (function (Mat, ELEMENTS, AIR, FLAME, WALL, ELECTRODE, P_POWDER, P_LIQUID, P_GAS, P_PLASMA) {
  var S = { heat: false, time: 0 };
  var W, H, D, BLOCK = 8, cW, cH, cD, colorBuf, emitBuf, coarseBuf, matBuf, velX, velY, velZ;
  var WATER_ID = Mat.named("H2O"), LITMUS = Mat.named("Litmus"), PHENOL = Mat.named("Phenolphthalein"), UNIVERSAL = Mat.named("UniversalIndicator");
  // Universal indicator colours from pH 0 to 14.
  var PH_COL = [[200, 30, 40], [225, 50, 40], [235, 90, 40], [240, 130, 40], [240, 170, 40], [235, 205, 50], [190, 215, 60], [90, 190, 80], [50, 170, 130], [50, 140, 180], [50, 100, 200], [70, 70, 200], [100, 60, 190], [120, 50, 170], [130, 40, 150]];
  function phColor(ph) { var k = ph < 0 ? 0 : (ph > 14 ? 14 : ph), a = k | 0, b = a < 14 ? a + 1 : 14, t = k - a; return [PH_COL[a][0] + (PH_COL[b][0] - PH_COL[a][0]) * t, PH_COL[a][1] + (PH_COL[b][1] - PH_COL[a][1]) * t, PH_COL[a][2] + (PH_COL[b][2] - PH_COL[a][2]) * t]; }

  // Blackbody colour by Planck's law, sampled through the eye's response. Below about 800 K nothing is visible.
  var BB = new Uint8Array(1024 * 3), BBI = new Float32Array(1024);
  (function () {
    function planck(l, T) { var c2 = 0.014388; return 1 / (Math.pow(l, 5) * (Math.exp(c2 / (l * T)) - 1)); }
    for (var k = 0; k < 1024; k++) {
      var T = 500 + k * 12;
      var r = planck(610e-9, T), g = planck(550e-9, T), b = planck(465e-9, T), m = Math.max(r, g, b);
      BB[k * 3] = 255 * r / m; BB[k * 3 + 1] = 255 * g / m; BB[k * 3 + 2] = 255 * b / m;
      BBI[k] = Math.min(1, Math.pow(Math.max(0, (T - 780) / 1700), 1.6));
    }
  })();

  function hash(x, y, z) { var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) & 255); }

  // Heat-map view: cold is deep blue, room temperature grey-teal, hot runs through orange to white on a log scale.
  function heatColor(t) {
    var v = Math.log10(Math.max(t, 1)) / 4;   // 1 K .. 10000 K
    if (v > 1) v = 1;
    var r = Math.min(255, Math.max(0, 255 * (v * 3.2 - 1.45)));
    var g = Math.min(255, Math.max(0, v < 0.62 ? 255 * (v * 1.15) : 255 * (0.71 - (v - 0.62) * 0.2 + Math.max(0, v - 0.8) * 2)));
    var b = Math.min(255, Math.max(0, v < 0.5 ? 255 * (0.25 + v * 1.2) : 255 * (0.85 - (v - 0.5) * 2.2) + Math.max(0, v - 0.85) * 1200));
    return [r, g, b];
  }

  // Surface classes the realistic renderer reads from the material buffer. Each picks a surface channel and a treatment.
  var C_STATIC = 1, C_POWDER = 2, C_OPAQUE_LIQUID = 3, C_CLEAR_LIQUID = 4, C_GLASS = 5, C_GAS = 6, C_FLAME = 7, C_PLASMA = 8;

  // Rebuild colour and emission for one chunk.
  function shadeChunk(cx, cy, cz, time) {
    var ID = Sim.ID, PH = Sim.PH, T = Sim.T, AUX = Sim.AUX, AUX2 = Sim.AUX2, USED = Sim.USED, U2 = Sim.U2, CH = Sim.CH, CS = Sim.CHUNK, Mat_ = Mat;
    var x0 = cx * CS, x1 = Math.min(W, x0 + CS), y0 = cy * CS, y1 = Math.min(H, y0 + CS), z0 = cz * CS, z1 = Math.min(D, z0 + CS);
    var heat = S.heat, phView = S.phView;
    for (var y = y0; y < y1; y++) for (var z = z0; z < z1; z++) {
      var row = z * W + y * W * D, o = (x0 + z * W + y * W * D) * 4;
      for (var x = x0; x < x1; x++, o += 4) {
        var i = x + row, id = ID[i];
        if (id === AIR) {
          colorBuf[o + 3] = 0;
          matBuf[o] = matBuf[o + 1] = matBuf[o + 2] = matBuf[o + 3] = 0;
          var ta = T[i];
          if (ta > 1000) {
            var ka = ((ta - 500) / 12) | 0; if (ka > 1023) ka = 1023;
            var ia = BBI[ka] * 0.05;
            colorBuf[o + 3] = 0; emitBuf[o] = BB[ka * 3] * ia; emitBuf[o + 1] = BB[ka * 3 + 1] * ia; emitBuf[o + 2] = BB[ka * 3 + 2] * ia; emitBuf[o + 3] = 0;
          } else { emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = emitBuf[o + 3] = 0; }
          continue;
        }
        if (id === WALL && (x === 0 || z === 0 || y === 0 || x === W - 1 || z === D - 1 || y === H - 1)) { colorBuf[o + 3] = 0; matBuf[o] = matBuf[o + 1] = matBuf[o + 2] = matBuf[o + 3] = 0; continue; }
        var ph = PH[i], t = T[i], m3 = id * 3, r, g, b, a = 255, spec = 0, grain = 1;
        var h = hash(x, y, z);
        if (id === WALL) { colorBuf[o] = 150; colorBuf[o + 1] = 176; colorBuf[o + 2] = 205; colorBuf[o + 3] = 18; emitBuf[o] = emitBuf[o + 1] = emitBuf[o + 2] = emitBuf[o + 3] = 0; matBuf[o] = id & 255; matBuf[o + 1] = (id >> 8) | (C_GLASS << 4); matBuf[o + 2] = 128; matBuf[o + 3] = 18; continue; }
        if (ph <= P_POWDER) {
          var v = ph === P_POWDER ? 0.82 + h / 255 * 0.28 : 0.93 + (h & 31) / 31 * 0.09;
          r = Mat_.colS[m3] * v; g = Mat_.colS[m3 + 1] * v; b = Mat_.colS[m3 + 2] * v; grain = v;
          var m = id <= 118 ? ELEMENTS[id] : null;
          spec = m && m.sigma > 0.3 ? 200 : 40;
        } else if (ph === P_LIQUID) {
          var v2 = 0.97 + (h & 15) / 15 * 0.05;
          r = Mat_.colL[m3] * v2; g = Mat_.colL[m3 + 1] * v2; b = Mat_.colL[m3 + 2] * v2;
          var mt = id <= 118 && ELEMENTS[id].sigma > 0.3;
          a = mt ? 255 : (id === WATER_ID ? 13 : 120);
          spec = mt ? 240 : 120;
          if (id === WATER_ID && (AUX[i] || AUX2[i])) {
            // Stronger solutions show deeper colour, by molarity as the eye sees it: a tenth-molar solution is tinted and a molar one is strong.
            // (A cell's full share of a salt is 10 to 25 M, far past what water can hold, so going by share left real solutions almost clear.)
            // A mixed cell blends its two solutes by how strongly each absorbs, its molarity over its half-strength molarity, so a trace of
            // blood-red thiocyanate complex shows through half-molar iron(III). Only water holds solutes; in an element cell AUX2 is a mass number.
            var cr = 0, cg = 0, cb = 0, absorb = 0;
            for (var q = 0; q < 2; q++) {
              var sid = q ? AUX2[i] : AUX[i];
              if (!sid) continue;
              var so = Mat_.list[sid], mol = (1 - (q ? U2[i] : USED[i])) * Mat_.n0[sid] * 1000, A = mol > 0 ? mol / (so && so.tintM ? so.tintM : 0.3) : 0;
              if (so && so.solutionCol) { cr += so.solutionCol[0] * A; cg += so.solutionCol[1] * A; cb += so.solutionCol[2] * A; absorb += A; }
              else a += (so && so.acid ? 14 : 4) * (A / (A + 1)) * (q ? 0.5 : 1);
            }
            if (absorb > 0) {
              var st = absorb / (absorb + 1), mixC = st * 1.5 > 1 ? 1 : st * 1.5;
              r += (cr / absorb - r) * mixC; g += (cg / absorb - g) * mixC; b += (cb / absorb - b) * mixC; a += 24 * st;
            }
          }
        } else {
          r = Mat_.colG[m3]; g = Mat_.colG[m3 + 1]; b = Mat_.colG[m3 + 2];
          a = Math.min(Mat_.gasA[id] + (h & 3), 220);
          if (id === FLAME) { a = 0; }
        }
        var er = 0, eg = 0, eb = 0;
        // Indicators in a water cell take their colour from the pH of what else is dissolved.
        if (id === WATER_ID && ph === P_LIQUID && (AUX[i] || AUX2[i] || phView)) {
          var ind = AUX[i] === LITMUS || AUX[i] === PHENOL || AUX[i] === UNIVERSAL ? AUX[i] : (AUX2[i] === LITMUS || AUX2[i] === PHENOL || AUX2[i] === UNIVERSAL ? AUX2[i] : 0);
          if (ind || phView) {
            var other = AUX[i] === ind ? AUX2[i] : AUX[i], oU = AUX[i] === ind ? Sim.U2[i] : USED[i], cellPH = Chem.pHfromSolutes(other, other ? Chem.molar(other, oU) : 0, 0, 0);
            if (phView || ind === UNIVERSAL) { var pc = phColor(cellPH); r = pc[0]; g = pc[1]; b = pc[2]; a = phView ? 60 : 40; }
            else if (ind === LITMUS) { if (cellPH < 4.5) { r = 210; g = 40; b = 50; } else if (cellPH > 8.3) { r = 40; g = 70; b = 200; } else { r = 120; g = 70; b = 140; } a = 40; }
            // Water here only absorbs light, so a dye in deep water just goes dark. A real dye also scatters light back at the eye, and a soft glow stands in for that.
            else if (ind === PHENOL) { if (cellPH > 8.2) { r = 255; g = 60; b = 150; a = 45; er = 190; eg = 38; eb = 110; } else a = 14; }
          }
        } else if (phView && ph === P_LIQUID && id > 118 && Mat_.list[id].acid) {
          var acidC = phColor(Chem.pHfromSolutes(id, Chem.molar(id, USED[i]), 0, 0)); r = acidC[0]; g = acidC[1]; b = acidC[2]; a = 90;
        }
        if (heat) {
          var hc = heatColor(t);
          r = hc[0]; g = hc[1]; b = hc[2]; grain = 1;
          if (a < 255) a = Math.max(a, 90);
          er = hc[0] * 0.4; eg = hc[1] * 0.4; eb = hc[2] * 0.4;
        } else if (id === FLAME) {
          // A flame fades from a bright core through the element's own colour to a dull red tip. The flicker comes from the time-varying term.
          var fz = AUX[i] || 0, heatF = Math.min(1, (t - 900) / 1400), flick = 0.82 + 0.18 * Math.sin(S.time * 17 + h);
          var gr = fz ? Mat_.glow[fz * 3] : 255, gg = fz ? Mat_.glow[fz * 3 + 1] : 150, gb = fz ? Mat_.glow[fz * 3 + 2] : 60;
          var core = heatF * heatF * 0.35;
          er = (gr + (255 - gr) * core) * (0.45 + 0.55 * heatF) * flick;
          eg = (gg + (255 - gg) * core) * heatF * flick;
          eb = (gb + (255 - gb) * core) * heatF * heatF * flick;
          r = gr; g = gg; b = gb; a = 16;
        } else if (t > 790) {
          var k = ((t - 500) / 12) | 0; if (k > 1023) k = 1023;
          var I = BBI[k];
          if (ph >= P_GAS) I *= ph === P_PLASMA ? 0.55 : 0.3;
          er = BB[k * 3] * I; eg = BB[k * 3 + 1] * I; eb = BB[k * 3 + 2] * I;
          if (ph === P_PLASMA && id <= 118) {
            var gl3 = Mat_.glow;
            er = Math.max(er, gl3[m3] * 0.4); eg = Math.max(eg, gl3[m3 + 1] * 0.4); eb = Math.max(eb, gl3[m3 + 2] * 0.4); a = Math.max(a, 50);
          }
        }
        // Current through a gas excites its emission lines. Metals only flicker white where the pulse head sits.
        if (CH[i] > 0) {
          if (ph >= P_GAS && id <= 118) { var f = 0.2 + CH[i] / 5 * 0.28; er = Math.max(er, Mat_.glow[m3] * f); eg = Math.max(eg, Mat_.glow[m3 + 1] * f); eb = Math.max(eb, Mat_.glow[m3 + 2] * f); r = Mat_.glow[m3]; g = Mat_.glow[m3 + 1]; b = Mat_.glow[m3 + 2]; a = Math.max(a, 40); }
          else if (id !== ELECTRODE) { var w = CH[i] * 16; er = Math.min(255, er + w * 0.55); eg = Math.min(255, eg + w * 0.75); eb = Math.min(255, eb + w); }
        }
        // Radium, actinium and other strong emitters glow faintly by their own radioactivity.
        if (Mat_.decay[id] > 0 && Mat_.decay[id] < 120 && ph <= P_LIQUID) { var pul = 0.5 + 0.5 * Math.sin(time * 2 + h); eg = Math.max(eg, 26 + 16 * pul); eb = Math.max(eb, 32 + 22 * pul); er = Math.max(er, 8); }
        // The lowest alpha bit marks a liquid for the renderer's refraction.
        if (a < 255) { a = Math.round(a); a = ph === P_LIQUID ? a | 1 : a & 254; }
        colorBuf[o] = r; colorBuf[o + 1] = g; colorBuf[o + 2] = b; colorBuf[o + 3] = a;
        emitBuf[o] = er; emitBuf[o + 1] = eg; emitBuf[o + 2] = eb; emitBuf[o + 3] = spec;
        // Id and class stay per cell, so a material never bleeds into its neighbour. The grain factor lets the renderer remove the voxel-by-voxel colour noise.
        var cls = id === FLAME ? C_FLAME : ph === P_PLASMA ? C_PLASMA : ph === P_GAS ? C_GAS : ph === P_LIQUID ? (a === 255 ? C_OPAQUE_LIQUID : C_CLEAR_LIQUID) : ph === P_POWDER ? C_POWDER : C_STATIC;
        matBuf[o] = id & 255; matBuf[o + 1] = (id >> 8) | (cls << 4); matBuf[o + 2] = (grain - 0.75) * 510; matBuf[o + 3] = a;
        // For a clear liquid the third byte instead says how fast the cell is moving. The renderer turns this into foam.
        if (cls === C_CLEAR_LIQUID) matBuf[o + 2] = (Math.abs(velX[i]) + Math.abs(velY[i]) + Math.abs(velZ[i])) * 6;
        // Water vapour is invisible in truth, but what the eye calls steam is droplets condensing in it. It is drawn only in the realistic look.
        else if (id === WATER_ID && cls === C_GAS && !heat) matBuf[o + 3] = Math.max(a, 62);
      }
    }
  }

  // Coarse volume: rgb is average light emitted in a block, alpha marks whether a ray has to walk it voxel by voxel.
  function coarseChunk(cx, cy, cz) {
    var bs = BLOCK, CS = Sim.CHUNK, n = CS / bs;
    for (var by = cy * n; by < Math.min(cH, (cy + 1) * n); by++) for (var bz = cz * n; bz < Math.min(cD, (cz + 1) * n); bz++) for (var bx = cx * n; bx < Math.min(cW, (cx + 1) * n); bx++) {
      var sr = 0, sg = 0, sb = 0, occ = 0;
      for (var y = by * bs; y < Math.min(H, (by + 1) * bs); y++) for (var z = bz * bs; z < Math.min(D, (bz + 1) * bs); z++) {
        var o = (bx * bs + z * W + y * W * D) * 4;
        for (var x = bx * bs; x < Math.min(W, (bx + 1) * bs); x++, o += 4) {
          if (colorBuf[o + 3]) occ = 1;
          var e = emitBuf[o];
          if (e | emitBuf[o + 1] | emitBuf[o + 2]) { sr += e; sg += emitBuf[o + 1]; sb += emitBuf[o + 2]; }
        }
      }
      var c = (bx + bz * cW + by * cW * cD) * 4, f = 1 / 45;
      coarseBuf[c] = Math.ceil(sr * f); coarseBuf[c + 1] = Math.ceil(sg * f); coarseBuf[c + 2] = Math.ceil(sb * f);   // ceil: any glow at all marks the block
      coarseBuf[c + 3] = occ ? 255 : 0;
    }
  }


  // Physically based parameters for every material, as a 64 x 64 table indexed by id: metalness, roughness, refractive index and surface detail.
  var METAL_ROUGH = { Au: 0.2, Ag: 0.16, Cu: 0.26, Al: 0.36, Fe: 0.44, Hg: 0.06, Ga: 0.14, Pt: 0.2, Pd: 0.22, Rh: 0.18, Ir: 0.22, Os: 0.24, Ti: 0.4, Cr: 0.13, Ni: 0.26, Co: 0.3, Zn: 0.46, Sn: 0.34, Pb: 0.56, Mg: 0.42, Li: 0.38, Na: 0.3, K: 0.3, Rb: 0.28, Cs: 0.26, U: 0.5, Bi: 0.3, W: 0.34 };
  // Elements whose bulk look is not what their conductivity suggests: graphite-black carbon, dull semiconductors. [metalness, roughness, detail]
  var ELEMENT_LOOK = { C: [0.1, 0.72, 0.8], Si: [0.65, 0.32, 0.25], Ge: [0.7, 0.3, 0.25], As: [0.6, 0.45, 0.5], Sb: [0.75, 0.38, 0.4], Te: [0.65, 0.4, 0.4], B: [0.3, 0.55, 0.6], I: [0.4, 0.34, 0.3] };
  S.materialLUT = function () {
    var lut = new Uint8Array(64 * 64 * 4), list = Mat.list;
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    for (var id = 0; id < list.length && id < 4096; id++) {
      var m = list[id]; if (!m) continue;
      var metal = 0, rough = 0.62, detail = 0.65;
      // Gladstone-Dale: refractive index rises roughly in step with density.
      var ior = clamp(1 + 0.21 * Mat.rhoS[id], 1.3, 2.4);
      if (ELEMENT_LOOK[m.sym]) { var look = ELEMENT_LOOK[m.sym]; metal = look[0]; rough = look[1]; detail = look[2]; }
      else if (Mat.sigma[id] > 0.3) { metal = 1; rough = METAL_ROUGH[m.sym] !== undefined ? METAL_ROUGH[m.sym] : 0.3 + (id * 37 % 17) / 100; detail = 0.28; }
      else if (m.kind === "compound") { rough = 0.48 + (id * 53 % 29) / 100; detail = 0.8; }
      if (id === WATER_ID) { ior = 1.333; rough = 0.04; }
      if (id === WALL) { ior = 1.5; rough = 0.06; detail = 0; }
      if (id === ELECTRODE) { rough = 0.24; detail = 0.2; }
      var o = id * 4;
      lut[o] = metal * 255; lut[o + 1] = rough * 255; lut[o + 2] = (ior - 1) / 1.5 * 255; lut[o + 3] = detail * 255;
    }
    return lut;
  };

  function setDims() {
    W = Sim.W; H = Sim.H; D = Sim.D; cW = Math.ceil(W / BLOCK); cH = Math.ceil(H / BLOCK); cD = Math.ceil(D / BLOCK);
    S.cW = cW; S.cH = cH; S.cD = cD; S.BLOCK = BLOCK;
  }
  S.init = function () {
    setDims();
    // Clamped arrays, or bright grains wrap round to dark.
    // The material buffer shares colour's allocation, so workers receive it along with colour.
    var n = W * D * H * 4, both = Pool.alloc(Uint8ClampedArray, n * 2);
    var sb = Sim.sharedBuffers(); velX = sb.VX; velY = sb.VY; velZ = sb.VZ;
    colorBuf = S.colorBuf = both.subarray(0, n);
    matBuf = S.matBuf = both.subarray(n);
    emitBuf = S.emitBuf = Pool.alloc(Uint8ClampedArray, W * D * H * 4);
    coarseBuf = S.coarseBuf = Pool.alloc(Uint8ClampedArray, cW * cD * cH * 4);
  };
  S.buffers = function () { return { colorBuf: colorBuf, emitBuf: emitBuf, coarseBuf: coarseBuf }; };
  S.attachShared = function (b) { setDims(); velX = b.VX; velY = b.VY; velZ = b.VZ; colorBuf = b.colorBuf; matBuf = new Uint8ClampedArray(b.colorBuf.buffer, b.colorBuf.length, b.colorBuf.length); emitBuf = b.emitBuf; coarseBuf = b.coarseBuf; };
  S.writeParams = function (P) { P[16] = S.time; P[17] = S.heat ? 1 : 0; P[18] = S.phView ? 1 : 0; };
  S.readParams = function (P) { S.time = P[16]; S.heat = P[17] === 1; S.phView = P[18] === 1; };
  S.chunkByIndex = function (k) {
    var cw = Sim.cw, cd = Sim.cd, cy = (k / (cw * cd)) | 0, r = k - cy * cw * cd, cz = (r / cw) | 0, cx = r - cz * cw;
    shadeChunk(cx, cy, cz, S.time);
    coarseChunk(cx, cy, cz);
  };
  // Rebuild only the coarse volume of one chunk, after something other than the shader has written voxels into it.
  S.coarseByIndex = function (k) {
    var cw = Sim.cw, cd = Sim.cd, cy = (k / (cw * cd)) | 0, r = k - cy * cw * cd, cz = (r / cw) | 0, cx = r - cz * cw;
    coarseChunk(cx, cy, cz);
  };
  S.CLASS = { STATIC: C_STATIC, POWDER: C_POWDER, OPAQUE_LIQUID: C_OPAQUE_LIQUID, CLEAR_LIQUID: C_CLEAR_LIQUID, GLASS: C_GLASS };
  S.WATER_ID = WATER_ID;
  return S;
})(Mat, ELEMENTS, AIR, FLAME, WALL, ELECTRODE, P_POWDER, P_LIQUID, P_GAS, P_PLASMA);
