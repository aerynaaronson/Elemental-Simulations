# Building for Steam

The pipeline is ready to use, but nothing has been uploaded. It needs a Steamworks account and an app, which only the publisher can set up.

## You need

* A [Steamworks](https://partner.steamgames.com/) partner account and a paid app slot. This gives you an **App ID** and a **Depot ID**.
* [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD), from the Steamworks SDK, on PATH.
* A Steam account with build permission for the app. Valve recommends a separate one just for builds.

## Steps

```bash
npm install
```

```bash
npm test
```

```bash
npm run package:win
```

```bash
npm run steam:prepare -- --app <AppID> --depot <DepotID> --desc "0.1.0 test build"
```

`steam:prepare` makes no contact with Steam. It checks that the build:

* exists, and uses loose files rather than an `app.asar` archive, so patches stay small
* matches the current version and every source file in `js/`, so an old build cannot be shipped by accident
* contains no development files

It then writes `dist/steam/app_build_<AppID>.vdf` and `depot_build_<DepotID>.vdf`, and prints the upload command for you to run yourself:

```bash
steamcmd +login <your_build_account> +run_app_build "<path to app_build vdf>" +quit
```

Add `--branch beta` to `steam:prepare` to make the build go live on a beta branch when it uploads. Without it, the build only appears in Steamworks, and you choose where it goes. Steam does not let a script set the default branch live, so the public release is always a deliberate click on the site.

## Steamworks settings

* **Launch option:** `Elemental Simulations.exe`, operating system Windows.
* **Install folder:** `Elemental Simulations`.
* **Depot:** language-independent, Windows 64-bit.
* **Cloud saves:** not set up yet. Settings and the automatic save live in `%APPDATA%\Elemental Simulations`, and save files go wherever the player puts them. Steam Auto-Cloud would need a move to plain files, since IndexedDB is not a good fit for it.

## Not done yet

* The Steam overlay can be unreliable on Electron apps. Test it on a real install.
* No Steamworks SDK integration, so no achievements. These would need a native module such as `steamworks.js`. The roadmap treats achievements as optional for the first release.
* No Steam Deck testing.
* The package has no custom icon or installer artwork.
