// Launch the desktop app, check it is cross-origin isolated (so shared memory and threads work), ticking and drawing, then quit.
// Run with: npm run smoke
const { spawnSync } = require("child_process"), path = require("path");
const electron = require("electron");
const r = spawnSync(electron, [path.join(__dirname, ".."), "--no-sandbox"], { env: Object.assign({}, process.env, { ELEMENTAL_SMOKE: "1" }), encoding: "utf8", timeout: 200000 });
const lines = (r.stdout || "").split(/\r?\n/).filter(l => l.startsWith("SMOKE"));
lines.forEach(l => console.log(l));
if (!lines.includes("SMOKE OK")) { console.log((r.stderr || "").split("\n").slice(-15).join("\n")); process.exit(1); }
