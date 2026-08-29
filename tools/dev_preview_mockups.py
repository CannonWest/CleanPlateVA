"""No-cache static server for reviewing docs/mockups/ (CRD-M1).

Dev-only, like everything in tools/ — not part of the site. Serves the
mockups with Cache-Control: no-store so an edit shows on the next reload
(a bare http.server sends Last-Modified without Cache-Control and the
preview browser heuristically caches edited files for hours).

    python tools/dev_preview_mockups.py [port]   # default 5610
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = str(Path(__file__).resolve().parent.parent / "docs" / "mockups")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5610


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"mockups at http://127.0.0.1:{PORT}/  (serving {ROOT})")
    ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler).serve_forever()
