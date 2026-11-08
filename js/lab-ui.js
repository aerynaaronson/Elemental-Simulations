// Desktop controls and drawing for lab equipment. Mouse and keys become Lab calls here; nothing in this file writes to the grid.
// Loose objects are drawn on a 2D overlay above the raymarched chamber. Set-down beakers and resting plates are real cells,
// so the raymarcher draws them, and the overlay only adds a highlight. Overlay drawing is not hidden behind material.
var LabUI = (function () {
  var U = { selected: null, held: null, hover: null, spawnKind: "beaker", reagent: "hcl" };
  var ctx2d, overlay, canvas, wrap, panel, api, last = { nx: 0, ny: 0 }, panelKey = "";
  var SEG = 28;

  U.init = function (opts) {
    api = opts; canvas = opts.canvas; wrap = canvas.parentNode;
    Lab.init(Sim);
    Render.afterShade = LabRender.afterShade;
    if (typeof LabMeshes !== "undefined") Render.meshPass = LabMeshes.draw;
    overlay = document.createElement("canvas");
    overlay.id = "labOverlay";
    wrap.insertBefore(overlay, canvas.nextSibling);
    ctx2d = overlay.getContext("2d");
    panel = document.createElement("div");
    panel.id = "labPanel"; panel.hidden = true;
    wrap.appendChild(panel);
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("input", onPanelInput);
    panel.addEventListener("pointerdown", function (e) { if (e.target.type === "range") U.sliding = true; });
    window.addEventListener("pointerup", function () { U.sliding = false; });
    window.addEventListener("keydown", onKey);
    refreshPanel();
  };

  // ---- Screen helpers ----
  function proj(p) { return Render.project(p[0], p[1], p[2]); }
  function px(q) { return [q.x * overlay.clientWidth, q.y * overlay.clientHeight]; }
  function beakerDist(v, mx, my) {
    var f = Vessels.frame(v), b = proj(Vessels.toWorld(v, f, 0, 0, 0)), t = proj(Vessels.toWorld(v, f, 0, v.height, 0)), s = proj(Vessels.toWorld(v, f, 0, v.height / 2, v.radius)), m = proj([v.x, v.y, v.z]);
    if (!b || !t || !s || !m) return Infinity;
    var B = px(b), T = px(t), S = px(s), M = px(m), r = Math.hypot(S[0] - M[0], S[1] - M[1]) + 6;
    var ex = T[0] - B[0], ey = T[1] - B[1], L = ex * ex + ey * ey || 1, k = Math.max(0, Math.min(1, ((mx - B[0]) * ex + (my - B[1]) * ey) / L));
    var d = Math.hypot(mx - (B[0] + ex * k), my - (B[1] + ey * k));
    return d < r + 4 ? d : Infinity;
  }
  function plateCorners(p) {
    var h = p.half + 0.5, out = [];
    [[-h, -h], [h, -h], [h, h], [-h, h]].forEach(function (c) { out.push([p.x + c[0], p.y, p.z + c[1]]); });
    [[-h, -h], [h, -h], [h, h], [-h, h]].forEach(function (c) { out.push([p.x + c[0], p.y + p.h, p.z + c[1]]); });
    return out;
  }
  function plateDist(p, mx, my) {
    var pts = plateCorners(p).map(proj);
    if (pts.some(function (q) { return !q; })) return Infinity;
    pts = pts.map(px);
    var x0 = Math.min.apply(null, pts.map(function (q) { return q[0]; })), x1 = Math.max.apply(null, pts.map(function (q) { return q[0]; }));
    var y0 = Math.min.apply(null, pts.map(function (q) { return q[1]; })), y1 = Math.max.apply(null, pts.map(function (q) { return q[1]; }));
    return mx >= x0 - 4 && mx <= x1 + 4 && my >= y0 - 4 && my <= y1 + 4 ? 20 : Infinity;   // beakers win over the plate they stand on
  }
  // Top of a tool: the head of a stick, or the top of a power supply's case.
  function toolTop(o) { return o.y + o.len + (o.kind === "supply" ? 3 : 0); }
  // Where a condenser's tube starts: just above its source container's stopper, or up and to one side of its outlet when it has none.
  function condenserTop(o) {
    var v = o.vessel != null ? Vessels.byId(o.vessel) : null;
    if (!v) return [o.x - 10, o.y + 7, o.z];
    if (v.shell) return [v.shell.cx + 0.5, v.shell.by + v.shell.h + 3.5, v.shell.cz + 0.5];
    var b = Vessels.base(v); return [b[0], b[1] + v.height + 3.5, b[2]];
  }
  // The two ends of what a pointer can pick a tool by: its upright axis, or for a syringe its barrel.
  function toolAxis(o) {
    if (o.kind === "syringe") return [[o.x - 6.5, o.y + 1.5, o.z], [o.x + 6.5, o.y + 1.5, o.z]];
    if (o.kind === "condenser") return [[o.x, o.y, o.z], condenserTop(o)];
    return [[o.x, o.y, o.z], [o.x, toolTop(o), o.z]];
  }
  // Tools are thin and usually stand inside a container, so a pointer near one picks the tool rather than the container around it.
  function toolDist(o, mx, my) {
    var ax = toolAxis(o), b = proj(ax[0]), t = proj(ax[1]);
    if (!b || !t) return Infinity;
    var B = px(b), T = px(t), r = 7;
    if (o.kind === "jar") { var jr = proj([o.x + o.radius + 1.5, toolTop(o), o.z]); if (jr) { var JR = px(jr); r = Math.hypot(JR[0] - T[0], JR[1] - T[1]) + 4; } }
    if (o.kind === "funnel") { var e = proj([o.x + o.rTop, toolTop(o), o.z]); if (e) { var E = px(e); r = Math.hypot(E[0] - T[0], E[1] - T[1]) * 0.7 + 4; } }
    if (o.kind === "supply") { var s = proj([o.x + o.gap + 1.5, toolTop(o), o.z]); if (s) { var S = px(s); r = Math.hypot(S[0] - T[0], S[1] - T[1]) + 4; } }
    var ex = T[0] - B[0], ey = T[1] - B[1], L = ex * ex + ey * ey || 1, k = Math.max(0, Math.min(1, ((mx - B[0]) * ex + (my - B[1]) * ey) / L));
    var d = Math.hypot(mx - (B[0] + ex * k), my - (B[1] + ey * k));
    return d < r ? d - 100 : Infinity;
  }
  function objectUnder(nx, ny) {
    var mx = nx * overlay.clientWidth, my = ny * overlay.clientHeight, best = null, bestD = Infinity;
    Lab.all().forEach(function (o) { var d = o.kind === "beaker" ? beakerDist(o, mx, my) : Lab.isTool(o) ? toolDist(o, mx, my) : plateDist(o, mx, my); if (d < bestD) { bestD = d; best = o; } });
    return best;
  }

  // ---- Input, called from ui.js while the Lab tool is active ----
  function isPlateKind(k) { return k === "plate" || k === "chiller" || k === "burner" || k === "stirrer" || k === "balance"; }
  function isToolKind(k) { return !!Lab.TOOLS[k]; }
  function spawnSelected(x, y, z) {
    var k = U.spawnKind;
    if (k === "plate") return Lab.spawnPlate(x, y, z);
    if (k === "chiller") return Lab.spawnChiller(x, y, z);
    if (k === "burner") return Lab.spawnBurner(x, y, z);
    if (k === "stirrer") return Lab.spawnStirrer(x, y, z);
    if (k === "balance") return Lab.spawnBalance(x, y, z);
    // Clamped tools start a little above where they are put, so their tips are in the open.
    if (isToolKind(k) && Lab.TOOLS[k].clamp) return Lab.spawnTool(k, x, y + (k === "condenser" ? 12 : 4), z);
    if (k === "bottle") return Lab.spawnBottle(x, y, z, U.reagent, { yaw: -Render.camera.yaw });
    if (isToolKind(k)) return Lab.spawnTool(k, x, y, z);
    return Lab.spawnBeaker(x, y, z, { type: k, yaw: -Render.camera.yaw });
  }
  U.down = function (e, p, pointer) {
    last = pointer;
    var o = objectUnder(pointer.nx, pointer.ny);
    // On a plate, a click sets a container on it and a drag moves the plate. Which one it was is settled once the pointer moves or lifts.
    // On a container, a click with a tool chosen drops the tool into it, and a drag carries the container.
    var onto = o && ((o.kind === "plate" && !isPlateKind(U.spawnKind)) || (o.kind === "beaker" && isToolKind(U.spawnKind)));
    if (onto) { U.pending = { o: o, p: p, x: pointer.nx, y: pointer.ny }; U.selected = o; refreshPanel(); return; }
    if (o) {
      api.pushUndo();
      var b = Lab.base(o);
      Lab.grab(o);
      o.lift = Math.max(0, b[1] - Lab.groundUnder(o));
      U.held = U.selected = o;
    } else if (p && p.ax !== undefined) {
      api.pushUndo();
      var y = Math.max(1, p.ay);
      o = spawnSelected(p.ax + 0.5, y, p.az + 0.5);
      Lab.clampInside(o);
      U.selected = o;
    }
    refreshPanel();
  };
  U.move = function (pointer) {
    last = pointer;
    var pd = U.pending;
    if (pd && Math.hypot((pointer.nx - pd.x) * overlay.clientWidth, (pointer.ny - pd.y) * overlay.clientHeight) > 6) {
      U.pending = null;
      api.pushUndo();
      var b = Lab.base(pd.o);
      Lab.grab(pd.o);
      pd.o.lift = Math.max(0, b[1] - Lab.groundUnder(pd.o));
      U.held = U.selected = pd.o;
    }
    U.hover = U.held || objectUnder(pointer.nx, pointer.ny);
  };
  U.up = function () {
    var pd = U.pending;
    if (pd) {
      U.pending = null;
      api.pushUndo();
      var v;
      if (pd.o.kind === "beaker" && U.spawnKind === "syringe") {   // a syringe goes beside the container, connected to it
        var bs = Lab.base(pd.o);
        v = spawnSelected(bs[0] + pd.o.radius + 9, bs[1] + 2, bs[2]);
        Lab.connect(v, pd.o);
      } else if (pd.o.kind === "beaker" && U.spawnKind === "condenser") {   // a condenser runs from the container's stopper down to one side
        var bc = Lab.base(pd.o);
        v = Lab.spawnTool("condenser", bc[0] + pd.o.radius + 14, bc[1] + 15, bc[2]);
        Lab.connect(v, pd.o);
      } else if (pd.o.kind === "beaker") {   // a tool let go over the middle of the container, so it drops in
        var b = Lab.base(pd.o);
        v = spawnSelected(b[0], b[1] + pd.o.height + 2, b[2]);
      } else {
        v = spawnSelected(pd.o.x, pd.o.y + pd.o.h + 6, pd.o.z);
        if (pd.p && pd.p.ax !== undefined) Lab.move(v, pd.p.ax + 0.5, pd.o.y + pd.o.h + 6, pd.p.az + 0.5);
      }
      Lab.clampInside(v);
      U.selected = v; refreshPanel();
    }
    if (U.held) { Lab.release(U.held); U.held = null; }
  };
  // Scrolling while holding a beaker tips it; with Shift it lifts whatever is held. Returns true when the wheel was used here.
  U.wheel = function (e) {
    var o = U.held || (U.hover && U.hover === U.selected ? U.hover : null);
    if (!o) return false;
    if (e.shiftKey || o.kind !== "beaker") { if (!U.held) return false; o.lift = Math.max(0, Math.min(Sim.H, (o.lift || 0) - e.deltaY * 0.02)); }
    else { Lab.tilt(o, o.tilt + e.deltaY * 0.0022); o.pinTilt = !U.held; }
    refreshPanel();
    return true;
  };
  function onKey(e) {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
    var k = e.key.toLowerCase();
    if (k === "b") { api.setTool("vessel"); return; }
    if (api.state.tool !== "vessel" || !U.selected) return;
    var o = U.selected;
    if (k === "q") Lab.turn(o, -Math.PI / 12);
    else if (k === "e") Lab.turn(o, Math.PI / 12);
    else if (k === "f") fillSelected();
    else if (k === "delete" || k === "backspace") removeSelected();
    else return;
    refreshPanel();
  }
  function fillSelected() {
    var s = api.state, v = U.selected;
    if (!v || v.kind !== "beaker" || s.mat === WALL || s.mat === ELECTRODE) return;
    var T = s.placeT == null ? Sim.ambient : s.placeT, form = Sim.phaseFor(s.mat, T, s.form);
    if (form !== P_LIQUID && form !== P_POWDER) form = s.form === P_LIQUID ? P_LIQUID : P_POWDER;
    api.pushUndo();
    Lab.fill(v, s.mat, form, Math.round(Vessels.capacity(v) * 0.5), T);
  }
  function removeSelected() { if (!U.selected) return; api.pushUndo(); Lab.remove(U.selected); U.selected = U.held = U.hover = null; }

  // ---- Panel ----
  function onPanelClick(e) {
    var a = e.target.dataset && e.target.dataset.act;
    if (!a) return;
    if (a.indexOf("kind-") === 0) U.spawnKind = a.slice(5);
    else if (a === "deselect") U.selected = null;
    else if (!U.selected) return;
    else if (a === "fill") fillSelected();
    else if (a === "empty") { api.pushUndo(); Lab.grab(U.selected); Vessels.empty(U.selected); Lab.release(U.selected); }
    else if (a === "remove") removeSelected();
    else if (a === "left") Lab.turn(U.selected, -Math.PI / 12);
    else if (a === "right") Lab.turn(U.selected, Math.PI / 12);
    else if (a === "off") Lab.setPlate(U.selected, null);
    else if (a === "light") Lab.setPlate(U.selected, Lab.BURNER_T);
    else if (a === "stopper") { api.pushUndo(); Lab.setStopper(U.selected, !U.selected.stopper); }
    else if (a === "draw") { api.pushUndo(); Lab.drawUp(U.selected); }
    else if (a === "drop1") { api.pushUndo(); Lab.squeeze(U.selected, 1); }
    else if (a === "squeeze") { api.pushUndo(); Lab.squeeze(U.selected); }
    else if (a === "power") { api.pushUndo(); Lab.setSupply(U.selected, !U.selected.on); }
    else if (a.indexOf("stir-") === 0) { api.pushUndo(); Lab.setStir(U.selected, +a.slice(5)); }
    else if (a === "filter") { api.pushUndo(); Lab.setFilter(U.selected, !U.selected.filter); }
    else if (a === "discard") { api.pushUndo(); Lab.discard(U.selected); }
    else if (a === "connect") { api.pushUndo(); Lab.connectNearest(U.selected); }
    else if (a === "disconnect") { api.pushUndo(); Lab.connect(U.selected, null); }
    else if (a === "vent") { api.pushUndo(); Lab.ventSyringe(U.selected); }
    else if (a === "tare") { api.pushUndo(); Lab.tare(U.selected); }
    else if (a === "grip") { api.pushUndo(); Lab.grip(U.selected); }
    else if (a === "letgo") { api.pushUndo(); Lab.letGo(U.selected); }
    else if (a === "spark") { Lab.spark(U.selected); }
    else if (a === "auto") { Lab.setAuto(U.selected, !U.selected.auto); }
    else if (a === "clicks") { U.clicks = !U.clicks; }
    else if (a === "count0") { Lab.resetCount(U.selected); }
    else if (a === "pump") { api.pushUndo(); Lab.setPump(U.selected, !U.selected.pump); }
    else if (a === "air") { api.pushUndo(); Lab.letAirIn(U.selected); }
    else if (a === "stopper-on") { var sv = Vessels.byId(U.selected.vessel); if (sv) { api.pushUndo(); Lab.setStopper(sv, true); } }
    refreshPanel();
  }
  function onPanelInput(e) {
    if (e.target.id === "labReagent") { U.reagent = e.target.value; refreshPanel(); return; }
    var o = U.selected;
    if (!o) return;
    if (e.target.id === "labTilt") { Lab.tilt(o, +e.target.value * Math.PI / 180); o.pinTilt = o.tilt > 0; }
    if (e.target.id === "labPlateT") Lab.setPlate(o, +e.target.value + 273.15);
    if (e.target.id === "labVolts") Lab.setSupply(o, null, +e.target.value);
  }
  function nameOf(id) { var m = Mat.list[id]; return m ? (id >= FIRST_COMPOUND ? Mat.pretty(m.formula) : m.name) : "?"; }
  function phaseName(f) { return f === P_LIQUID ? "liquid" : f === P_POWDER ? "grains" : f >= P_GAS ? "gas" : "solid"; }
  function refreshPanel() {
    if (!panel) return;
    var show = api.state.tool === "vessel" || !!U.selected;
    panel.hidden = !show;
    if (!show) return;
    var o = U.selected, html;
    if (o && Lab.all().indexOf(o) < 0) o = U.selected = null;
    if (!o) {
      var kinds = Object.keys(Lab.CONTAINERS).map(function (k) { return [k, Lab.CONTAINERS[k].label]; }).concat([["plate", "Hot plate"], ["chiller", "Chiller"], ["burner", "Gas burner"], ["stirrer", "Stirrer"], ["balance", "Balance"]],
        Object.keys(Lab.TOOLS).map(function (k) { return [k, Lab.TOOLS[k].label]; }));
      var chosen = kinds.filter(function (k) { return k[0] === U.spawnKind; })[0] || kinds[0];
      html = "<h3>Lab equipment</h3>" +
        "<div class='lbtns wrap'>" + kinds.map(function (k) { return "<button data-act='kind-" + k[0] + "' aria-pressed='" + (U.spawnKind === k[0]) + "'>" + k[1] + "</button>"; }).join("") + "</div>" +
        (U.spawnKind === "bottle" ? "<select id='labReagent' aria-label='Reagent' style='margin-top:6px;width:100%'>" + Lab.REAGENTS.filter(function (r) { return Lab.reagent(r.key); }).map(function (r) { return "<option value='" + r.key + "'" + (r.key === U.reagent ? " selected" : "") + ">" + r.label + "</option>"; }).join("") + "</select>" : "") +
        "<p style='margin-top:6px'>Click a surface to set down: <b>" + chosen[1].toLowerCase() + "</b>." + (U.spawnKind === "syringe" || U.spawnKind === "condenser" ? " Click a container to connect it." : U.spawnKind === "jar" ? " Click a container to put the jar over it." : isToolKind(U.spawnKind) ? " Click a container to drop it in." : "") + " Drag to carry. Scroll while holding a container to tip it, Shift + scroll to lift. <b>Q</b>/<b>E</b> turn the spout.</p>" +
        "<p>Once a container sits still it becomes real glass in the chamber, and what's inside reacts, heats and boils like anything else.</p>";
    } else if (o.kind === "probe") {
      var rd = Lab.read(o), what = rd.mat === AIR ? "air" : nameOf(rd.mat) + " " + phaseName(rd.form);
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : "Tip in " + what) + "</div>" +
        "<div class='lcontents'><div>Temperature <span>" + (rd.T - 273.15).toFixed(1) + " °C</span></div>" +
        (rd.pH != null ? "<div>pH <span>" + rd.pH.toFixed(1) + "</span></div>" : "") +
        "<div>Pressure <span>" + Math.round(rd.kPa) + " kPa</span></div></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Let it go over a container or a pool and it sinks to the bottom. It reads whatever its tip touches, with pH when that is water.</p>";
    } else if (o.kind === "dropper") {
      var held = Lab.amountIn(o), dp = Math.round(100 * held / o.cap);
      var drows = o.contents.map(function (c) { return "<div>" + nameOf(c.mat) + (c.aux ? " + " + nameOf(c.aux) : "") + " <span>" + c.n + " · " + Math.round(c.T - 273.15) + " °C</span></div>"; }).join("") || "<div class='empty'>Empty</div>";
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lbar'><div style='width:" + dp + "%'></div></div>" +
        "<div class='lline'>" + (o.held ? "Held" : "Resting") + " · " + held + " / " + o.cap + " drops" + (o.drip ? " · dripping" : "") + "</div>" +
        "<div class='lcontents'>" + drows + "</div>" +
        "<div class='lbtns'><button data-act='draw'>Draw up</button><button data-act='drop1'>1 drop</button><button data-act='squeeze'>Squeeze out</button></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Draw up liquid at the tip, then hold it over a container and add it a drop at a time, as in a titration. Shift + scroll lifts it while you carry it.</p>";
    } else if (o.kind === "tongs") {
      var tn = Lab.amountIn(o) + o.hold.length, tw = o.hold.length ? Sim.ID[o.hold[0]] : o.contents.length ? o.contents[0].mat : 0;
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : "In a clamp") + " · " + (tn ? "holding " + tn + " cells of " + nameOf(tw) : "empty") + "</div>" +
        "<div class='lbtns'>" + (tn ? "<button data-act='letgo'>Let go</button>" : "<button data-act='grip'>Grip</button>") + "<button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Bring the tips to a solid and grip a small piece. Carry it into a flame and let go of the tongs: they stay in their clamp and hold the sample there, so it can burn or colour the flame.</p>";
    } else if (o.kind === "igniter") {
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : "In a clamp") + " · " + (o.sparks || 0) + " sparks</div>" +
        "<div class='lbtns'><button data-act='spark'>Spark</button><button data-act='auto' aria-pressed='" + !!o.auto + "'>Keep sparking</button></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Hold the tip where a flammable gas meets the air, at the mouth of a test tube of hydrogen say, and spark it. Each spark heats the gas there past its ignition point.</p>";
    } else if (o.kind === "geiger") {
      var bt = o.byType;
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + Math.round(Lab.rate(o)) + " counts a second · " + o.total + " in all</div>" +
        "<div class='lcontents'><div>Alpha <span>" + bt.alpha + "</span></div><div>Beta <span>" + bt.beta + "</span></div><div>Gamma <span>" + bt.gamma + "</span></div><div>Neutron <span>" + bt.neutron + "</span></div></div>" +
        "<div class='lbtns'><button data-act='clicks' aria-pressed='" + !!U.clicks + "'>Clicks</button><button data-act='count0'>Reset</button></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Counts the radiation passing through the window at the bottom of its tube. Alpha particles stop in a cell of anything, so hold it close to the source.</p>";
    } else if (o.kind === "jar") {
      var leak = o.stamp && o.stamp.leak, bpw = Sim.bpAt ? Sim.bpAt(Mat.byFormula.H2O, o.kPa) - 273.15 : 100;
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : o.stamp ? (leak ? "<b>Leaking</b>: its rim is not sitting flat" : "Sealed") : "Settling") + " · " + (o.kPa < 10 ? o.kPa.toFixed(1) : Math.round(o.kPa)) + " kPa" + (o.pump ? " · pumping" : "") + "</div>" +
        "<div class='lline'>Water boils at " + Math.round(bpw) + " °C in here</div>" +
        "<div class='lbtns'><button data-act='pump'>" + (o.pump ? "Pump off" : "Pump on") + "</button><button data-act='air'>Let air in</button></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Set it over something on the bench and pump the air out. Water boils at room temperature and chills itself, and nothing can burn once the air is gone.</p>";
    } else if (o.kind === "condenser") {
      var cv = o.vessel != null ? Vessels.byId(o.vessel) : null;
      var clink = !cv ? "Not connected" : !cv.stopper ? "On " + cv.name.toLowerCase() + " · <b>its stopper is out</b>" : !cv.shell ? "On " + cv.name.toLowerCase() + " · waiting for it to be set down" : "From " + cv.name.toLowerCase();
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + clink + " · " + o.made + " drops collected</div>" +
        "<div class='lbtns'>" + (cv ? "<button data-act='disconnect'>Disconnect</button>" : "<button data-act='connect'>Connect to nearest</button>") + (cv && !cv.stopper ? "<button data-act='stopper-on'>Stopper in</button>" : "") + "</div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Heat the container it comes from, and what boils off is cooled back to liquid and drips from the outlet. Put a container under the outlet to catch it. Whatever is dissolved stays behind, so brine gives pure water.</p>";
    } else if (o.kind === "funnel") {
      var fin = Lab.amountIn(o), frows = o.contents.map(function (c) { return "<div>" + nameOf(c.mat) + (c.aux ? " + " + nameOf(c.aux) : "") + " " + phaseName(c.form) + " <span>" + c.n + "</span></div>"; }).join("") || "<div class='empty'>Empty</div>";
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : "Resting") + " · " + (o.filter ? "filter paper in" : "no filter paper") + " · " + fin + " / " + o.cap + " cells</div>" +
        "<div class='lcontents'>" + frows + "</div>" +
        "<div class='lbtns'><button data-act='filter'>" + (o.filter ? "Take paper out" : "Put paper in") + "</button><button data-act='discard'>Discard</button></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Set it in a container's mouth and pour a mixture in. Liquid runs through, and with filter paper in, anything solid stays behind in the paper. What is dissolved goes through.</p>";
    } else if (o.kind === "syringe") {
      var sv = o.vessel != null ? Vessels.byId(o.vessel) : null, sn = Lab.amountIn(o), sp = Math.round(100 * sn / o.cap);
      var srows = o.contents.map(function (c) { return "<div>" + nameOf(c.mat) + " <span>" + c.n + "</span></div>"; }).join("") || "<div class='empty'>Empty</div>";
      var link = !sv ? "Not connected" : !sv.stopper ? "On " + sv.name.toLowerCase() + " · <b>its stopper is out</b>" : !sv.shell ? "On " + sv.name.toLowerCase() + " · waiting for it to be set down" : sn >= o.cap ? "On " + sv.name.toLowerCase() + " · <b>full</b>" : "Collecting from " + sv.name.toLowerCase();
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lbar'><div style='width:" + sp + "%'></div></div>" +
        "<div class='lline'>" + link + " · " + sn + " / " + o.cap + " cells of gas</div>" +
        "<div class='lcontents'>" + srows + "</div>" +
        "<div class='lbtns'>" + (sv ? "<button data-act='disconnect'>Disconnect</button>" : "<button data-act='connect'>Connect to nearest</button>") + (sv && !sv.stopper ? "<button data-act='stopper-on'>Stopper in</button>" : "") + "<button data-act='vent'>Push out gas</button></div>" +
        "<div class='lbtns'><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Collects the gas a stoppered container gives off, through a tube in its stopper, so the stopper stays in until the syringe is full. Push the gas out to let it go.</p>";
    } else if (o.kind === "supply") {
      var wet = Lab.wetRods(o), live = Lab.live(o), low = o.on && o.volts < Lab.MIN_VOLTS;
      var where = !o.stamp ? (o.held ? "Held" : "Settling") : wet[0] && wet[1] ? "Both rods in liquid" : wet[0] || wet[1] ? "One rod in liquid" : "Rods in air";
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + where + " · " + (o.on ? o.volts.toFixed(1) + " V" : "off") + (live && (wet[0] || wet[1]) ? " · <b>current flowing</b>" : "") + "</div>" +
        "<input id='labVolts' type='range' min='0' max='" + Lab.MAX_VOLTS + "' step='0.5' value='" + o.volts + "' aria-label='Voltage'>" +
        (low ? "<div class='lline'>Below " + Lab.MIN_VOLTS + " V no current flows through a solution.</div>" : "") +
        "<div class='lbtns'><button data-act='power'>" + (o.on ? "Switch off" : "Switch on") + "</button><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Lower the rods into water, or a molten or dissolved salt, and switch on. The current splits it at the rods: water into hydrogen and oxygen, a salt into its metal and non-metal. A higher voltage works faster.</p>";
    } else if (o.burner) {
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : o.stamp ? "On the bench" : "Settling") + " · " + (o.setT != null ? "lit" : "off") + "</div>" +
        "<div class='lbtns'>" + (o.setT != null ? "<button data-act='off'>Turn off</button>" : "<button data-act='light'>Light</button>") + "<button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Keeps a flame burning above its nozzle. Put a salt around the nozzle and the flame takes on the metal's colour, as in a flame test.</p>";
    } else if (o.scale) {
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : o.stamp ? "On the bench" : "Settling") + "</div>" +
        "<div class='lcontents'><div>Reading <span>" + Lab.weigh(o).toFixed(1) + " g</span></div></div>" +
        "<div class='lbtns'><button data-act='tare'>Tare</button><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>Weighs what stands on its pan: a container with its glass and contents, each cell a cubic centimetre. Tare zeroes it with what is on it now.</p>";
    } else if (o.kind === "plate") {
      var on = o.setT != null, idle = 25, c = on ? Math.round(o.setT - 273.15) : idle;
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lline'>" + (o.held ? "Held" : o.stamp ? "On the bench" : "Settling") + " · " + (on ? c + " °C" : "off") + "</div>" +
        "<input id='labPlateT' type='range' min='" + (o.cold ? -196 : 25) + "' max='" + (o.cold ? 25 : Math.max(600, c)) + "' step='" + (o.cold ? 1 : 5) + "' value='" + c + "' aria-label='Plate temperature'>" +
        (o.stir != null ? "<div class='lline'>Stirring: " + ["off", "slow", "medium", "fast"][o.stir] + "</div><div class='lbtns'>" + ["Off", "Slow", "Medium", "Fast"].map(function (l, k) { return "<button data-act='stir-" + k + "' aria-pressed='" + (o.stir === k) + "'>" + l + "</button>"; }).join("") + "</div>" : "") +
        "<div class='lbtns'><button data-act='off'>" + (o.stir != null ? "Heat off" : "Turn off") + "</button><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>" +
        "<p>" + (o.stir != null ? "Stirs and heats whatever stands on it. Stirring keeps a solid moving through the liquid, so it dissolves and reacts faster." : o.cold ? "Cools whatever stands on it, including a container's contents, down to the temperature of liquid nitrogen." : "Heats whatever stands on it, including a container's contents.") + "</p>";
    } else {
      var cap = Vessels.capacity(o), cont = Vessels.contentsNow(o, Sim).filter(function (c) { return c.form !== P_GAS && c.form !== P_PLASMA; });
      var n = cont.reduce(function (s, c) { return s + c.n; }, 0), pct = Math.min(100, Math.round(100 * n / cap)), plate = Lab.plateOn(o);
      var rows = cont.sort(function (a, b) { return b.n - a.n; }).slice(0, 6).map(function (c) {
        var phase = c.form === P_LIQUID ? "liquid" : c.form === P_POWDER ? "grains" : "solid";
        return "<div>" + nameOf(c.mat) + (c.aux ? " + " + nameOf(c.aux) : "") + " " + phase + " <span>" + c.n + " · " + Math.round(c.T - 273.15) + " °C</span></div>";
      }).join("") || "<div class='empty'>Empty</div>";
      var tilt = Math.round(o.tilt * 180 / Math.PI), state = o.held ? "Held" : o.shell ? (plate ? "On " + plate.name.toLowerCase() : "On the bench") : "Settling";
      var seal = o.shell && o.shell.cap ? "<div class='lline'>Stoppered · headspace " + Math.round(100 * Vessels.gasShare(o, Sim)) + "% gas</div>" :
        o.stopper ? "<div class='lline'>Stoppered</div>" : o.popped ? "<div class='lline'><b>The stopper popped out</b></div>" : "";
      html = "<h3>" + o.name + "</h3>" +
        "<div class='lbar'><div style='width:" + pct + "%'></div></div>" +
        "<div class='lline'>" + state + " · " + n + " / " + cap + " cells</div>" + seal +
        "<div class='lcontents'>" + rows + "</div>" +
        "<div class='lline'>Tilt " + tilt + "°" + (!o.shell && n ? " · spills past " + Math.round(Vessels.spillAngle(o) * 180 / Math.PI) + "°" : "") + (o.blocked ? " · <b>spout blocked</b>" : "") + "</div>" +
        "<input id='labTilt' type='range' min='0' max='135' value='" + tilt + "' aria-label='Tilt'>" +
        "<div class='lbtns'><button data-act='fill' title='F'>Fill with " + nameOf(api.state.mat) + "</button><button data-act='empty'>Discard</button><button data-act='stopper'>" + (o.stopper ? "Unstopper" : "Stopper") + "</button></div>" +
        "<div class='lbtns'><button data-act='left' title='Q'>⟲ Spout</button><button data-act='right' title='E'>Spout ⟳</button><button data-act='remove' title='Delete'>Remove</button><button data-act='deselect'>Done</button></div>";
    }
    var dragging = U.sliding && document.activeElement && document.activeElement.type === "range";
    if (html !== panelKey && !dragging) { panel.innerHTML = html; panelKey = html; }
  }

  // ---- Geiger counter clicks ----
  // Each count is a short burst of noise. Browsers only allow sound after the page has been clicked, which using the Lab tool always does.
  U.clicks = true;
  var audio = null, heard = {};
  function geigerClicks() {
    var n = 0;
    Lab.tools.forEach(function (o) { if (o.kind !== "geiger") return; var was = heard[o.id] == null ? o.total : heard[o.id]; n += Math.max(0, o.total - was); heard[o.id] = o.total; });
    if (!n || !U.clicks || typeof AudioContext === "undefined") return;
    try {
      if (!audio) audio = new AudioContext();
      if (audio.state === "suspended") { audio.resume(); return; }
      var now = audio.currentTime;
      for (var k = 0; k < Math.min(n, 12); k++) {
        var len = Math.floor(audio.sampleRate * 0.002), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
        for (var q = 0; q < len; q++) d[q] = (Math.random() * 2 - 1) * (1 - q / len);
        var src = audio.createBufferSource(), g = audio.createGain();
        src.buffer = buf; g.gain.value = 0.25; src.connect(g); g.connect(audio.destination);
        src.start(now + Math.random() * 0.03);
      }
    } catch (e) { U.clicks = false; }
  }

  // ---- Per frame ----
  U.frame = function (dt) {
    if (!overlay) return;
    if (U.held) {
      var p = api.pick(last.nx, last.ny), o = U.held;
      if (p && p.ax !== undefined) {
        var cur = Lab.base(o), k = Math.min(1, dt * 18), gy = Math.max(1, p.ay) + (o.lift || 0);
        Lab.move(o, cur[0] + (p.ax + 0.5 - cur[0]) * k, cur[1] + (gy - cur[1]) * k, cur[2] + (p.az + 0.5 - cur[2]) * k);
      }
    }
    Lab.update(dt);
    LabRender.update();
    // The meshes show readings and moving parts that change no cell, such as a thermometer's column or a syringe's plunger. Draw again when they change.
    if (typeof LabMeshes !== "undefined" && LabMeshes.ready) { var mk = LabMeshes.visualKey(); if (mk !== U.meshKey) { U.meshKey = mk; Render.wake(); } }
    geigerClicks();
    draw();
    U.panelT = (U.panelT || 0) + dt;
    if (U.panelT > 0.2) { U.panelT = 0; refreshPanel(); }
  };
  U.toolChanged = function () { refreshPanel(); };
  U.reset = function () { Lab.clear(); U.forget(); };
  // Let go of everything the interface remembers, after the equipment has been replaced underneath it.
  U.forget = function () { LabRender.reset(); U.selected = U.held = U.hover = U.pending = null; refreshPanel(); };

  // ---- Drawing ----
  function poly(pts) { ctx2d.beginPath(); ctx2d.moveTo(pts[0][0], pts[0][1]); for (var k = 1; k < pts.length; k++) ctx2d.lineTo(pts[k][0], pts[k][1]); ctx2d.closePath(); }
  function draw() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = overlay.clientWidth, h = overlay.clientHeight;
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) { overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr); }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);
    Lab.plates.forEach(drawPlate);
    var depth = function (v) { var q = proj([v.x, v.y, v.z]); return q ? q.w : 0; };
    Vessels.list.slice().sort(function (a, b) { return depth(b) - depth(a); }).forEach(drawBeaker);
    Lab.tools.forEach(drawTool);
  }
  // Tools are drawn as voxels by LabRender. The overlay adds a highlight and a label: a thermometer always shows its reading, a power supply its setting.
  function drawTool(o) {
    var ax = toolAxis(o), b = proj(ax[0]), t = proj(ax[1]);
    if (!b || !t) return;
    var B = px(b), T = px(t), sel = o === U.selected, hot = o === U.hover || o.held;
    if (sel || hot || !LabRender.enabled) {
      ctx2d.strokeStyle = sel ? "rgba(140,210,255,0.95)" : hot ? "rgba(210,235,255,0.85)" : "rgba(200,210,225,0.6)";
      ctx2d.lineWidth = o.kind === "supply" ? 1.2 : 3;
      ctx2d.beginPath(); ctx2d.moveTo(B[0], B[1]); ctx2d.lineTo(T[0], T[1]); ctx2d.stroke();
    }
    var text = null;
    if (o.kind === "probe") text = (Lab.read(o).T - 273.15).toFixed(1) + " °C";
    else if (o.kind === "supply") text = o.on ? o.volts.toFixed(1) + " V" : "off";
    else if (o.kind === "syringe" && Lab.amountIn(o)) text = Lab.amountIn(o) + " / " + o.cap;
    else if (o.kind === "geiger") text = Math.round(Lab.rate(o)) + " /s";
    else if (o.kind === "jar") text = (o.kPa < 10 ? o.kPa.toFixed(1) : Math.round(o.kPa)) + " kPa";
    else if (sel || hot) text = Lab.amountIn(o) + " / " + o.cap;
    if (!text) return;
    ctx2d.font = "12px system-ui, sans-serif"; ctx2d.textAlign = "center";
    ctx2d.fillStyle = o.kind === "supply" && Lab.live(o) ? "rgba(150,255,180,0.95)" : "rgba(230,240,255,0.95)";
    ctx2d.fillText(text, T[0], T[1] - 8);
  }
  // Plate colour runs from dark ceramic through dull red to orange as it heats.
  function plateGlow(p) {
    if (p.setT == null || p.burner) return null;
    var t = Math.max(0, Math.min(1, (p.setT - 320) / 500));
    return [Math.round(90 + 165 * t), Math.round(40 + 80 * t * t), Math.round(30 + 10 * t)];
  }
  function drawPlate(p) {
    var c = plateCorners(p).map(proj);
    if (c.some(function (q) { return !q; })) return;
    c = c.map(px);
    var sel = p === U.selected, hot = p === U.hover || p.held, glow = plateGlow(p), real = !!p.stamp || LabRender.enabled;
    // Sides then top. A plate written into the grid is already drawn by the raymarcher, so it gets only a tint and its edges.
    var faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    // The plate itself is drawn as voxels by LabRender; the overlay adds only a highlight and its temperature.
    if (!real) {
      ctx2d.fillStyle = "rgba(40,44,52,0.75)";
      faces.forEach(function (f) { poly(f.map(function (k) { return c[k]; })); ctx2d.fill(); });
      poly([c[4], c[5], c[6], c[7]]);
      ctx2d.fillStyle = glow ? "rgba(" + glow.join(",") + ",0.6)" : "rgba(60,64,72,0.7)";
      ctx2d.fill();
    }
    if (real && !sel && !hot) { if (glow || p.scale || (p.burner && p.setT != null)) { label(); } return; }
    poly([c[4], c[5], c[6], c[7]]);
    ctx2d.strokeStyle = sel ? "rgba(140,210,255,0.95)" : hot ? "rgba(210,235,255,0.85)" : "rgba(200,210,225,0.45)";
    ctx2d.lineWidth = sel ? 1.8 : 1.1; ctx2d.stroke();
    label();
    function label() {
      var top = [c[4], c[5], c[6], c[7]], cx = top.reduce(function (s, q) { return s + q[0] / 4; }, 0), cy = Math.min.apply(null, top.map(function (q) { return q[1]; }));
      ctx2d.font = "12px system-ui, sans-serif"; ctx2d.textAlign = "center"; ctx2d.fillStyle = glow ? "rgba(255,190,140,0.95)" : "rgba(220,230,245,0.85)";
      ctx2d.fillText(p.scale ? Lab.weigh(p).toFixed(1) + " g" : p.burner ? (p.setT != null ? "lit" : "off") : glow ? Math.round(p.setT - 273.15) + " °C" : "off", cx, cy - 6);
    }
  }
  function colorOf(v) {
    var r = 0, g = 0, b = 0, n = 0;
    v.contents.forEach(function (c) { r += Mat.colS[c.mat * 3] * c.n; g += Mat.colS[c.mat * 3 + 1] * c.n; b += Mat.colS[c.mat * 3 + 2] * c.n; n += c.n; });
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
  }
  function drawBeaker(v) {
    var f = Vessels.frame(v), bot = [], top = [], liqB = [], liqT = [], amount = Vessels.amount(v), col = colorOf(v);
    var sel = v === U.selected, hot = v === U.hover || v.held;
    if (!sel && !hot && (v.shell || LabRender.enabled)) return;   // the raymarcher draws the glass and contents
    for (var k = 0; k < SEG; k++) {
      var a = Math.cos(k / SEG * Math.PI * 2) * v.radius, c = Math.sin(k / SEG * Math.PI * 2) * v.radius;
      var pb = proj(Vessels.toWorld(v, f, a, 0, c)), pt = proj(Vessels.toWorld(v, f, a, v.height, c));
      if (!pb || !pt) return;
      bot.push(px(pb)); top.push(px(pt));
      if (amount && !v.shell && !LabRender.enabled) {
        var pl = proj(Vessels.toWorld(v, f, a, Math.max(0, Math.min(v.height, Vessels.surface(v, a))), c));
        if (!pl) return;
        liqT.push(px(pl)); liqB.push(bot[k]);
      }
    }
    if (liqT.length && col) {
      var rgb = col.join(",");
      ctx2d.fillStyle = "rgba(" + rgb + ",0.16)";
      for (var q = 0; q < SEG; q++) { var n2 = (q + 1) % SEG; poly([liqB[q], liqB[n2], liqT[n2], liqT[q]]); ctx2d.fill(); }
      poly(liqB); ctx2d.fillStyle = "rgba(" + rgb + ",0.35)"; ctx2d.fill();
      poly(liqT); ctx2d.fillStyle = "rgba(" + rgb + ",0.6)"; ctx2d.fill();
      ctx2d.strokeStyle = "rgba(" + rgb + ",0.9)"; ctx2d.lineWidth = 1; ctx2d.stroke();
    }
    var B0 = bot.reduce(function (s, p) { return [s[0] + p[0] / SEG, s[1] + p[1] / SEG]; }, [0, 0]);
    var T0 = top.reduce(function (s, p) { return [s[0] + p[0] / SEG, s[1] + p[1] / SEG]; }, [0, 0]);
    var ax = T0[0] - B0[0], ay = T0[1] - B0[1], al = Math.hypot(ax, ay) || 1, nx = -ay / al, ny = ax / al, lo = 0, hi = 0, lov = Infinity, hiv = -Infinity;
    for (var j = 0; j < SEG; j++) { var d = (bot[j][0] - B0[0]) * nx + (bot[j][1] - B0[1]) * ny; if (d < lov) { lov = d; lo = j; } if (d > hiv) { hiv = d; hi = j; } }
    if (!v.shell && !LabRender.enabled) { ctx2d.fillStyle = "rgba(200,225,255," + (hot ? 0.09 : 0.05) + ")"; poly([bot[lo], top[lo], top[hi], bot[hi]]); ctx2d.fill(); }
    ctx2d.strokeStyle = sel ? "rgba(140,210,255," + (v.shell ? 0.7 : 0.95) + ")" : hot ? "rgba(210,235,255,0.8)" : "rgba(210,230,255,0.55)";
    ctx2d.lineWidth = sel ? 1.6 : 1.2;
    poly(bot); ctx2d.stroke(); poly(top); ctx2d.stroke();
    ctx2d.beginPath(); ctx2d.moveTo(bot[lo][0], bot[lo][1]); ctx2d.lineTo(top[lo][0], top[lo][1]); ctx2d.moveTo(bot[hi][0], bot[hi][1]); ctx2d.lineTo(top[hi][0], top[hi][1]); ctx2d.stroke();
    var lip = proj(Vessels.lip(v));
    if (lip && !v.shell) { var L = px(lip); ctx2d.fillStyle = v.blocked ? "#ff7a6b" : "#8fd3ff"; ctx2d.beginPath(); ctx2d.arc(L[0], L[1], 3, 0, Math.PI * 2); ctx2d.fill(); }
    if (v.held || (sel && !v.shell)) {
      var label = Math.round(100 * amount / Vessels.capacity(v)) + "%" + (v.tilt > 0.05 ? " · " + Math.round(v.tilt * 180 / Math.PI) + "°" : "");
      ctx2d.font = "12px system-ui, sans-serif"; ctx2d.fillStyle = "rgba(230,240,255,0.95)"; ctx2d.textAlign = "center";
      ctx2d.fillText(label, T0[0], Math.min.apply(null, top.map(function (p) { return p[1]; })) - 8);
    }
  }
  return U;
})();
