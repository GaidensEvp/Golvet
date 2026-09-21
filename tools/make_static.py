"""Bygger den öppna sidan (index.html) från den delade artefaktens HTML.

Användning: python3 tools/make_static.py <källa.html> <index.html>
Avbryter med felkod om mallen ändrats så att någon omvandling inte kan göras.
"""
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
h = open(src, encoding="utf-8").read()


def sub1(pattern, repl, text, flags=0):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit("mönster hittades inte: " + pattern[:70])
    return new


icon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
        "%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%88%3C/text%3E%3C/svg%3E")

h = sub1(r"<html>", '<html lang="sv">', h)
h = sub1(r"</head><body>\s*<title>Golvet EVP</title>",
         '<title>Golvet EVP</title>'
         '<meta name="description" content="AI-analysdesk som bevakar världsläget och föreslår idéer. Delad läsvy.">'
         '<link rel="icon" href="' + icon + '"></head><body>', h)
h = sub1(r'\s*<span class="status-pill" id="dbStatus">.*?</span></span>', "", h, re.S)
h = sub1(r'\s*<section class="panel">\s*<h3>Rekommendationshistorik</h3>.*?</section>', "", h, re.S)
h = sub1(r"(\.lower-grid\{ display:grid; grid-template-columns:)repeat\(3,1fr\)", r"\1repeat(2,1fr)", h)
h = sub1(r"  // ---------- DB-backed recommendation history.*?(?=  // ---------- tabs ----------)", "", h, re.S)

if "Golvet EVP" not in h:
    raise SystemExit("förväntade 'Golvet EVP' i mallen")
h = h.replace("Golvet EVP", "Golvet")

for forbidden in ("window.claude", "historyList", "dbStatus"):
    if forbidden in h:
        raise SystemExit("rest kvar efter omvandling: " + forbidden)
if "<title>Golvet</title>" not in h:
    raise SystemExit("titeln blev fel")

open(dst, "w", encoding="utf-8", newline="\n").write(h)
print("ok", len(h))
