#!/usr/bin/env python3
"""Local SPA static server with History API fallback to index.html."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = (self.path or "/").split("?", 1)[0]
        if path != "/" and not Path(ROOT, path.lstrip("/")).exists():
            if not path.startswith("/api"):
                self.path = "/index.html"
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("BubblinCrude http://127.0.0.1:%s/" % PORT, flush=True)
    httpd.serve_forever()
