from flask import Blueprint, jsonify, render_template, request

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    return render_template("index.html")


# ── Read-only API over the inspection archive ────────────────────────────
#
# The data layer is not wired up yet — these endpoints serve the response
# shape the front-end expects, with `available: False` until a data source
# is configured.

@bp.route("/api/food/facilities", methods=["GET"])
def food_facilities():
    """The full mapped facility roster for the map view.

    No query params (beyond optional ?refresh=1 to bypass caching).
    Returns `{available, facilities: [...], counts, fetched_at}`.
    """
    return jsonify({"available": False, "reason": "no data source configured"}), 503


@bp.route("/api/food/facility", methods=["GET"])
def food_facility_detail():
    """One facility + its full inspection history.

    Query: ?permitID=<GUID> (required)
           &merge=<GUID,GUID,...> (optional — re-issued permit ids the roster
           merge folded into this marker; the server re-validates before
           unioning their histories).
    """
    permit_id = request.args.get("permitID", "").strip()
    if not permit_id:
        return jsonify({"available": False, "reason": "permitID required"}), 400
    return jsonify({"available": False, "reason": "no data source configured"}), 503
