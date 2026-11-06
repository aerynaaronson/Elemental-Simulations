// Fork-join thread pool over SharedArrayBuffer. The main thread publishes a list of chunks, helps work through it, and spins until
// every chunk is done, so simulation state is only ever touched by workers while the main thread is inside Pool.run.
// Without cross-origin isolation (file://, hosted pages) there are no helpers and jobs simply run inline.
var JOB_CELLS = 1, JOB_SHADE = 2;
var C_SEQ = 0, C_TYPE = 1, C_NEXT = 2, C_COUNT = 3, C_DONE = 4, C_BUSY = 5, C_TICK = 6, C_ATTACHED = 7;

var Pool = (function () {
  var P = { helpers: 0, attached: 0, available: false, handlers: {}, driverReady: false, driving: false };
  var CTRL = null, JOBS = null, PARAMS = null, workers = [];

  P.shared = function () { return typeof SharedArrayBuffer !== "undefined" && typeof self !== "undefined" && self.crossOriginIsolated === true; };

  // Typed array allocator used for all simulation and shading state.
  P.alloc = function (Type, n) {
    return P.available || P.shared() ? new Type(new SharedArrayBuffer(n * Type.BYTES_PER_ELEMENT)) : new Type(n);
  };

  var workerCount = 0, messageHandler = null, generation = 0;
  P.init = function (count, onMessage) {
    if (!P.shared() || typeof Worker === "undefined" || count <= 0) return 0;
    P.available = true;
    PARAMS = new Float64Array(new SharedArrayBuffer(8 * 32));
    P.PARAMS = PARAMS;
    workerCount = count; messageHandler = onMessage;
    P.helpers = count;
    return count;
  };

  // Start a fresh set of workers on the current buffers. Replacing them outright on a grid change means no thread can be left holding
  // old arrays. They join as they become ready; until then jobs just have fewer hands.
  P.attach = function (buffers) {
    if (!P.available) return;
    workers.forEach(function (w) { w.terminate(); });
    workers = [];
    P.attached = 0;
    P.driverReady = false;
    generation++;
    CTRL = new Int32Array(new SharedArrayBuffer(64));
    JOBS = new Int32Array(new SharedArrayBuffer(4 * 65536));
    pendingBuffers = buffers;
    spawn();
  };

  // All workers share one in-memory copy of the code, fetched once. Each loading nine scripts over the network was slow and could fail under load.
  var SCRIPTS = ["elements.data.js", "elements.js", "isotopes.data.js", "species.js", "materials.js", "reactions.js", "pool.js", "sim.js", "chem.js", "shade.js", "worker.js"];
  var workerURL = null, fetching = false, pendingBuffers = null;
  function spawn() {
    if (!workerURL) {
      if (fetching) return;
      fetching = true;
      Promise.all(SCRIPTS.map(function (s) { return fetch("js/" + s).then(function (r) { if (!r.ok) throw new Error(s); return r.text(); }); })).then(function (texts) {
        workerURL = URL.createObjectURL(new Blob([texts.join(";")], { type: "text/javascript" }));
        fetching = false;
        spawn();
      }).catch(function (e) { fetching = false; console.warn("Running on one thread: could not load worker code.", e); });
      return;
    }
    var buffers = pendingBuffers;
    // The helpers, then one more thread that drives the simulation so the main thread does not have to wait for it.
    for (var k = 0; k <= workerCount; k++) {
      var w = new Worker(workerURL);
      w.onmessage = function (e) {
        if (e.data.type === "attached") {
          if (e.data.generation !== generation) return;
          if (e.data.driver) P.driverReady = true;
          else { P.attached++; Atomics.store(CTRL, C_ATTACHED, P.attached); }
        }
        else if (messageHandler) messageHandler(e.data);
      };
      w.onerror = function (e) { console.error("Worker error:", e.message); };
      w.postMessage({ type: k < workerCount ? "attach" : "drive", generation: generation, index: k + 1, CTRL: CTRL, JOBS: JOBS, PARAMS: PARAMS, buffers: buffers });
      workers.push(w);
    }
  }

  P.startTick = function () { Atomics.store(CTRL, C_TICK, 1); Atomics.notify(CTRL, C_TICK); };
  P.tickDone = function () { return Atomics.load(CTRL, C_TICK) === 0; };
  // Sim thread: sleep until the main thread sets a tick going, run it, say it is done, forever.
  P.driverLoop = function (ctrl, jobs, fn) {
    CTRL = ctrl; JOBS = jobs; P.driving = true;
    for (;;) {
      Atomics.wait(ctrl, C_TICK, 0);
      if (Atomics.load(ctrl, C_TICK) !== 1) continue;
      try { fn(); } catch (e) { console.error(e); }
      Atomics.store(ctrl, C_TICK, 0);
    }
  };

  function publish(type, count) {
    var seq = Atomics.add(CTRL, C_SEQ, 1) + 1;   // odd: writing, workers stay out
    var guard = 0;
    while (Atomics.load(CTRL, C_BUSY) !== 0 && guard++ < 2e8) { /* wait for stragglers from the last job */ }
    CTRL[C_TYPE] = type; CTRL[C_COUNT] = count;
    Atomics.store(CTRL, C_NEXT, 0); Atomics.store(CTRL, C_DONE, 0);
    Atomics.store(CTRL, C_SEQ, seq + 1);
    Atomics.notify(CTRL, C_SEQ);
  }

  // Run fn over every item of list, in parallel when helpers are attached. Small lists stay on this thread: waking helpers costs more.
  P.run = function (type, list, count, fn) {
    if (!count) return;
    var hands = P.driving ? Atomics.load(CTRL, C_ATTACHED) : P.attached;
    if (hands === 0 || count < 3) { for (var k = 0; k < count; k++) fn(list[k]); return; }
    for (var j = 0; j < count; j++) JOBS[j] = list[j];
    publish(type, count);
    var i;
    while ((i = Atomics.add(CTRL, C_NEXT, 1)) < count) {
      fn(JOBS[i]);
      Atomics.add(CTRL, C_DONE, 1);
    }
    var t0 = 0, spins = 0;
    while (Atomics.load(CTRL, C_DONE) < count) {
      if ((++spins & 0xfffff) === 0) {
        if (!t0) t0 = performance.now();
        else if (performance.now() - t0 > 4000) { console.error("Worker stalled; continuing on one thread."); P.attached = 0; Atomics.store(CTRL, C_ATTACHED, 0); return; }
      }
    }
  };

  // Worker side: claim chunks until the list is empty, forever. A worker is terminated, not asked to stop.
  P.workerLoop = function (ctrl, jobs, handlers, beforeJob) {
    var last = Atomics.load(ctrl, C_SEQ) | 0;
    if (last & 1) last--;
    for (;;) {
      var s = Atomics.load(ctrl, C_SEQ);
      if (s === last || (s & 1)) {
        var spins = 0;
        while (spins++ < 3000 && Atomics.load(ctrl, C_SEQ) === s) { /* brief spin: the next pass usually follows within microseconds */ }
        if (Atomics.load(ctrl, C_SEQ) === s) Atomics.wait(ctrl, C_SEQ, s, 100);
        continue;
      }
      Atomics.add(ctrl, C_BUSY, 1);
      if (Atomics.load(ctrl, C_SEQ) !== s) { Atomics.sub(ctrl, C_BUSY, 1); continue; }
      last = s;
      var type = ctrl[C_TYPE], count = ctrl[C_COUNT];
      beforeJob(type);
      var h = handlers[type], i;
      while ((i = Atomics.add(ctrl, C_NEXT, 1)) < count) {
        try { h(jobs[i]); } catch (e) { console.error(e); }
        Atomics.add(ctrl, C_DONE, 1);
      }
      Atomics.sub(ctrl, C_BUSY, 1);
    }
  };

  return P;
})();
