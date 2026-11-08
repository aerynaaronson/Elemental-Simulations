# Elemental Simulations: Steam Overhaul Roadmap

## Vision

Transform Elemental Simulations from a browser-based simulation prototype into a polished, immersive chemistry sandbox.

The game should combine the accessibility of a game like Universe Sandbox with the hands-on experimentation of a virtual chemistry laboratory.

The core promise:

> Explore chemistry by manipulating materials directly, watching reactions emerge, and learning through experimentation.

Target audiences:

- Players interested in science and sandbox games
- High-school students and educators
- Chemistry enthusiasts
- VR users interested in immersive experimentation

**Initial platform:** Windows PC through Steam.

**Initial pricing target:** approximately $2–5.

**VR:** planned as a major feature, but not required for the initial release.

---

## Status

*Last updated 8 November 2026. Phases are in section 8.*

| Phase | State | Still to do |
| --- | --- | --- |
| 0. Audit and foundation | Done | The baseline is not committed yet |
| 1. Desktop game shell | Nearly done | Run `npm run package:win` and test a real install; a Steamworks app is needed to upload |
| 2. Interaction overhaul | Done as a prototype | Playtesting by someone else |
| 3. Visual overhaul | Under way | Liquid and gas visualisation, new README pictures, a playtest of the camera, effects and gas burner |
| 4 to 7 | Not started | |

**Phase 0.** [Architecture, dependency maps, thread design, bottlenecks and migration plan](docs/ARCHITECTURE.md). `npm test` and `npm run test:full` run every headless suite.

**Phase 1.** Electron shell with full screen and window memory. Settings dialog. Save files with full validation, including equipment and all world settings. Automatic save with a "continue" prompt. Recovery from a lost graphics context. [Steam build pipeline](docs/STEAM.md), not yet used.

**Phase 2.** Twenty-one kinds of equipment on the [Lab API](docs/LAB.md): beaker, test tube, large beaker, crucible, evaporating dish, reagent bottle, hot plate, stirrer, chiller, gas burner, balance, thermometer, dropper, funnel, gas syringe, power supply, tongs, spark igniter, Geiger counter, bell jar with vacuum pump and condenser, and a stopper for any container. A low-pressure region in the simulation for the bell jar. A reagent shelf of solutions at stated strengths, which keep their strength through every transfer. Grabbing, pouring, dipping, setting down, sealing, filtering, weighing, heating, cooling, stirring, measuring, igniting, distilling, pumping out, gas collection and electrolysis, all through material operations. Carried objects stay out of solids. Everything is covered by undo and save files.

**Phase 3, so far.**

* **Laboratory:** the chamber stands on a black resin island bench in a tiled lab, with reagent shelves, ceiling lights and a window on the side the light comes from. It is traced in the same shaders as the chamber, so water reflects and refracts it, and it costs about 0.1 ms a frame. Settings can switch it off.
* **Camera:** the view glides rather than jumps. Arrow keys turn it, `+` and `−` zoom, `Home` resets it, and a middle double-click or Alt + double-click centres it on something. Zooming and panning stay inside the room.
* **Material browser:** favourites, starred from the data card or with `*`, stay first in the material bar between sessions. The compound list can be narrowed to acids, bases, salts, oxides, organics, alloys, gases or liquids.
* **Performance:** when nothing has changed for 2.5 seconds, the renderer stops drawing and leaves the last image on screen, which saves the GPU while paused.
* **Reaction effects:** reactions now leave a short sign of what they did. Gas forming in a liquid fizzes off its surface, gas given off into the air rises as a wisp, a precipitate sinks from the surface in its own colour, and heat that is not hot enough to glow shows as a flash. The simulation records each event in a shared ring and changes nothing else, so the same events can drive sound later. Settings can turn effects off, and they start off for players whose system asks for reduced motion.

**Correct behaviour before visuals** (section 1.5). Done on 7 November 2026:

