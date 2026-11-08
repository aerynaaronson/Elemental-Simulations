// Prepares a Steam upload from the packaged Windows build: checks the build is sound and writes the two VDF scripts steamcmd reads.
// It never uploads anything. It prints the command for you to run once the Steamworks app exists. See docs/STEAM.md.
//   node tools/steam_build.js --app 480 --depot 481 --desc "0.1.0 test build" [--branch beta]
// The IDs come from the Steamworks partner site. Options can also be given as STEAM_APP_ID, STEAM_DEPOT_ID and STEAM_BRANCH.
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const NAME = pkg.productName;
function arg(name, env) {
  const k = process.argv.indexOf("--" + name);
  return k >= 0 ? process.argv[k + 1] : process.env[env];
}
const BUILD = path.resolve(arg("build", "STEAM_BUILD_DIR") || path.join(ROOT, "dist", NAME + "-win32-x64"));
const OUT = path.join(ROOT, "dist", "steam");
function die(msg) { console.error("steam_build: " + msg); process.exit(1); }
// VDF strings are quoted, with backslash as the escape character, so Windows paths need doubling.
function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

const app = arg("app", "STEAM_APP_ID"), depot = arg("depot", "STEAM_DEPOT_ID"), branch = arg("branch", "STEAM_BRANCH") || "";
const desc = arg("desc", "STEAM_DESC") || NAME + " " + pkg.version;
if (!/^\d+$/.test(app || "") || !/^\d+$/.test(depot || "")) die("give the numeric IDs from Steamworks: --app <id> --depot <id>");
if (branch && !/^[\w.-]+$/.test(branch)) die("the branch name can only hold letters, digits, dots, dashes and underscores");
if (branch === "default") die("Steam does not allow setting the default branch live from a build script. Do that on the Steamworks site.");

// ---- Is the build complete, and is it this version? ----
const need = [NAME + ".exe", "resources/app/index.html", "resources/app/desktop/main.js", "resources/app/js/sim.js", "resources/app/js/savefile.js", "resources/app/js/lab.js"];
const missing = need.filter(f => !fs.existsSync(path.join(BUILD, f)));
// The app ships as loose files, so a Steam patch only carries what changed and this script can compare them with the source.
if (fs.existsSync(path.join(BUILD, "resources/app.asar"))) die("this build uses an app.asar archive. Build it with: npm run package:win");
if (missing.length) die("the build in dist/ is missing " + missing.join(", ") + ". Run: npm run package:win");
const built = JSON.parse(fs.readFileSync(path.join(BUILD, "resources/app/package.json"), "utf8"));
if (built.version !== pkg.version) die("dist/ holds version " + built.version + " but package.json says " + pkg.version + ". Run: npm run package:win");
// A build from an earlier edit would silently ship old code, so every source file has to match.
const stale = fs.readdirSync(path.join(ROOT, "js")).filter(f => {
  const inBuild = path.join(BUILD, "resources/app/js", f);
  return !fs.existsSync(inBuild) || !fs.readFileSync(inBuild).equals(fs.readFileSync(path.join(ROOT, "js", f)));
});
if (stale.length) die("the build in dist/ is out of date (" + stale.join(", ") + "). Run: npm run package:win");
const unwanted = ["_to_delete", "tools", "docs", "ROADMAP.md"].filter(f => fs.existsSync(path.join(BUILD, "resources/app", f)));
if (unwanted.length) die("the build contains files players should not get: " + unwanted.join(", "));

// ---- The two scripts ----
fs.mkdirSync(path.join(OUT, "logs"), { recursive: true });
const appVdf = [
  '"appbuild"', "{",
  '\t"appid" ' + q(app),
  '\t"desc" ' + q(desc),
  '\t"buildoutput" ' + q(path.join(OUT, "logs")),
  '\t"contentroot" ' + q(BUILD),
  '\t"setlive" ' + q(branch),
  '\t"depots"', "\t{",
  "\t\t" + q(depot) + " " + q("depot_build_" + depot + ".vdf"),
  "\t}", "}", ""
].join("\n");
const depotVdf = [
  '"DepotBuildConfig"', "{",
  '\t"DepotID" ' + q(depot),
  '\t"ContentRoot" ' + q(BUILD),
  '\t"FileMapping"', "\t{", '\t\t"LocalPath" "*"', '\t\t"DepotPath" "."', '\t\t"recursive" "1"', "\t}",
  '\t"FileExclusion" "*.pdb"',
  "}", ""
].join("\n");
const appFile = path.join(OUT, "app_build_" + app + ".vdf");
fs.writeFileSync(appFile, appVdf);
fs.writeFileSync(path.join(OUT, "depot_build_" + depot + ".vdf"), depotVdf);

const files = (function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : 1), 0); })(BUILD);
console.log("Build checked: " + NAME + " " + pkg.version + ", " + files + " files, matches the source.");
console.log("Wrote " + path.relative(ROOT, OUT) + path.sep + " for app " + app + ", depot " + depot + (branch ? ", going live on branch " + branch : ", not set live on any branch") + ".");
console.log("\nTo upload, run this yourself, signed in with a Steamworks build account:\n");
console.log('steamcmd +login <your_build_account> +run_app_build "' + appFile + '" +quit');
