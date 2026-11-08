// User interface: periodic table, tools, camera, picking, data card and readouts.
function startElemental() {
  var $ = function (id) { return document.getElementById(id); };
  // One helper per physical core, less the main thread. navigator reports logical threads, so halve it.
  var helpers = Pool.init(Math.max(0, Math.min(15, Math.ceil((navigator.hardwareConcurrency || 2) / 2) - 1)), function (d) { if (d.type === "log") Sim.mergeLog(d.entries); });
  // Sized to hold 30 ticks a second in a busy scene. A 12-thread machine manages 24 to 30 at Large, but only 10 to 24 at Huge. Larger chambers stay a choice in the menu.
  var GRID = helpers >= 7 ? { w: 128, h: 80, d: 128 } : { w: 96, h: 64, d: 96 };
  if (Settings.get("chamber") !== "auto") { var sized = Settings.get("chamber").split(",").map(Number); GRID = { w: sized[0], h: sized[1], d: sized[2] }; }
  var canvas = $("view");
  var TOOLS = [
    { id: "place", label: "Place", tip: "Pour the selected material" },
    { id: "erase", label: "Erase", tip: "Remove material" },
    { id: "heat", label: "Heat", tip: "Raise temperature" },
    { id: "cool", label: "Cool", tip: "Lower temperature toward absolute zero" },
    { id: "spark", label: "Spark", tip: "Send current through conductors and gases" },
    { id: "neutron", label: "Neutrons", tip: "Fire a neutron source" },
    { id: "magnet", label: "Magnet", tip: "Attract ferromagnets below their Curie point" },
    { id: "blast", label: "Blast", tip: "Set off a blast wave" },
    { id: "uv", label: "UV lamp", tip: "Shine ultraviolet light to drive photochemistry" },
    { id: "orbit", label: "Orbit", tip: "Drag to turn the view (useful on touch screens)" },
    { id: "vessel", label: "Lab", tip: "Containers, hot plates and chillers: set down, carry, tip, heat and cool", key: "B" }
  ];
  var CATS = { nonmetal: "Reactive nonmetal", noble: "Noble gas", alkali: "Alkali metal", alkaline: "Alkaline earth", metalloid: "Metalloid", halogen: "Halogen", post: "Post-transition metal", transition: "Transition metal", lanthanide: "Lanthanide", actinide: "Actinide" };
  var state = { shape: "sphere", undo: [], redo: [], recent: [], pinned: null, pinnedSeries: [], tool: "place", mat: 11, form: P_POWDER, brush: 3, height: 26, placeT: null, paused: false, speed: 1, pointer: null, painting: false, tab: "el", hover: null };

  if (!Render.init(canvas)) { $("noGL").style.display = "flex"; }
  Sim.init(GRID.w, GRID.h, GRID.d);
  Sim.structural = true;
  try { Render.resizeGrid(); } catch (e) { console.error(e); }
  function attachWorkers() { var b = Sim.sharedBuffers(), s = Shade.buffers(); b.colorBuf = s.colorBuf; b.emitBuf = s.emitBuf; b.coarseBuf = s.coarseBuf; Pool.attach(b); }
  attachWorkers();
  // Every input handler may change cells, so each one first waits for a running tick to finish. Capturing here covers them all, and the next tick only starts from the main loop.
  ["click", "change", "input", "keydown", "pointerdown"].forEach(function (type) { window.addEventListener(type, function () { Sim.idle(); }, true); });

  // ---- Units ----
  function fmtT(t) {
    if (t >= 1e6) return (t / 1e6).toPrecision(3) + " MK";
    if (t >= 100000) return (t / 1000).toFixed(0) + " kK";
    return t.toFixed(t < 100 ? 1 : 0) + " K";
  }
  function celsius(t) { return t > 100000 ? "" : " (" + (t - 273.15).toFixed(0) + " °C)"; }
  function fmtTime(s) {
    if (s == null) return "stable";
    var Y = 31557600;
    if (s < 1) return (s * 1000).toPrecision(3) + " ms";
    if (s < 120) return s.toPrecision(3) + " s";
    if (s < 7200) return (s / 60).toPrecision(3) + " min";
    if (s < 172800) return (s / 3600).toPrecision(3) + " h";
    if (s < Y) return (s / 86400).toPrecision(3) + " d";
    if (s < 1e3 * Y) return (s / Y).toPrecision(3) + " y";
    if (s < 1e6 * Y) return (s / Y / 1e3).toPrecision(3) + " ky";
    if (s < 1e9 * Y) return (s / Y / 1e6).toPrecision(3) + " My";
    return (s / Y / 1e9).toPrecision(3) + " Gy";
  }
  var MODES = { A: "alpha", "B-": "beta minus", "B+": "beta plus", EC: "electron capture", SF: "spontaneous fission" };
  // Log-scale slider for temperature: 0 to 100 maps to 1 K to 100 000 K.
  function sliderToT(v) { return Math.pow(10, v / 20); }
  function tToSlider(t) { return Math.log10(t) * 20; }

  // ---- Periodic table ----
  var elButtons = {};
  function tablePos(e) {
    var z = e.z;
    if (z >= 57 && z <= 71) return { col: z - 57 + 3, row: 8 };
    if (z >= 89 && z <= 103) return { col: z - 89 + 3, row: 9 };
    return { col: e.grp, row: e.per };
  }
  function buildTable() {
    var box = $("ptable");
    var frag = document.createDocumentFragment();
    for (var z = 1; z <= 118; z++) {
      var e = ELEMENTS[z], p = tablePos(e), b = document.createElement("button");
      b.className = "el";
      b.style.setProperty("--c", "var(--c-" + e.cat + ")");
      b.style.gridColumn = p.col; b.style.gridRow = p.row;
      b.innerHTML = "<i>" + z + "</i><b>" + e.s + "</b><u></u>";
      b.title = z + " " + e.n;
      b.setAttribute("aria-label", e.n);
      var room = Sim.phaseFor(z, 293.15, P_POWDER);
      if (room === P_LIQUID) b.classList.add("liquid"); else if (room >= P_GAS) b.classList.add("gas");
      if (e.hl) b.classList.add("rad");
      b.dataset.z = z;
      b.addEventListener("click", selectFromEvent);
      b.addEventListener("mouseenter", hoverEl);
      elButtons[z] = b;
      frag.appendChild(b);
    }
    var key = document.createElement("div");
    key.id = "keyRow";
    key.innerHTML = Object.keys(CATS).map(function (c) { return '<span><s style="background:var(--c-' + c + ')"></s>' + CATS[c] + "</span>"; }).join("") +
      '<span><s style="background:#6cc4ff;border-radius:50%"></s>liquid</span><span><s style="background:#fff;border-radius:50%"></s>gas at 20 °C</span><span><s style="background:#bff36a;height:3px"></s>radioactive</span>';
    frag.appendChild(key);
    box.appendChild(frag);
    box.style.gridTemplateRows = "repeat(7, var(--cell)) 5px repeat(2, var(--cell))";
    for (var k = 1; k <= 118; k++) {   // f-block sits below a small gap
      var pos = tablePos(ELEMENTS[k]);
      if (pos.row >= 8) elButtons[k].style.gridRow = pos.row + 1;
    }
  }
  function selectFromEvent(ev) { selectMat(+ev.currentTarget.dataset.z); }
  function hoverEl(ev) { showCard(+ev.currentTarget.dataset.z); }

  function buildCompounds() {
    var box = $("compounds"), frag = document.createDocumentFragment();
    var named = Object.keys(SPECIES).filter(function (f) { return Mat.named(f) && Mat.PALETTE.indexOf(f) < 0; });
    Mat.PALETTE.concat(named, ["__wall", "__electrode"]).forEach(function (f) {
      var id = f === "__wall" ? WALL : f === "__electrode" ? ELECTRODE : Mat.named(f);
      var m = Mat.list[id], b = document.createElement("button");
      b.className = "cp";
      var phase = Sim.phaseFor(id, 293.15, P_POWDER);
      var col = phase === P_LIQUID ? (m.colL || m.colS) : m.colS;
      b.innerHTML = '<s style="background:' + col + '"></s><b>' + Mat.pretty(id >= FIRST_COMPOUND ? m.formula : m.name) + "</b>";
      b.title = m.name;
      b.dataset.z = id;
      b.dataset.search = (m.name + " " + m.formula).toLowerCase();
      b.addEventListener("click", selectFromEvent);
      b.addEventListener("mouseenter", hoverEl);
      b.dataset.kind = compoundKinds(id, m, phase);
      elButtons[id] = b;
      frag.appendChild(b);
    });
    box.appendChild(frag);
  }
  // Which groups of the compound filter a material belongs to, as a space-separated list.
  function compoundKinds(id, m, phase) {
    var k = [];
    if (id === WALL || id === ELECTRODE) return "";
    if (m.acid) k.push("acid");
    if (m.base) k.push("base");
    if (m.isAlloy) k.push("alloy");
    else if (m.an === "O") k.push("oxide");
    else if (m.catZ && m.an && !m.acid && !m.base) k.push("salt");
    // Organic by the usual convention: carbon with hydrogen, but not carbonates, cyanides and thiocyanates, which chemists count as inorganic.
    if (!m.isAlloy && m.formula && !/CO3|CN|SCN/.test(m.formula)) { var at = Mat.atoms(m.formula); if (at && at.C && at.H) k.push("organic"); }
    if (phase >= P_GAS) k.push("gas"); else if (phase === P_LIQUID) k.push("liquid");
    return k.join(" ");
  }

  // ---- Reaction browser ----
  function conditionText(d) {
    var c = [];
    if (d.minT) c.push("> " + d.minT + " K");
    if (d.maxT) c.push("< " + d.maxT + " K");
    if (d.cat) c.push("on " + Mat.pretty(Mat.list[d.cat].formula));
    if (d.elec) c.push("current");
    if (d.light) c.push("UV");
    if (d.liq) c.push("molten");
    if (d.dH !== null && d.dH !== undefined) c.push((d.dH > 0 ? "+" : "") + Math.round(d.dH) + " kJ");
    return c.join(" \u00b7 ");
  }
  function buildReactions() {
    var box = $("reactions"), groups = {}, order = [];
    Chem.database.forEach(function (d, k) {
      if (!groups[d.group]) { groups[d.group] = []; order.push(d.group); }
      groups[d.group].push(k);
    });
    var sel = $("rxGroup");
    sel.innerHTML = '<option value="">All groups</option>' + order.map(function (g) { return '<option>' + g + " (" + groups[g].length + ")</option>"; }).join("");
    var html = "";
    order.forEach(function (g) {
      groups[g].forEach(function (k) {
        var d = Chem.database[k], c = conditionText(d);
        html += '<button class="rx" data-k="' + k + '" data-g="' + g + '" data-s="' + (d.eq + " " + d.L.concat(d.R).map(function (t) { return Mat.list[t.id].name; }).join(" ")).toLowerCase().replace(/"/g, "") + '"><span>' + d.msg + "</span><em>" + c + "</em></button>";
      });
    });
    box.innerHTML = html;
    box.addEventListener("click", function (e) {
      var b = e.target.closest(".rx");
      if (!b) return;
      runDemo(Chem.database[+b.dataset.k]);
    });
    $("rxCount").textContent = Chem.database.length + " equations";
  }
  function filterLists() {
    var q = $("search").value.trim().toLowerCase(), g = $("rxGroup").value.replace(/ \(\d+\)$/, ""), shown = 0;
    document.querySelectorAll("#reactions .rx").forEach(function (b) {
      var on = (!q || b.dataset.s.indexOf(q) >= 0) && (!g || b.dataset.g === g);
      b.hidden = !on; if (on) shown++;
    });
    if (state.tab === "rx") $("rxCount").textContent = shown + " of " + Chem.database.length + " equations";
    var kind = $("cpGroup").value, favs = Settings.get("favourites");
    document.querySelectorAll("#compounds .cp").forEach(function (b) {
      var inKind = !kind || (kind === "fav" ? favs.indexOf(+b.dataset.z) >= 0 : (" " + b.dataset.kind + " ").indexOf(" " + kind + " ") >= 0);
      b.hidden = (!!q && (b.dataset.search || "").indexOf(q) < 0) || !inKind;
    });
    if (state.tab === "el") for (var z = 1; z <= 118; z++) elButtons[z].classList.toggle("dimmed", !!q && (ELEMENTS[z].n + " " + ELEMENTS[z].s).toLowerCase().indexOf(q) < 0);
  }
  function runDemo(d) {
    pushUndo();
    LabUI.reset();
    Sim.ambient = 293.15; Sim.atmosphere = "air"; $("atm").value = "air"; state.syncAmb();
    Scenes.demo(d);
    state.demo = d;
    $("lid").setAttribute("aria-pressed", "true");
    $("scene").value = "";
    $("noteTitle").textContent = d.msg;
    var parts = [d.group + "."], c = conditionText(d);
    if (c) parts.push("Conditions: " + c + ".");
    if (d.light) parts.push("The lamp is on for this demonstration.");
    $("noteText").textContent = parts.join(" ");
    $("noteAction").hidden = true; $("sceneNote").hidden = false;
    Render.markAllDirty();
  }

  function selectMat(id) {
    if (elButtons[state.mat]) elButtons[state.mat].setAttribute("aria-pressed", "false");
    state.mat = id;
    if (elButtons[id]) elButtons[id].setAttribute("aria-pressed", "true");
    if (state.tool !== "vessel") setTool("place");   // with the Beaker tool, picking a material chooses what Fill pours in
    showCard(id);
    showPartners(id);
    noteRecent(id);
    buildIsotopes(id);
  }

  // ---- Data card ----
  function fact(k, v, est) { return v === null || v === undefined || v === "" ? "" : "<dt>" + k + "</dt><dd" + (est ? ' class="est"' : "") + ">" + v + "</dd>"; }
  function showCard(id) {
    var m = Mat.list[id];
    if (!m) return;
    var html = "";
    if (id >= 1 && id <= 118) {
      var e = ELEMENTS[id], est = e.est || [], E = function (k) { return est.indexOf(k) >= 0; };
      $("cSym").textContent = e.s; $("cName").textContent = e.n; $("cSub").textContent = "Z " + e.z + " · " + CATS[e.cat];
      $("swatch").style.background = e.color;
      html += fact("Atomic mass", e.m + " u");
      html += fact("Electrons", e.conf);
      html += fact("Group / period", (e.grp || "f") + " / " + e.per);
      html += fact("Melts", e.mp == null ? "no solid at 1 atm" : (e.mp >= e.bp ? "sublimes" : e.mp.toFixed(1) + " K"), E("mp"));
      html += fact("Boils", e.bp == null ? "—" : e.bp.toFixed(1) + " K", E("bp"));
      html += fact("Density", (e.d < 0.05 ? (e.d * 1000).toFixed(3) + " g/L" : e.d.toFixed(2) + " g/cm³"), E("density"));
      html += fact("Specific heat", e.cp.toFixed(3) + " J/g·K", E("cp"));
      html += fact("Conducts heat", e.k + " W/m·K", E("k"));
      html += fact("Fusion heat", e.hf + " kJ/mol", E("hf"));
      html += fact("Vaporisation", e.hv + " kJ/mol", E("hv"));
      html += fact("Electronegativity", e.en == null ? "—" : e.en);
      html += fact("First ionisation", e.ie == null ? null : e.ie + " eV");
      html += fact("Oxidation", e.ox && e.ox.length ? e.ox.map(function (o) { return (o > 0 ? "+" : "") + o; }).join(", ") : "none");
      if (e.E0 != null) html += fact("E°", (e.E0 > 0 ? "+" : "") + e.E0 + " V");
      if (e.sigma >= 0.01) html += fact("Conductivity", e.sigma + " MS/m");
      if (e.ign) html += fact("Ignites in air", e.ign + " K");
      if (e.Tc) html += fact("Superconducts", "< " + e.Tc + " K");
      if (e.curie) html += fact("Curie point", e.curie + " K");
      if (e.barns) html += fact("n capture", e.barns + " b");
      if (e.lat) html += fact("Crystal", e.lat);
      if (e.crust) html += fact("Crustal abundance", e.crust + " mg/kg");
      if (e.year) html += fact("Discovered", e.year);
      if (e.hl) {
        html += fact("Longest isotope", e.s + "-" + e.hlA);
        html += fact("Half-life", fmtTime(e.hl));
        html += fact("Here", Mat.decay[id].toPrecision(2) + " s");
        html += fact("Decays by", MODES[e.dm] || e.dm);
      } else if (e.hlNote) html += fact("Half-life", (e.hlNote / 31557600).toExponential(1) + " y");
      $("note").textContent = e.note;
    } else {
      var f = id >= FIRST_COMPOUND;
      $("cSym").textContent = f ? "" : "";
      $("cName").textContent = m.name;
      $("cSub").textContent = f ? Mat.pretty(m.formula) + " · " + m.M.toFixed(2) + " g/mol" : "Special cell";
      $("swatch").style.background = m.colS;
      if (f) {
        html += fact("Melts", m.mp >= m.bp ? "sublimes or decomposes" : m.mp.toFixed(0) + " K", m.est);
        html += fact("Boils", m.bp.toFixed(0) + " K", m.est);
        html += fact("Density", m.rhoS.toFixed(2) + " g/cm³", m.est);
        html += fact("Specific heat", m.cp.toFixed(2) + " J/g·K", m.est);
        if (Mat.decT[id]) html += fact("Decomposes", Mat.decT[id].toFixed(0) + " K", m.est);
        html += fact("Water", m.acid ? "strong acid" : m.soluble ? "soluble" : "insoluble");
      }
      $("note").textContent = m.noteText || (m.est ? "Formula from real oxidation states. Physical properties are estimated from the bond type." : "");
    }
    $("facts").innerHTML = html;
    state.cardId = id;
    syncFavButton();
    $("reactsWith").hidden = true;
  }
  // The full partner list costs thousands of lookups, so it is built when a material is chosen and not on hover.
  function showPartners(id) {
    var box = $("reactsWith");
    if (id === WALL || id === ELECTRODE) { box.hidden = true; return; }
    var seen = {}, rows = [], partners = Chem.partners(id);
    partners.forEach(function (p) { var r = p.rule; while (r) { if (!seen[r.msg]) { seen[r.msg] = 1; rows.push(r.msg); } r = r.alt; } });
    var u = Chem.uniFor(id);
    if (u) u.forEach(function (x) { if (!seen[x.msg]) { seen[x.msg] = 1; rows.unshift(x.msg); } });
    Chem.database.forEach(function (d) { if (d.R.length && d.L.length > 2 && d.L.some(function (t) { return t.id === id; }) && !seen[d.msg]) { seen[d.msg] = 1; rows.push(d.msg); } });
    if (!rows.length) { box.innerHTML = '<summary>No known reactions here</summary>'; box.hidden = false; return; }
    box.innerHTML = "<summary>" + rows.length + " reactions</summary><div>" + rows.slice(0, 200).map(function (m) { return "<p>" + m + "</p>"; }).join("") + (rows.length > 200 ? "<p>\u2026 and " + (rows.length - 200) + " more</p>" : "") + "</div>";
    box.hidden = false;
  }

  // ---- Controls ----
  function setTool(t) {
    state.tool = t;
    TOOLS.forEach(function (o) { $("tool-" + o.id).setAttribute("aria-pressed", o.id === t ? "true" : "false"); });
    if (t !== "magnet") Sim.magnet = null;
    if (typeof LabUI !== "undefined") LabUI.toolChanged();
  }
  function buildTools() {
    var box = $("tools");
    TOOLS.forEach(function (t, k) {
      var b = document.createElement("button");
      b.id = "tool-" + t.id; b.textContent = t.label; b.title = t.tip + " (" + (t.key || k + 1) + ")";
      b.addEventListener("click", function () { setTool(t.id); });
      box.appendChild(b);
    });
  }
  var SPEEDS = [0.25, 0.5, 1, 2, 4], DECAYS = [0.25, 1, 5, 25, 100];
  function bindControls() {
    var size = $("size"), height = $("height"), pt = $("ptemp"), amb = $("amb"), speed = $("speed"), dec = $("decay");
    function syncBrush() { state.brush = +size.value; $("sizeO").textContent = state.brush * 2 + 1 + " vox"; state.height = +height.value; $("heightO").textContent = state.height + " vox"; }
    function syncPT() {
      var v = +pt.value; state.placeT = v === 0 ? null : sliderToT(v);
      $("ptempO").textContent = state.placeT === null ? "room" : fmtT(state.placeT);
    }
    function syncAmb() { Sim.ambient = sliderToT(+amb.value); $("ambO").textContent = fmtT(Sim.ambient); Sim.wakeAll(); }
    function syncSpeed() { state.speed = SPEEDS[+speed.value]; $("speedO").textContent = state.speed + "×"; }
    function syncDecay() { Sim.setDecayScale(DECAYS[+dec.value]); $("decayO").textContent = DECAYS[+dec.value] + "×"; }
    size.oninput = height.oninput = syncBrush; pt.oninput = syncPT; speed.oninput = syncSpeed; dec.oninput = syncDecay;
    $("gridSize").value = GRID.w + "," + GRID.h + "," + GRID.d;
    amb.value = tToSlider(293.15); amb.oninput = syncAmb;
    state.syncAmb = function () { amb.value = tToSlider(Sim.ambient); $("ambO").textContent = fmtT(Sim.ambient); };
    state.syncDecay = function () { dec.value = DECAYS.indexOf(Sim.decayScale) < 0 ? 1 : DECAYS.indexOf(Sim.decayScale); $("decayO").textContent = Sim.decayScale + "×"; };
    state.syncBrush = syncBrush;
    syncBrush(); syncPT(); syncAmb(); syncSpeed(); syncDecay();

    $("gridSize").onchange = function () {
      var d = this.value.split(",").map(Number), current = $("scene").value;
      state.undo.length = 0; state.redo.length = 0; refreshUndo();
      LabUI.reset(); unpin();
      Sim.init(d[0], d[1], d[2]); Render.resizeGrid(); attachWorkers();
      if (current) loadScene(current); else Sim.updateCensus();
    };
    $("atm").onchange = function () { Sim.atmosphere = this.value; Sim.wakeAll(); };
    function press(b, v) { b.setAttribute("aria-pressed", v ? "true" : "false"); }
    $("lid").onclick = function () { Sim.lid = !Sim.lid; press(this, Sim.lid); };
    // Earth, the Moon, a heavy world, then none.
    var GRAVITIES = [[1, "Gravity 1 g"], [0.16, "Gravity 0.16 g"], [3, "Gravity 3 g"], [0, "Gravity off"]];
    state.setGravity = function (g) { Sim.gravity = g; var row = GRAVITIES.filter(function (o) { return o[0] === g; })[0] || GRAVITIES[0]; $("grav").textContent = row[1]; press($("grav"), g); };
    $("grav").onclick = function () { var at = GRAVITIES.map(function (o) { return o[0]; }).indexOf(Sim.gravity); state.setGravity(GRAVITIES[(at + 1) % GRAVITIES.length][0]); Sim.wakeAll(); Sim.markStatic(); };
    function setView(v) { Render.viewMode = Render.viewMode === v ? "normal" : v; press($("heatView"), Render.viewMode === "heat"); press($("phView"), Render.viewMode === "ph"); Render.markAllDirty(); }
    function toggleHeat() { setView("heat"); }
    $("heatView").onclick = toggleHeat;
    $("phView").onclick = function () { setView("ph"); };
    $("fluidBtn").onclick = function () { Sim.fluid = Sim.fluid === false; press(this, Sim.fluid); if (!Sim.fluid) { Sim.FU.fill(0); Sim.FV.fill(0); Sim.FW.fill(0); } };
    $("isotope").onchange = function () { applyIsotope(this.value); };
    $("record").onclick = toggleRecord;
    $("share").onclick = shareLink;
    $("lessonsBtn").onclick = function () { $("lessonMenu").hidden = !$("lessonMenu").hidden; };
    $("lessonMenuClose").onclick = function () { $("lessonMenu").hidden = true; };
    $("lessonNext").onclick = function () { nextStep(); };
    $("lessonClose").onclick = function () { state.lesson = null; $("lessonBox").hidden = true; };
    $("tabJn").onclick = function () { setTab("jn"); };
    $("fGrains").onclick = function () { state.form = P_POWDER; press(this, true); press($("fBlock"), false); };
    $("fBlock").onclick = function () { state.form = P_STATIC; press(this, true); press($("fGrains"), false); };
    function togglePause() { state.paused = !state.paused; $("pause").textContent = state.paused ? "Resume" : "Pause"; }
    $("pause").onclick = togglePause;
    $("step").onclick = function () { if (!state.paused) togglePause(); Sim.tick(); };
    $("undo").onclick = function () { undo(state.undo, state.redo); };
    $("redo").onclick = function () { undo(state.redo, state.undo); };
    $("save").onclick = saveFile;
    $("load").onclick = function () { $("loadFile").click(); };
    $("loadFile").onchange = function () { if (this.files[0]) loadFile(this.files[0]); this.value = ""; };
    $("shape").onchange = function () { state.shape = this.value; };
    $("collapse").onclick = function () { Sim.structural = !Sim.structural; press(this, Sim.structural); Sim.markStatic(); };
    $("pin").onclick = pinCell;
    function setCompact(v) { document.body.classList.toggle("compact", v); press($("compact"), v); try { localStorage.setItem("elementalCompact", v ? "1" : ""); } catch (e) {} }
    $("compact").onclick = function () { setCompact(!document.body.classList.contains("compact")); };
    try { if (localStorage.getItem("elementalCompact")) setCompact(true); } catch (e) {}
    $("clear").onclick = function () { pushUndo(); state.demo = null; LabUI.reset(); unpin(); Sim.clear(); Sim.updateCensus(); $("scene").value = ""; $("sceneNote").hidden = true; Render.markAllDirty(); };
    $("helpBtn").onclick = function () { $("help").hidden = false; };
    $("helpClose").onclick = function () { $("help").hidden = true; };
    $("help").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
    bindSettings();
    $("noteClose").onclick = function () { $("sceneNote").hidden = true; };

    var sel = $("scene");
    sel.innerHTML = '<option value="">Blank chamber</option>' + Scenes.list.map(function (s) { return '<option value="' + s.id + '">' + s.name + "</option>"; }).join("");
    sel.onchange = function () { if (this.value) loadScene(this.value); };

    function setTab(t) {
      state.tab = t;
      press($("tabEl"), t === "el"); press($("tabCp"), t === "cp"); press($("tabRx"), t === "rx"); press($("tabJn"), t === "jn"); press($("tabHide"), t === "hide");
      $("journal").style.display = t === "jn" ? "block" : "none";
      if (t === "jn") renderJournal();
      $("ptable").style.display = t === "el" ? "grid" : "none";
      $("compounds").style.display = t === "cp" ? "flex" : "none";
      $("reactions").style.display = t === "rx" ? "grid" : "none";
      $("rxGroup").hidden = t !== "rx"; $("rxCount").hidden = t !== "rx"; $("cpGroup").hidden = t !== "cp";
      filterLists();
      $("tableScroll").style.display = t === "hide" ? "none" : "block";
    }
    $("tabEl").onclick = function () { setTab("el"); };
    $("tabCp").onclick = function () { setTab("cp"); };
    $("tabRx").onclick = function () { setTab("rx"); };
    $("search").oninput = filterLists; $("rxGroup").onchange = filterLists; $("cpGroup").onchange = filterLists;
    $("favBtn").onclick = function () { toggleFavourite(state.cardId); };
    $("tabHide").onclick = function () { setTab("hide"); };
    setTab("el");

    $("filter").onchange = function () {
      var v = this.value;
      for (var z = 1; z <= 118; z++) {
        var e = ELEMENTS[z], room = Sim.phaseFor(z, 293.15, P_POWDER), on = true;
        if (v === "liquid") on = room === P_LIQUID;
        else if (v === "gas") on = room >= P_GAS;
        else if (v === "rad") on = !!e.hl;
        else if (v === "fissile") on = e.fissile > 0;
        else if (v === "magnet") on = e.curie > 0;
        else if (v === "super") on = e.Tc > 0;
        else if (v === "absorber") on = e.barns > 90;
        else if (v === "water") on = !!(Chem.ruleFor(z, Mat.named("H2O")) && Chem.ruleFor(z, Mat.named("H2O")).minT === 0);
        else if (v === "est") on = e.est.indexOf("mp") >= 0;
        elButtons[z].classList.toggle("dimmed", !!v && !on);
      }
    };

    window.addEventListener("keydown", function (e) {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== "Escape") return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) undo(state.redo, state.undo); else undo(state.undo, state.redo); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); undo(state.redo, state.undo); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === " ") { e.preventDefault(); togglePause(); }
      else if (e.key === "p" || e.key === "P") pinCell();
      else if (e.key === "[") { size.value = Math.max(0, +size.value - 1); syncBrush(); }
      else if (e.key === "]") { size.value = Math.min(14, +size.value + 1); syncBrush(); }
      else if (e.key === "t" || e.key === "T") setTab(state.tab === "hide" ? "el" : "hide");
      else if (e.key === "h" || e.key === "H") toggleHeat();
      else if (e.key === "Escape") { $("help").hidden = true; $("settings").hidden = true; }
      else if (e.key === "*") toggleFavourite(state.mat);
      else if (e.key === "Home") { e.preventDefault(); Render.resetCamera(); }
      else if (CAM_KEYS[e.key]) { e.preventDefault(); camHeld[e.key] = true; }
      else if (/^[1-9]$/.test(e.key)) setTool(TOOLS[+e.key - 1].id);
    });
    window.addEventListener("keyup", function (e) { delete camHeld[e.key]; });
    window.addEventListener("blur", function () { camHeld = {}; });
  }

  // ---- Camera keys ----
  // Held keys turn, tilt and zoom at a steady rate. The view itself glides after the target, in render.js.
  var CAM_KEYS = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, -1, 0], ArrowDown: [0, 1, 0], "+": [0, 0, -1], "=": [0, 0, -1], "-": [0, 0, 1], "_": [0, 0, 1] }, camHeld = {};
  function cameraKeys(dt) {
    var c = Render.camera, turn = 0, tilt = 0, zoom = 0;
    for (var k in camHeld) { var v = CAM_KEYS[k]; if (v) { turn += v[0]; tilt += v[1]; zoom += v[2]; } }
    if (!turn && !tilt && !zoom) return;
    c.yaw -= turn * 1.6 * dt;
    c.pitch = clamp(c.pitch + tilt * 1.1 * dt, 0.02, 1.5);
    c.dist = clamp(c.dist * Math.exp(zoom * 1.6 * dt), 18, Render.maxDist());
  }
  // Centre the view on whatever was double-clicked, keeping the same distance and angle.
  function focusAt(nx, ny) {
    var p = pick(nx, ny);
    if (!p || !p.hit) return;
    var c = Render.camera;
    c.tx = p.x + 0.5; c.ty = p.y + 0.5; c.tz = p.z + 0.5;
  }

  // ---- Settings ----
  function applyUiScale(v) { document.documentElement.style.setProperty("--ui-scale", v); }
  // Holding a fixed render scale here also tells the main loop to stop adapting it.
  function applyQuality() { var s = Settings.renderScale(); if (s !== null) Render.scale = s; }
  function bindSettings() {
    function sync() {
      $("setQuality").value = Settings.get("quality");
      $("setLook").value = Render.look === "classic" ? "classic" : "realistic";
      $("setLook").disabled = !!document.getElementById("lookBtn") && document.getElementById("lookBtn").disabled;
      $("setRoom").value = Settings.get("room");
      $("setFx").value = Settings.get("effects") ? "on" : "off";
      $("setScale").value = String(Settings.get("uiScale"));
      $("setChamber").value = Settings.get("chamber");
      $("setAuto").value = Settings.get("autosave") ? "on" : "off";
      $("setFull").textContent = document.fullscreenElement ? "Leave full screen" : "Full screen";
    }
    $("settingsBtn").onclick = function () { sync(); $("settings").hidden = false; };
    $("setClose").onclick = function () { $("settings").hidden = true; };
    $("settings").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
    $("setFull").onclick = function () {
      var done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      if (done && done.catch) done.catch(function () { toast("Full screen is not available here."); });
    };
    document.addEventListener("fullscreenchange", sync);
    $("setQuality").onchange = function () { Settings.set("quality", this.value); };
    $("setLook").onchange = function () { Render.setLook(this.value); };
    $("setRoom").onchange = function () { Settings.set("room", this.value); };
    $("setFx").onchange = function () { Settings.set("effects", this.value === "on"); };
    $("setScale").onchange = function () { Settings.set("uiScale", +this.value); };
    $("setChamber").onchange = function () { Settings.set("chamber", this.value); toast("The chamber size applies the next time the game starts."); };
    $("setAuto").onchange = function () { Settings.set("autosave", this.value === "on"); if (this.value !== "on") Autosave.clear(); };
    $("setReset").onclick = function () { Settings.reset(); Render.setLook("realistic"); sync(); };
    Settings.onChange(function (k, v) { if (k === "uiScale") applyUiScale(v); if (k === "quality") applyQuality(); if (k === "room") { Render.room = v === "lab"; Render.wake(); } if (k === "effects") Effects.enabled = v; });
    applyUiScale(Settings.get("uiScale"));
    applyQuality();
    Render.room = Settings.get("room") === "lab";
    // Effects follow the setting, and start off for anyone whose system asks for less motion until they choose otherwise.
    var lessMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var chosen = false;
    try { chosen = localStorage.getItem("elemental.settings") !== null; } catch (e) { chosen = false; }
    Effects.enabled = Settings.get("effects") && !(lessMotion && !chosen);
  }

  // ---- Undo and files ----
  function refreshUndo() { $("undo").disabled = !state.undo.length; $("redo").disabled = !state.redo.length; }
  // The whole state of the chamber: cells, settings and equipment. Undo and save files both use this, so neither can lose part of it.
  function captureWorld() {
    var s = Sim.snapshot();
    s.lab = Lab.serialize();
    s.scene = $("scene").value;
    return s;
  }
  function unpin() { state.pinned = null; state.pinnedSeries = []; if ($("graph-pin")) $("graph-pin").hidden = true; }
  // Puts a captured or loaded state back, changing the chamber's size first if it has to. Afterward every control shows what the chamber now is.
  function applyWorld(s) {
    if (Sim.busy) Sim.idle();
    if (s.W !== Sim.W || s.H !== Sim.H || s.D !== Sim.D) {
      unpin();
      Sim.init(s.W, s.H, s.D); Render.resizeGrid(); attachWorkers();
    }
    Sim.restore(s);
    Lab.deserialize(s.lab);   // an older file has no equipment, and this empties the list
    LabUI.forget();
    syncControls(s);
    state.demo = null;
    Render.markAllDirty();
  }
  function syncControls(s) {
    var size = s.W + "," + s.H + "," + s.D, grid = $("gridSize");
    grid.value = size;
    if (grid.value !== size) grid.selectedIndex = -1;   // a size the menu does not list
    $("atm").value = Sim.atmosphere;
    state.syncAmb(); state.syncDecay(); state.setGravity(Sim.gravity);
    $("lid").setAttribute("aria-pressed", Sim.lid ? "true" : "false");
    $("collapse").setAttribute("aria-pressed", Sim.structural ? "true" : "false");
    $("fluidBtn").setAttribute("aria-pressed", Sim.fluid !== false ? "true" : "false");
    var known = Scenes.list.some(function (o) { return o.id === s.scene; });
    $("scene").value = known ? s.scene : "";
    if (!known || s.scene !== state.noteScene) $("sceneNote").hidden = true;
  }
  function pushUndo() {
    noteEdit();
    state.undo.push(captureWorld());
    if (state.undo.length > 6) state.undo.shift();
    state.redo.length = 0;
    refreshUndo();
  }
  function undo(from, to) {
    if (!from.length) return;
    to.push(captureWorld());
    applyWorld(from.pop());
    refreshUndo();
  }
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(state.toastT);
    state.toastT = setTimeout(function () { el.hidden = true; }, 3500);
  }
  var saveEnv = { Mat: Mat, WALL: WALL, labCheck: Lab.check };
  function captureForFile() {
    var s = captureWorld(), c = Render.camera;
    s.camera = { yaw: c.yaw, pitch: c.pitch, dist: c.dist, tx: c.tx, ty: c.ty, tz: c.tz };
    return s;
  }
  // The camera only comes back from a file. Undo leaves the view where the player put it.
  function restoreCamera(c) { if (c) { Object.assign(Render.camera, c); Render.camera.dist = clamp(Render.camera.dist, 18, Render.maxDist()); Render.snapCamera(); } }
  async function saveFile() {
    var blob = await SaveFile.toBlob(captureForFile(), Mat), a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chamber-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".elemental";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast("Saved " + (blob.size / 1048576).toFixed(1) + " MB");
  }
  // Everything is checked and read into a separate copy before the chamber changes, so a bad file leaves the current one untouched.
  async function loadFile(file) {
    try {
      var loaded = await SaveFile.fromBlob(file, saveEnv);
      pushUndo();
      applyWorld(loaded);
      restoreCamera(loaded.camera);
      toast("Loaded " + file.name + (loaded.repaired ? ", with " + loaded.repaired + " damaged readings reset" : ""));
    } catch (e) { toast(e.friendly ? e.message : "That file could not be read."); }
  }

  // ---- Automatic save ----
  // At most one save running at a time, and none while nothing has changed. A slow machine or a giant chamber saves less often rather than stuttering.
  var AUTOSAVE_SECONDS = 60;
  var auto = { busy: false, nextAt: 0, lastTick: -1, edits: 0, savedEdits: -1, offer: false, lastMs: 0 };
  function noteEdit() { auto.edits++; if (auto.offer) dismissResume(); }
  function autosaveNow(force) {
    // A forced save waits its turn, because the one already running holds an older state.
    if (auto.busy) return force ? auto.running.then(function () { return autosaveNow(true); }) : Promise.resolve(false);
    if (!force) {
      if (state.glLost || !Settings.get("autosave") || auto.offer) return Promise.resolve(false);
      if (auto.lastTick === Sim.tickN && auto.savedEdits === auto.edits) return Promise.resolve(false);
      if (!Sim.totalCells && !Lab.all().length) return Promise.resolve(false);
    }
    auto.busy = true;
    var t0 = performance.now(), tick = Sim.tickN, edits = auto.edits, s = captureForFile();
    auto.running = SaveFile.toBlob(s, Mat).then(function (blob) {
      return Autosave.put(blob, { when: Date.now(), W: s.W, H: s.H, D: s.D, scene: s.scene });
    }).then(function () {
      auto.lastTick = tick; auto.savedEdits = edits; auto.lastMs = performance.now() - t0;
      auto.busy = false;
      return true;
    }, function (e) { auto.busy = false; console.warn("Automatic save failed.", e); return false; });
    return auto.running;
  }
  function autosaveTick(now) {
    if (now < auto.nextAt) return;
    auto.nextAt = now + Math.max(AUTOSAVE_SECONDS * 1000, auto.lastMs * 40);
    if (now > 1000) autosaveNow(false);
  }
  function timeAgo(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    var h = Math.round(m / 60);
    if (h < 48) return h + (h === 1 ? " hour ago" : " hours ago");
    return Math.round(h / 24) + " days ago";
  }
  async function resumeAutosave(record) {
    var loaded = await SaveFile.fromBlob(record.blob, saveEnv);
    applyWorld(loaded);
    restoreCamera(loaded.camera);
  }
  function dismissResume() { auto.offer = false; $("resumeBar").hidden = true; }
  // After a graphics reset the page reloads and carries on by itself. After a normal launch the player chooses, and starting to build counts as choosing not to.
  async function offerResume() {
    var marker = null;
    try { marker = sessionStorage.getItem("elemental.resume"); sessionStorage.removeItem("elemental.resume"); } catch (e) { marker = null; }
    var record = await Autosave.get();
    if (!record || !record.blob) { if (marker) toast("The graphics driver restarted, and the chamber could not be recovered."); return; }
    if (marker) {
      try { await resumeAutosave(record); toast("The graphics driver restarted. Your chamber is back."); }
      catch (e) { toast("The graphics driver restarted, and the chamber could not be recovered."); }
      return;
    }
    if (!Settings.get("autosave") || location.hash.length > 1) return;
    var i = record.info || {}, known = Scenes.list.filter(function (o) { return o.id === i.scene; })[0];
    $("resumeText").textContent = "Continue your last chamber" + (known ? " (" + known.name + ")" : "") + ", saved " + timeAgo(Date.now() - (i.when || 0)) + "?";
    $("resumeBar").hidden = false;
    auto.offer = true;
    $("resumeNo").onclick = dismissResume;
    $("resumeGo").onclick = async function () {
      dismissResume();
      try { pushUndo(); await resumeAutosave(record); toast("Welcome back."); }
      catch (e) { toast(e.friendly ? e.message : "The automatic save could not be read."); }
    };
  }

  // ---- Lost graphics context ----
  // A driver reset or a GPU crash takes every texture and shader with it. The simulation lives on the CPU and is fine, so it is saved first,
  // and then the page reloads into a fresh context and carries on. Reloading rebuilds far less fragile state than recreating each GL object.
  function bindContextLoss() {
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();   // without this the browser never offers the context back
      state.glLost = true;
      $("glLost").hidden = false; $("glLostText").textContent = "The graphics driver restarted. Saving your chamber and getting it back.";
      var ready = autosaveNow(true).then(function (ok) { try { if (ok) sessionStorage.setItem("elemental.resume", "1"); } catch (err) { /* it simply starts fresh */ } return ok; });
      state.glSaved = ready;
      // Some drivers never give the context back. Offer a way out rather than leaving a black window.
      setTimeout(function () { if (state.glLost) { $("glLostText").textContent = "The graphics driver has not come back yet. Your chamber is saved."; $("glLostReload").hidden = false; } }, 8000);
    });
    canvas.addEventListener("webglcontextrestored", function () { state.glSaved.then(function () { location.reload(); }); });
    $("glLostReload").onclick = function () { state.glSaved.then(function () { location.reload(); }); };
  }

  // ---- Graphs: one small chart per reading, each with its own axis ----
  var GRAPHS = [
    { id: "hot", label: "Hottest matter", unit: "K", get: function (h) { return h.hot; } },
    { id: "press", label: "Peak pressure", unit: "kPa", get: function (h) { return h.press; } },
    { id: "rate", label: "Events per second", unit: "/s", rate: true },
    { id: "pin", label: "Pinned cell", unit: "K", pinned: true }
  ];
  function buildGraphs() {
    var box = $("graphs");
    GRAPHS.forEach(function (g) {
      var d = document.createElement("div");
      d.className = "graph"; d.id = "graph-" + g.id; if (g.pinned) d.hidden = true;
      d.innerHTML = '<div class="gh"><span>' + g.label + '</span><b></b></div><canvas role="img" aria-label="' + g.label + ' over time"></canvas><div class="tip" hidden></div>';
      box.appendChild(d);
      var cv = d.querySelector("canvas");
      cv.addEventListener("pointermove", function (e) { var r = cv.getBoundingClientRect(); g.hover = (e.clientX - r.left) / r.width; drawGraph(g); });
      cv.addEventListener("pointerleave", function () { g.hover = null; drawGraph(g); });
    });
  }
  function seriesFor(g) {
    if (g.pinned) return state.pinnedSeries;
    var H = Sim.history || [], out = [];
    for (var k = 0; k < H.length; k++) {
      if (g.rate) { if (k) { var dt = H[k].t - H[k - 1].t; out.push({ t: H[k].t, v: dt > 0 ? Math.max(0, H[k].reactions - H[k - 1].reactions) / dt : 0 }); } }
      else out.push({ t: H[k].t, v: g.get(H[k]) });
    }
    return out;
  }
  function fmtVal(v, unit) { var n = Math.abs(v) >= 1e6 ? v.toExponential(1) : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)); return n + " " + unit; }
  function drawGraph(g) {
    var d = $("graph-" + g.id), cv = d.querySelector("canvas"), s = seriesFor(g), dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var c = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.strokeStyle = css.getPropertyValue("--line"); c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();
    d.querySelector("b").textContent = s.length ? fmtVal(s[s.length - 1].v, g.unit) : "\u2014";
    var tip = d.querySelector(".tip");
    if (s.length < 2) { tip.hidden = true; return; }
    var mn = Infinity, mx = -Infinity;
    s.forEach(function (p) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; });
    if (g.rate || g.id === "press") mn = 0;
    if (mx - mn < 1e-6) mx = mn + 1;
    var t0 = s[0].t, t1 = s[s.length - 1].t, X = function (t) { return t1 > t0 ? 1 + (t - t0) / (t1 - t0) * (w - 6) : 1; }, Y = function (v) { return h - 3 - (v - mn) / (mx - mn) * (h - 8); };
    c.strokeStyle = css.getPropertyValue("--accent"); c.lineWidth = 2; c.lineJoin = "round";
    c.beginPath(); s.forEach(function (p, k) { if (k) c.lineTo(X(p.t), Y(p.v)); else c.moveTo(X(p.t), Y(p.v)); }); c.stroke();
    var last = s[s.length - 1]; c.fillStyle = css.getPropertyValue("--accent"); c.beginPath(); c.arc(X(last.t), Y(last.v), 3, 0, 6.3); c.fill();
    c.fillStyle = css.getPropertyValue("--dim"); c.font = "10px " + css.getPropertyValue("--mono"); c.fillText(fmtVal(mx, ""), 3, 10);
    if (g.hover != null) {
      var idx = Math.min(s.length - 1, Math.max(0, Math.round(g.hover * (s.length - 1)))), p = s[idx], hx = X(p.t);
      c.strokeStyle = css.getPropertyValue("--faint"); c.lineWidth = 1; c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx, h); c.stroke();
      c.fillStyle = css.getPropertyValue("--fg"); c.beginPath(); c.arc(hx, Y(p.v), 3.5, 0, 6.3); c.fill();
      tip.hidden = false; tip.textContent = fmtVal(p.v, g.unit) + " at " + p.t.toFixed(0) + " s";
      tip.style.left = Math.min(w - tip.offsetWidth, Math.max(0, hx - tip.offsetWidth / 2)) + "px";
    } else tip.hidden = true;
  }
  function pinCell() {
    var p = state.pointer ? pick(state.pointer.nx, state.pointer.ny) : null;
    if (!p || !p.hit) { toast("Point at some material, then press P or use Pin a cell."); return; }
    state.pinned = { i: p.i }; state.pinnedSeries = [];
    $("graph-pin").hidden = false;
    toast("Following one " + Mat.list[p.id].name.toLowerCase() + " cell");
  }

  // ---- Isotope choice for the selected element ----
  function buildIsotopes(id) {
    var row = $("isoRow"), sel = $("isotope"), data = id <= 118 ? ISOTOPE_DATA[id] : null;
    Sim.enrichment = null; Sim.isotopeOverride = null;
    if (!data || !data.length) { row.hidden = true; return; }
    var html = '<option value="nat">' + (ISOTOPE_NATURAL[id] ? "Natural mix" : "Longest-lived") + "</option>";
    if (id === 92) html += '<option value="e0.05">Enriched, 5% U-235</option><option value="e0.2">Enriched, 20% U-235</option><option value="e0.9">Enriched, 90% U-235</option>';
    data.slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 14).forEach(function (r) { html += '<option value="' + r[0] + '">' + ELEMENTS[id].s + "-" + r[0] + ", half-life " + fmtTime(r[1]) + "</option>"; });
    sel.innerHTML = html; row.hidden = false;
    state.isoFor = id;
  }
  function applyIsotope(v) {
    Sim.enrichment = null; Sim.isotopeOverride = null;
    if (v[0] === "e") Sim.enrichment = +v.slice(1);
    else if (v !== "nat") { Sim.isotopeOverride = {}; Sim.isotopeOverride[state.isoFor] = +v; }
  }

  // ---- Reaction journal: every kind of reaction seen, kept between sessions ----
  var JOURNAL_KEY = "elementalJournal", journal = {};
  try { journal = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "{}"); } catch (e) { journal = {}; }
  function noteDiscovery(msg) {
    if (journal[msg]) return;
    journal[msg] = Date.now();
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal)); } catch (e) {}
    if (dbMsgs[msg] !== undefined) { var b = document.querySelector('.rx[data-k="' + dbMsgs[msg] + '"]'); if (b) b.classList.add("found"); }
    if (state.tab === "jn") renderJournal();
  }
  var dbMsgs = {};
  function renderJournal() {
    var keys = Object.keys(journal).sort(function (a, b) { return journal[b] - journal[a]; });
    var found = keys.filter(function (k) { return dbMsgs[k] !== undefined; }).length;
    $("journal").innerHTML = '<div class="head">' + found + " of " + Chem.database.length + " database reactions seen, " + keys.length + " kinds of event in all</div><div class=\"list\">" + keys.slice(0, 600).map(function (k) { return "<div>" + k + "</div>"; }).join("") + "</div>";
  }
  function markJournal() {
    Chem.database.forEach(function (d, k) { dbMsgs[d.msg] = k; if (journal[d.msg]) { var b = document.querySelector('.rx[data-k="' + k + '"]'); if (b) b.classList.add("found"); } });
    Sim.onDiscover = noteDiscovery;
  }

  // ---- Clips and share links ----
  function toggleRecord() {
    var btn = $("record");
    if (state.recorder) { state.recorder.stop(); return; }
    if (!canvas.captureStream || typeof MediaRecorder === "undefined") { toast("This browser cannot record the chamber."); return; }
    var chunks = [], type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    var rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 12e6 });
    rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      state.recorder = null; btn.textContent = "Record"; btn.setAttribute("aria-pressed", "false");
      var a = document.createElement("a"), blob = new Blob(chunks, { type: "video/webm" });
      a.href = URL.createObjectURL(blob); a.download = "elemental-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".webm"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast("Saved a " + (blob.size / 1048576).toFixed(1) + " MB clip");
    };
    rec.start(); state.recorder = rec; btn.textContent = "Stop"; btn.setAttribute("aria-pressed", "true");
  }
  // A link can name an experiment or a reaction. A whole chamber is too large for a link, so use Save for that.
  function shareLink() {
    var token = state.demo ? "rx" + Chem.database.indexOf(state.demo) : ($("scene").value ? "scene-" + $("scene").value : "");
    if (!token) { toast("Pick an experiment or reaction first. Use Save to share a whole chamber."); return; }
    var url = location.href.split("#")[0] + "#" + token;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied"); }, function () { toast(url); });
    else toast(url);
  }
  function openFromHash() {
    var h = location.hash.slice(1);
    if (h.indexOf("scene-") === 0 && Scenes.list.some(function (s) { return s.id === h.slice(6); })) { loadScene(h.slice(6)); return true; }
    if (h.indexOf("rx") === 0 && Chem.database[+h.slice(2)]) { runDemo(Chem.database[+h.slice(2)]); return true; }
    return false;
  }

  // ---- Lessons ----
  function buildLessons() {
    $("lessonList").innerHTML = Scenes.lessons.map(function (l, k) { return '<button data-k="' + k + '">' + l.title + "</button>"; }).join("");
    $("lessonList").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) startLesson(+b.dataset.k); });
  }
  function startLesson(k) { $("lessonMenu").hidden = true; state.lesson = { l: Scenes.lessons[k], step: -1 }; nextStep(); }
  function nextStep() {
    var ls = state.lesson;
    if (!ls) return;
    Sim.idle();
    ls.step++;
    if (ls.step >= ls.l.steps.length) { toast("Lesson finished: " + ls.l.title); state.lesson = null; $("lessonBox").hidden = true; return; }
    var st = ls.l.steps[ls.step];
    if (st.setup) { st.setup({ loadScene: loadScene, state: state }); Render.markAllDirty(); }
    $("lessonBox").hidden = false; $("lessonTitle").textContent = ls.l.title; $("lessonText").textContent = st.text;
    $("lessonStep").textContent = "Step " + (ls.step + 1) + " of " + ls.l.steps.length;
    $("lessonNext").disabled = !st.manual;
    $("lessonNext").textContent = ls.step === ls.l.steps.length - 1 ? "Finish" : "Next";
  }
  function checkLesson() {
    var ls = state.lesson;
    if (!ls) return;
    var st = ls.l.steps[ls.step];
    if (!st || st.manual) return;
    if (st.check && st.check({ state: state })) $("lessonNext").disabled = false;
  }

  // ---- Favourite and recent materials ----
  // Favourites stay in the bar for good, starred and first. Recent materials follow, up to eight that are not favourites already.
  function favourites() { return Settings.get("favourites").filter(function (id) { return Mat.list[id] && id < Mat.count(); }); }
  function toggleFavourite(id) {
    if (!Mat.list[id]) return;
    var f = favourites(), at = f.indexOf(id);
    if (at >= 0) f.splice(at, 1); else if (f.length < 40) f.push(id);
    Settings.set("favourites", f);
    renderMaterialBar(); syncFavButton(); filterLists();
    toast(at >= 0 ? "Removed from favourites" : "Added to favourites");
  }
  function syncFavButton() { var on = favourites().indexOf(state.cardId) >= 0; $("favBtn").setAttribute("aria-pressed", on ? "true" : "false"); $("favBtn").textContent = on ? "★" : "☆"; }
  function noteRecent(id) {
    state.recent = [id].concat(state.recent.filter(function (x) { return x !== id; })).slice(0, 12);
    renderMaterialBar();
  }
  function renderMaterialBar() {
    var box = $("recent"), favs = favourites(), recent = state.recent.filter(function (m) { return favs.indexOf(m) < 0; }).slice(0, 8);
    box.innerHTML = "";
    function add(m, fav) {
      var b = document.createElement("button"), mm = Mat.list[m];
      b.textContent = (fav ? "★ " : "") + Mat.pretty(m >= FIRST_COMPOUND ? mm.formula : (mm.sym || mm.name.slice(0, 4)));
      b.title = mm.name + (fav ? " (favourite)" : "");
      if (fav) b.className = "fav";
      if (m === state.mat) b.setAttribute("aria-pressed", "true");
      b.onclick = function () { selectMat(m); };
      box.appendChild(b);
    }
    favs.forEach(function (m) { add(m, true); });
    if (favs.length && recent.length) { var s = document.createElement("span"); s.className = "sep"; box.appendChild(s); }
    recent.forEach(function (m) { add(m, false); });
  }

  function loadScene(id, keepNote) {
    if (Sim.history && Sim.history.length) pushUndo();
    unpin();
    state.demo = null;
    state.noteScene = id;
    Sim.ambient = 293.15; Sim.atmosphere = "air"; $("atm").value = "air"; state.setGravity(1);
    if (typeof LabUI !== "undefined") LabUI.reset();
    var s = Scenes.load(id);
    state.syncAmb(); state.syncDecay();
    $("lid").setAttribute("aria-pressed", Sim.lid ? "true" : "false");
    $("noteTitle").textContent = s.name; $("noteText").textContent = s.text; $("sceneNote").hidden = false;
    var act = $("noteAction");
    act.hidden = !s.action;
    if (s.action) { act.textContent = s.action.label; act.onclick = function () { s.action.run(); act.hidden = true; }; }
    Render.markAllDirty();
    $("scene").value = id;
  }

  // ---- Picking ----
  function pick(nx, ny) {
    var ray = Render.ray(nx, ny);
    if (!ray) return null;   // no camera until the first frame is drawn
    var o = ray.o, d = ray.d, W = Sim.W, H = Sim.H, D = Sim.D;
    var lo = [1, 1, 1], hi = [W - 1, H - 1, D - 1], t0 = -Infinity, t1 = Infinity;
    for (var a = 0; a < 3; a++) {
      var inv = 1 / (d[a] || 1e-9), ta = (lo[a] - o[a]) * inv, tb = (hi[a] - o[a]) * inv;
      if (ta > tb) { var s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    }
    if (t0 > t1 || t1 < 0) return null;
    var t = Math.max(t0, 0) + 1e-3, x = Math.floor(o[0] + d[0] * t), y = Math.floor(o[1] + d[1] * t), z = Math.floor(o[2] + d[2] * t);
    var sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    var dx = Math.abs(1 / (d[0] || 1e-9)), dy = Math.abs(1 / (d[1] || 1e-9)), dz = Math.abs(1 / (d[2] || 1e-9));
    var tx = (x + (sx > 0 ? 1 : 0) - o[0]) / (d[0] || 1e-9), ty = (y + (sy > 0 ? 1 : 0) - o[1]) / (d[1] || 1e-9), tz = (z + (sz > 0 ? 1 : 0) - o[2]) / (d[2] || 1e-9);
    var px = x, py = y, pz = z;
    for (var n = 0; n < 500; n++) {
      if (x < 1 || y < 1 || z < 1 || x >= W - 1 || y >= H - 1 || z >= D - 1) {
        return y < 1 ? { x: clamp(px, 1, W - 2), y: 1, z: clamp(pz, 1, D - 2), hit: false, floor: true, ax: px, ay: py, az: pz } : { x: clamp(px, 1, W - 2), y: clamp(py, 1, H - 2), z: clamp(pz, 1, D - 2), hit: false, ax: px, ay: py, az: pz };
      }
      var i = Sim.idx(x, y, z), id = Sim.ID[i];
      if (id !== AIR && Sim.PH[i] <= P_LIQUID) return { x: x, y: y, z: z, hit: true, id: id, i: i, ax: px, ay: py, az: pz };
      px = x; py = y; pz = z;
      if (tx < ty) { if (tx < tz) { x += sx; tx += dx; } else { z += sz; tz += dz; } }
      else { if (ty < tz) { y += sy; ty += dy; } else { z += sz; tz += dz; } }
    }
    return null;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function applyTool(p) {
    var cx = p.ax, cy = p.ay, cz = p.az, r = state.brush, tool = state.tool;
    if (cx === undefined) return;
    cx = clamp(cx, 1, Sim.W - 2); cy = clamp(cy, 1, Sim.H - 2); cz = clamp(cz, 1, Sim.D - 2);
    if (tool === "place") {
      var y = clamp(cy + state.height, 1, Sim.H - 2), mat = state.mat, form = mat === WALL || mat === ELECTRODE ? P_STATIC : state.form;
      if (form === P_STATIC) y = clamp(cy + (state.height > 6 ? 0 : state.height), 1, Sim.H - 2);
      var density = form === P_STATIC || r === 0 ? 1 : 0.32;
      Sim.forBrush(state.shape, cx, y, cz, r, function (X, Y, Z, i) { if (Sim.ID[i] === AIR && Sim.rf() < density) Sim.place(X, Y, Z, mat, form, state.placeT); });
    } else if (tool === "erase") {
      Sim.forBrush(state.shape, p.x, p.y, p.z, r, function (X, Y, Z) { Sim.erase(X, Y, Z); });
    } else if (tool === "heat") {
      Sim.forBrush(state.shape, p.x, p.y, p.z, r, function (X, Y, Z, i) { if (Sim.ID[i] !== WALL) { Sim.T[i] = Math.min(Sim.T[i] * 1.07 + 25, 5e9); } });
      Sim.wake(p.x, p.y, p.z);
      wakeSphere(p, r);
    } else if (tool === "cool") {
      Sim.forBrush(state.shape, p.x, p.y, p.z, r, function (X, Y, Z, i) { if (Sim.ID[i] !== WALL) { Sim.T[i] = Math.max(Sim.T[i] * 0.9 - 2, 0.5); } });
      wakeSphere(p, r);
    } else if (tool === "spark") {
      Sim.spark(p.x, p.y, p.z, r);
    } else if (tool === "neutron") {
      for (var k = 0; k < 6; k++) Sim.spawnP(PT_NEUTRON, p.x + 0.5, p.y + 1.5, p.z + 0.5, 1.5, 0, 500);
    } else if (tool === "blast") {
      if (!state.blastLock) { Sim.blast(p.x, p.y, p.z, Math.max(3, r + 2), 1.2); state.blastLock = true; }
    } else if (tool === "uv") {
      Sim.forSphere(p.x, p.y, p.z, r + 2, function (X, Y, Z, i) { if (Sim.ID[i] !== AIR && Sim.ID[i] !== WALL) Chem.illuminate(i, X, Y, Z); });
    } else if (tool === "magnet") {
      Sim.magnet = { x: p.x, y: p.y + 2, z: p.z };
    }
  }
  function wakeSphere(p, r) { Sim.forSphere(p.x, p.y, p.z, r + 1, function (X, Y, Z) { Sim.wake(X, Y, Z); }); }

  // ---- Pointer and camera ----
  function bindPointer() {
    var drag = null;
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.button === 1 || state.tool === "orbit") { drag = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.shiftKey }; }
      else if (e.button === 0 && state.tool === "vessel") { updatePointer(e); LabUI.down(e, pick(state.pointer.nx, state.pointer.ny), state.pointer); return; }
      else if (e.button === 0) { if (state.tool !== "magnet" && state.tool !== "neutron" && state.tool !== "uv") pushUndo(); state.painting = true; state.blastLock = false; }
      updatePointer(e);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (drag) {
        var c = Render.camera, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) {
          // Panning stays over the bench, so the view cannot wander off into the room and lose the chamber.
          var s = c.dist * 0.0016, sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
          c.tx = clamp(c.tx - dx * cs * s, 1, Sim.W - 1); c.tz = clamp(c.tz + dx * sn * s, 1, Sim.D - 1); c.ty = clamp(c.ty + dy * s, 0, Sim.H);
        } else {
          c.yaw -= dx * 0.006;
          c.pitch = clamp(c.pitch + dy * 0.005, 0.02, 1.5);
        }
        return;
      }
      updatePointer(e);
      if (state.tool === "vessel" && state.pointer) LabUI.move(state.pointer);
    });
    function up(e) { drag = null; if (typeof LabUI !== "undefined") LabUI.up(); state.painting = false; if (state.tool === "magnet") Sim.magnet = null; }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", function () { state.pointer = null; Render.brush = null; });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (state.tool === "vessel" && LabUI.wheel(e)) return;
      var c = Render.camera;
      c.dist = clamp(c.dist * Math.exp(e.deltaY * 0.001), 18, Render.maxDist());
    }, { passive: false });
    canvas.addEventListener("dblclick", function (e) { if (state.tool === "orbit" || state.tool === "vessel" || e.altKey) { updatePointer(e); focusAt(state.pointer.nx, state.pointer.ny); } });
    canvas.addEventListener("auxclick", function (e) { if (e.button === 1 && e.detail === 2) { updatePointer(e); focusAt(state.pointer.nx, state.pointer.ny); } });
  }
  function updatePointer(e) {
    var r = canvas.getBoundingClientRect();
    state.pointer = { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  }

  // ---- Readouts ----
  var PHASES = ["solid", "powder", "liquid", "gas", "plasma"];
  function updateProbe(p) {
    var el = $("probe");
    if (state.tool === "vessel" && LabUI.hover) { el.innerHTML = "<b>" + LabUI.hover.name + "</b><br>Drag to carry"; return; }   // the glass is WALL cells, which would read as the chamber's own wall
    if (!p || !p.hit) {
      var ai = p ? Sim.idx(clamp(p.ax, 1, Sim.W - 2), clamp(p.ay, 1, Sim.H - 2), clamp(p.az, 1, Sim.D - 2)) : -1;
      var airT = ai >= 0 ? Sim.T[ai] : Sim.ambient;
      el.innerHTML = "<b>" + ({ air: "Air", oxygen: "Oxygen", argon: "Argon", vacuum: "Vacuum" })[Sim.atmosphere] + "</b><br>" + fmtT(airT) + celsius(airT);
      return;
    }
    var i = p.i, id = Sim.ID[i], t = Sim.T[i], m = Mat.list[id], ph = Sim.PH[i], name = m.name;
    var pr = Sim.PR[i], L = "";
    if (pr > 0.5 && ph <= P_POWDER) L = " · melting " + Math.min(99, 100 * pr / Math.max(Mat.lf[id], 1)).toFixed(0) + "%";
    else if (pr > 0.5 && ph === P_LIQUID) L = " · boiling " + Math.min(99, 100 * pr / Math.max(Mat.lv[id], 1)).toFixed(0) + "%";
    else if (pr < -0.5 && ph === P_LIQUID) L = " · freezing " + Math.min(99, 100 * -pr / Math.max(Mat.lf[id], 1)).toFixed(0) + "%";
    var aux = Sim.AUX[i] && id !== FLAME && id !== AIR && Mat.list[Sim.AUX[i]] ? " + " + Mat.pretty(Mat.list[Sim.AUX[i]].formula) + " at " + Math.round((1 - Sim.USED[i]) * 100) + "%" : "";
    // Air cells carry vapour and spent oxygen rather than solutes.
    if (id === AIR) {
      if (Sim.AUX[i] && Mat.list[Sim.AUX[i]]) aux = " + " + Mat.pretty(Mat.list[Sim.AUX[i]].formula) + " vapour, " + Math.min(100, Math.round(Sim.USED[i] / Math.max(Sim.saturation(Sim.AUX[i], t), 1e-6) * 100)) + "% of saturation";
      if (Sim.U2[i] > 0.01) aux += " \u00b7 " + Math.round(Math.min(1, Sim.U2[i]) * 100) + "% of its oxygen used";
    }
    if (id <= 118 && Sim.AUX2[i] && ISOTOPE_DATA[id]) {
      var info = Sim.isotopeInfo(id, Sim.AUX2[i]);
      name = ELEMENTS[id].n + "-" + Sim.AUX2[i] + (info.half ? ", half-life " + fmtTime(info.half) : ", stable");
    }
    if (id === Mat.named("H2O") && ph === P_LIQUID) { var cellPH = Chem.pH(i); if (cellPH !== null) aux += (aux ? " \u00b7 " : " ") + "pH " + cellPH.toFixed(1); }
    if (aux && Sim.AUX2[i] && Mat.list[Sim.AUX2[i]] && id > 118) aux += " + " + Mat.pretty(Mat.list[Sim.AUX2[i]].formula) + " at " + Math.round((1 - Sim.U2[i]) * 100) + "%";
    if (!aux && Sim.USED[i] > 0.01 && id !== AIR) aux = " (" + Math.round((1 - Sim.USED[i]) * 100) + "% left)";
    el.innerHTML = "<b>" + name + "</b> " + (id >= FIRST_COMPOUND ? Mat.pretty(m.formula) : "") + aux + "<br>" + PHASES[ph] + " · " + fmtT(t) + celsius(t) + L + "<br>" + (ph >= P_GAS ? Sim.gasDensity(id, t).toFixed(4) : (ph === P_STATIC ? Mat.rhoS[id] : Sim.densityOf(i)).toFixed(3)) + " g/cm³" + (Sim.CH[i] ? " · carrying current" : "") + (Sim.P[i] > 0.5 ? " · +" + Sim.P[i].toFixed(0) + " kPa" : "");
  }

  var censusHash = "";
  function updatePanels() {
    var c = Sim.census || [], total = Sim.totalCells || 0, h = c.map(function (a) { return a[0] + ":" + a[1]; }).join();
    if (h !== censusHash) {
      censusHash = h;
      var html = c.length ? "" : '<div class="empty">The chamber is empty. Choose a material and draw.</div>';
      var mx = c.length ? c[0][1] : 1;
      for (var k = 0; k < c.length; k++) {
        var id = c[k][0], m = Mat.list[id], col = "rgb(" + Mat.colS[id * 3] + "," + Mat.colS[id * 3 + 1] + "," + Mat.colS[id * 3 + 2] + ")";
        html += '<div class="bar"><span>' + Mat.pretty(id >= FIRST_COMPOUND ? m.formula : (m.sym || m.name.slice(0, 5))).slice(0, 7) + '</span><div class="track"><div class="fill" style="width:' + (100 * c[k][1] / mx).toFixed(1) + "%;background:" + col + '"></div></div><span class="n">' + (c[k][1] > 9999 ? (c[k][1] / 1000).toFixed(0) + "k" : c[k][1]) + "</span></div>";
      }
      $("census").innerHTML = html;
    }
    var L = Sim.log, out = "";
    if (!L.length) out = '<div class="empty">Reactions appear here as they happen.</div>';
    for (var q = 0; q < Math.min(L.length, 16); q++) out += '<div class="' + L[q].kind + '"><span>' + L[q].msg + "</span><span>" + (L[q].n > 1 ? "×" + L[q].n : "") + "</span></div>";
    if ($("log").dataset.h !== out) { $("log").innerHTML = out; $("log").dataset.h = out; }
    var s = Sim.stats;
    $("stats").textContent = (Render.fpsNow || 0).toFixed(0) + " fps · " + (Pool.attached + 1) + (Pool.attached ? " threads · " : " thread · ") + (Sim.totalCells || 0).toLocaleString() + " cells · t " + (Sim.tickN / Sim.TICKS_PER_SEC).toFixed(0) + " s" + (s.fissions ? " · " + s.fissions + " fissions" : "") + (s.fusions ? " · " + s.fusions + " fusions" : "");
  }

  // ---- Main loop ----
  var last = 0, acc = 0, fpsT = 0, frames = 0, panelT = 0;
  var lowFrames = 0, highFrames = 0;
  function loop(now) {
  requestAnimationFrame(loop);
    var dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      Render.fpsNow = frames / fpsT; frames = 0; fpsT = 0;
      // Drop the render resolution when the GPU falls behind, and bring it back when there is room. A fixed quality setting turns this off.
      if (Settings.renderScale() !== null) { lowFrames = highFrames = 0; }
      else if (Render.fpsNow < 22) { lowFrames++; highFrames = 0; if (lowFrames >= 2 && Render.scale > 0.4) { Render.scale = Math.max(0.4, Render.scale * 0.8); lowFrames = 0; } }
      else if (Render.fpsNow > 52) { highFrames++; lowFrames = 0; if (highFrames >= 8 && Render.scale < 1) { Render.scale = Math.min(1, Render.scale * 1.15); highFrames = 0; } }
      else { lowFrames = highFrames = 0; }
    }
    if (Sim.tickPoll()) afterTick();
    var p = state.pointer ? pick(state.pointer.nx, state.pointer.ny) : null;
    Render.brush = p && p.ax !== undefined && state.tool !== "vessel" ? brushPos(p) : null;
    if (Sim.busy) { /* the stroke catches up on the first frame with no tick running */ }
    else if (state.painting && state.pointer) {
      // Fill in the stroke between frames, so a fast drag leaves a line and not a row of dots.
      var prev = state.lastPaint || state.pointer, gap = Math.hypot(state.pointer.nx - prev.nx, state.pointer.ny - prev.ny);
      var n = Math.min(12, Math.ceil(gap * canvas.clientWidth / Math.max(4, state.brush * 4)));
      for (var s = 1; s < n; s++) {
        var q = pick(prev.nx + (state.pointer.nx - prev.nx) * s / n, prev.ny + (state.pointer.ny - prev.ny) * s / n);
        if (q) applyTool(q);
      }
      if (p) applyTool(p);
      state.lastPaint = state.pointer;
    } else state.lastPaint = null;
    if (!state.paused) {
      acc += dt * Sim.TICKS_PER_SEC * state.speed;
      var t0 = performance.now(), budget = 14;
      if (Sim.threaded) {
        // A sim that cannot keep up runs slow, not behind. At high speed, ticks short enough to fit in the frame can run back to back.
        if (acc > 3) acc = 3;
        while (acc >= 2 && !Sim.busy && Sim.tickMs < 3 && performance.now() - t0 < 6) { Sim.tick(); afterTick(); acc -= 1; }
      } else {
        while (acc >= 1) {
          Sim.tick(); acc -= 1;
          afterTick();
          if (performance.now() - t0 > budget) { acc = 0; break; }
        }
      }
    }
    cameraKeys(dt);
    Effects.update(state.paused ? 0 : dt);   // paused, effects hold still like everything else
    if (!state.glLost) Render.frame(now / 1000);   // with no context to draw into, the simulation carries on and the screen waits
    if (!state.glLost) LabUI.frame(dt);
    autosaveTick(now);
    panelT += dt;
    if (panelT > 0.2) {
      panelT = 0; updatePanels(); updateProbe(p);
      if (state.pinned && (!state.pinLast || state.pinLast !== Sim.tickN)) {
        state.pinLast = Sim.tickN;
        state.pinnedSeries.push({ t: Sim.tickN / Sim.TICKS_PER_SEC, v: Sim.T[state.pinned.i] });
        if (state.pinnedSeries.length > 300) state.pinnedSeries.shift();
      }
      GRAPHS.forEach(drawGraph);
      checkLesson();
    }
    // The next tick starts last, so the frame above shaded a finished one and nothing reads a half-written chamber.
    if (!state.paused && Sim.threaded && !Sim.busy && acc >= 1) { Sim.tickStart(); acc -= 1; }
  }
  // Lab equipment writes to the grid once per tick, between ticks, when no worker is writing.
  function afterTick() { Lab.step(); if (state.demo && state.demo.light) Scenes.demoTick(state.demo); }
  function brushPos(p) {
    var r = state.brush + 0.5, h = state.tool === "place" ? state.height : 0;
    if (state.tool === "place") return { x: p.ax + 0.5, y: clamp(p.ay + h, 1, Sim.H - 2) + 0.5, z: p.az + 0.5, r: r };
    return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5, r: r };
  }

  LabUI.init({ canvas: canvas, pick: pick, state: state, setTool: setTool, pushUndo: pushUndo });
  buildTools(); buildTable(); buildCompounds(); buildReactions(); buildGraphs(); buildLessons(); bindControls(); bindPointer(); bindContextLoss(); markJournal();
  $("dock").addEventListener("mouseleave", function () { if (state.cardId !== state.mat) { showCard(state.mat); showPartners(state.mat); } });
  // The hint is for pages opened without the launcher. An isolated page on a machine too small for helpers has nothing to fix.
  if (!Pool.available && !self.crossOriginIsolated) { var hint = $("coreHint"); hint.hidden = false; }
  setTool("place"); selectMat(11);
  if (!openFromHash()) loadScene("alkali");
  window.addEventListener("hashchange", function () { Sim.idle(); openFromHash(); });
  setTimeout(function () { window.__ready = true; }, 0);
  document.getElementById("loading").hidden = true;
  window.__elemental = { startLesson: startLesson, journal: journal, state: state, loadScene: loadScene, selectMat: selectMat, setTool: setTool, pick: pick, applyTool: applyTool, autosaveNow: autosaveNow, auto: auto, undo: function () { undo(state.undo, state.redo); }, redo: function () { undo(state.redo, state.undo); } };
  requestAnimationFrame(loop);
  offerResume();
}
// Compiling the raymarch shader can block for a few seconds on Windows, so let the page paint its loading message first.
setTimeout(startElemental, 30);
