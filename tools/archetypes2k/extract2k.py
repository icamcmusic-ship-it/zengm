# Extracts the NBA 2K build database (sheet Archetype_DB of the user's 2K archetype spreadsheet) into
# src/common/archetypes/twoK/builds2k.json, the input of src/common/archetypes/twoK/convert2k.script.test.ts.
# Usage: python3 -I tools/archetypes2k/extract2k.py path/to/spreadsheet.xlsx
# Needs openpyxl. Only the build rows are read (name, position, height range, the 21 rating ranges); the sheet's own
# translation tables are not used (they predate the expanded ratings): the converter builds its own from generated leagues.
import json
import re
import sys
from pathlib import Path

import openpyxl

STATS = [
    "Close Shot", "Driving Layup", "Driving Dunk", "Standing Dunk", "Post Control", "Midrange Shot",
    "Threepoint Shot", "Free Throw", "Pass Accuracy", "Ball Handle", "Speed With Ball", "Interior Defense",
    "Perimeter Defense", "Steal", "Block", "Offensive Rebound", "Defensive Rebound", "Speed", "Agility",
    "Strength", "Vertical",
]
POS = {"Point Guard": "PG", "Shooting Guard": "SG", "Small Forward": "SF", "Power Forward": "PF", "Center": "C"}


def rng(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return [float(v), float(v)]
    m = re.findall(r"\d+(?:\.\d+)?", str(v))
    if not m:
        return None
    xs = [float(x) for x in m]
    return [min(xs), max(xs)]


def inches(v):
    m = re.findall(r"(\d+)'\s*(\d+)\"", str(v))
    xs = [int(a) * 12 + int(b) for a, b in m]
    return [min(xs), max(xs)] if xs else None


def main(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Archetype_DB"]
    rows = list(ws.iter_rows(values_only=True))
    head = [str(h or "").replace(" ▲", "").strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(head)}
    out = []
    for r in rows[1:]:
        if not r or not r[0]:
            continue
        h = inches(r[col["Height"]])
        if not h:
            continue
        # In STATS order: [low, high] of the build's range (null when the sheet has none)
        stats = [rng(r[col[s]]) for s in STATS]
        stats = [[round(x) if float(x).is_integer() else x for x in v] if v else None for v in stats]
        out.append({"name": str(r[0]).strip(), "pos": POS[r[col["Position"]]], "in": h, "s": stats})
    dest = Path(__file__).resolve().parents[2] / "src/common/archetypes/twoK/builds2k.json"
    dest.write_text(json.dumps({"stats": STATS, "builds": out}, separators=(",", ":")) + "\n")
    print(f"{len(out)} builds -> {dest}")


if __name__ == "__main__":
    main(sys.argv[1])