* Every experiment's description is now a test. `tools/test_experiments.js` turns 81 claims in the 25 descriptions into checks, and passes on three random seeds.
* Five experiments did not match their text, and are fixed. Titration now turns pink. The blast furnace has a burner, and makes lime, slag and molten iron. The density column uses liquids that do not react with what falls in. The alkali metals and filament descriptions now say what really happens.
* Iron no longer rusts in argon or vacuum.
* The default chamber is now Large on machines with 8 or more cores. Busy scenes run at 24 to 30 ticks a second there, against 10 to 24 at Huge.

**The three experiments seen wrong in the README pictures** (7 November 2026):

* **Golden rain** no longer leaves a white ridge. A soluble product with no free slot in the reacting cells now joins the water beside them, where before it was put in the nearest air as a grain. The solutions are now at strengths water can hold (lead nitrate 1.6 M, iodide 3.2 M). At a full share, over eight times saturation, their surface crusted white as it dried.
* **Colour tests** drop reagent *solutions* into the pools, as a dropper does, instead of grains. Products filled every cell's second solute slot, so the grains never dissolved and lay white over the colours. Pools are at bench strength, 0.1 to 0.5 M.
* **Flame tests** use a new piece of equipment, the **gas burner**, which keeps a flame alight until it is turned off. Any flame that touches a flame-test metal, as the element, a salt or a solution, takes on its colour, so each burner shows its colour steadily for at least a minute. The old metal powders burned out in a few seconds.
* Along the way: a solution's colour now goes by molarity and by how strongly the solute absorbs, so real-strength solutions are tinted and a trace of thiocyanate complex shows blood red. A precipitate grows on a grain of itself nearby before taking a water cell, which halves the water a pool loses. Endothermic reactions in solution now scale their chill by the amount reacted, as heat given off already did. One iron(III) hydrolysis event had been chilling its cell to 73 K, and the iron pool froze in specks. Evaporation spreads a strong solution's solutes over the water beside it rather than crusting at once.

**Reaction heat by amount** (8 November 2026):

* Every reaction now gives out or takes in heat by how much actually reacted, as reactions in solution already did. Before, the leftover of a part-used cell took the full heat again each time it reacted. Glacial acetic acid poured on baking soda chilled cells to 69 K, and most of its CO₂ came out as dry ice.
* A reaction that takes in heat now draws it from the solids and liquids around it as well as from the reacting cells, because in reality it can only go as fast as heat flows in. Heat given out still stays where it is made, since that hot spot is what lets a reaction set light to its neighbours.
* Now the coldest cell is about 260 K, and the CO₂ is gas. The mixture still cools by about 30 K, which freezes glacial acetic acid (it melts at 17 °C) and stalls the reaction. The 0.8 M vinegar on the reagent shelf is unchanged. `tools/test_sim.js` checks both.

**Experiments on lab equipment** (8 November 2026):

* The stellar forge, boiler explosion and blast furnace are gone: they did not work well or did not look right. The boiler's pressure test stays in `tools/test_sim.js`, built in place.
* The other experiments now use the lab equipment wherever a real bench would, so the player can pick it up and use it: beakers, test tubes, crucibles and dishes, hot plates, a magnetic stirrer, droppers held in clamps, a power supply and Geiger counters. Discharge tubes are sealed glass tubes whose stopper never pops. The reactor, the breeding blanket, the lamp filaments and the Daniell cell (no salt bridge yet) are still built from cells.
* Titration now runs on a stirrer with a dropper of base, and shows a true end point. To make it work, an indicator now steps aside into the next cell when it stands between an acid and a base, which before never reacted. Left over base stays as pink flecks rather than tinting the whole beaker, because a water cell holds two solutes and salt plus indicator fill both.
* `tools/test_experiments.js` checks that each experiment loads with its equipment set down. Drops and container sizes grow with the chamber.

Still open, from the audit and longer-term: a third of the generated decomposition rules do not balance, and sealed gas builds little pressure. A precipitate forming away from any grain still takes a whole water cell (golden rain loses about 12% of its pool). Ammonia spreads through the copper pool faster than it reacts, so the copper complex shows as a faint blue tint rather than a royal-blue patch. Liquid fuels such as methanol evaporate rather than burn, so there is no spirit lamp yet. The flame and colour test pictures and a new golden rain picture still need taking with `npm run screenshots`.

