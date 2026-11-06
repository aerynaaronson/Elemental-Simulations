#!/usr/bin/env python
"""Local server for Elemental Simulations. Run: python tools/serve.py [port] [--open]

Sends the cross-origin isolation headers that unlock SharedArrayBuffer, which the multi-threaded
engine needs, and disables caching so edits show up on reload.
"""
import functools, http.server, os, sys, threading, webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()

    def log_message(self, *args):
        pass


args = [a for a in sys.argv[1:] if not a.startswith("--")]
port = int(args[0]) if args else 8765
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=ROOT))
url = f"http://localhost:{port}/"
print(f"Elemental Simulations is running at {url}\nClose this window to stop it.", flush=True)
if "--open" in sys.argv:
    threading.Timer(0.3, webbrowser.open, [url]).start()
server.serve_forever()
