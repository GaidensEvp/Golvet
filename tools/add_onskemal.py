"""Lägger önskemålsblocket (Trendspanaren) ovanpå den genererade sidan.

Användning: python3 tools/add_onskemal.py <index.html> <index.html>
Läser första filen och skriver den andra (får vara samma fil). Kör alltid EFTER
make_static.py, som skapar sidan på nytt varje dag. Avbryter med felkod om ett
ankare saknas eller om blocket redan finns.
"""
import os
import sys

src, dst = sys.argv[1], sys.argv[2]
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "onskemal")


def read(name):
    return open(os.path.join(here, name), encoding="utf-8").read()


def insert_before(text, anchor, block):
    if text.count(anchor) != 1:
        raise SystemExit("ankare hittades inte exakt en gång: " + anchor[:60].replace("\n", "\n"))
    return text.replace(anchor, block + anchor)


h = open(src, encoding="utf-8").read()
if 'id="wishForm"' in h:
    raise SystemExit("önskemålsblocket finns redan i sidan")
h = insert_before(h, "</style>\n\n<div class=\"wrap\">", read("onskemal.css"))
# efter lower-grid, innan Skrivbordsvyn stänger
h = insert_before(h, "  </div>\n\n\n  <div id=\"viewOrg\"", read("onskemal.html"))
h = insert_before(h, "</body></html>", read("onskemal.js"))

for needed in ('id="wishForm"', "formspree.io/f/", ".wish-grid"):
    if needed not in h:
        raise SystemExit("saknas efter injektion: " + needed)
open(dst, "w", encoding="utf-8", newline="\n").write(h)
print("ok", len(h))
