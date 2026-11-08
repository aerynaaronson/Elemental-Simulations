// The pictures for the README and, later, the Steam page. Each one sets up a scene, runs it to the interesting moment and frames it.
// Take them with: node tools/take_screenshots.js   (they land in docs/images, replacing what is there)
// Cameras are given relative to the chamber, so a shot looks the same at any chamber size:
//   yaw and pitch in radians, dist as a multiple of the chamber's longest side, target as fractions of its width, height and depth.
// crop "view" keeps only the chamber, "window" the whole game. setup and every run in the page, with the game's globals.
module.exports = [
  { name: "hero", crop: "window", scene: "alkali", ticks: 48, camera: { yaw: 0.62, pitch: 0.42, dist: 1.25, target: [0.5, 0.2, 0.5] } },
  { name: "lab-equipment", crop: "view", ticks: 220, camera: { yaw: 0.5, pitch: 0.4, dist: 1.05, target: [0.5, 0.18, 0.5] },
    setup: [
      "Lab.clear();",
      "var W = Sim.W, D = Sim.D, water = Mat.named('H2O');",
      "var hot = Lab.spawnPlate(W * 0.3, 1, D * 0.55, { setT: 640, half: 9 }), cold = Lab.spawnChiller(W * 0.7, 1, D * 0.55, { setT: 120, half: 9 });",
      "Lab.placePlateNow(hot); Lab.placePlateNow(cold);",
      "var flask = Lab.spawnBeaker(W * 0.3, hot.stamp.top, D * 0.55, { type: 'flask' }); Lab.fill(flask, water, P_LIQUID, 1300);",
      "var pot = Lab.spawnBeaker(W * 0.7, cold.stamp.top, D * 0.55, { type: 'crucible' }); Lab.fill(pot, water, P_LIQUID, 200);",
      "var jug = Lab.spawnBeaker(W * 0.19, 34, D * 0.55, { yaw: 0 }); Lab.fill(jug, Mat.named('CuSO4'), P_POWDER, 260);",
      "Lab.grab(jug); window.__shotJug = jug;"
    ].join("\n"),
    each: "if (Sim.tickN > 150 && window.__shotJug) Lab.tilt(window.__shotJug, Math.min(1.9, (Sim.tickN - 150) * 0.05));",
    after: "__elemental.setTool('vessel'); LabUI.selected = Vessels.list.filter(function (v) { return v.type === 'flask'; })[0];" },
  { name: "thermite", crop: "view", scene: "thermite", ticks: 34, camera: { yaw: 0.85, pitch: 0.45, dist: 0.95, target: [0.5, 0.3, 0.5] } },
  { name: "titration", crop: "view", scene: "titration", ticks: 750, camera: { yaw: 0.72, pitch: 0.78, dist: 0.95, target: [0.5, 0.15, 0.5] } },
  { name: "golden-rain", crop: "view", scene: "golden", ticks: 120, camera: { yaw: 0.35, pitch: 0.62, dist: 0.95, target: [0.5, 0.1, 0.5] } },
  { name: "density-column", crop: "view", scene: "density", ticks: 260, camera: { yaw: 0.6, pitch: 0.28, dist: 0.95, target: [0.5, 0.3, 0.5] } },
  // Not yet in the README: both were left out until their scenes were fixed, and need taking first.
  { name: "flame-tests", crop: "view", scene: "flames", ticks: 300, camera: { yaw: 0.55, pitch: 0.32, dist: 0.82, target: [0.5, 0.12, 0.5] } },
  { name: "colour-tests", crop: "view", scene: "colours", ticks: 900, camera: { yaw: 0.7, pitch: 0.62, dist: 1.1, target: [0.5, 0.08, 0.5] } }
];
