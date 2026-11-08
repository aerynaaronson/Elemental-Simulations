// Runs the headless test suites and prints one line each. Run with: npm test
//   node tools/run_tests.js          the quick suites, for use after every change
//   node tools/run_tests.js --full   also the simulation, reaction and validation suites, for before a checkpoint
//   node tools/run_tests.js --browser also the thread comparison, which needs Chrome and Python
const { spawnSync } = require("child_process"), path = require("path");
const QUICK = [["vessels", "test_vessels.js"], ["lab", "test_lab.js"], ["equipment", "test_equipment.js"], ["labware", "test_labware.js"],["save files", "test_save.js"], ["effects", "test_effects.js"]];
const FULL = [["experiments", "test_experiments.js"], ["simulation", "test_sim.js"], ["reactions", "test_reactions.js"], ["validation", "validate.js"]];
const BROWSER = [["threads", "test_threads.js"]];
const has = f => process.argv.includes(f);
const suites = QUICK.concat(has("--full") || has("--browser") ? FULL : [], has("--browser") ? BROWSER : []);

let failed = 0;
const started = Date.now();
for (const [name, file] of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: "utf8", cwd: path.join(__dirname, ".."), maxBuffer: 64 * 1048576 });
  const lines = ((r.stdout || "") + (r.stderr || "")).split(/\r?\n/);
  const ok = r.status === 0;
  console.log((ok ? "pass " : "FAIL ") + name.padEnd(12) + ((Date.now() - t0) / 1000).toFixed(1).padStart(7) + " s");
  if (!ok) {
    failed++;
    const bad = lines.filter(l => /FAIL|Error/.test(l)).slice(0, 25);
    console.log((bad.length ? bad : lines.slice(-15)).map(l => "     " + l).join("\n"));
  }
}
console.log((failed ? failed + " suite(s) failed" : "all " + suites.length + " suites passed") + " in " + ((Date.now() - started) / 1000).toFixed(0) + " s");
process.exit(failed ? 1 : 0);
