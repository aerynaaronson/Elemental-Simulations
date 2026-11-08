# Architecture

How the game is put together, what depends on what, where the time goes, and how to change it without breaking the simulation. This is the audit the roadmap asks for in section 10, and the baseline for later work.

Timings were measured on 7 November 2026 on the development machine (24 logical threads, 12 threads in use) and are for comparing one change with the next, not promises about other hardware. See [Performance](#performance).

## Layers

```text
 Input                 mouse and keys           future VR controllers       scripted tests
                            │                            │                        │
 Presentation          ui.js, lab-ui.js                  │                        │
 (DOM, camera)              │                            │                        │
                            ▼                            ▼                        ▼
 Objects and           lab.js  ───────────────►  vessels.js
 interaction                │                            │
                            ▼                            ▼
 Simulation core       sim.js ◄──► chem.js        pool.js + worker.js (threads)
                            │           │
 Material data         materials.js, species.js, reactions.js, elements*.js, isotopes.data.js
                            │
 Rendering             shade.js ─► render.js (WebGL2), lab-render.js (equipment)

 Around all of it      savefile.js, autosave.js, settings.js, scenes.js, desktop/main.js
```

The rule that keeps VR possible: **nothing below `lab-ui.js` knows about the DOM, the mouse or the camera.** The simulation receives material operations (`Sim.place`, `Sim.erase`, writes to `Sim.T`) and never input events.

## Files

| File | Lines | Layer | Job |
| --- | ---: | --- | --- |
| `js/sim.js` | 1706 | Core | The grid: heat, phases, movement, pressure, air currents, structure, electricity, isotopes, neutrons. The tick loop. Snapshots. |
| `js/chem.js` | 991 | Core | Reactions in true moles, Gibbs and Arrhenius, solutions and pH, generated rule families. |
| `js/pool.js`, `js/worker.js` | 170 | Core | Fork-join thread pool over shared memory, and the worker entry point. |
| `js/materials.js` | 508 | Data | Builds the material table. Ids are fixed by build order, so all threads agree. |
| `js/species.js`, `js/reactions.js` | 837 | Data | Hand-entered molecules and the reaction database. |
| `js/elements*.js`, `js/isotopes.data.js` | 270 | Data | Generated element and isotope data, plus hand-entered additions. |
| `js/vessels.js` | 325 | Objects | Containers outside the grid: geometry, inventory, pouring, catching, setting down. |
| `js/lab.js` | 342 | Objects | The Lab API: spawning, grabbing, moving, heating, saving. See [LAB.md](LAB.md). |
| `js/shade.js` | 224 | Rendering | Turns cells into colour and light buffers. Runs on the worker threads. |
| `js/render.js` | 974 | Rendering | WebGL2 raymarcher, classic and realistic looks, bloom, particles, camera. |
| `js/lab-render.js` | 134 | Rendering | Hides equipment cells that meshes stand in for, and paints carried contents as "ghost" voxels. |
| `js/lab-meshes.js` | 424 | Rendering | Draws lab equipment as meshes from `js/labware.data.js`, which `tools/blender/labware.py` generates in Blender. |
| `js/effects.js` | 140 | Rendering | Short-lived reaction effects, read from the simulation's event ring. No DOM, no GL. |
| `js/ui.js` | 1050 | Presentation | Everything on screen, the main loop, picking, undo, files, autosave, settings dialog. |
| `js/lab-ui.js` | 319 | Presentation | Mouse and keys for equipment, its panel and outlines. |
| `js/scenes.js` | 462 | Content | The 22 experiments, the lessons and the test rig. |
| `js/savefile.js` | 126 | Saving | File format and all checks. No DOM. |
| `js/autosave.js` | 30 | Saving | One rolling save in IndexedDB. |
| `js/settings.js` | 40 | Saving | Player settings with allowed values. |
| `desktop/main.js` | 125 | Shell | Electron: the `app://` scheme with isolation headers, window state, single instance. |

## Simulation entry points

What the rest of the game may call. Everything else in `sim.js` is private to the tick.

| Call | Use |
| --- | --- |
| `Sim.init(w, h, d)` | Allocates a new chamber. Workers must be re-attached afterward. |
| `Sim.place`, `Sim.erase`, `Sim.box`, `Sim.forBrush`, `Sim.dissolve` | Put and remove material. |
| `Sim.T[i]` plus `Sim.wakeI(i)` | Change a temperature and make sure the chunk notices. |
| `Sim.tick()` | One whole tick, blocking. Tests use this. |
| `Sim.tickStart()`, `Sim.tickPoll()`, `Sim.idle()` | The threaded tick. **Only change cells when `Sim.busy` is false.** |
| `Sim.snapshot()`, `Sim.restore(s)` | Cells and world settings. A size change has to happen first. |
| `Sim.ambient`, `atmosphere`, `lid`, `gravity`, `star`, `magnet`, `structural`, `fluid`, `enrichment`, `isotopeOverride`, `setDecayScale` | World settings. Workers receive them through `writeParams`. |

## Simulation dependency map

```text
elements.data ─► elements ─┐
isotopes.data ─────────────┤
species ───────────────────┼─► materials ─► reactions
                           │        │
                           │        ▼
                         pool ─► sim ◄──► chem       (sim holds Chem through Chem.bind)
```

The core has no dependency on anything drawn or clicked. Headless tests load exactly this list in a Node `vm` context, which is the proof that it stays true. `scenes.js` needs only the core too, and has no DOM code.

## Rendering dependency map

```text
sim (ID, PH, T, AUX, USED, AUX2, U2, CH, P, DIRTY, particles)   read-only, as shared arrays
    │
    ▼
shade.chunkByIndex   runs on worker threads, also reads chem for pH colours
    │  colorBuf, emitBuf, matBuf, coarseBuf
    ▼
Render.afterShade ─► lab-render   paints ghost voxels on the main thread
Render.meshPass   ─► lab-meshes   draws equipment meshes over the volume
    │
    ▼
render.uploadDirty ─► 3D textures ─► raymarch ─► bloom ─► canvas
```

* The renderer reads the simulation and never writes to it, apart from clearing `DIRTY`.
* **The room** around the chamber is `ROOM_GLSL` in `render.js`: boxes and planes traced analytically, in both looks, for rays that leave the chamber. Its sizes are multiples of the chamber's longest side, so it fits any grid. In the realistic look it reports its hit distance, which the anti-aliasing needs to reproject the image as the camera moves.
* **The camera** is a target. `Render.camera` is where the view is going, and the drawn view glides after it. Code that must jump, such as loading a file or resizing the chamber, calls `Render.snapCamera()`.
* **Reaction events** are the one channel from the simulation to presentation besides the cells. `Sim.fx(cell, kind, material, heat)` writes to a shared ring, `Sim.FX`, from any thread: heat, fizz, gas or precipitate. It draws no random numbers and changes no cell, and `tools/test_effects.js` checks that a run is identical with and without it. `js/effects.js` reads the ring each frame, thins it to one effect per small region at a time and a budget per frame, and hands sprites to the particle pass. Sound effects would read the same ring.
* **Idle frames:** `Render.frame` skips drawing once nothing has changed for 2.5 seconds: no dirty chunk, no particle, and the same view, size, look and brush. Anything outside that list that changes the picture calls `Render.wake()`.
* A chunk is reshaded only when `DIRTY` is set, and `wake` and most writes set it.
* `ui.js` holds the only references to both sides: it decides when a tick runs relative to a frame.
* A VR stereo pass would replace the last box. Everything above it can stay.

## Threads

```text
Main thread                 Sim thread (driver)                Helper threads (pool)
───────────                 ───────────────────                ─────────────────────
Sim.tickStart()
  tickBegin, writeParams
  C_TICK = 1 ───notify───►  driveTick
                              readParams
                              tickCells ──publish JOB_CELLS──► runChunk, 8 colour passes
  frame keeps drawing,        (helps claim chunks too)
  no cell writes              tickRest: particles,
                              structure, air currents
Sim.tickPoll()  ◄──C_TICK = 0─┘
  tickEnd, afterTick
  Lab.step(): equipment writes cells here
Render.frame()
  writeParams
  Pool.run(JOB_SHADE) ───publish JOB_SHADE───────────────────► Shade.chunkByIndex
```

* **Memory:** all state is `SharedArrayBuffer`, allocated by `Pool.alloc`. This needs cross-origin isolation, which `tools/serve.py` and the desktop app's `app://` scheme both provide. Without it, everything runs inline on one thread.
* **Colouring:** chunks are split into 8 colours. Chunks of one colour are at least 16 cells apart, further than any cell reaches in a tick, so they can run at the same time.
* **Control block:** `CTRL` holds the job sequence, type, next-chunk and done counters, and the tick flag. `JOBS` holds the chunk list. `PARAMS` is a `Float64Array` of world settings.
* **Replacing workers:** a chamber size change terminates all workers and starts new ones on the new arrays, so no thread can hold an old array. Until they report in, jobs run with fewer hands.
* **The one rule:** every input handler first waits for the tick to finish. A capturing listener in `ui.js` covers `click`, `change`, `input`, `keydown` and `pointerdown`. Code running outside those events must check `Sim.busy` itself.

## What is on screen

Tools: Place, Erase, Heat, Cool, Spark, Neutrons, Magnet, Blast, UV lamp, Orbit, Lab. Top bar: experiment menu, Pause, Step, Undo, Redo, Save, Load, Clear, Record, Share, Lessons, Guide, Settings. Side panel: data card, brush, environment, readings, census, reaction log. Dock: periodic table, compounds, reactions, journal, search, highlight filter. Overlays: experiment note, lesson box, probe, toast, lab panel, resume prompt.

## Saving and restoring

`captureWorld()` in `ui.js` is the single description of a chamber: `Sim.snapshot()` plus `Lab.serialize()` plus the scene id. Undo, save files and the automatic save all use it, and `applyWorld()` is its single inverse, so the three cannot drift apart.

* **File:** gzip around one JSON header line and the raw cell arrays. Format `elemental-2`, and `elemental-1` files still open.
* **Checks:** `SaveFile.decode` checks the header, the material list fingerprint, the exact length, each cell's ids and phase, and that the chamber's outer shell is intact, and it builds a separate copy. Nothing in the simulation changes until all of that passes. A bad float is replaced rather than refusing the file.
* **Automatic save:** about once a minute when something changed, only one at a time, and never while the "continue" prompt is showing.
* **Lost graphics context:** the simulation is on the CPU and survives, so it saves, then reloads into a fresh context and restores itself. Recreating every GL object in place would be far more fragile.

## Performance

**Headless, one thread** (`npm run bench`, 96 × 64 × 96):

| Case | ms per tick |
| --- | ---: |
| Empty | 0.4 |
| Water pool and falling sand | 20 |
| Settled | 22 |
| Whole grid awake and warm | 88 |

**In the browser, 12 threads, "Alkali metals in water":**

| Chamber | Cells | Awake chunks | Tick, median | Tick, worst | Census | Snapshot | File | Compress |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Small | 197 k | 41 | 12 ms | 18 ms | 0.7 ms | 11 ms | 0.8 MB | 56 ms |
| Huge (default) | 2.5 M | 435 | 43 ms | 79 ms | 11 ms | 23 ms | 5.4 MB | 470 ms |
| Giant | 6.4 M | 1559 | 83 ms | 140 ms | 22 ms | 34 ms | 5.1 MB | 750 ms |

The simulation targets 30 ticks a second, which is 33 ms. It runs slow rather than falling behind, by design.

**Ticks a second actually reached**, against a target of 30, in four busy scenes:

| Chamber | Alkali | Thermite | Furnace | Colours |
| --- | ---: | ---: | ---: | ---: |
| Medium, 96 × 64 × 96 | 29.8 | 28.4 | 30.0 | 29.9 |
| Large, 128 × 80 × 128 | 23.5 | 28.9 | 29.8 | 28.5 |
| Huge, 160 × 96 × 160 | 10.5 | 23.9 | 23.1 | 21.3 |

Huge was the default for machines with 8 or more cores, and the very first scene ran at a third of real time. Large is now the default there.

Only the snapshot blocks the main thread during an automatic save. Compression runs in the browser's background.

### Bottlenecks, largest first

1. **The cell pass (`Sim.runChunk`).** Most of every tick. Awake chunks are the cost, not grid size, so anything that keeps chunks awake needlessly is expensive. This is the place to look first, and it needs care, since it is the simulation.
2. **Chamber size.** Fixed by making Large the default, as the table above shows. A short benchmark at first launch could choose better still on machines much faster or slower than this one.
3. **Raymarching.** Automatic quality settled at a render scale of 0.64 in the test pane. Not measured on a real window yet. Measure at 1080p and 1440p in a real window before optimising it, because the test pane's size and visibility affect these numbers.
4. **Census on the main thread.** 11 to 22 ms, every 15 to 30 ticks, which is a small regular stutter at large sizes. It scans the grid twice. It could run on the sim thread.
5. **`Sim.idle()` from input handlers.** Each mouse press spins until the tick ends, which can be a whole tick at large sizes.
6. **Drawing while paused.** Fixed: the renderer stops drawing once the picture has not changed for 2.5 seconds.

## Refactoring boundaries

Safe to change freely, because the tests sit above them:

* `lab.js`, `vessels.js`: covered by `test_lab` and `test_vessels` through their public calls.
* `savefile.js`, `settings.js`: covered by `test_save`.
* `ui.js`, `lab-ui.js`: no simulation logic should live here. Moving code out is welcome. There are no automated tests at this level yet, so check changes in the browser.

Change only with a specific reason, and benchmark before and after:

* `sim.js` and `chem.js`. Their behaviour is the product. `test_sim`, `test_reactions` and `validate` guard them, `test_experiments` checks every experiment still does what its text says, and `test_threads` checks that threaded and single-threaded runs agree. Run `test_experiments` with a few values of `SEED`, because a check that passes on one seed can pass by luck.
* `pool.js`. Small, and subtle. A mistake here shows up as rare corruption, not a clean failure.
* `materials.js` build order. Ids are stored in save files. Changing the order or adding materials invalidates saves, and the fingerprint will refuse them with a message. A migration table will be needed before the first public release.

## Migration plan

Each step keeps the game runnable and preserves what exists. Done steps are recorded in [ROADMAP.md](../ROADMAP.md).

1. **Types without a rewrite.** Add JSDoc and `tsc --checkJs` on `lab.js`, `vessels.js` and `savefile.js` first. This gives typed APIs, as the roadmap wants, and no build step. Move to real TypeScript only if this proves too limiting.
2. **Split `ui.js`.** Move the file, autosave and settings sections out, then the main loop. No behaviour change.
3. **Generalise Lab tools.** Input actions (grab, tilt, fill) become one table that mouse, gamepad and VR all map onto.
4. **VR prototype, as the roadmap sets out.** A WebXR stereo pass over the existing raymarcher. It may be too heavy to hold headset frame rates, and the roadmap's rule stands: decide on the evidence, before any engine move.
5. **Native bridge, only if that prototype fails.** Keep the simulation as the data source, and evaluate Godot or Unity as a renderer in front of it.
