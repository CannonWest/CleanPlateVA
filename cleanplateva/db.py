import os

COUCHDB_URL = os.environ.get("COUCHDB_URL", "http://127.0.0.1:5984")


def db_url(name):
    return f"{COUCHDB_URL}/{name}"
