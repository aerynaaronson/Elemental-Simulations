// Helper thread. pool.js bundles this after the same simulation code the main thread runs, so it works on shared arrays with identical tables.

onmessage = function (e) {
  var m = e.data;
  if (m.type === "drive") {
    Sim.attachShared(m.buffers, m.index);
    Sim.becomeDriver();
    postMessage({ type: "attached", generation: m.generation, driver: true });
    Pool.driverLoop(m.CTRL, m.JOBS, function () { Sim.driveTick(m.PARAMS); });
    return;
  }
  if (m.type !== "attach") return;
  Sim.attachShared(m.buffers, m.index);
  Shade.attachShared(m.buffers);
  var handlers = {};
  handlers[JOB_CELLS] = Sim.runChunk;
  handlers[JOB_SHADE] = Shade.chunkByIndex;
  postMessage({ type: "attached", generation: m.generation });
  Pool.workerLoop(m.CTRL, m.JOBS, handlers, function () { Sim.readParams(m.PARAMS); Shade.readParams(m.PARAMS); });
};

Sim.flushLog = function (entries) { postMessage({ type: "log", entries: entries }); };
