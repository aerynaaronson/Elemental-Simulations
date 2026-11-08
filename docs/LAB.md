# Lab equipment and the desktop app (prototype)

## Layers

```
mouse / keys (lab-ui.js)  ─┐
future VR controllers      ├─►  Lab API (lab.js)  ─►  Vessels (vessels.js)  ─►  Sim.place / Sim.erase / Sim.T
scripted tests (test_lab)  ─┘
```

The simulation core is unchanged. Equipment only reaches it through material operations: placing, erasing and heating cells.
Nothing below `lab-ui.js` knows about the DOM, the mouse or the camera, so a VR front end can call the same functions.

## Lab API

| Call | What it does |
| --- | --- |
| `Lab.spawnBeaker(x, y, z, opts)` | New container with its base at a point. `opts`: type (`beaker`, `tube`, `flask`, `crucible`, `dish`, `bottle`, see `Lab.CONTAINERS`), radius, height, yaw, name. |
| `Lab.spawnBottle(x, y, z, key, opts)` | A reagent bottle nine-tenths full of one of `Lab.REAGENTS`, named after it. `Lab.reagent(key)` says what that reagent is in the simulation. |
| `Lab.spawnStirrer(x, y, z, opts)` | A hot plate that also stirs. `opts.stir` is 0 (off) to 3 (fast); `Lab.setStir(o, speed)` changes it. |
| `Lab.spawnBalance(x, y, z, opts)` / `Lab.weigh(p)` / `Lab.tare(p)` | A balance; grams on its pan less the tare; zero it with what is on it now. |
| `Lab.spawnPlate(x, y, z, opts)` | New hot plate. `opts`: half (half-width), h, setT (kelvin or null for off), cold. |
| `Lab.spawnChiller(x, y, z, opts)` | A plate that runs cold, down to liquid nitrogen temperature on its dial. |
| `Lab.spawnBurner(x, y, z, opts)` | A gas burner: a plate with a nozzle that keeps a flame alight. `opts`: nozzle (radius in cells, 0 for one cell), core (flame height), half, h, setT (flame temperature, `Lab.BURNER_T` = 1800 K, or null for off). |
| `Lab.spawnTool(kind, x, y, z, opts)` | A hand tool with its tip at a point: `probe` (thermometer), `dropper`, `supply` (power supply), `funnel`, `syringe` (gas syringe), `tongs`, `igniter` (spark igniter), `geiger` (Geiger counter), `jar` (bell jar, positioned by the middle of its rim) or `condenser` (positioned by its outlet), see `Lab.TOOLS`. Also `spawnProbe`, `spawnDropper`, `spawnSupply`, `spawnFunnel`, `spawnSyringe`. `opts`: len, name; for a supply, gap (cells from the centre to each rod), volts, on; for a funnel, filter; for a dropper, cap (how many cells it holds, 20 by default) and clamp (held in a clamp stand, so it stays where it is put, as an experiment holds one over a beaker). |
| `Lab.setFilter(o, on)` / `Lab.discard(o)` | Put filter paper in a funnel or take it out / throw away what a dropper, funnel or syringe holds. |
| `Lab.connect(s, v)` / `Lab.connectNearest(s)` / `Lab.ventSyringe(s)` | Connect a gas syringe or condenser to a container (null to disconnect), which stoppers it / to the nearest one / push a syringe's gas back out. |
| `Lab.grip(o)` / `Lab.letGo(o)` | Tongs: grip up to six cells of a solid near the tip / open and drop them. |
| `Lab.spark(o)` / `Lab.setAuto(o, on)` | Spark igniter: one spark / keep sparking twice a second. |
| `Lab.rate(o)` / `Lab.resetCount(o)` | Geiger counter: counts a second over the last second / zero its totals. |
| `Lab.setPump(o, on)` / `Lab.letAirIn(o)` | Bell jar: run its vacuum pump / open its valve. Its pressure is `o.kPa`. |
| `Lab.clamped(o)` | Whether a tool stays where it is let go, held in a clamp stand: tongs, spark igniter, Geiger counter and condenser. |
| `Lab.read(o)` | What a thermometer's tip touches: `{ T, mat, form, pH, kPa }`. pH is null unless it is in water. |
| `Lab.drawUp(o, n)` / `Lab.squeeze(o, n)` | Take up to n cells of liquid into a dropper from around its tip / let n out, one drop a tick. Leave n out for all. |
| `Lab.setStopper(o, on)` | Put a stopper in a container or take it out. A container with `sealed` set, such as a discharge tube, is closed for good: its stopper never pops. |
| `Lab.placePlateNow(p)` / `Lab.setDownNow(v)` | Write a plate, or set a container down, into the grid at once rather than after it settles, so an experiment can build on it or fill it cell by cell. |
| `Lab.setSupply(o, on, volts)` | Switch a power supply on or off and set its voltage, 0 to `Lab.MAX_VOLTS`. Either may be null to leave it. |
| `Lab.live(o)` / `Lab.wetRods(o)` | Whether a supply is driving current / how many cells of each rod touch liquid. |
| `Lab.grab(o)` / `Lab.release(o)` | Pick up / let go. Grabbing lifts a set-down object out of the grid at once. |
| `Lab.carryFloor(o)` | The lowest a carried object can go without being inside a solid. |
| `Lab.serialize()` / `Lab.deserialize(d)` / `Lab.check(d, N, matCount)` | Equipment as plain data, for undo and save files. Restore the grid first. |
| `Lab.move(o, x, y, z)` | Move the base centre. |
| `Lab.tilt(o, radians)` / `Lab.turn(o, dYaw)` | Tip a beaker / turn its spout. |
| `Lab.fill(o, mat, form, n, T)` | Add material from the browser. |
| `Lab.transferMaterial(src, dst, n)` | Move cells between beakers without pouring, like a pipette. |
| `Lab.placeMaterial(mat, x, y, z, n, form, T)` | Put n cells into open space near a point. |
| `Lab.applyHeat(o, dT)` | Change a beaker's contents by dT kelvin. |
| `Lab.setPlate(o, T)` | Plate temperature in kelvin, or null for off. |
| `Lab.remove(o)` | Delete an object; a set-down beaker is lifted first. |
| `Lab.update(dt)` | Every frame: motion only (falling, settling, righting). Never writes to the grid. |
| `Lab.step()` | Every simulation tick, between ticks: pouring, catching, setting down, heating. |

