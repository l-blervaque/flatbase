#!/usr/bin/env python3
"""Build index.html — the GitHub Pages live demo.

Takes the atelier (db-viewer.html) and injects the example schema as
window.__BAKED_DATA__, which the loader picks up before cache/picker.
The result is the full viewer preloaded with the bookstore sample.

Usage: python3 tools/make-demo.py   (from the repo root)
Re-run after any db-viewer.html or tables.json.example change.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
viewer = (ROOT / "db-viewer.html").read_text()
data = json.loads((ROOT / "tables.json.example").read_text())

marker = "<body>"
if marker not in viewer:
    sys.exit("db-viewer.html: <body> tag not found")

inject = f"{marker}\n<script>window.__BAKED_DATA__ = {json.dumps(data)};</script>"
out = viewer.replace(marker, inject, 1)
out = out.replace("<title>", "<title>flatbase demo — ", 1)

(ROOT / "index.html").write_text(out)
print(f"index.html written ({len(out)} bytes)")