---

## 1. Product design principles

### 1.1 Sandbox first

Players should be able to enter the simulation and immediately experiment.

Avoid requiring:

- Chemistry knowledge
- Tutorials before sandbox access
- Complicated configuration
- Understanding of simulation parameters

### 1.2 Scientific depth is optional

The simulation should remain approachable while allowing interested players to inspect:

- Chemical formulas
- Reaction equations
- Material properties
- Temperature and pressure
- Reaction outcomes
- Scientific explanations

### 1.3 Preserve the simulation engine

The existing chemistry, material database, and physics systems are the project’s greatest assets.

Do not rebuild them simply to support a new rendering engine.

### 1.4 Desktop and VR share the same world

VR should be another way of interacting with the simulation, not a separate simulation.

### 1.5 Simulation stability comes before visual complexity

Prioritize:

1. Correct simulation behavior
2. Reliable interaction
3. Performance
4. Visual polish
5. Additional features

---

## 2. Proposed engine architecture

### 2.1 High-level system diagram

```text
Player Input → Interaction Layer → World/Object Layer → Simulation Engine → Rendering
```

The simulation engine should remain independent of the game interface.

### 2.2 Layer responsibilities

#### A. Simulation Core

The existing chemistry and physics engine.

Responsibilities:

- Chemical reactions
- Material properties
- Temperature and heat transfer
- Phase transitions
- Fluid and gas behavior
- Pressure
- Structural mechanics
- Electricity
- Nuclear simulation
- Simulation time and tick progression

The core should not know about:

- VR controllers
- UI menus
- Steam achievements
- Graphics effects
- Player camera

#### B. Material Database

A unified database for elements, compounds, isotopes, and material properties.

Responsibilities:

- Material identification
- Chemical formulas
- Physical properties
- Reaction data
- Scientific metadata
- Source and confidence information

The database should remain separate from simulation logic.

#### C. World Simulation

Responsible for the simulated environment.

Responsibilities:

- Simulation volume
- Spatial coordinates
- Material placement
- Boundaries
- World regions
- Simulation state
- Object-to-world interaction

#### D. Object and Equipment System

A new layer for manipulable objects.

Examples:

- Beakers
- Bottles
- Crucibles
- Test tubes
- Containers
- Tools
- Heating equipment

Responsibilities:

- Object transforms
- Collision
- Grabbing
- Rotation
- Object movement
- Container boundaries
- Material transfer

#### E. Interaction System

A platform-independent interface between user input and the world.

Supported input sources:

- Mouse and keyboard
- Gamepad
- VR controllers
- Potential future hand tracking

Responsibilities:

- Grab
- Release
- Pour
- Scoop
- Place
- Heat
- Select
- Inspect

#### F. Rendering System

Responsible for displaying the world.

Responsibilities:

- Material rendering
- Lighting
- Shadows
- Transparent liquids
- Smoke
- Fire
- Particle effects
- Simulation visualization
- Desktop rendering
- Stereo VR rendering

#### G. Game and Presentation Layer

Responsibilities:

- Menus
- Material browser
- Tool selection
- Tutorials
- Discovery tracking
- Settings
- Save/load
- Steam integration
- Achievements
- User-facing scientific explanations

---

## 3. Simulation-to-game interaction

The existing voxel simulation and the new object system must coexist.

### Example: pouring water

1. Player grabs a bottle.
2. Interaction system tracks its transform.
3. Object system detects that the bottle is tilted.
4. Pouring logic determines the material transfer.
5. Simulation core receives the material at the correct world coordinates.
6. Chemistry and fluid simulation update.
7. Rendering displays the resulting interaction.

The simulation engine should receive material operations, not VR controller events.

### Recommended interaction API

Examples:

- `grabObject(objectId)`
- `releaseObject(objectId)`
- `moveObject(objectId, transform)`
- `transferMaterial(source, destination, quantity)`
- `placeMaterial(materialId, position, quantity)`
- `applyHeat(target, energy)`
- `applyForce(target, force)`

These are conceptual API examples, not instructions to implement them immediately.

The API should eventually be typed and documented.

