"""Builds src/data/provinces.json: first-level administrative areas (states, provinces, regions) for Africa and the
Middle East, simplified to about 3 km.

Sources (download the two files first, paths below):
  - Natural Earth 1:10m admin-1 states and provinces (public domain):
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
  - geoBoundaries (CC BY 4.0, https://www.geoboundaries.org) for the DR Congo's 26 current provinces, because Natural
    Earth still has the old 11:
    https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/COD/ADM1/geoBoundaries-COD-ADM1_simplified.geojson

Usage: python3 scripts/buildProvinces.py NE_ADMIN1.geojson COD_ADM1.geojson
"""
import json, re, sys

COUNTRIES = set("DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW EH SY IQ IR IL PS LB JO YE SA OM AE KW QA BH TR".split())
TOL = 0.03

def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        best, idx = 0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0: d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
            if d > best: best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]

def area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2

def rings_of(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out = []
    for poly in polys:
        r = poly[0]  # outer ring only; holes are not needed for shading
        s = dp([(x, y) for x, y in r], TOL)
        if len(s) >= 4 and area(s) > 0.004:
            out.append([[round(x, 2), round(y, 2)] for x, y in s])
    return out

ne = json.load(open(sys.argv[1]))["features"]
cod = json.load(open(sys.argv[2]))["features"]
out = []
for f in ne:
    cc = f["properties"].get("iso_a2")
    if cc not in COUNTRIES or cc == "CD": continue
    rings = rings_of(f["geometry"])
    if rings: out.append([cc, f["properties"]["name"], rings])
for f in cod:
    rings = rings_of(f["geometry"])
    if rings: out.append(["CD", f["properties"]["shapeName"], rings])
json.dump(out, open("src/data/provinces.json", "w"), separators=(",", ":"), ensure_ascii=False)
print(len(out), "areas")
