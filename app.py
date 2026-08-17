"""Local dev server — serves the static site in public/ the way the
production host (Cloudflare Workers static assets) does, including the
single-page-application fallback: a view path (/list, /about, /map, or
anything else without a file extension) gets index.html and the client
routes it. Not used in deployment.

Two optional environment variables point the two data channels at alternate
roots so the client can be exercised against a materialization that is not
the checkout's own (CPD-M2 QA against cannon-food's `--contract v4 --out`):

    CLEANPLATE_DATA_ROOT       serves /data/*       (default public/data)
    CLEANPLATE_DATA_FULL_ROOT  serves /data-full/*  (default public/data-full)
"""

import os
from pathlib import Path

from flask import Flask, abort, send_from_directory

PUBLIC = Path(__file__).parent / "public"
DATA_ROOTS = {
    "data": Path(os.environ.get("CLEANPLATE_DATA_ROOT") or PUBLIC / "data"),
    "data-full": Path(os.environ.get("CLEANPLATE_DATA_FULL_ROOT")
                      or PUBLIC / "data-full"),
}

# No Flask static route: every request goes through `site` below so the
# SPA fallback can decide between a file and index.html.
app = Flask(__name__, static_folder=None)
# Dev copy: working-tree edits appear on the next reload (browsers otherwise
# heuristically cache a JS module against its old mtime for hours).
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


@app.route("/", defaults={"subpath": ""})
@app.route("/<path:subpath>")
def site(subpath):
    channel, _, rest = subpath.partition("/")
    if channel in DATA_ROOTS and rest:
        # A data channel is files or nothing — never the SPA shell, exactly
        # like the production worker (a missing shard must 404, not parse as
        # markup; see the design ref §4).
        root = DATA_ROOTS[channel]
        if (root / rest).is_file():
            return send_from_directory(root, rest)
        abort(404)
    target = (PUBLIC / subpath) if subpath else None
    if target is not None and target.is_file():
        return send_from_directory(PUBLIC, subpath)
    last = subpath.rsplit("/", 1)[-1]
    if "." in last:
        abort(404)   # a missing asset stays a 404, not a phantom page
    return send_from_directory(PUBLIC, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5001")), debug=True)
