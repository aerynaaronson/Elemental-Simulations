#!/usr/bin/env python
"""Compares hand-entered species data with PubChem. Usage: python -I tools/verify_species.py <species.json> <report.json>

species.json comes from tools/dump_species.js. Looks up each compound by name, checks that its molecular weight
matches the formula, and takes the median of PubChem's experimental melting point, boiling point and density.
PubChem's rate limit is 5 requests per second, so this stays under it and takes several minutes.
"""
import json, re, statistics, sys, time, urllib.parse, urllib.request

src, out = sys.argv[1:3]
species = json.load(open(src, encoding="utf8"))
BASE = "https://pubchem.ncbi.nlm.nih.gov/rest"
last = [0.0]


def get(url):
    wait = 0.25 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "ElementalSimulations-data-check"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception:
        return None


def strings(cid, heading):
    data = get(f"{BASE}/pug_view/data/compound/{cid}/JSON?heading={urllib.parse.quote(heading)}")
    found = []

    def walk(node):
        if isinstance(node, dict):
            if "StringWithMarkup" in node:
                found.extend(s.get("String", "") for s in node["StringWithMarkup"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    if data:
        walk(data)
    return found


NUM = r"(-?\d+(?:\.\d+)?)"


def temperature(text):
    t = text.replace("−", "-").replace("°", " deg ")
    if re.search(r"(mm ?Hg|torr|kPa|decompos|sublim|bar\b)", t, re.I):
        return None
    m = re.search(NUM + r"\s*(?:to\s*-?\d+(?:\.\d+)?\s*)?(?:deg\s*)?([CFK])\b", t)
    if not m:
        return None
    v, u = float(m.group(1)), m.group(2)
    return v + 273.15 if u == "C" else ((v - 32) / 1.8 + 273.15 if u == "F" else v)


def density(text):
    t = text.replace("−", "-")
    m = re.search(NUM + r"\s*(?:g/cm|g/cu|g/mL|g/ml|kg/L)", t) or re.search(r"(?:density|specific gravity)[^0-9]{0,30}" + NUM, t, re.I)
    if not m:
        return None
    v = float(m.group(1))
    return v if 0.05 < v < 30 else None


def median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 3) if values else None


report = []
for k, s in enumerate(species):
    row = dict(s)
    ids = get(f"{BASE}/pug/compound/name/{urllib.parse.quote(s['lookup'])}/cids/JSON")
    cid = ids["IdentifierList"]["CID"][0] if ids else None
    row["cid"] = cid
    if cid:
        props = get(f"{BASE}/pug/compound/cid/{cid}/property/MolecularFormula,MolecularWeight/JSON")
        if props:
            p = props["PropertyTable"]["Properties"][0]
            row["pcFormula"], row["pcMW"] = p.get("MolecularFormula"), float(p.get("MolecularWeight", 0))
        row["pcMp"] = median(temperature(x) for x in strings(cid, "Melting Point"))
        row["pcBp"] = median(temperature(x) for x in strings(cid, "Boiling Point"))
        row["pcRho"] = median(density(x) for x in strings(cid, "Density"))
    report.append(row)
    if k % 20 == 0:
        print(k, "of", len(species), flush=True)
        json.dump(report, open(out, "w", encoding="utf8"), indent=0)
json.dump(report, open(out, "w", encoding="utf8"), indent=0)
print("done", flush=True)
