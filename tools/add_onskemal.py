"""Lägger önskemålsblocket (Trendspanaren) ovanpå den genererade sidan.

Användning: python3 tools/add_onskemal.py <index.html> <prototyp.html>
Läser index.html (utdata från make_static.py) och skriver en ny fil, så att den
dagliga sidan inte påverkas. Avbryter med felkod om ett ankare saknas.
"""
import os
import sys

src, dst = sys.argv[1], sys.argv[2]
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "onskemal")


def read(name):
    return open(os.path.join(here, name), encoding="utf-8").read()


def insert(text, anchor, block, before=True):
    if text.count(anchor) != 1:
        raise SystemExit("ankare hittades inte exakt en gång: " + anchor[:60].replace("\n", "\\n"))
    return text.replace(anchor, block + anchor if before else anchor + block)


h = open(src, encoding="utf-8").read()
h = insert(h, "</style>\n\n<div class=\"wrap\">", read("onskemal.css"))
# efter lower-grid, innan Skrivbordsvyn stänger
h = insert(h, "  </div>\n\n\n  <div id=\"viewOrg\"", read("onskemal.html"))
h = insert(h, "</body></html>", read("onskemal.js"))

for needed in ('id="wishForm"', "golvet_wish_votes", ".wish-grid"):
    if needed not in h:
        raise SystemExit("saknas efter injektion: " + needed)
open(dst, "w", encoding="utf-8", newline="\n").write(h)
print("ok", len(h))
