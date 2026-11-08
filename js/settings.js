// Player settings, kept in local storage. Each one has a default and a list of allowed values, so a stale or hand-edited entry cannot break the game.
// The dialog that shows them lives in ui.js; this file knows nothing about the page.
var Settings = (function () {
  var KEY = "elemental.settings";
  var DEFS = {
    quality: { def: "auto", allowed: ["auto", "high", "medium", "low"] },   // how the chamber's render resolution is chosen
    chamber: { def: "auto", allowed: ["auto", "64,48,64", "96,64,96", "128,80,128", "160,96,160", "224,128,224"] },   // size at launch
    uiScale: { def: 1, allowed: [0.85, 1, 1.15, 1.3, 1.5] },   // size of the panels and text; the chamber view is not scaled
    autosave: { def: true, allowed: [true, false] },
    room: { def: "lab", allowed: ["lab", "plain"] },   // the laboratory around the chamber, or the plain backdrop
    effects: { def: true, allowed: [true, false] },     // flashes, fizz and wisps where reactions happen
    favourites: { def: [], list: true }                 // material ids the player has starred
  };
  var QUALITY_SCALE = { high: 1, medium: 0.7, low: 0.45 };
  var S = {}, values = {}, listeners = [];
  function read(storage) {
    var saved = {};
    try { saved = JSON.parse(storage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
    Object.keys(DEFS).forEach(function (k) { values[k] = valid(k, saved[k]) ? saved[k] : DEFS[k].def; });
  }
  // A list setting holds up to 40 whole numbers. Whether each still names a material is up to whoever reads it.
  function valid(k, v) {
    if (DEFS[k].list) return Array.isArray(v) && v.length <= 40 && v.every(function (x) { return Number.isInteger(x) && x > 0 && x < 65536; });
    return DEFS[k].allowed.indexOf(v) >= 0;
  }
  var store = null;
  try { store = typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { store = null; }
  read(store || { getItem: function () { return null; } });

  S.get = function (k) { return values[k]; };
  S.allowed = function (k) { return DEFS[k].list ? null : DEFS[k].allowed.slice(); };
  // Refuses anything not on the list. Returns whether the value took.
  S.set = function (k, v) {
    if (!DEFS[k] || !valid(k, v)) return false;
    values[k] = v;
    try { if (store) store.setItem(KEY, JSON.stringify(values)); } catch (e) { /* the choice just will not persist */ }
    listeners.forEach(function (fn) { fn(k, v); });
    return true;
  };
  // Resets the options only. Favourites are the player's own collection, not a setting to lose by accident.
  S.reset = function () { Object.keys(DEFS).forEach(function (k) { if (!DEFS[k].list) S.set(k, DEFS[k].def); }); };
  S.onChange = function (fn) { listeners.push(fn); };
  // The fixed render scale for the chosen quality, or null when the game should adapt to the frame rate.
  S.renderScale = function () { return values.quality === "auto" ? null : QUALITY_SCALE[values.quality]; };
  S.useStorage = function (s) { store = s; read(s); };   // for tests
  return S;
})();
if (typeof module !== "undefined") module.exports = Settings;