## How a beaker works

* **Held or moving:** the beaker sits outside the grid with an inventory counted in cells. Loose liquid or powder inside its volume
  goes into it (dipping, catching a stream). Tipped past its spill angle, cells are placed just past the lip. Carried into something
  solid, it rises over it; liquid and grains do not stop it, so it can still be dipped.
* **At rest:** after a few still ticks it is *set down*: a WALL shell (drawn as glass) is written into the grid and its inventory is
  poured inside. From then on its contents react, conduct heat and boil like anything else.
* **Picked up again:** liquids, powders and solids inside go back into the inventory, gas is left to drift off, and the glass is removed.
* Every exchange conserves material; `tools/test_vessels.js` and `tools/test_lab.js` check it.
* An inventory keeps what is dissolved in each cell and how strong it is, as well as a second solute such as an indicator, so a solution
  poured, dipped, drawn up or set down keeps its strength. Strengths are averaged over cells of the same kind, which keeps the amount of solute.

## Hot plate

A WALL slab (drawn as glass-ceramic) held at the set temperature. It pulls whatever touches its top toward that temperature, and heats
the bottom layer of a set-down beaker standing on it directly, because WALL does not conduct heat into neighbours in the simulation.
A chiller is the same object with a colder dial and a frosted look, so it freezes things the same way a hot plate boils them.

## Gas burner

The same object again, but its body stays cool. While lit, it keeps a column of FLAME cells (its core) alight above the nozzle at the
flame temperature, and flame rises off the core and fades as any flame does. Anything sitting in the core is heated instead.
`Lab.setPlate(o, null)` turns the gas off and `Lab.setPlate(o, Lab.BURNER_T)` lights it.

A flame that touches a flame-test metal (lithium, sodium, potassium, rubidium, caesium, calcium, strontium, barium, copper, boron,
indium or thallium), as the element, a compound of it or a solution of one, takes on that metal's flame colour. Colour also passes up
to the flame directly above, as the metal's atoms rise with the gas, but never sideways or down, so it fades once the sample is gone.
This happens in `sim.js` for every flame, so a fire next to copper burns green too.

## Stopper

A stoppered container neither pours nor catches anything while it is loose. Set down, its stopper is a disc of WALL cells one layer above
the rim, covering the glass too, so gas inside has no way out. Every 10 ticks `Lab.step` measures how much of the headspace is gas other
than air, counting gas cells and the vapour that air cells hold. Air in the simulation is empty space, so that share stands for pressure on
top of the air already there. Once it passes a quarter (about 1.25 atm), or the gas inside is 20 kPa over the room, the stopper pops out
with a puff and a log line. Water at room temperature fills about 1% of a sealed headspace; brought to the boil, it pops the stopper within
a few seconds. Picking a container up takes its stopper out of the grid with it, and setting it down seals it again.

## Reagent bottles and the evaporating dish

