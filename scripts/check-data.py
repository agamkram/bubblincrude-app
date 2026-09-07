#!/usr/bin/env python3
"""Mechanical honesty checks on the catalog.

Kind is curated, never guessed from the stream name or from API gravity.
A number on a record is never flagged unknown.

Usage:
    python3 scripts/check-data.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Curated Condensate ids. Adding a stream requires an explicit kind on the
# record *and* an update here — S() must not infer it from the name.
CONDENSATE_IDS = frozenset(
    [
        "algerian-condensate",
        "arun",
        "belanak",
        "bontang-condensate",
        "cochin-condensate",
        "condensate-blend",
        "coral-condensate",
        "culzean",
        "fort-saskatchewan-condensate",
        "gippsland-condensate",
        "gorgon-condensate",
        "ichthys",
        "murban-condensate",
        "northwest-shelf",
        "ormen-lange",
        "peace-condensate",
        "pembina-condensate",
        "qatar-condensate",
        "rangeland-condensate",
        "senipah",
        "snohvit",
        "south-pars",
        "southern-lights-diluent",
        "terengganu",
    ]
)

FLAG_FIELDS = (
    "api",
    "sulfur_wt",
    "ni_ppm",
    "v_ppm",
    "tan",
    "resid_wt",
    "resid_vol",
    "sara",
    "yields",
)

DUMP_JS = r"""
require("./data.js");
require("./sites.js");
const streams = CRUDE_DATA.streams.map((s) => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  flags: s.flags || {},
  api: s.api,
  sulfur_wt: s.sulfur_wt,
  ni_ppm: s.ni_ppm,
  v_ppm: s.v_ppm,
  tan: s.tan,
  resid_wt: s.resid_wt,
  resid_vol: s.resid_vol,
  sara: s.sara,
  yields: s.yields,
}));
const sites = SITES_DATA.sites.map((s) => ({
  id: s.id,
  flags: s.flags || {},
  api: s.api,
  sulfur_wt: s.sulfur_wt,
}));
process.stdout.write(
  JSON.stringify({
    kinds: CRUDE_DATA.kinds,
    streams,
    sites,
  })
);
"""


def load_catalog():
    proc = subprocess.run(
        ["node", "-e", DUMP_JS],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout)
        raise SystemExit("node failed to load data.js / sites.js")
    return json.loads(proc.stdout)


def fail(problems):
    for p in problems:
        print("FAIL  " + p)
    print("%d problem%s" % (len(problems), "" if len(problems) == 1 else "s"))
    raise SystemExit(1)


def present(v):
    return v is not None and v != ""


def flag_problems(label, rec, fields):
    out = []
    flags = rec.get("flags") or {}
    for k in fields:
        if present(rec.get(k)) and flags.get(k) == "unknown":
            out.append("%s %s: %s is present but flagged unknown" % (label, rec["id"], k))
    return out


def main():
    problems = []
    src = (ROOT / "data.js").read_text(encoding="utf-8")
    if "/condensate|diluent/" in src.replace(" ", ""):
        problems.append("data.js still infers kind from the stream name")

    data = load_catalog()
    kinds = set(data["kinds"])
    streams = data["streams"]
    tagged = {s["id"] for s in streams if s["kind"] == "Condensate"}

    if tagged != CONDENSATE_IDS:
        extra = sorted(tagged - CONDENSATE_IDS)
        missing = sorted(CONDENSATE_IDS - tagged)
        if extra:
            problems.append("unexpected Condensate kind: " + ", ".join(extra))
        if missing:
            problems.append("expected Condensate kind missing: " + ", ".join(missing))

    for s in streams:
        if s["kind"] not in kinds:
            problems.append("stream %s has unknown kind %r" % (s["id"], s["kind"]))
        problems.extend(flag_problems("stream", s, FLAG_FIELDS))

    for s in data["sites"]:
        problems.extend(flag_problems("site", s, ("api", "sulfur_wt")))

    if problems:
        fail(problems)

    print(
        "OK  %d streams, %d Condensate, %d sites — kinds curated, flags honest"
        % (len(streams), len(tagged), len(data["sites"]))
    )


if __name__ == "__main__":
    main()
