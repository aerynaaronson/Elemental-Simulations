// Desktop shell for Elemental Simulations (roadmap phase 1).
// Runs the existing web app unchanged in its own window. The app is served from an app:// scheme with the cross-origin isolation
// headers that SharedArrayBuffer needs, so the simulation can use every CPU core, the same as tools/serve.py does in a browser.
// F11 toggles full screen. The window remembers its size and position between runs.
// ELEMENTAL_SMOKE=1 loads the app, checks it is isolated and threaded, saves a screenshot and quits, for automated testing.
const { app, BrowserWindow, protocol, net, Menu, screen } = require("electron");
const path = require("path"), fs = require("fs"), url = require("url");

const ROOT = path.join(__dirname, "..");
const SMOKE = process.env.ELEMENTAL_SMOKE === "1";
// ELEMENTAL_SHOTS=<folder> takes the pictures listed in tools/screenshots.js, saves them there and quits.
const SHOTS = process.env.ELEMENTAL_SHOTS || "";
// A test run must not touch the player's automatic save, settings or window position.
if (SMOKE || SHOTS) app.setPath("userData", path.join(app.getPath("temp"), SHOTS ? "elemental-shots-profile" : "elemental-smoke-profile"));

// For machines without a GPU, such as test servers: draw with the software renderer.
if (process.env.ELEMENTAL_SOFTWARE_GL === "1") { app.commandLine.appendSwitch("use-angle", "swiftshader"); app.commandLine.appendSwitch("enable-unsafe-swiftshader"); app.commandLine.appendSwitch("ignore-gpu-blocklist"); }

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

// Only files inside the app folder are served; anything else is refused.
function serve(request) {
  const u = new URL(request.url);
  let rel = decodeURIComponent(u.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || file.includes(path.sep + "node_modules" + path.sep)) return new Response("Not found", { status: 404 });
  return net.fetch(url.pathToFileURL(file).toString()).then(res => {
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (file.endsWith(".js")) headers.set("Content-Type", "text/javascript");
    return new Response(res.body, { status: res.status, headers });
  }, () => new Response("Not found", { status: 404 }));
}

// ---- Window state ----
const statePath = () => path.join(app.getPath("userData"), "window.json");
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    const onScreen = screen.getAllDisplays().some(d => s.x >= d.bounds.x - 50 && s.y >= d.bounds.y - 50 && s.x < d.bounds.x + d.bounds.width && s.y < d.bounds.y + d.bounds.height);
    return onScreen ? s : { width: s.width, height: s.height, fullscreen: s.fullscreen };
  } catch (e) { return { width: 1600, height: 960 }; }
}
function saveState(win) {
  try { fs.writeFileSync(statePath(), JSON.stringify(Object.assign(win.getNormalBounds(), { fullscreen: win.isFullScreen() }))); } catch (e) {}
}

function createWindow() {
  const s = SHOTS ? { width: 1600, height: 900 } : SMOKE ? { width: 1400, height: 860 } : loadState();
  const win = new BrowserWindow({
    x: s.x, y: s.y, width: s.width || 1600, height: s.height || 960, minWidth: 900, minHeight: 600,
    backgroundColor: "#0d1016", title: "Elemental Simulations", show: true, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  if (s.fullscreen) win.setFullScreen(true);
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Links to the web open in the user's browser, not inside the game window, and the window itself never leaves the game.
  win.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:/.test(target)) require("electron").shell.openExternal(target); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, target) => {
    if (target.startsWith("app://elemental/")) return;
    e.preventDefault();
    if (/^https?:/.test(target)) require("electron").shell.openExternal(target);
  });
  win.on("close", () => saveState(win));
  win.loadURL("app://elemental/index.html");
  if (SMOKE) { win.webContents.on("console-message", e => { if (e.level === "error" || e.level === "warning") console.log("SMOKE console " + JSON.stringify(e.message)); }); smoke(win); }
  if (SHOTS) shots(win);
  return win;
}