Both are containers like any other. A reagent bottle is narrow and comes from the shelf full of a solution made up to a stated strength:
1 M hydrochloric, nitric and sodium hydroxide, 0.5 M sulfuric acid, copper sulfate and others, indicators, and pure ethanol and water.
A molarity M is stored as the share of a full cell of solute, M / (n0 × 1000), which is how the chemistry reads concentration.
An evaporating dish is wide and only three cells deep, for boiling a solution down on a hot plate until its salt is left.

## Stirrer

A hot plate with a white top that also stirs a set-down container standing on it. Each tick, liquid and grains inside trade places with
the cell beside them along a circle round the middle, and grains under liquid are swept up a few cells, trading places with the liquid
above. They settle again on their own, so the faster the setting the more of a solid hangs in the liquid, where it dissolves and reacts.
Cells are only ever swapped, so nothing is made or lost.

## Funnel

A glass cone on a stem, positioned by its stem tip. It rests on whatever its cone or stem touches first, so one let go over a container
sits in its mouth with the stem inside. Liquid and grains that land in the cone go into it, as they would into a container, and liquid runs
out of the stem: a cell a tick through filter paper, three without. Grains go through only without paper, so with it they stay behind as
the residue. What is dissolved in the liquid goes through with it.

## Gas syringe

A glass barrel lying on the bench, connected by a delivery tube to the stopper of one container; connecting it puts the stopper in. While
that container is set down and stoppered, the syringe draws gas cells out of its headspace, three a tick, until its 100 cells are full, and
its plunger is drawn out as it fills. Until then the gas cannot build up, so the stopper stays in; after that it pops as usual. Vapour held
by air, such as steam, is left behind, as it would condense in the tube. Pushing the plunger in lets the gas out at the nozzle.

## Balance

A plate with a steel pan. It reads every column of its pan up to the first empty cell, and each cell weighs its density in grams, since a
cell is a cubic centimetre. A set-down container counts with its glass (2.5 g a cell) and its contents; gas, which floats off, does not.

## Clamped tools

Tongs, a spark igniter, a Geiger counter and a condenser are held in a clamp stand, drawn beside each, so they stay where they are let go.

* **Tongs** grip up to six cells of a solid near their tip. While carried, the sample is held out of the grid. Let go, it is written back
  at the tip as fixed solid cells, so it can be held in a burner's flame and burn (magnesium does), melt or colour the flame. Picked up
  again, whatever is still solid there comes back; what melted or burned away stays behind.
* **A spark igniter** heats any gas within two cells of its tip to 1300 K, sends a pulse into anything conducting there and throws a
  shower of sparks. Held where hydrogen meets the air, it lights it.
* **A Geiger counter** counts every alpha, beta, gamma and neutron that comes into the window at the bottom of its tube, once each, and
  shows counts a second. It clicks for each count, which can be turned off in its panel.
* **A condenser** is a water-cooled tube from the stopper of its source container down to its outlet. While the source is set down and
  stoppered, it takes the gas cells that reach the headspace and the vapour held in its air. Anything that boils above the cooling water
  comes out of the outlet as liquid at 18 °C, two drops a tick; other gas passes straight through. Nothing dissolved goes over, so boiling
  brine gives pure water, and the flask's stopper never pops.

## Bell jar and vacuum pump

A glass dome 17 cells across and 16 high, open at the bottom. Let go, it falls until its rim rests on something solid and is written into
the grid as WALL, which seals it to what it stands on; a rim that does not sit flat leaks and cannot get below 60 kPa. Its pump halves the
pressure every 17 ticks or so, down to 0.5 kPa, draws gas cells and the vapour in the air out of it, and lets them go at its outlet.

The low pressure reaches the simulation as `Sim.region`, an upright cylinder at a pressure, passed to the worker threads in the shared
parameters. Inside it, a liquid boils at its boiling point at that pressure (by Clausius-Clapeyron through its normal boiling point and its
boiling point at a hundredth of an atmosphere), it evaporates as fast as into a vacuum, and nothing burns or rusts once the pressure is
below 30 kPa. Room-temperature water under a pumped jar boils, chills itself to about −7 °C and evaporates many times faster than in air.
Only the jar with the lowest pressure counts, so one pumped jar at a time.

## Thermometer and dropper

Both are upright sticks positioned by their tip. Let go, they sink through liquid and grains and come to rest on the first solid, so one
let go over a beaker stands on its glass floor. Neither is ever part of the grid. A thermometer reads the cell its tip is in, or what that
cell touches when it is air. A dropper holds up to 20 cells of liquid, takes them from around its tip nearest first, and lets them out one
drop a tick into the nearest free cell below or beside its tip.

## Power supply

