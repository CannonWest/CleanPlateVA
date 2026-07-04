"""Local dev server — serves the static site in public/ the way the
production host (Cloudflare Pages) does. Not used in deployment."""

from pathlib import Path

from flask import Flask

PUBLIC = Path(__file__).parent / "public"

app = Flask(__name__, static_folder=str(PUBLIC), static_url_path="")


@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
