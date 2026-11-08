// A single rolling save kept in the browser's IndexedDB, so a crash, a lost graphics context or a closed window costs at most a minute of work.
// Stores a compressed blob made by SaveFile plus a little information for the "continue" prompt. Every failure here is quiet and only means no autosave.
var Autosave = (function () {
  var DB = "elemental", STORE = "saves", KEY = "auto";
  var A = {};
  function open() {
    return new Promise(function (ok, no) {
      if (typeof indexedDB === "undefined") return no(new Error("no IndexedDB"));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (ok, no) {
        var t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
        t.oncomplete = function () { db.close(); ok(req && req.result); };
        t.onabort = t.onerror = function () { db.close(); no(t.error); };
      });
    });
  }
  // info: { when, W, H, D, scene }
  A.put = function (blob, info) { return tx("readwrite", function (s) { return s.put({ blob: blob, info: info }, KEY); }); };
  A.get = function () { return tx("readonly", function (s) { return s.get(KEY); }).catch(function () { return null; }); };
  A.clear = function () { return tx("readwrite", function (s) { return s.delete(KEY); }).catch(function () { return null; }); };
  return A;
})();