---

## 4. Proposed technology strategy

### Initial recommendation: preserve the existing JavaScript simulation

The existing project already uses a JavaScript-based simulation and WebGL rendering architecture.

A full migration to Unity or Unreal would introduce substantial development risk.

Instead, initially investigate:

- TypeScript for stronger interfaces and maintainability
- Three.js or the existing WebGL renderer for presentation
- Electron for a Steam-distributed desktop application
- Native or platform-specific VR integration as a later milestone

Electron provides a Chromium-based desktop runtime, allowing the existing web application to become a desktop product.

Potential benefits:

- Preserve existing JavaScript code
- Reuse existing rendering
- Desktop window management
- Local file access
- Steam packaging
- Familiar development workflow

Potential drawbacks:

- Larger application footprint
- Chromium/WebGL performance considerations
- Native VR integration may be more complicated

### VR architecture decision

Before committing to the final VR implementation, build a small technical prototype comparing:

1. Existing JavaScript/WebGL architecture with WebXR
2. Native VR integration through an engine or runtime bridge

Do not commit to a full Unity/Godot migration until the prototype demonstrates that the current architecture cannot meet VR requirements.

If native VR becomes essential, evaluate Godot and Unity against the existing simulation engine rather than assuming the chemistry engine must be rewritten.

---

## 5. Rendering and visual design

### Primary objective

Make the simulation feel like a modern game rather than a scientific prototype.

### Visual priorities

1. Full-screen presentation
2. Attractive laboratory environment
3. Clear material appearance
4. Smooth camera controls
5. Responsive UI
6. Lighting and shadows
7. Liquid and gas visualization
8. Reaction effects
9. VR-friendly rendering

### Recommended approach

Start with a single high-quality laboratory environment.

Do not initially build:

- Multiple laboratories
- Procedural worlds
- Multiplayer
- Complex character models
- Elaborate progression systems

The first environment should contain:

- Workbench
- Material storage
- Several containers
- Heating equipment
- Material browser
- Simulation controls

A small, polished environment is more valuable than a large unfinished one.

---

## 6. Desktop interaction design

### Controls

#### Mouse and keyboard

- Click to select materials
- Drag to grab objects
- Hold to pour
- Rotate objects using mouse movement or keyboard
- Scroll to adjust quantity or zoom
- Keyboard shortcuts for common tools

### Material browser

The periodic table should become an expandable material browser.

Users should be able to:

- Search elements and compounds
- Filter by material category
- View material properties
- Add materials to inventory
- Favorite commonly used materials

### Tool system

Initial tools:

- Grabber
- Material dispenser
- Pouring tool
- Heater
- Cooler
- Cutter
- Inspector

Avoid adding too many tools until the interaction system is stable.

---

## 7. VR interaction design

VR should use the same world and simulation.

### Initial VR target

SteamVR-compatible PCVR.

Initial hardware testing:

- Valve Index
- Standard motion controllers

### VR controls

- Grab objects
- Two-handed manipulation
- Pour containers
- Place objects
- Operate laboratory equipment
- Inspect materials
- Open a wrist-mounted or world-space material browser

### VR comfort

- Seated mode
- Standing mode
- Adjustable movement
- Teleportation where appropriate
- Fixed laboratory workbench
- Minimal artificial camera movement
- Adjustable UI distance and scale

### VR performance target

Target stable headset refresh rates rather than maximizing visual effects.

For Index testing, prioritize maintaining the appropriate headset refresh rate under realistic simulation workloads.

VR should not launch until:

- Grabbing is reliable
- UI interaction is comfortable
- Simulation performance is stable
- The player can complete basic experiments without frustration

---

## 8. Development roadmap

### Phase 0: Repository audit and technical foundation

**Objective:** establish the existing engine’s capabilities and limitations.

Tasks:

- Map the current source architecture
- Identify simulation entry points
- Document worker communication
- Identify renderer dependencies
- Measure simulation performance
- Inventory existing UI functionality
- Establish automated regression tests
- Create a stable baseline branch

**Deliverable:** architecture documentation and a verified baseline.

### Phase 1: Desktop game shell

