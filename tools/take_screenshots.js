// Takes the README and store pictures listed in tools/screenshots.js with the desktop app, into docs/images.
// Run with: npm run screenshots      Only some: node tools/take_screenshots.js hero thermite
// A window opens for a minute or two while it works. It uses its own profile, so your saves and settings are not touched.
const { spawnSync } = require("child_process"), path = require("path");
const electron = require("electron");
const out = path.join(__dirname, "..", "docs", "images");
const env = Object.assign({}, process.env, { ELEMENTAL_SHOTS: out, ELEMENTAL_SHOT_ONLY: process.argv.slice(2).join(",") });
const r = spawnSync(electron, [path.join(__dirname, ".."), "--no-sandbox"], { env, encoding: "utf8", timeout: 16 * 60000 });
const lines = (r.stdout || "").split(/\r?\n/).filter(l => l.startsWith("SHOTS"));
lines.forEach(l => console.log(l));
if (!lines.includes("SHOTS done")) { console.log((r.stderr || "").split("\n").slice(-15).join("\n")); process.exit(1); }
