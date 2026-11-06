// Checks that the sim thread gives the same results as running the tick on the main thread. Run with: node tools/test_threads.js [ticks] [scene ...]
// It needs Chrome and Python, because only a browser has the shared memory and workers the threaded path uses, and test_sim.js runs without them.
// Threads draw separate random numbers, so runs never match exactly. Each scene runs several times each way, and the means of the two ways must differ
// by no more than the runs of one way differ from each other, plus a small allowance. Set TRIALS for more runs per way; chain reactions need them.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { spawn } = require("child_process");
const PORT = 8798, DEBUG = 9398, root = path.join(__dirname, "..");
const args = process.argv.slice(2), TICKS = +args[0] || 150, only = args.slice(1), TRIALS = +process.env.TRIALS || 4;
const CHROME = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => fs.existsSync(p));
if (!CHROME) { console.error("Chrome not found. Set CHROME to its path."); process.exit(2); }

const wait = ms => new Promise(r => setTimeout(r, ms));
function getJSON(p) { return new Promise((res, rej) => http.get({ host: "127.0.0.1", port: DEBUG, path: p }, r => { let s = ""; r.on("data", d => s += d); r.on("end", () => res(JSON.parse(s))); }).on("error", rej)); }

// Runs in the page: one scene for a fixed number of ticks, either way, then reads back everything that should agree.
function runScene(id, threaded, ticks) {
  const st = __elemental.state;
  st.paused = true; Sim.idle();
  Sim.useDriver = threaded;
  __elemental.loadScene(id);
  const startMass = Sim.totalMass();
  for (let k = 0; k < ticks; k++) Sim.tick();
  Sim.idle(); Sim.updateCensus();
  const census = {};
  (Sim.census || []).slice(0, 6).forEach(c => { census[Mat.list[c[0]].formula] = c[1]; });
  return {
    threadedNow: Sim.threaded, massChange: (Sim.totalMass() + Sim.lostMass() - startMass) / Math.max(startMass, 1), cells: Sim.totalCells, census,
    fissions: Sim.stats.fissions, decays: Sim.stats.decays, fusions: Sim.stats.fusions, reactions: Sim.stats.reactions,
    hottest: Sim.history.length ? Sim.history[Sim.history.length - 1].hot : 0
  };
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "elemental-threads-"));
  const server = spawn("python", [path.join(root, "tools", "serve.py"), String(PORT)], { stdio: "ignore" });
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEBUG, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--window-size=1280,800", "http://localhost:" + PORT + "/"], { stdio: "ignore" });
  let code = 1;
  try {
    let target = null;
    for (let k = 0; k < 60 && !target; k++) { await wait(500); try { target = (await getJSON("/json")).find(t => t.type === "page" && /localhost/.test(t.url)); } catch (e) { /* not up yet */ } }
    if (!target) throw new Error("Chrome did not start.");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = {};
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
    const evaluate = expr => new Promise(res => { const i = ++id; pending[i] = d => { const r = d.result || {}; if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); res(r.result && r.result.value); }; ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
    for (let k = 0; k < 120 && !(await evaluate("window.__ready===true&&Pool.driverReady&&Pool.attached===Pool.helpers")); k++) await wait(500);
    if (!(await evaluate("Pool.driverReady"))) throw new Error("The sim thread did not start. Is the page cross-origin isolated?");
    const scenes = only.length ? only : await evaluate("Scenes.list.map(s=>s.id)");
    const run = (s, t) => evaluate("(" + runScene.toString() + ")(" + JSON.stringify(s) + "," + t + "," + TICKS + ")");
    let failures = 0;
    for (const s of scenes) {
      const A = [], B = [], bad = [];
      // Taking turns keeps any slow drift in the machine from favouring one way.
      for (let t = 0; t < TRIALS; t++) { A.push(await run(s, false)); B.push(await run(s, true)); }
      if (A.some(r => r.threadedNow) || B.some(r => !r.threadedNow)) bad.push("ran on the wrong path");
      const mean = a => a.reduce((x, y) => x + y, 0) / a.length, range = a => Math.max.apply(null, a) - Math.min.apply(null, a);
      const close = (name, a, b, pct, floor) => {
        const ma = mean(a), mb = mean(b), allow = Math.max(range(a), range(b)) + Math.max(Math.abs(ma), Math.abs(mb)) * pct + floor;
        if (Math.abs(ma - mb) > allow) bad.push(name + " " + ma.toFixed(1) + " vs " + mb.toFixed(1) + " (allowed " + allow.toFixed(1) + ")");
      };
      // Mass as counted here really does change in scenes with gas, burning or decay, so what must hold is that both ways change it alike.
      close("mass change %", A.map(r => r.massChange * 100), B.map(r => r.massChange * 100), 0, 1.5);
      close("cells", A.map(r => r.cells), B.map(r => r.cells), 0.02, 20);
      close("hottest", A.map(r => r.hottest), B.map(r => r.hottest), 0.1, 40);
      ["fissions", "decays", "fusions", "reactions"].forEach(k => close(k, A.map(r => r[k]), B.map(r => r[k]), 0.1, 8));
      new Set(Object.keys(A[0].census).concat(Object.keys(B[0].census))).forEach(f => close(f, A.map(r => r.census[f] || 0), B.map(r => r.census[f] || 0), 0.05, 40));
      const show = k => String(Math.round(mean(A.map(r => r[k])))).padStart(6) + " / " + String(Math.round(mean(B.map(r => r[k])))).padEnd(6);
      console.log((bad.length ? "FAIL" : "  ok") + "  " + s.padEnd(11) + " cells " + show("cells") + " reactions " + show("reactions") + " fissions " + show("fissions") + " mass change " + (mean(A.map(r => r.massChange)) * 100).toFixed(1).padStart(6) + "% / " + (mean(B.map(r => r.massChange)) * 100).toFixed(1) + "%" + (bad.length ? "\n      " + bad.join("\n      ") : ""));
      if (bad.length) failures++;
    }
    console.log("\n" + (scenes.length - failures) + " passed, " + failures + " failed (" + TICKS + " ticks; main thread / sim thread)");
    code = failures ? 1 : 0;
    ws.close();
  } catch (e) { console.error(e.message || e); code = 2; }
  chrome.kill(); server.kill();
  await wait(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold it */ }
  process.exit(code);
})();
