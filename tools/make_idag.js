#!/usr/bin/env node
/*
Bygger Golvets öppna förstasida (ny layout) från B-artefaktens HTML plus agenternas idag.json.

Användning:
  node tools/make_idag.js --b <golvet_b.html> --repo <REPO> [--idag <idag.json>] [--strict | --allow-missing] [--date ÅÅÅÅ-MM-DD]

  --strict         avbryt (exit 2) utan att skriva något om idag.json saknas eller är ofullständig
  --allow-missing  bygg ändå med automatiska reservlösningar (för test)

Skriver REPO/index.html och uppdaterar REPO/data/history.json. Trenden räknas ur kurshistorik från
Yahoo Finance; går det inte hoppas trendraderna över utan att bygget avbryts.
Exit: 0 = ok, 1 = fel i indata/bygge, 2 = idag.json underkänd i --strict.
*/
const fs = require('fs'), path = require('path'), https = require('https');

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].indexOf('--') === 0) { const k = args[i].slice(2); opt[k] = (args[i + 1] && args[i + 1].indexOf('--') !== 0) ? args[++i] : true; }
}
function fail(msg, code) { console.error('FEL: ' + msg); process.exit(code || 1); }
if ((!opt.b && !opt.pending) || !opt.repo) fail('Användning: node tools/make_idag.js --b <golvet_b.html> --repo <REPO> [--idag idag.json] [--strict|--allow-missing]');