**Objective:** turn the existing simulation into a desktop game.

Tasks:

- Create desktop application shell
- Implement full-screen mode
- Add settings and window management
- Implement save/load
- Add Steam build pipeline
- Improve startup and loading
- Preserve existing simulation functionality

**Deliverable:** desktop build that launches and runs the existing simulation.

### Phase 2: Interaction overhaul

**Objective:** make the simulation feel tactile.

Tasks:

- Implement object grabbing
- Add container objects
- Implement material transfer
- Add pouring
- Add material placement
- Add heating and cooling tools
- Connect interactions to the simulation core

**Deliverable:** playable desktop laboratory prototype.

### Phase 3: Visual overhaul

**Objective:** establish the final visual direction.

Tasks:

- Build the laboratory environment
- Improve materials and lighting
- Implement camera controls
- Add reaction effects
- Improve liquid and gas visualization
- Redesign material browser
- Optimize performance

**Deliverable:** polished laboratory sandbox.

### Phase 4: Gameplay and education

**Objective:** make the sandbox approachable and replayable.

Tasks:

- Add guided experiments
- Add discovery tracking
- Add experiment presets
- Add contextual explanations
- Add scientific inspection tools
- Add optional challenges
- Add onboarding

**Deliverable:** Steam-ready gameplay experience.

### Phase 5: VR prototype

**Objective:** prove the interaction architecture in VR.

Tasks:

- Evaluate VR runtime options
- Implement controller tracking
- Implement object grabbing
- Implement pouring
- Implement VR UI
- Optimize rendering
- Test comfort and usability

**Deliverable:** functional VR laboratory prototype.

### Phase 6: Steam release

**Objective:** release a stable, affordable game.

Tasks:

- Finalize controls
- Improve onboarding
- Test save/load
- Optimize performance
- Prepare Steam assets
- Create store page
- Implement achievements if appropriate
- Conduct external playtesting
- Fix high-priority issues

**Deliverable:** first public Steam release.

### Phase 7: School playtesting

**Objective:** evaluate educational usability.

Tasks:

- Prepare educator-facing documentation
- Create guided experiment scenarios
- Test with local high-school students
- Gather teacher feedback
- Evaluate usability and accessibility
- Improve explanations and controls

**Deliverable:** validated educational sandbox with potential classroom applications.

---

## 9. Scope control

The first Steam release should NOT require:

- Full VR support
- Multiplayer
- Procedural laboratories
- Advanced campaign progression
- Complete scientific accuracy
- Every imaginable tool
- A full Unity/Unreal migration

The first release needs one compelling experience:

> A player enters a laboratory, selects materials, manipulates them, observes interesting reactions, and wants to keep experimenting.

Everything else should support that experience.

---

## 10. Claude Code development strategy

Claude Code should work through small, isolated implementation tasks.

### Rules for implementation

- Never replace the simulation engine wholesale.
- Inspect the relevant files before modifying them.
- Preserve existing functionality unless explicitly approved for removal.
- Establish tests before refactoring critical systems.
- Avoid mixing rendering, chemistry, and interaction changes in one task.
- Use feature branches or Git checkpoints.
- Keep the application runnable after each milestone.
- Benchmark performance before and after major changes.
- Document new APIs and architectural decisions.

### First Claude Code task

Do not start by building the VR laboratory.

Start by asking Claude Code to audit the repository and produce:

1. Current architecture map
2. Simulation engine dependency map
3. Rendering dependency map
4. Worker communication diagram
5. Current performance bottlenecks
6. Recommended refactoring boundaries
7. A migration plan that preserves existing behavior

Only after reviewing that audit should implementation begin.

---

## Success criteria

The project is ready for its first public release when:

- The desktop application launches reliably.
- The simulation is stable.
- Players can manipulate materials naturally.
- The interface is understandable without prior chemistry knowledge.
- Experiments are engaging.
- Performance is acceptable on mainstream gaming hardware.
- Scientific limitations are communicated appropriately.
- External playtesters can enjoy the game without developer assistance.

The long-term goal is an immersive chemistry sandbox that is simultaneously entertaining, educational, and technically extensible.
