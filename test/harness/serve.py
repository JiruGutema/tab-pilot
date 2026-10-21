"""Dev server for the harness: serves the project root, plus /__delay?ms=N which
responds after N ms (the harness uses it to hold the load event open so headless
screenshots capture scripted interactions)."""
import sys, time, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GIF = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def log_message(self, *a):
        pass
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/__delay":
            time.sleep(int(parse_qs(u.query).get("ms", ["500"])[0]) / 1000)
            self.send_response(200)
            self.send_header("Content-Type", "image/gif")
            self.end_headers()
            self.wfile.write(GIF)
            return
        super().do_GET()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"Serving {ROOT} on http://127.0.0.1:{port}/test/harness/popup.html")
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
