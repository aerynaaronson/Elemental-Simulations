#!/usr/bin/env python
"""Builds js/elements.data.js from reference data.

Usage: python -I tools/gen_elements.py <merged.json> <out.js>

merged.json is the join of the Mendeleev element database (MIT, github.com/lmmentel/mendeleev)
and PubChem's periodic table (pubchem.ncbi.nlm.nih.gov/periodic-table). PubChem wins on melting
and boiling point, Mendeleev on everything else. Corrections below replace known errors or fill
gaps. Any value that is a prediction or a rule-of-thumb is listed in the row's `est` field so
the UI can mark it as estimated.
"""
import json, sys

src, out = sys.argv[1:3]
rows = json.load(open(src, encoding="utf8"))

# Literature values that fill gaps in the sources (CRC Handbook / WebElements).
K = {"Ne":0.0491,"P":0.236,"Ca":201,"Mn":7.81,"As":50.2,"Sr":35.4,"Y":17.2,"Mo":138,"I":0.449,"Ba":18.4,"Nd":16.5,
     "Sm":13.3,"Gd":10.6,"Ho":16.2,"Er":14.5,"Tm":16.9,"Yb":38.5,"Lu":16.4,"Os":87.6,"C":140}
K_EST = {"Po":20,"At":1.7,"Fr":15,"Ra":18.6,"Ac":12,"Th":54,"Pa":47,"Np":6.3,"Pu":6.74,"Am":10,"Cm":10,"Bk":10,"Cf":10}
HF = {"He":0.0138,"C":117,"N":0.72,"O":0.44,"Ne":0.335,"Ar":1.18,"As":24.44,"Kr":1.64,"Xe":2.27,"Pm":7.7,"Eu":9.21,
      "Gd":10.05,"Tb":10.15,"Dy":11.06,"Ho":17.0,"Er":19.9,"Tm":16.84,"Lu":22,"Rn":3.247,"Cm":14.6,"K":2.33}
HV = {"C":715,"N":5.57,"O":6.82,"Ru":591,"Pm":289,"Fr":65,"Cm":320,"K":76.9}
EN = {"Pm":1.13,"Eu":1.2,"Tb":1.1,"Yb":1.1,"Am":1.13,"Cm":1.28,"Bk":1.3,"Cf":1.3,"Es":1.3,"Fm":1.3,"Md":1.3,"No":1.3,"Lr":1.3,
      "Rn":2.2,"Kr":3.0}

# Predicted transition points and densities for elements nobody has made in bulk.
PREDICTED = {  # sym: (mp K, bp K, density g/cm3)
    "Es":(1133,1269,None),"Fm":(1800,None,9.7),"Md":(1100,None,10.3),"No":(1100,None,9.9),"Lr":(1900,None,15.6),
    "Rf":(2400,5800,17.0),"Db":(2900,5900,21.6),"Sg":(3100,6200,23.2),"Bh":(3200,6100,26.5),"Hs":(3400,5800,28.6),
    "Mt":(3100,5000,27.5),"Ds":(2800,4500,26.5),"Rg":(1800,3600,22.0),"Cn":(283,340,14.0),"Nh":(700,1430,16.0),
    "Fl":(200,210,11.4),"Mc":(670,1400,13.5),"Lv":(708,1085,12.9),"Ts":(723,883,7.2),"Og":(325,450,7.0),
    "At":(575,610,None),"Fr":(300,950,None),"Pa":(1845,4300,None),"Bk":(1323,2900,None),"Cf":(1173,1743,None),
    "Am":(1449,2880,None),
}
MP_FIX = {"He":None,"C":3915}   # helium does not freeze at 1 atm; carbon sublimes at 3915 K
BP_FIX = {"C":3915,"As":887}
DIATOMIC = {"H":2,"N":2,"O":2,"F":2,"Cl":2,"Br":2,"I":2,"P":4,"S":8,"Te":2,"Se":2,"As":4}
CATS = {"Nonmetal":"nonmetal","Noble gas":"noble","Alkali metal":"alkali","Alkaline earth metal":"alkaline","Metalloid":"metalloid",
        "Halogen":"halogen","Post-transition metal":"post","Transition metal":"transition","Lanthanide":"lanthanide","Actinide":"actinide"}
