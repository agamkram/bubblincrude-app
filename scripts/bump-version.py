#!/usr/bin/env python3
"""Bump the app version everywhere at once.

The version lives in four files and they must agree. If they drift, the app
either self-heals in a loop or reports a version that is not what loaded —
which defeats the whole point of having a badge you can trust.

Usage:
    scripts/bump-version.py          # next version (v6 -> v7)
    scripts/bump-version.py 12       # set explicitly to v12
    scripts/bump-version.py --check  # verify agreement, change nothing
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
APP = ROOT / "app.js"
SW = ROOT / "sw.js"
CSS = ROOT / "styles.css"

# name -> (file, pattern with one capture group for the number, template)
SPOTS = {
    "index asset ?v=": (INDEX, r"\?v=(\d+)", "?v={n}"),
    "index badge text": (INDEX, r'(?<=id="app-version">)v(\d+)', "v{n}"),
    "index EXPECTED": (INDEX, r'var EXPECTED = "v(\d+)"', 'var EXPECTED = "v{n}"'),
    "app APP_VERSION": (APP, r'const APP_VERSION = "v(\d+)"', 'const APP_VERSION = "v{n}"'),
    "sw CACHE": (SW, r'const CACHE = "bubblincrude-v(\d+)"', 'const CACHE = "bubblincrude-v{n}"'),
    "sw precache ?v=": (SW, r"\?v=(\d+)", "?v={n}"),
    "css --bc-css": (CSS, r"--bc-css:\s*(\d+)", "--bc-css: {n}"),
}


def read(p):
    return p.read_text(encoding="utf-8")


def found(text, pattern):
    return [m.group(1) for m in re.finditer(pattern, text)]


def survey():
    """Return {spot: [versions found]} and a cache of file contents."""
    cache = {}
    result = {}
    for name, (path, pattern, _) in SPOTS.items():
        if path not in cache:
            cache[path] = read(path)
        hits = found(cache[path], pattern)
        result[name] = hits
    return result, cache


def report(survey_result):
    all_versions = set()
    problems = []
    for name, hits in survey_result.items():
        if not hits:
            problems.append("%s: no match found" % name)
            print("  %-18s MISSING" % name)
            continue
        uniq = sorted(set(hits))
        all_versions.update(uniq)
        flag = "" if len(uniq) == 1 else "  <-- inconsistent"
        print("  %-18s v%s (%d spot%s)%s" % (
            name, ",v".join(uniq), len(hits), "" if len(hits) == 1 else "s", flag))
        if len(uniq) > 1:
            problems.append("%s disagrees with itself: %s" % (name, uniq))
    if len(all_versions) > 1:
        problems.append("files disagree: found %s" % sorted(all_versions))
    return all_versions, problems


def main():
    args = [a for a in sys.argv[1:] if a]
    check_only = "--check" in args
    explicit = next((a for a in args if a.isdigit()), None)

    print("current:")
    result, cache = survey()
    versions, problems = report(result)

    if check_only:
        if problems:
            print("\nFAIL")
            for p in problems:
                print("  - " + p)
            sys.exit(1)
        print("\nOK — all in sync at v%s" % versions.pop())
        return

    if not versions:
        print("\nNothing found to bump. Aborting.", file=sys.stderr)
        sys.exit(1)

    if explicit:
        new = int(explicit)
    else:
        # Highest wins, so a drifted set converges upward instead of clobbering
        # the newest file with an older number.
        new = max(int(v) for v in versions) + 1

    for name, (path, pattern, template) in SPOTS.items():
        text = cache[path]
        # Replace only the captured number, preserving everything around it.
        def sub(m, tmpl=template):
            return tmpl.format(n=new)
        cache[path] = re.sub(pattern, sub, text)

    for path, text in cache.items():
        path.write_text(text, encoding="utf-8")

    print("\nbumped to v%d:" % new)
    after, problems2 = report(survey()[0])
    if problems2:
        print("\nFAIL — files still disagree")
        for p in problems2:
            print("  - " + p)
        sys.exit(1)
    print("\nOK — all in sync at v%d. Reload; badge should read v%d."
          % (new, new))


if __name__ == "__main__":
    main()