A case on a clamp with two electrode rods hanging from it. Once it rests, the rods are written into the grid as ELECTRODE cells, pushing
any liquid or grains in the way aside. The simulation pulses every ELECTRODE cell on a shared clock, so the supply registers its rods with
`Sim.electrodeGate` to keep them out of that, and pulses them itself through `Sim.pulseCell`: every 6 ticks at 6 V, every 3 at 12 V, and
not at all while it is off or below 1.23 V, the voltage that splits water. The current does the rest through the existing electricity code:
water splits into hydrogen and oxygen, a dissolved salt of a less reactive metal plates out, and a molten salt splits into its elements.
The rods have no polarity: both gases come off at both rods. Lifting the container the rods stand in lets them fall.

## Drawing

Equipment is drawn as smooth meshes modelled in Blender. `tools/blender/labware.py` builds every model in cell units, with each
model's origin and size matching the cells the simulation gives that object, and writes them to `js/labware.data.js` (and a `.glb`
beside the script for viewing). Rebuild them after changing the script:

```
"F:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/blender/labware.py -- --preview
```

`js/lab-meshes.js` places the models each frame from the equipment's state and draws them in `Render.meshPass`, after the raymarcher
and before the temporal resolve, depth-tested against the volume and with the same jitter, so their edges are smoothed too. Glass is
blended far to near. The meshes also show state the old voxels could not: the thermometer's column follows its reading, the dropper
and syringe show how much they hold, a stirrer spins a bar in the container on it, a hot plate's heating zone glows, reagent bottles
carry a hazard-coloured label, and lamps and displays light up.

The equipment's own cells are untouched. `js/lab-render.js` only hides how they look, after the shader fills a chunk
(`Render.afterShade`): container walls, stoppers, rods and the bell jar become glass with no alpha. The realistic renderer draws that as
nothing, leaves it out of its smoothing (so liquid stays level up to the wall instead of standing back from it or climbing it) and never
takes depth from it (so it cannot hide the mesh drawn in its place). `lab-render.js` also passes each set-down container's
axis and radius to `Render.setContainers`. In a container's outer ring the realistic renderer reads the liquid from just inside the
column and cuts it off at the true circle, so liquid in a round container has a smooth round side and a round rim instead of the cells'
stair steps. Plate slabs become empty space that keeps a hot plate's glow, so it still lights what stands
on it. What a carried container, funnel or pair of tongs holds is still drawn as cells there. If the meshes cannot load, everything is
drawn as voxels as before. `node tools/test_labware.js` checks the models against the simulation's geometry.

## Desktop app

`desktop/main.js` runs the unchanged web app in Electron, served from `app://` with the cross-origin isolation headers that shared memory
needs, so all CPU cores are used without the launcher. F11 or Settings toggles full screen; window size is remembered. Only one copy runs
at a time, and the window cannot navigate away from the game.

```
npm install            # once
npm start              # run the desktop app
npm run smoke          # launch, check isolation, WebGL2, ticking and saving, then quit
npm test               # quick tests; npm run test:full adds the simulation suites (several minutes)
npm run package:win    # Windows build in dist/
```

For Steam, see [STEAM.md](STEAM.md). For how the whole game fits together, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Known limits

* Equipment meshes cast no shadows into the chamber and are not refracted by the liquid around them.
* A carried beaker's contents only react once it is set down.
* Only upright footprints are checked against solids, so the top of a steeply tipped beaker can still pass through one.
* Glass is WALL: HF does not etch it, explosions do not break it, and it loses heat to the room quickly. A crucible does not melt, however hot it gets.
* Equipment is cleared when an experiment loads. Undo brings it back.
* Hand tools pass through glass and each other while carried, and a thermometer or dropper is hidden where it is under liquid.
* A power supply's rods have no polarity, so it cannot separate hydrogen from oxygen into two tubes.
* Glacial acetic acid on baking soda never pops a stopper. The reaction takes in heat, and pure acetic acid freezes at 17 °C, so it stalls
  after a little CO2. The vinegar on the reagent shelf pops one in about 500 ticks.

## Experiments

The ready-made experiments in `js/scenes.js` use this equipment wherever a real bench would: beakers, test tubes, crucibles and dishes set down
with `Lab.setDownNow` and filled cell by cell, hot plates and a stirrer, droppers held in clamps, a power supply and Geiger counters. Once loaded
they are ordinary equipment, so the player can pick them up, pour them or turn them off. Headless tests that do not load the lab get glass
shells and steel slabs of the same shape instead. The reactor, the breeding blanket and the lamp filaments have no bench equivalent, and no
equipment can make the Daniell cell's salt bridge yet, so these are still built from cells. `tools/test_experiments.js` checks that each experiment loads with its equipment set down.