const decode = s => String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const txt = s => decode(String(s == null ? '' : s).replace(/<\/?(?:b|i|em|strong|span|br|p|a|small|sup|sub|div|h[1-6]|li|ul)(?:\s[^>]*)?\/?>/gi, '')).replace(/\s+/g, ' ').trim();
const esc = s => txt(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => esc(s).replace(/"/g, '&quot;');

const GLOSS = [
  [/\bfed\b|fomc/i, 'Fed är USA:s centralbank. På mötet bestäms styrräntan, som påverkar lånekostnader och hur aktier värderas över hela världen.'],
  [/\becb\b/i, 'ECB är eurozonens centralbank. Räntebeskedet påverkar bland annat europeiska banker och bolag med mycket lån.'],
  [/bank of japan|\bboj\b/i, 'Japans centralbank. Besked om räntan kan flytta valutan yen och internationella investerares pengar.'],
  [/riksbank/i, 'Sveriges centralbank. Räntan styr bolåne- och företagslån och slår särskilt mot banker och fastighetsbolag.'],
  [/bank of england|\bboe\b/i, 'Storbritanniens centralbank. Räntebeskedet påverkar pundet och brittiska banker.'],
  [/opec/i, 'Oljeproducerande länder som bestämmer hur mycket olja som pumpas upp. Det styr oljepriset och därmed energibolag och industrins kostnader.'],
  [/mellanårsval|mellanval|midterm/i, 'Val i USA halvvägs in i presidentperioden. Utfallet avgör vem som styr kongressen, vilket kan påverka skatter, tullar och regleringar.'],
  [/arbetsmarknadsrapport|jobbrapport|nonfarm/i, 'Visar hur många jobb som tillkom i USA. Starka siffror kan göra att räntan hålls hög längre.'],
  [/inflation|\bkpi\b/i, 'Visar hur snabbt priserna stiger. Det styr centralbankernas räntebeslut.'],
  [/kapitalmarknadsdag/i, 'Bolaget går igenom mål och strategi för investerare. Brukar ge besked om framtida ambitioner.'],
  [/rapporterar|delårsrapport|kvartalsrapport|niomånaders|bokslut/i, 'Bolaget redovisar hur det gått. Aktien rör sig ofta kraftigt om siffrorna avviker från förväntningarna.'],
  [/börsnotering|\bipo\b/i, 'Ett bolag börjar handlas på börsen för första gången.']
];
const MON3 = { jan: 0, feb: 1, mar: 2, apr: 3, maj: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };
function isoFromD(d, pageIso) {
  const m = String(d).match(/(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+([A-Za-zåäöÅÄÖ]{3})/);
  if (!m) return null;
  const mon = MON3[m[3].toLowerCase()];
  if (mon === undefined) return null;
  const day = parseInt(m[2] || m[1], 10);
  const py = parseInt(pageIso.slice(0, 4), 10), pm = parseInt(pageIso.slice(5, 7), 10) - 1;
  let y = py;
  if (mon - pm > 6) y = py - 1; else if (pm - mon > 6) y = py + 1;
  return y + '-' + String(mon + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
/* samma händelse får samma nyckel även om formuleringen ändras: centralbanker m.fl. via ordlistan, annars första tecknen */
function evKey(iso, t) {
  const idx = []; GLOSS.forEach((g, i) => { if (i <= 8 && g[0].test(t)) idx.push(i); });
  return iso + '|' + (idx.length ? 'k' + idx.join('.') : txt(t).toLowerCase().replace(/[^a-zåäö0-9]+/g, ' ').trim().slice(0, 28));
}
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } };

/* --pending: lista händelser som inträffat de senaste dagarna och saknar utfall (för agenterna) */
if (opt.pending) {
  const pd = (typeof opt.date === 'string' && opt.date) || new Date().toISOString().slice(0, 10);
  const ev = readJson(path.join(opt.repo, 'data', 'events.json'), { events: [] }).events || [];
  const af = readJson(path.join(opt.repo, 'data', 'after.json'), { items: [] }).items || [];
  const done = {}; af.forEach(a => { done[a.key] = 1; });
  const list = ev.filter(e => e.iso < pd && e.iso >= addDays(pd, -3) && !done[evKey(e.iso, e.t)]).map(e => ({ d: e.d, t: e.t, tickers: e.tickers || [] }));
  console.log(JSON.stringify(list, null, 1));
  process.exit(0);
}
const cfg = readJson(path.join(opt.repo, 'tools', 'config.json'), {});
const gcCode = /^[a-z0-9-]{2,40}$/.test(String(cfg.goatcounter || '')) ? cfg.goatcounter : '';

const B = fs.readFileSync(opt.b, 'utf8');
function evalArr(re, name) {
  const m = B.match(re);
  if (!m) fail('hittar inte ' + name + ' i B-filen');
  try { return (new Function('return ' + m[1]))(); } catch (e) { fail('kunde inte tolka ' + name + ': ' + e.message); }
}
const candidates = evalArr(/var candidates = (\[[\s\S]*?\n  \]);/, 'candidates');
const radar = evalArr(/var trendRadar = (\[[\s\S]*?\n  \]);/, 'trendRadar');
const feat = (B.match(/<section class="news-feature">([\s\S]*?)<\/section>/) || [, ''])[1];
const leadB = txt((feat.match(/news-feature-headline">([\s\S]*?)<\/h2>/) || [, ''])[1]);
const calB = txt((feat.match(/news-feature-calendar">([\s\S]*?)<\/p>/) || [, ''])[1]).replace(/^Kalender kommande 14 dagar:\s*/i, '');
const footerRaw = txt((B.match(/<footer>\s*<p>([\s\S]*?)<\/p>/) || [, ''])[1]);
if (!candidates.length) fail('inga candidates i B');

let idag = null;
if (opt.idag) {
  try { idag = JSON.parse(fs.readFileSync(opt.idag, 'utf8')); } catch (e) { if (opt.strict) fail('idag.json saknas eller är trasig: ' + e.message, 2); console.warn('WARN: idag.json kunde inte läsas, använder reservlösningar'); }
} else if (opt.strict) fail('--strict kräver --idag', 2);

const date = (idag && idag.date) || opt.date || new Date().toISOString().slice(0, 10);
const WD = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const MO = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const dt = new Date(date + 'T12:00:00Z');
const dateLabel = WD[dt.getUTCDay()].charAt(0).toUpperCase() + WD[dt.getUTCDay()].slice(1) + ' ' + dt.getUTCDate() + ' ' + MO[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
const dow = dt.getUTCDay();
const dayLabel = (dow === 1 || dow === 0 || dow === 6) ? 'Fredagens handel' : 'Gårdagens handel';

/* ---------- validering ---------- */
const errors = [], warns = [];
const tickers = candidates.map(c => c.ticker);
function fallbackHeadline(k) {
  const up = /^\+/.test(k.changePct), n = String(k.changePct || '').replace(/[+\-−%\s]/g, '');
  return txt(k.company) + (up ? ' steg ' : ' föll ') + n + ' procent';
}
function fallbackWhy(k) {
  let s = txt(k.thesis).replace(/^.*?\(dagsintervall[^)]*\)[,]?\s*/i, '').replace(/^och\s+/i, '').replace(/\bdärmed\s/, '');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  s = s.split(/\.\s/)[0];
  if (s.length > 140) { s = s.slice(0, 140); s = s.slice(0, s.lastIndexOf(' ')) + '…'; }
  return s.replace(/[.]$/, '') + '.';
}
const cardsIn = (idag && idag.cards) || {};
let groups = (idag && Array.isArray(idag.groups)) ? idag.groups : [];
if (!idag) errors.push('idag.json saknas');
else {
  if (!idag.date) errors.push('date saknas');
  if (!groups.length) errors.push('groups saknas');
  if (!Array.isArray(idag.glance) || idag.glance.length < 2) errors.push('glance ska ha minst 2 rader');
  if (!Array.isArray(idag.calendar) || !idag.calendar.length) errors.push('calendar saknas');
  const seen = {};
  groups.forEach(g => { if (!g.t || !g.s || !Array.isArray(g.tickers)) errors.push('grupp saknar t/s/tickers'); (g.tickers || []).forEach(t => { if (tickers.indexOf(t) < 0) errors.push('grupp nämner okänd ticker ' + t); seen[t] = (seen[t] || 0) + 1; }); });
  tickers.forEach(t => { if (!seen[t]) errors.push('ticker ' + t + ' finns i ingen grupp'); else if (seen[t] > 1) errors.push('ticker ' + t + ' finns i flera grupper'); });
  tickers.forEach(t => {
    const c = cardsIn[t];
    if (!c) { errors.push('cards saknar ' + t); return; }
    if (!c.h || c.h.length > 75) errors.push(t + ': h saknas eller är längre än 75 tecken');
    if (!c.w || c.w.length > 150) errors.push(t + ': w saknas eller är längre än 150 tecken');
  });
  if (idag.after !== undefined && !Array.isArray(idag.after)) errors.push('after ska vara en lista');
  (Array.isArray(idag.after) ? idag.after : []).forEach(a => { if (!a.d || !a.t || !a.s) errors.push('after-rad saknar d/t/s'); else { if (!isoFromD(a.d, date)) errors.push('after-rad ' + a.d + ': datumet kan inte tolkas'); if (String(a.s).length > 450) errors.push('after-rad ' + a.d + ': s är längre än 450 tecken'); } });
  if (idag.wish && (!idag.wish.by || !idag.wish.q || !idag.wish.a)) errors.push('wish saknar by/q/a');
  (idag.calendar || []).forEach(e => { if (!e.d || !e.t) errors.push('calendar-rad saknar d/t'); if (e.x && String(e.x).length > 240) errors.push('calendar-rad ' + e.d + ': x är längre än 240 tecken'); (e.tickers || []).forEach(t => { if (tickers.indexOf(t) < 0) errors.push('calendar nämner okänd ticker ' + t); }); });
}
errors.forEach(e => console.warn('VALIDERING: ' + e));
if (errors.length && opt.strict) fail('idag.json underkänd (' + errors.length + ' fel), inget skrevs', 2);
if (errors.length && !opt['allow-missing'] && !opt.strict) console.warn('WARN: bygger med reservlösningar för det som saknas');

if (!groups.length || errors.some(e => /groups|ingen grupp|flera grupper/.test(e))) {
  const by = { pos: [], neg: [], blandad: [] };
  candidates.forEach(c => (by[c.impact] || by.blandad).push(c.ticker));
  groups = [['pos', 'Gynnas', 'Bolag där dagens utveckling är tydligt gynnsam.'], ['neg', 'Drabbas', 'Bolag där dagens utveckling är tydligt ogynnsam.'], ['blandad', 'Delad bild', 'Bolag där bilden är splittrad.']]
    .filter(g => by[g[0]].length).map(g => ({ t: g[1], s: g[2], tickers: by[g[0]] }));
}
const meta = t => {
  const k = candidates.find(c => c.ticker === t), c = cardsIn[t] || {};
  return { h: c.h || fallbackHeadline(k), w: c.w || fallbackWhy(k), ana: c.ana || '', bull: c.bull || '', bear: c.bear || '', world: c.world || '' };
};

/* ---------- historik (Ny idag / Dag N i rad) ---------- */
const histPath = path.join(opt.repo, 'data', 'history.json');
let hist = { days: [] };
try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch (e) { console.warn('WARN: ingen historik än'); }
const prev = (hist.days || []).filter(d => d.d < date).sort((a, b) => b.d.localeCompare(a.d));
const streakOf = t => { let n = 1; for (let i = 0; i < prev.length; i++) { if (prev[i].t.indexOf(t) > -1) n++; else break; } return n; };
const noNews = k => /(ingen|utan)( någon)?( ny| egen)?( bolagsspecifik)?( ny)? nyhet/i.test(txt(k.thesis));

/* ---------- trend ur kurshistorik ---------- */
function ysym(c) {
  if (c.ysym) return c.ysym;
  const ex = c.exch || '', t = c.ticker;
  if (/Stockholm/i.test(ex)) return t + '.ST';
  if (/Köpenhamn|Copenhagen/i.test(ex)) return t + '.CO';
  if (/Helsingfors|Helsinki/i.test(ex)) return t + '.HE';
  if (/Oslo/i.test(ex)) return t + '.OL';
  if (/Frankfurt|Xetra/i.test(ex)) return t + '.DE';
  return t;
}
function getJSON(url) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, res => {
      let d = ''; res.on('data', x => d += x); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
const sma = (a, n) => a.length >= n ? a.slice(-n).reduce((x, y) => x + y, 0) / n : null;
async function trendFor(c) {
  const j = await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym(c)) + '?range=1y&interval=1d');
  try {
    const r = j.chart.result[0], ts = r.timestamp, cl = r.indicators.quote[0].close;
    const cs = [];
    for (let i = 0; i < ts.length; i++) if (cl[i] != null && new Date(ts[i] * 1000).toISOString().slice(0, 10) < date) cs.push(cl[i]);
    if (cs.length < 200) return null;
    const last = cs[cs.length - 1], s50 = sma(cs, 50), s200 = sma(cs, 200), hi = Math.max.apply(null, cs);
    const r3 = last / cs[cs.length - 64] - 1;
    const lab = last > s50 && last > s200 ? 'up' : (last < s50 && last < s200 ? 'down' : 'mid');
    return { lab, last, s50, s200, r3: r3 * 100, fromHi: (last / hi - 1) * 100 };
  } catch (e) { return null; }
}

const labTxt = { up: 'Trend uppåt', down: 'Trend nedåt', mid: 'Trend blandad' };
const arrow = {
  up: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>',
  mid: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 12h14"/></svg>'
};
const fm = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1).replace('.', ',') + ' %';
const fnum = n => n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mv = s => String(s || '').replace('-', '−').replace('%', ' %');

/* ---------- sidan ---------- */
const nameOf = t => esc((candidates.find(x => x.ticker === t) || {}).company || t);
const qt = '<span class="qt">Ingen kommentar idag.</span>';
const ag = (label, body) => '<div class="ag"><span class="al">' + label + '</span><span class="at">' + body + '</span></div>';

function row(k, T) {
  const m = meta(k.ticker), streak = streakOf(k.ticker), up = /^\+/.test(k.changePct), cls = up ? 'up' : 'down';
  const tags = [streak === 1 ? '<span class="tag new">Ny idag</span>' : '<span class="tag">Dag ' + streak + ' i rad</span>'];
  if (noNews(k)) tags.push('<span class="tag quiet">Ingen egen nyhet</span>');
  if (k.wish && k.wish.by) tags.push('<span class="tag wish">Önskat av ' + esc(k.wish.by) + '</span>');
  const trendLine = T ? '<div class="trend"><span class="tl ' + T.lab + '">' + arrow[T.lab] + labTxt[T.lab] + '</span><span class="tm">3 mån ' + fm(T.r3) + ' · ' + Math.abs(T.fromHi).toFixed(1).replace('.', ',') + ' % under 1-årstoppen</span></div>' : '';
  const sent = k.sentiment ? esc(k.sentiment.label) + '. ' + esc(k.sentiment.note) : '';
  const risk = m.bull || m.bear ? '<b>Bull:</b> ' + esc(m.bull) + ' <b>Bear:</b> ' + esc(m.bear) : (k.risk ? '<b>Risk:</b> ' + esc(k.risk) : '');
  const det = ['<div class="agents">' + ag('Bolag och analytiker', m.ana ? esc(m.ana) : qt) + ag('Sentiment', sent || qt) + ag('Riskgranskare', risk || qt) +
    ag('Omvärld', m.world ? esc(m.world) : '<span class="qt">Inget känt i dagens underlag.</span>') + '</div>',
    '<p><b>Så rörde sig aktien.</b> ' + esc(k.thesis) + '</p>'];
  if (T) det.push('<p><b>Trend.</b> Pris ' + fnum(T.last) + ', 50-dagars medelvärde ' + fnum(T.s50) + ', 200-dagars ' + fnum(T.s200) + '. Över båda räknas som uppåt, under båda som nedåt. Det beskriver hur kursen betett sig, inte en prognos.</p>');
  det.push('<p class="src">Påverkan: ' + esc(k.impactLabel) + '. ' + esc(k.src) + '</p>');
  return '<li class="row" id="c-' + attr(k.ticker) + '" data-t="' + attr(k.ticker) + '" data-mv="' + attr(mv(k.changePct)) + '" data-co="' + attr(k.company) + '">' +
    '<div class="num"><span class="tick">' + esc(k.ticker) + '</span><span class="move ' + cls + '">' + esc(mv(k.changePct)) + '</span></div>' +
    '<div class="body"><h3>' + esc(m.h) + '</h3>' + (m.w ? '<p class="why">' + esc(m.w) + '</p>' : '') + trendLine +
    '<div class="tags">' + tags.join('') + '<button class="follow" type="button" aria-pressed="false" aria-label="Följ ' + attr(k.company) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" stroke-width="1.6" stroke-linejoin="round"/></svg><span>Följ</span></button></div>' +
    '<details><summary>Vad säger agenterna om ' + esc(k.company) + '</summary><div class="det">' + det.join('') + '</div></details></div></li>';
}

function readTool(name) { try { return fs.readFileSync(path.join(opt.repo, 'tools', 'onskemal', name), 'utf8'); } catch (e) { console.warn('WARN: saknar tools/onskemal/' + name); return ''; } }

const css = String.raw`
:root{
  --paper:#ECEADB; --surface:#F6F4EA; --ink:#1B2420; --ink-soft:#4E5B4C; --ink-faint:#6F7A69; --line:#D5D3BD;
  --desk:#1F2E28; --desk-ink:#ECE8D6; --glance:#D9B65F;
  --brass:#7A5A14; --brass-soft:#E7D6A6; --up:#2B7547; --down:#B23A32;
  --f-display:'Fraunces', Georgia, serif; --f-body:'Work Sans', system-ui, sans-serif; --f-mono:'IBM Plex Mono', ui-monospace, monospace;
  --font-display:var(--f-display); --font-body:var(--f-body); --font-mono:var(--f-mono);
  --brass-strong:var(--brass); --radius-s:6px; --paper-2:var(--surface);
  color-scheme:light;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --paper:#13160E; --surface:#1A1E14; --ink:#E7E4D2; --ink-soft:#AEB39C; --ink-faint:#8D9380; --line:#2B3024;
  --desk:#222E26; --desk-ink:#EFEBD8; --brass:#D9A53F; --brass-soft:#3B2E14; --up:#4CAF6E; --down:#E2645F; color-scheme:dark; } }
:root[data-theme="dark"]{
  --paper:#13160E; --surface:#1A1E14; --ink:#E7E4D2; --ink-soft:#AEB39C; --ink-faint:#8D9380; --line:#2B3024;
  --desk:#222E26; --desk-ink:#EFEBD8; --brass:#D9A53F; --brass-soft:#3B2E14; --up:#4CAF6E; --down:#E2645F; color-scheme:dark; }
*{box-sizing:border-box}
html{text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--f-body);font-size:15px;line-height:1.5}
.page{max-width:760px;margin:0 auto;padding-inline:20px;padding-block:22px 56px}
h1,h2,h3,p,ul{margin:0}
ul{padding:0;list-style:none}
.mast{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--ink)}
.word{font-family:var(--f-display);font-weight:600;font-size:30px;letter-spacing:-.01em}
.date{font-family:var(--f-mono);font-size:12px;color:var(--ink-soft);letter-spacing:.04em}
.edition{display:flex;gap:16px;flex-wrap:wrap;padding-block:10px 0;font-family:var(--f-mono);font-size:11.5px;color:var(--ink-soft);letter-spacing:.03em;text-transform:uppercase}
.edition b{color:var(--brass);font-weight:600}
.lead{padding-block:26px 18px}
.eyebrow{font-family:var(--f-mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--brass);margin-bottom:10px}
h1{font-family:var(--f-display);font-weight:600;font-size:clamp(25px,6.4vw,35px);line-height:1.15;text-wrap:balance}
.glance{background:var(--desk);color:var(--desk-ink);border-radius:12px;padding:6px 20px;margin-block:4px 0}
.g{display:grid;grid-template-columns:116px 1fr;gap:14px;padding-block:14px;border-top:1px solid rgba(236,232,214,.14)}
.g:first-child{border-top:none}
.gl{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--glance);padding-top:3px}
.gt{font-size:15px;line-height:1.5}
.mine{margin-block:14px 0;padding:10px 14px;border:1px dashed var(--line);border-radius:8px;font-size:13px;color:var(--ink-soft)}
.mine .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.chip{display:inline-flex;gap:8px;align-items:baseline;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-family:var(--f-mono);font-size:12px}
.chip .up{color:var(--up)}.chip .down{color:var(--down)}
.group{padding-block:30px 0}
h2{font-family:var(--f-display);font-weight:600;font-size:22px;line-height:1.2;text-wrap:balance}
.gsum{font-size:14px;color:var(--ink-soft);margin-top:4px;max-width:62ch}
.rows{margin-top:10px}
.row{display:grid;grid-template-columns:78px 1fr;gap:14px;padding-block:16px;border-top:1px solid var(--line);scroll-margin-top:16px}
.num{display:flex;flex-direction:column;gap:2px}
.tick{font-family:var(--f-mono);font-size:11px;color:var(--ink-faint);letter-spacing:.04em}
.move{font-family:var(--f-mono);font-weight:600;font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap}
.move.up{color:var(--up)}.move.down{color:var(--down)}
h3{font-family:var(--f-display);font-weight:500;font-size:18px;line-height:1.28;text-wrap:balance}
.why{font-size:14px;color:var(--ink-soft);margin-top:4px}
.trend{display:flex;flex-wrap:wrap;gap:3px 10px;align-items:center;margin-top:8px}
.tl{display:inline-flex;gap:4px;align-items:center;font-family:var(--f-mono);font-size:11.5px;font-weight:600;letter-spacing:.02em}
.tl svg{fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.tl.up{color:var(--up)}.tl.down{color:var(--down)}.tl.mid{color:var(--ink-soft)}
.tm{font-size:12.5px;color:var(--ink-faint)}
.tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:9px}
.tag{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.03em;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink-soft) 12%,transparent);color:var(--ink-soft)}
.tag.new{background:var(--brass-soft);color:var(--brass)}
.tag.quiet{background:transparent;border:1px solid var(--line)}
.tag.wish{background:var(--brass);color:var(--paper)}
.follow{margin-left:auto;display:inline-flex;gap:5px;align-items:center;background:none;border:1px solid var(--line);border-radius:999px;padding:3px 10px 3px 8px;font:inherit;font-size:12px;color:var(--ink-soft);cursor:pointer}
.follow svg{fill:none;stroke:currentColor}
.follow{min-height:34px}
.follow[aria-pressed="true"]{color:var(--paper);background:var(--brass);border-color:var(--brass);font-weight:600}
.follow[aria-pressed="true"] svg{fill:currentColor}
.chip.away{color:var(--ink-faint);font-family:var(--f-body)}
.mine .note{display:block;margin-top:8px;font-size:12px;color:var(--ink-faint)}
.toast{position:fixed;left:50%;bottom:20px;transform:translate(-50%,16px);max-width:min(92vw,440px);display:flex;gap:14px;align-items:center;padding:10px 14px;border-radius:10px;background:var(--desk);color:var(--desk-ink);font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;z-index:50}
.toast.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.toast button{background:none;border:0;padding:4px 2px;font:inherit;font-weight:600;color:var(--glance);cursor:pointer;text-decoration:underline;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.toast{transition:none}}
.follow:hover{border-color:var(--ink-faint)}
:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
details{margin-top:8px}
summary{cursor:pointer;font-size:13px;color:var(--ink-soft);list-style:none;display:inline-block;padding-block:2px}
summary::-webkit-details-marker{display:none}
summary::after{content:" \203A"}
details[open] summary::after{content:" \2039"}
.det{margin-top:8px;padding:12px 14px;background:var(--surface);border-radius:8px;display:flex;flex-direction:column;gap:10px;font-size:13.5px}
.det b{color:var(--ink)}
.src{font-family:var(--f-mono);font-size:11px;color:var(--ink-faint)}
.agents{display:flex;flex-direction:column;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.ag{display:grid;grid-template-columns:96px 1fr;gap:12px}
.al{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--brass);padding-top:3px}
.qt{color:var(--ink-faint);font-style:italic}
.week{padding-block:34px 0}
.cal{margin-top:10px}
.cal li{display:grid;grid-template-columns:92px 1fr;gap:12px;padding-block:10px;border-top:1px solid var(--line);font-size:14px}
.cd{font-family:var(--f-mono);font-size:12px;color:var(--brass);padding-top:2px}
.cx.out{color:var(--ink);font-size:14px;margin-top:5px}
.cx{margin:3px 0 0;color:var(--ink-soft);font-size:13px;line-height:1.45}
.berors{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font-size:12.5px;color:var(--ink-soft)}
.chip2{text-decoration:none;color:var(--ink);padding:2px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:12.5px}
.chip2:hover{border-color:var(--brass)}
.legend{font-size:12.5px;color:var(--ink-faint);margin-top:12px;max-width:70ch}
.wishnow{padding-block:34px 0}
.wishnow .wa{margin-top:10px;font-size:15px;line-height:1.6;max-width:62ch}
.back{margin-top:34px;border-top:1px solid var(--line);padding-top:6px}
.back summary{font-family:var(--f-mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;padding-block:12px}
.lens{display:flex;flex-direction:column;gap:10px;margin-top:6px;font-size:13.5px;color:var(--ink-soft)}
.lens b{color:var(--ink);display:block;font-weight:600}
.section-label{font-family:var(--f-mono);font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 14px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.panel h3{font-size:17px;margin-bottom:10px}
.btn{font-family:var(--f-mono);font-weight:600;letter-spacing:.04em;text-transform:uppercase;background:var(--ink);color:var(--paper);border:1px solid var(--ink);border-radius:8px;cursor:pointer}
.btn.ghost{background:transparent;color:var(--ink)}
.btn:disabled{opacity:.6;cursor:default}
footer{margin-top:30px;padding-top:16px;border-top:3px solid var(--ink)}
footer p{font-size:11.5px;color:var(--ink-faint);line-height:1.6;max-width:70ch}
footer .more{margin-top:10px}
footer a{color:var(--ink-soft)}
@media (max-width:480px){
  .g{grid-template-columns:1fr;gap:4px}
  .row{grid-template-columns:64px 1fr;gap:12px}
  .move{font-size:15px}
  h3{font-size:17px}
  .ag{grid-template-columns:1fr;gap:2px}
  .cal li{grid-template-columns:78px 1fr}
}
`;
const cssOverride = '\n.wish-grid{ grid-template-columns:1fr !important; }\n.wish{ margin-top:34px; }\n';

const js = String.raw`
(function(){
  var KEY='golvet_follow', NK='golvet_follow_names';
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){ return []; } }
  function save(a){ try{ localStorage.setItem(KEY, JSON.stringify(a)); }catch(e){} }
  function loadN(){ try{ return JSON.parse(localStorage.getItem(NK)||'{}'); }catch(e){ return {}; } }
  function saveN(o){ try{ localStorage.setItem(NK, JSON.stringify(o)); }catch(e){} }
  var rows=[].slice.call(document.querySelectorAll('.row'));
  var mine=document.getElementById('mine');
  var toast=document.createElement('div'); toast.className='toast'; toast.setAttribute('role','status'); toast.setAttribute('aria-live','polite');
  document.body.appendChild(toast);
  var timer=null;
  function say(msg){
    toast.textContent='';
    var m=document.createElement('span'); m.textContent=msg; toast.appendChild(m);
    var v=document.createElement('button'); v.type='button'; v.textContent='Visa';
    v.addEventListener('click', function(){
      var reduce=window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      mine.scrollIntoView({behavior:reduce?'auto':'smooth', block:'center'});
      toast.classList.remove('show');
    });
    toast.appendChild(v);
    toast.classList.add('show');
    clearTimeout(timer); timer=setTimeout(function(){ toast.classList.remove('show'); }, 5000);
  }
  function chip(label, move){
    var c=document.createElement('span'); c.className='chip'+(move?'':' away');
    c.appendChild(document.createTextNode(label+(move?' ':'')));
    if(move){ var s=document.createElement('span'); s.className=move.charAt(0)==='+'?'up':'down'; s.textContent=move; c.appendChild(s); }
    return c;
  }
  function render(){
    var f=load(), n=loadN();
    rows.forEach(function(r){
      var on=f.indexOf(r.getAttribute('data-t'))>-1;
      var b=r.querySelector('.follow');
      b.setAttribute('aria-pressed', on?'true':'false');
      b.querySelector('span').textContent=on?'Följer':'Följ';
    });
    var today=rows.map(function(r){ return r.getAttribute('data-t'); });
    var hits=rows.filter(function(r){ return f.indexOf(r.getAttribute('data-t'))>-1; });
    var away=f.filter(function(t){ return today.indexOf(t)<0; });
    mine.textContent='';
    if(!f.length){
      mine.textContent='Dina bolag. Tryck på Följ vid ett bolag så samlas det här, högst upp.';
      return;
    }
    var b=document.createElement('b'); b.textContent=hits.length?'Dina bolag idag.':'Dina bolag.'; mine.appendChild(b);
    if(hits.length){
      var wrap=document.createElement('div'); wrap.className='chips';
      hits.forEach(function(r){ wrap.appendChild(chip(r.getAttribute('data-co'), r.getAttribute('data-mv'))); });
      mine.appendChild(wrap);
    }
    if(away.length){
      var w2=document.createElement('div'); w2.className='chips';
      away.forEach(function(t){ w2.appendChild(chip((n[t]||t)+', inte med idag', '')); });
      mine.appendChild(w2);
    }
    var note=document.createElement('span'); note.className='note';
    note.textContent='Sparas bara i den här webbläsaren. Du får ingen avisering, men ser dina bolag här varje gång du öppnar sidan.';
    mine.appendChild(note);
  }
  rows.forEach(function(r){
    r.querySelector('.follow').addEventListener('click', function(){
      var f=load(), n=loadN(), t=r.getAttribute('data-t'), co=r.getAttribute('data-co'), i=f.indexOf(t);
      if(i>-1){ f.splice(i,1); save(f); render(); say('Du följer inte längre '+co+'.'); }
      else { f.push(t); n[t]=co; save(f); saveN(n); render(); say('Du följer '+co+'. Dina bolag samlas högst upp.'); }
    });
  });
  render();
})();
`;

(async function main() {
  const T = {};
  let got = 0;
  for (const c of candidates) { const t = await trendFor(c); T[c.ticker] = t; if (t) got++; }
  if (got < candidates.length) console.warn('WARN: trend saknas för ' + (candidates.length - got) + ' av ' + candidates.length + ' bolag');

  const counts = { up: 0, down: 0, mid: 0 };
  candidates.forEach(c => { if (T[c.ticker]) counts[T[c.ticker].lab]++; });
  const nya = candidates.filter(c => streakOf(c.ticker) === 1).length;

  const lead = txt((idag && idag.lead) || leadB || 'Dagens läge');
  const glanceRows = ((idag && idag.glance) || []).map(g => ({ l: txt(g.l), t: txt(g.t) }));
  if (got >= Math.ceil(candidates.length / 2)) glanceRows.push({ l: 'Trendbild', t: 'Av ' + got + ' bolag har ' + counts.down + ' kursen under både 50- och 200-dagarssnittet, ' + counts.up + ' över båda och ' + counts.mid + ' däremellan.' });

  let calRows = (idag && Array.isArray(idag.calendar) && idag.calendar.length) ? idag.calendar : [];
  if (!calRows.length && calB) calRows = calB.split(/,\s*(?=\d)/).map(s => { const m = s.match(/^(\d+(?:[–-]\d+)?\s+\S+)\s+(.*)$/); return m ? { d: m[1], t: m[2], tickers: [] } : null; }).filter(Boolean);
  const explain = e => { if (e.x) return txt(e.x); const hit = GLOSS.filter(g => g[0].test(e.t)).slice(0, 2).map(g => g[1]); return hit.join(' '); };
  const calHtml = calRows.map(e => '<li><span class="cd">' + esc(e.d) + '</span><div><span>' + esc(e.t) + '</span>' + (explain(e) ? '<p class="cx">' + esc(explain(e)) + '</p>' : '') +
    ((e.tickers || []).filter(t => tickers.indexOf(t) > -1).length ? '<div class="berors"><span>Berörs:</span>' + e.tickers.filter(t => tickers.indexOf(t) > -1).map(t => '<a class="chip2" href="#c-' + attr(t) + '">' + nameOf(t) + '</a>').join('') + '</div>' : '') + '</div></li>').join('');

  /* sparade händelser och utfall */
  const evPath = path.join(opt.repo, 'data', 'events.json'), afPath = path.join(opt.repo, 'data', 'after.json');
  const evs = (readJson(evPath, { events: [] }).events || []).filter(e => e.iso >= addDays(date, -14));
  calRows.forEach(e => {
    const iso = isoFromD(e.d, date); if (!iso) return;
    const key = evKey(iso, e.t);
    if (!evs.some(x => evKey(x.iso, x.t) === key)) evs.push({ iso, d: txt(e.d), t: txt(e.t), tickers: (e.tickers || []).filter(t => tickers.indexOf(t) > -1) });
  });
  evs.sort((a, b) => a.iso.localeCompare(b.iso));
  let afItems = (readJson(afPath, { items: [] }).items || []).filter(a => a.iso >= addDays(date, -14));
  if (idag && Array.isArray(idag.after)) idag.after.forEach(a => {
    const iso = a && a.d && a.t && a.s ? isoFromD(a.d, date) : null; if (!iso) return;
    const key = evKey(iso, a.t);
    afItems = afItems.filter(x => x.key !== key);
    afItems.push({ key, iso, d: txt(a.d), t: txt(a.t), s: txt(a.s), tickers: (a.tickers || []).filter(t => tickers.indexOf(t) > -1), added: date });
  });
  const shownAfter = afItems.filter(a => { const age = daysBetween(a.iso, date); return age >= 1 && age <= 3; }).sort((a, b) => b.iso.localeCompare(a.iso));
  const berorsOf = tk => (tk || []).filter(t => tickers.indexOf(t) > -1).length ? '<div class="berors"><span>Berörs:</span>' + tk.filter(t => tickers.indexOf(t) > -1).map(t => '<a class="chip2" href="#c-' + attr(t) + '">' + nameOf(t) + '</a>').join('') + '</div>' : '';
  const afterHtml = shownAfter.length ? '<section class="week"><h2>Det som hände</h2><p class="gsum">Utfallet av de senaste händelserna i kalendern. Visas i några dagar.</p><ul class="cal">' +
    shownAfter.map(a => '<li><span class="cd">' + esc(a.d) + '</span><div><span>' + esc(a.t) + '</span><p class="cx out">' + esc(a.s) + '</p>' + berorsOf(a.tickers) + '</div></li>').join('') + '</ul></section>\n' : '';

  const wishHtml = (idag && idag.wish && idag.wish.by && idag.wish.q && idag.wish.a)
    ? '<section class="wishnow"><p class="eyebrow">Dagens önskemål</p><h2>' + esc(idag.wish.q) + '</h2><p class="gsum">Önskat av ' + esc(idag.wish.by) + '</p>' +
      String(idag.wish.a).split(/\n\s*\n/).map(p => '<p class="wa">' + esc(p) + '</p>').join('') + '</section>\n' : '';

  const groupHtml = groups.map(g => '<section class="group"><h2>' + esc(g.t) + '</h2><p class="gsum">' + esc(g.s) + '</p><ul class="rows">' +
    g.tickers.map(t => row(candidates.find(c => c.ticker === t), T[t])).join('') + '</ul></section>').join('');

  const act = radar.filter(r => r.active), off = radar.filter(r => !r.active);
  const radarHtml = '<ul class="lens">' + act.map(r => '<li><b>' + esc(r.lens) + '</b> ' + esc(r.note) + '</li>').join('') + '</ul>' +
    (off.length ? '<p class="gsum">Inget nytt idag: ' + off.map(r => esc(r.lens)).join(', ') + '.</p>' : '');

  const visible = [lead, glanceRows.map(g => g.t).join(' '), calRows.map(e => e.t).join(' '), groups.map(g => g.s).join(' '), candidates.map(c => meta(c.ticker).h + ' ' + meta(c.ticker).w).join(' ')].join(' ');
  const mins = Math.max(1, Math.round(visible.split(/\s+/).length / 200));

  const desc = ('Dagens läge på börsen: ' + lead).slice(0, 155);
  const footerHtml = '<b>Golvet</b>' + esc(footerRaw.replace(/^Golvet/, ''));
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%88%3C/text%3E%3C/svg%3E";

  const html = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Golvet</title><meta name="description" content="' + attr(desc) + '">' +
    '<link rel="canonical" href="https://golvet.gaidens.se/"><meta property="og:type" content="website"><meta property="og:site_name" content="Golvet">' +
    '<meta property="og:title" content="Golvet"><meta property="og:description" content="' + attr(desc) + '"><meta property="og:url" content="https://golvet.gaidens.se/"><meta property="og:locale" content="sv_SE">' +
    '<meta name="twitter:card" content="summary"><link rel="icon" href="' + icon + '">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">' +
    '<style>' + css + readTool('onskemal.css') + cssOverride + '</style></head><body>\n<div class="page">\n' +
    '<header><div class="mast"><span class="word">Golvet</span><span class="date">' + esc(dateLabel) + '</span></div>' +
    '<div class="edition"><span>' + dayLabel + '</span><span>' + candidates.length + ' bolag</span><span><b>' + nya + ' nya</b> sedan sist</span><span>ca ' + mins + ' min läsning</span></div></header>\n' +
    '<section class="lead"><p class="eyebrow">Dagens läge</p><h1>' + esc(lead) + '</h1></section>\n' +
    '<div class="glance">' + glanceRows.map(g => '<div class="g"><span class="gl">' + esc(g.l) + '</span><span class="gt">' + esc(g.t) + '</span></div>').join('') + '</div>\n' +
    '<div class="mine" id="mine"></div>\n' + afterHtml +
    '<section class="week"><h2>Veckan framåt</h2><p class="gsum">Händelser som kan svänga marknaden, och bolagen i dagens lista som är känsliga för dem.</p><ul class="cal">' + calHtml + '</ul>' +
    '<p class="legend">Kopplingarna är vår bedömning av vilka bolag som är känsliga, inte en prognos.</p></section>\n' + wishHtml +
    '<p class="legend" style="margin-top:34px">Trend visar hur kursen betett sig mot sina 50- och 200-dagars medelvärden. Det är historik, inte en prognos eller en rekommendation.</p>\n' +
    groupHtml + '\n' + readTool('onskemal.html') + '\n' +
    '<details class="back"><summary>Så togs dagens läge fram</summary>' + radarHtml + '</details>\n' +
    '<footer><p>' + footerHtml + '</p><p class="more">Sidan hämtar typsnitt från Google Fonts och skickar önskemål via Formspree.' + (gcCode ? ' Besök räknas anonymt med GoatCounter, utan cookies.' : '') + ' Dina följda bolag sparas bara i din egen webbläsare.</p><p class="more"><a href="/klassisk/">Visa den utförliga versionen med alla skift</a></p></footer>\n</div>\n' +
    '<script>' + js + '</script>\n' + readTool('onskemal.js') + '\n' + (gcCode ? '<script data-goatcounter="https://' + gcCode + '.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>\n' : '') + '</body></html>\n';

  /* sista kontroller innan något skrivs */
  const bad = [];
  if (!/<title>Golvet<\/title>/.test(html)) bad.push('titel');
  if (html.indexOf('id="wishForm"') < 0) bad.push('önskemålsformuläret saknas');
  if (/window\.claude|historyList|EVP/.test(html)) bad.push('rester från artefakten');
  if ((html.match(/class="row"/g) || []).length !== candidates.length) bad.push('antal kort stämmer inte');
  if (bad.length) fail('bygget underkänt: ' + bad.join(', '));

  fs.mkdirSync(path.dirname(histPath), { recursive: true });
  fs.writeFileSync(path.join(opt.repo, 'index.html'), html, { encoding: 'utf8' });
  const days = (hist.days || []).filter(d => d.d !== date);
  days.push({ d: date, t: tickers });
  days.sort((a, b) => a.d.localeCompare(b.d));
  fs.writeFileSync(histPath, JSON.stringify({ days: days.slice(-40) }, null, 1) + '\n', 'utf8');
  fs.writeFileSync(evPath, JSON.stringify({ events: evs }, null, 1) + '\n', 'utf8');
  fs.writeFileSync(afPath, JSON.stringify({ items: afItems }, null, 1) + '\n', 'utf8');
  console.log('ok index.html ' + html.length + ' tecken, ' + candidates.length + ' kort, ' + groups.length + ' grupper, trend ' + got + '/' + candidates.length + ', nya ' + nya + (errors.length ? ', reservlösningar används (' + errors.length + ' valideringsfel)' : ''));
})();