// ---- Screenshots ----
// Runs in the page for each shot: set the scene up, run it with the loop paused so every shot is repeatable, frame it, and let the
// realistic renderer settle before the picture is taken.
const SHOT_PAGE = `async function (o) {
  const $ = id => document.getElementById(id), frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const st = __elemental.state;
  if (!$("resumeBar").hidden) $("resumeNo").click();
  $("help").hidden = true; $("settings").hidden = true;
  st.paused = true; Sim.idle();
  if (o.scene) __elemental.loadScene(o.scene); else { $("clear").click(); }
  $("sceneNote").hidden = true;
  if (o.crop === "window") { $("tabEl").click(); } else { $("tabHide").click(); }
  // In a picture of the chamber alone, the pointer readout and the particle key are clutter.
  ["probe", "legend"].forEach(id => { $(id).style.visibility = o.crop === "window" ? "" : "hidden"; });
  __elemental.setTool("place"); LabUI.selected = null;
  Effects.clear();
  if (o.setup) (0, eval)(o.setup);
  const c = Render.camera, S = Math.max(Sim.W, Sim.D);
  c.yaw = o.camera.yaw; c.pitch = o.camera.pitch; c.dist = o.camera.dist * S;
  c.tx = o.camera.target[0] * Sim.W; c.ty = o.camera.target[1] * Sim.H; c.tz = o.camera.target[2] * Sim.D; Render.snapCamera();
  for (let k = 0; k < o.ticks; k++) {
    Sim.tick(); Lab.step(); Lab.update(1 / 30); Effects.update(1 / 30);
    if (o.each) (0, eval)(o.each);
    if (k % 4 === 0) await frame();
  }
  if (o.after) (0, eval)(o.after);
  Render.markAllDirty();
  for (let k = 0; k < 70; k++) await frame();   // the realistic look blends frames together, so give it time to come into focus
  const r = (o.crop === "window" ? document.body : $("viewWrap")).getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), grid: [Sim.W, Sim.H, Sim.D] };
}`;
async function shots(win) {
  const list = require(path.join(ROOT, "tools", "screenshots.js")), wc = win.webContents, only = (process.env.ELEMENTAL_SHOT_ONLY || "").split(",").filter(Boolean);
  const stop = msg => { console.log("SHOTS " + msg); app.exit(msg === "done" ? 0 : 1); };
  setTimeout(() => stop("timed out"), 15 * 60000);
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    await new Promise(r => wc.once("did-finish-load", r));
    for (let k = 0; k < 600 && !(await wc.executeJavaScript("window.__ready === true && Render.realisticReady()")); k++) await new Promise(r => setTimeout(r, 200));
    for (const shot of list) {
      if (only.length && !only.includes(shot.name)) continue;
      const t0 = Date.now(), rect = await wc.executeJavaScript("(" + SHOT_PAGE + ")(" + JSON.stringify(shot) + ")");
      const img = await wc.capturePage({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      const file = path.join(SHOTS, shot.name + ".jpg");
      fs.writeFileSync(file, img.toJPEG(90));
      console.log("SHOTS " + shot.name + " " + img.getSize().width + "x" + img.getSize().height + " grid " + rect.grid.join("x") + " in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
    }
    stop("done");
  } catch (e) { stop("failed: " + String(e && e.stack || e)); }
}

async function smoke(win) {
  const out = (k, v) => console.log("SMOKE " + k + " " + JSON.stringify(v));
  const fail = msg => { console.log("SMOKE FAIL " + msg); app.exit(1); };
  setTimeout(() => fail("timed out"), 170000);
  try {
    await new Promise(r => win.webContents.once("did-finish-load", r));
    const wc = win.webContents;
    await wc.executeJavaScript("window.addEventListener('error', e => { window.__smokeErr = String(e.message) + ' @' + e.filename + ':' + e.lineno; }); 1");
    for (let k = 0; k < 600 && !(await wc.executeJavaScript("window.__ready === true")); k++) await new Promise(r => setTimeout(r, 200));
    const info = await wc.executeJavaScript(`({ isolated: crossOriginIsolated, cores: navigator.hardwareConcurrency, threads: Pool.attached + 1,
      grid: [Sim.W, Sim.H, Sim.D], webgl2: !!document.createElement("canvas").getContext("webgl2"), lab: typeof Lab === "object" })`);
    out("info", info);
    // The first frame compiles the shaders, which takes a while on software rendering, so wait for the loop to get going.
    const ticks0 = await wc.executeJavaScript("Sim.tickN");
    let ticks1 = ticks0;
    for (let k = 0; k < 300 && ticks1 < ticks0 + 3; k++) { await new Promise(r => setTimeout(r, 200)); ticks1 = await wc.executeJavaScript("Sim.tickN"); }
    out("ticks", ticks1 - ticks0);
    out("fps", await wc.executeJavaScript("Render.fpsNow || 0"));
    out("frame_ms", await wc.executeJavaScript("new Promise(r => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round((performance.now() - t) / 2)))); })"));
    out("render_scale", await wc.executeJavaScript("Render.scale"));
    // Storage on the app:// scheme: the automatic save and the settings both depend on it, and a browser test would not catch a problem here.
    const storage = await wc.executeJavaScript(`(async () => {
      const saved = await __elemental.autosaveNow(true), rec = await Autosave.get();
      const back = await SaveFile.fromBlob(rec.blob, { Mat, WALL, labCheck: Lab.check });
      Settings.set("autosave", true);
      return { saved, bytes: rec.blob.size, grid: [back.W, back.H, back.D], settings: localStorage.getItem("elemental.settings") !== null };
    })()`);
    out("storage", storage);
    const err = await wc.executeJavaScript("window.__smokeErr || null");
    if (err) return fail("page error: " + err);
    const img = await wc.capturePage();
    const shot = process.env.ELEMENTAL_SMOKE_SHOT || path.join(app.getPath("temp"), "elemental-smoke.png");
    fs.writeFileSync(shot, img.toPNG());
    out("screenshot", shot);
    if (!info.isolated) return fail("not cross-origin isolated, so no shared memory");
    if (!info.webgl2) return fail("no WebGL2");
    if (!(ticks1 > ticks0)) return fail("simulation is not ticking");
    if (!storage.saved || !(storage.bytes > 0) || !storage.settings) return fail("saving does not work on the app scheme");
    console.log("SMOKE OK");
    app.exit(0);
  } catch (e) { fail(String(e && e.stack || e)); }
}

// One copy at a time. A second launch, such as a second click in Steam, brings the running window forward.
// Two copies would also fight over the same automatic save.
if (!SMOKE && !SHOTS && !app.requestSingleInstanceLock()) app.quit();
else {
  let mainWindow = null;
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    protocol.handle("app", serve);
    Menu.setApplicationMenu(null);
    mainWindow = createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