OX_FIX = {"He":[],"Ne":[],"Ar":[],"Kr":[2],"Rn":[2],"Db":[5],"Sg":[6],"Bh":[7],"Hs":[8],"Mt":[3],"Ds":[2],"Rg":[1],"Cn":[2],"Nh":[1],
          "Fl":[2],"Mc":[1],"Lv":[2],"Ts":[-1],"Og":[],"U":[6,4],"Fe":[3,2],"Cu":[2,1],"Au":[3,1],"Hg":[2,1],"Pb":[2,4],"Sn":[4,2],
          "Tl":[1,3],"Mn":[2,4,7],"Cr":[3,6],"Co":[2,3],"N":[-3,5,3],"Cl":[-1,1,5,7],"Br":[-1,1,5],"I":[-1,1,5,7],"Si":[4,-4],
          "Ce":[3,4],"Eu":[3,2],"Yb":[3,2],"Pd":[2,4],"Pt":[4,2],"Xe":[2,4,6],"W":[6,4],"Mo":[6,4],"Te":[4,-2,6],"Se":[4,-2,6],"S":[-2,4,6],
          "P":[-3,5,3],"As":[3,5,-3],"Sb":[3,5,-3],"Ge":[4,2],"Ir":[3,4],"Ru":[3,4],"Os":[4],"Re":[7,4],"Tc":[7,4],"Ti":[4],"V":[5]}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def pick_mode(longest):
    if not longest:
        return None
    best, best_i = None, -1
    for mode, _rel, inten in longest["modes"]:
        m = mode.encode("ascii", "ignore").decode()
        if m not in ("A", "B-", "B+", "EC", "SF", "e+", "2B-"):
            continue
        i = inten if inten is not None else 0
        if i > best_i:
            best, best_i = m, i
    return {"e+": "B+", "2B-": "B-"}.get(best, best)


res = []
for r in rows:
    s = r["sym"]
    est = []
    mp, bp = num(r["pcMp"]), num(r["pcBp"])
    dens = r["density"]
    if s in PREDICTED:
        pm, pb, pd = PREDICTED[s]
        if mp is None or r["z"] >= 99:
            mp = pm; est.append("mp")
        if bp is None or r["z"] >= 99:
            bp = pb; est.append("bp")
        if pd is not None and (dens is None or r["z"] >= 100):
            dens = pd; est.append("density")
    mp = MP_FIX.get(s, mp); bp = BP_FIX.get(s, bp)
    if bp is None and mp is not None:   # rough Guldberg rule for transactinides without any prediction
        bp = round(mp * 1.6); est.append("bp")
    mass = r["mass"] or num(r["pmass"])
    cp = r["cp"]
    if cp is None:
        cp = round(25.0 / mass, 4); est.append("cp")          # Dulong-Petit
    k = r["k"]
    if s in K:
        k = K[s]
    elif s in K_EST:
        k = K_EST[s]; est.append("k")
    elif k is None:
        k = 10; est.append("k")
    hf = HF.get(s, r["Hf"])
    if hf is None:
        hf = round(0.0092 * (mp or 1000), 2); est.append("hf")  # Richard's rule
    hv = HV.get(s, r["Hv"])
    if hv is None:
        hv = round(0.088 * (bp or 2000), 1); est.append("hv")   # Trouton's rule
    en = EN.get(s, r["en"])
    ox = OX_FIX.get(s, r["ox"])
    if not ox and r["block"] in ("f", "d") and r["z"] < 104:
        ox = [3]
    L = r["longest"]
    if L and L["hl"] and L["hl"] > 1e24:   # bismuth-209: formally unstable, effectively stable
        stableish = L["hl"]
    else:
        stableish = None
    res.append({
        "z": r["z"], "s": s, "n": r["name"], "m": round(mass, 4), "d": round(dens, 6) if dens else 5.0,
        "mp": mp, "bp": bp, "cp": cp, "k": k, "hf": hf, "hv": hv, "en": en, "ie": round(r["ie"], 3) if r["ie"] else None,
        "ea": round(r["ea"], 3) if r["ea"] else None, "ox": ox, "lat": r["lattice"], "conf": r["conf"],
        "cat": CATS.get(r["gc"], "unknown"), "grp": r["group"], "per": r["period"], "block": r["block"],
        "crust": r["crust"], "sea": r["sea"], "year": num(r["pcYear"]) if "pcYear" in r else num(r["pcyear"]),
        "r": r["rad"], "atoms": DIATOMIC.get(s, 1), "iso": r["mainIso"], "nStable": r["nStable"],
        "hl": None if (not L or stableish) else L["hl"], "hlA": L["A"] if L else None, "dm": None if (not L or stableish) else pick_mode(L),
        "hlNote": stableish, "est": est,
    })

with open(out, "w", encoding="utf8", newline="\n") as f:
    f.write("// Generated by tools/gen_elements.py. Do not edit by hand.\n")
    f.write("// Sources: Mendeleev element database, PubChem periodic table. `est` lists predicted or rule-of-thumb fields.\n")
    f.write("var ELEMENT_DATA = [\n")
    for row in res:
        f.write(json.dumps(row, separators=(",", ":"), ensure_ascii=True) + ",\n")
    f.write("];\n")

for row in res:
    if row["z"] >= 84 or row["mp"] is None or row["bp"] is None:
        print(row["z"], row["s"], row["cat"], "d", row["d"], "mp", row["mp"], "bp", row["bp"], row["dm"], row["hl"], row["ox"], row["est"])
print("unknown cats:", [r["s"] for r in res if r["cat"] == "unknown"])
