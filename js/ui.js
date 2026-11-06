// User interface: periodic table, tools, camera, picking, data card and readouts.
function startElemental() {
  var $ = function (id) { return document.getElementById(id); };
  // One helper per physical core, less the main thread. navigator reports logical threads, so halve it.
  var helpers = Pool.init(Math.max(0, Math.min(15, Math.ceil((navigator.hardwareConcurrency || 2) / 2) - 1)), function (d) { if (d.type === "log") Sim.mergeLog(d.entries); });
  var GRID = helpers >= 7 ? { w: 160, h: 96, d: 160 } : { w: 96, h: 64, d: 96 };
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
    { id: "orbit", label: "Orbit", tip: "Drag to turn the view (useful on touch screens)" }
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
      elButtons[id] = b;
      frag.appendChild(b);
    });
    box.appendChild(frag);
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
    document.querySelectorAll("#compounds .cp").forEach(function (b) { b.hidden = !!q && (b.dataset.search || "").indexOf(q) < 0; });
    if (state.tab === "el") for (var z = 1; z <= 118; z++) elButtons[z].classList.toggle("dimmed", !!q && (ELEMENTS[z].n + " " + ELEMENTS[z].s).toLowerCase().indexOf(q) < 0);
  }
  function runDemo(d) {
    pushUndo();
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
    setTool("place");
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
  }
  function buildTools() {
    var box = $("tools");
    TOOLS.forEach(function (t, k) {
      var b = document.createElement("button");
      b.id = "tool-" + t.id; b.textContent = t.label; b.title = t.tip + " (" + (k + 1) + ")";
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
    $("clear").onclick = function () { pushUndo(); state.demo = null; Sim.clear(); Sim.updateCensus(); $("scene").value = ""; $("sceneNote").hidden = true; Render.markAllDirty(); };
    $("helpBtn").onclick = function () { $("help").hidden = false; };
    $("helpClose").onclick = function () { $("help").hidden = true; };
    $("help").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
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
      $("rxGroup").hidden = t !== "rx"; $("rxCount").hidden = t !== "rx";
      filterLists();
      $("tableScroll").style.display = t === "hide" ? "none" : "block";
    }
    $("tabEl").onclick = function () { setTab("el"); };
    $("tabCp").onclick = function () { setTab("cp"); };
    $("tabRx").onclick = function () { setTab("rx"); };
    $("search").oninput = filterLists; $("rxGroup").onchange = filterLists;
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
      else if (e.key === "Escape") $("help").hidden = true;
      else if (/^[1-9]$/.test(e.key)) setTool(TOOLS[+e.key - 1].id);
    });
  }

  // ---- Undo and files ----
  function refreshUndo() { $("undo").disabled = !state.undo.length; $("redo").disabled = !state.redo.length; }
  function pushUndo() {
    state.undo.push(Sim.snapshot());
    if (state.undo.length > 6) state.undo.shift();
    state.redo.length = 0;
    refreshUndo();
  }
  function undo(from, to) {
    if (!from.length) return;
    to.push(Sim.snapshot());
    Sim.restore(from.pop());
    state.demo = null;
    refreshUndo(); Render.markAllDirty();
  }
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(state.toastT);
    state.toastT = setTimeout(function () { el.hidden = true; }, 3500);
  }
  // Saved files hold a JSON header, then the raw arrays, gzipped. They are tied to this version's material list, and the header checks that.
  async function saveFile() {
    var snap = Sim.snapshot(), fields = Sim.snapshotFields, head = { format: "elemental-1", W: snap.W, H: snap.H, D: snap.D, ambient: snap.ambient, atmosphere: snap.atmosphere, lid: snap.lid, count: snap.count, tick: snap.tick };
    var parts = [new TextEncoder().encode(JSON.stringify(head) + "\n")];
    fields.forEach(function (f) { parts.push(new Uint8Array(snap[f].buffer, snap[f].byteOffset, snap[f].byteLength)); });
    var gz = new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"));
    var blob = await new Response(gz).blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chamber-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".elemental";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast("Saved " + (blob.size / 1048576).toFixed(1) + " MB");
  }
  async function loadFile(file) {
    try {
      var buf = new Uint8Array(await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
      var nl = buf.indexOf(10), head = JSON.parse(new TextDecoder().decode(buf.subarray(0, nl)));
      if (head.format !== "elemental-1") throw new Error("That is not a saved chamber.");
      if (head.count !== Mat.count()) throw new Error("This file was saved by a different version, and its materials do not match.");
      if (head.W !== Sim.W || head.H !== Sim.H || head.D !== Sim.D) {
        Sim.init(head.W, head.H, head.D); Render.resizeGrid(); attachWorkers();
        $("gridSize").value = head.W + "," + head.H + "," + head.D;
      }
      var off = nl + 1, snap = { ambient: head.ambient, atmosphere: head.atmosphere, lid: head.lid };
      Sim.snapshotFields.forEach(function (f) {
        var Type = Sim[f].constructor, bytes = Sim[f].length * Type.BYTES_PER_ELEMENT;
        snap[f] = new Type(buf.slice(off, off + bytes).buffer); off += bytes;
      });
      pushUndo();
      Sim.restore(snap);
      $("atm").value = head.atmosphere; state.syncAmb(); $("lid").setAttribute("aria-pressed", head.lid ? "true" : "false");
      $("scene").value = ""; $("sceneNote").hidden = true; state.demo = null; Render.markAllDirty();
      toast("Loaded " + file.name);
    } catch (e) { toast(e.message.indexOf("different version") >= 0 || e.message.indexOf("not a saved") >= 0 ? e.message : "That file could not be read."); }
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

  // ---- Recent materials ----
  function noteRecent(id) {
    state.recent = [id].concat(state.recent.filter(function (x) { return x !== id; })).slice(0, 8);
    var box = $("recent");
    box.innerHTML = "";
    state.recent.forEach(function (m) {
      var b = document.createElement("button"), mm = Mat.list[m];
      b.textContent = Mat.pretty(m >= FIRST_COMPOUND ? mm.formula : (mm.sym || mm.name.slice(0, 4)));
      b.title = mm.name;
      b.onclick = function () { selectMat(m); };
      box.appendChild(b);
    });
  }

  function loadScene(id, keepNote) {
    if (Sim.history && Sim.history.length) pushUndo();
    state.pinned = null; state.pinnedSeries = []; if ($("graph-pin")) $("graph-pin").hidden = true;
    state.demo = null;
    Sim.ambient = 293.15; Sim.atmosphere = "air"; $("atm").value = "air"; state.setGravity(1);
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
    var ray = Render.ray(nx, ny), o = ray.o, d = ray.d, W = Sim.W, H = Sim.H, D = Sim.D;
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
      else if (e.button === 0) { if (state.tool !== "magnet" && state.tool !== "neutron" && state.tool !== "uv") pushUndo(); state.painting = true; state.blastLock = false; }
      updatePointer(e);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (drag) {
        var c = Render.camera, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) {
          var s = c.dist * 0.0016, sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
          c.tx -= (dx * cs) * s; c.tz += (dx * sn) * s; c.ty = clamp(c.ty + dy * s, 0, Sim.H);
        } else {
          c.yaw -= dx * 0.006;
          c.pitch = clamp(c.pitch + dy * 0.005, 0.02, 1.5);
        }
        return;
      }
      updatePointer(e);
    });
    function up(e) { drag = null; state.painting = false; if (state.tool === "magnet") Sim.magnet = null; }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", function () { state.pointer = null; Render.brush = null; });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var c = Render.camera;
      c.dist = clamp(c.dist * Math.exp(e.deltaY * 0.001), 18, Math.max(Sim.W, Sim.D) * 4);
    }, { passive: false });
  }
  function updatePointer(e) {
    var r = canvas.getBoundingClientRect();
    state.pointer = { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  }

  // ---- Readouts ----
  var PHASES = ["solid", "powder", "liquid", "gas", "plasma"];
  function updateProbe(p) {
    var el = $("probe");
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
      // Drop the render resolution when the GPU falls behind, and bring it back when there is room.
      if (Render.fpsNow < 22) { lowFrames++; highFrames = 0; if (lowFrames >= 2 && Render.scale > 0.4) { Render.scale = Math.max(0.4, Render.scale * 0.8); lowFrames = 0; } }
      else if (Render.fpsNow > 52) { highFrames++; lowFrames = 0; if (highFrames >= 8 && Render.scale < 1) { Render.scale = Math.min(1, Render.scale * 1.15); highFrames = 0; } }
      else { lowFrames = highFrames = 0; }
    }
    if (Sim.tickPoll()) afterTick();
    var p = state.pointer ? pick(state.pointer.nx, state.pointer.ny) : null;
    Render.brush = p && p.ax !== undefined ? brushPos(p) : null;
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
    Render.frame(now / 1000);
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
  function afterTick() { if (state.demo && state.demo.light) Scenes.demoTick(state.demo); }
  function brushPos(p) {
    var r = state.brush + 0.5, h = state.tool === "place" ? state.height : 0;
    if (state.tool === "place") return { x: p.ax + 0.5, y: clamp(p.ay + h, 1, Sim.H - 2) + 0.5, z: p.az + 0.5, r: r };
    return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5, r: r };
  }

  buildTools(); buildTable(); buildCompounds(); buildReactions(); buildGraphs(); buildLessons(); bindControls(); bindPointer(); markJournal();
  $("dock").addEventListener("mouseleave", function () { if (state.cardId !== state.mat) { showCard(state.mat); showPartners(state.mat); } });
  if (!Pool.available) { var hint = $("coreHint"); hint.hidden = false; }
  setTool("place"); selectMat(11);
  if (!openFromHash()) loadScene("alkali");
  window.addEventListener("hashchange", function () { Sim.idle(); openFromHash(); });
  setTimeout(function () { window.__ready = true; }, 0);
  document.getElementById("loading").hidden = true;
  window.__elemental = { startLesson: startLesson, journal: journal, state: state, loadScene: loadScene, selectMat: selectMat, setTool: setTool, pick: pick, applyTool: applyTool };
  requestAnimationFrame(loop);
}
// Compiling the raymarch shader can block for a few seconds on Windows, so let the page paint its loading message first.
setTimeout(startElemental, 30);
