// Makes tests/fixtures/signals-old-page.json: what the OLD site's own code answered, for the Signals page to be held to.
//
// It runs macro-compass's docs/ma.js (load it with a stub window) and the structure and day-against-index blocks of
// docs/watch.html (cut out by their first and last line, each cut checked and hashed into the fixture) on
//   - the daily closes of the frozen 2026-11-01 capture (tests/parity/old-page-2026-11-01.json), and
//   - the weekly and monthly closes of series.json as written 2026-11-01T17:03:51Z (git show 19eb821:public/data/series.json),
// for twelve symbols chosen to reach every outcome the code has, and writes the answers beside the closes.
//
//   node tests/fixtures/make-signals-old-page.mjs            # reads ~/Macro Compass/docs, this repo's public/data/series.json
//   OLD_SITE=/path/to/docs SERIES=/path/to/series.json node tests/fixtures/make-signals-old-page.mjs
//
// Nothing here writes to the old site. The tests never read it: they read the fixture. See docs/PARITY.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REPO = new URL('../../', import.meta.url).pathname;
const OLD = (process.env.OLD_SITE || process.env.HOME + '/Macro Compass/docs').replace(/\/?$/, '/');
const sha = s => createHash('sha256').update(s).digest('hex');

const maSrc = readFileSync(OLD + 'ma.js', 'utf8');
const watchSrc = readFileSync(OLD + 'watch.html', 'utf8');
const wl = watchSrc.split('\n');
const win = {};
new Function('window', 'document', maSrc)(win, {});
const MA = win.MA;

// ---- cut the page's own code out of watch.html, checking each cut's first and last line
function cut(startIncludes, endTest, label) {
  const a = wl.findIndex(l => l.includes(startIncludes));
  if (a < 0) throw new Error('no start for ' + label);
  let b = a;
  while (!endTest(wl[b], b - a)) b++;
  return { text: wl.slice(a, b + 1).join('\n'), from: a + 1, to: b + 1, first: wl[a].trim(), last: wl[b].trim() };
}
const cuts = {
  smaSeries: cut('const smaSeries = (vals, n) => {', l => l === '  };', 'smaSeries'),
  maReadFor: cut('function maReadFor(vals, period) {', l => l === '  }', 'maReadFor'),
  structure: cut('const TFS = [["m", "monthly", 1, 0]', l => l.includes('(STATE_RANK[a[4]] ?? 9) - (STATE_RANK[b[4]] ?? 9));'), 'structure'),
  indexMap: cut('const INDEX_MAP = {', l => l.trim().endsWith('};'), 'indexMap'),
  median: cut('const median = a =>', l => l.includes('(s[m - 1] + s[m]) / 2; };'), 'median'),
  dayPctOf: cut('function dayPctOf(hist) {', l => l === '  }', 'dayPctOf'),
  pct1: cut('const pct1 = v =>', () => true, 'pct1'),
  relative: cut('const bySec = {};', (l, i) => l.includes('r.rels = ') , 'relative'),
};
// the relative block's last statement is followed by the loop's closing brace
{
  const c = cuts.relative; const i = c.to; // 1-based index of the r.rels line, so wl[i] is the next line
  if (wl[i].trim() !== '}') throw new Error('relative block does not end where expected: ' + wl[i]);
  c.text += '\n' + wl[i]; c.to = i + 1; c.last = '}';
}
for (const [k, c] of Object.entries(cuts)) console.log(k, c.from + '-' + c.to, '|', c.first.slice(0, 50), '...', c.last.slice(-50));

const fmtStub = (v, d) => String(v);
const structHarness = new Function('fmt', 'all', `${cuts.smaSeries.text}\n${cuts.maReadFor.text}\nconst fmtD = fmt;\n${cuts.structure.text}\nreturn struct;`);
const relHarness = new Function('HIST', 'all', `${cuts.indexMap.text}\n${cuts.median.text}\n${cuts.pct1.text}\n${cuts.dayPctOf.text}\n${cuts.relative.text}\nreturn all;`);

// ---- the closes
const dump = JSON.parse(readFileSync(REPO + 'tests/parity/old-page-2026-11-01.json', 'utf8'));
const HIST = dump.HIST;
const series = JSON.parse(readFileSync(process.env.SERIES || REPO + 'public/data/series.json', 'utf8'));

// The old fetchBars period rule (ma.js), cut from the source, to compare with what the new rule keeps.
const ruleSrc = (() => {
  const L = maSrc.split('\n');
  const a = L.findIndex(l => l.includes('const periodKey = (t) => {'));
  const b = L.findIndex((l, i) => i > a && l.includes('if (closes.length) out[row.symbol] = closes;'));
  return L.slice(a, b).join('\n');
})();
const oldClosesFn = new Function('ts', 'raw', 'interval', `${ruleSrc}\n return closes;`);
const oldCloses = (e, tf) => oldClosesFn(e.t, e.c, tf === 'weekly' ? '1wk' : '1mo');

// the new rule's answer, restated here so the fixture stores closes the page would use (US-style stamps: the same)
const DAY = 86400, HOUR = 3600;
function periodEnd(t, tf) {
  if (tf === 'weekly') return t + 7 * DAY;
  const m = new Date((t + 12 * HOUR) * 1000);
  return t + new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate() * DAY;
}
const newCloses = (e, tf) => {
  const n = e.c.length;
  const ph = n >= 2 && e.t[n - 1] < periodEnd(e.t[n - 2], tf) - HOUR;
  return ph ? e.c.slice(0, -1) : e.c.slice();
};

const TFS = ['daily', 'weekly', 'monthly'];
const PERIODS = { daily: [5, 21, 50, 150, 200], weekly: [10, 30, 40, 200], monthly: [10, 12, 20] };
const LOOK = { daily: 10, weekly: 13, monthly: 12 };
const closesFor = (sym, tf) => tf === 'daily' ? HIST[sym].settled.map(x => x[1]) : newCloses(series[tf][sym], tf);

const candidates = Object.keys(HIST).filter(s => HIST[s].settled.length >= 220 && series.weekly[s] && series.monthly[s] && series.weekly[s].c.length >= 220 && series.monthly[s].c.length >= 220);
console.log('candidates with enough bars on all three timeframes:', candidates.length);

function answers(vals, tf) {
  const reads = {}, slopes = {};
  for (const p of PERIODS[tf]) { reads[p] = MA.read(vals, p); slopes[p] = MA.slope(vals, p); }
  return { reads, slopes, crosses: MA.crosses(vals, LOOK[tf]), ema5: MA.emaSeries(vals, 5).slice(-3), ema21: MA.emaSeries(vals, 21).slice(-3), emaLen: MA.emaSeries(vals, 21).length };
}
const featuresOf = (a, tf) => {
  const f = new Set();
  for (const p of Object.keys(a.reads)) {
    const r = a.reads[p]; if (r && r.state) f.add(`tag:${tf}:${r.state}`);
    const s = a.slopes[p]; if (s) f.add(`slope:${tf}:${s.state}`);
  }
  for (const c of a.crosses) f.add(`cross:${tf}:${c.key}:${c.bullish ? 'bull' : 'bear'}:${c.whip ? 'whip' : 'held'}`);
  return f;
};

// A broad scan first: every candidate, so the sample can be chosen for what it exercises.
const per = {};
for (const s of candidates) {
  per[s] = {};
  const feats = new Set();
  for (const tf of TFS) { const a = answers(closesFor(s, tf), tf); per[s][tf] = a; for (const f of featuresOf(a, tf)) feats.add(f); }
  per[s].feats = feats;
}
const chosen = [];
const seen = new Set();
// US-listed names first, so weekly and monthly closes are what the old page itself would have used.
const usFirst = [...candidates].sort((a, b) => (/\./.test(a) ? 1 : 0) - (/\./.test(b) ? 1 : 0));
while (chosen.length < 9) {
  let best = null, gain = 0;
  for (const s of usFirst) {
    if (chosen.includes(s)) continue;
    let g = 0; for (const f of per[s].feats) if (!seen.has(f)) g++;
    if (g > gain) { best = s; gain = g; }
  }
  if (!best || gain === 0) break;
  chosen.push(best); for (const f of per[best].feats) seen.add(f);
}
// plus two names whose exchanges are ahead of UTC, so the sample is not all US stamps
for (const s of ['7956.T', 'CBK.DE', 'COL.AX', '0002.HK']) if (candidates.includes(s) && chosen.length < 12 && !chosen.includes(s)) chosen.push(s);
console.log('chosen:', chosen.join(', '));
const allFeats = new Set(); for (const s of chosen) for (const f of per[s].feats) allFeats.add(f);
console.log('features exercised:', allFeats.size);
console.log([...allFeats].sort().join('\n'));

const symbols = {};
for (const s of chosen) {
  symbols[s] = { country: undefined };
  for (const tf of TFS) {
    const vals = closesFor(s, tf);
    symbols[s][tf] = { closes: vals, ...answers(vals, tf) };
  }
  // does the old page's rule leave the same closes as the new one for this symbol?
  symbols[s].oldRuleSame = { weekly: JSON.stringify(oldCloses(series.weekly[s], 'weekly')) === JSON.stringify(newCloses(series.weekly[s], 'weekly')),
                              monthly: JSON.stringify(oldCloses(series.monthly[s], 'monthly')) === JSON.stringify(newCloses(series.monthly[s], 'monthly')) };
}
console.log('old rule == new rule:', JSON.stringify(Object.fromEntries(chosen.map(s => [s, symbols[s].oldRuleSame]))));

// ---- structure events: find (symbol, timeframe, cut) combinations where the old code reports a fresh change
const MAXAGO = { monthly: 1, weekly: 1, daily: 2 };
const discover = pool => {
  const out = [];
  for (const s of pool) for (const tf of TFS) for (let cutBars = 0; cutBars <= 40; cutBars++) {
    const full = closesFor(s, tf); const vals = full.slice(0, full.length - cutBars);
    for (const p of [200, 150]) {
      const m = MA.read(vals, p);
      if (m && m.state && (m.state === 'reclaimed' || m.state === 'lost') && m.crossedAgo != null && m.crossedAgo <= MAXAGO[tf]) out.push({ s, tf, cutBars, p, state: m.state, ago: m.crossedAgo });
    }
  }
  return out;
};
// the sample first, then anything else for the combinations it does not reach
const pick = []; const used = {};
const take = (f) => {
  const k = `${f.tf}:${f.state}:${f.p}`; used[k] = used[k] || 0;
  if (used[k] >= 1) return;
  if (pick.filter(x => x.s === f.s && x.tf === f.tf).length) return;
  pick.push(f); used[k]++;
};
for (const f of discover(chosen)) take(f);
const reached = () => TFS.flatMap(tf => ['reclaimed', 'lost'].flatMap(st => [200, 150].map(p => `${tf}:${st}:${p}`))).filter(k => !used[k]);
console.log('combinations the sample does not reach on its own:', reached().join(', ') || 'none');
for (const f of discover(candidates.filter(c => !chosen.includes(c)))) if (reached().includes(`${f.tf}:${f.state}:${f.p}`)) take(f);
console.log('combinations still missing:', reached().join(', ') || 'none');
console.log('picked', pick.length);
// and one change a bar too old to be fresh on each timeframe: the old code leaves it out, and a wider window would not
const stale = [];
for (const tf of TFS) {
  for (const sym of chosen) {
    if (stale.find(x => x.tf === tf)) break;
    for (let cutBars = 0; cutBars <= 40; cutBars++) {
      const full = closesFor(sym, tf); const vals = full.slice(0, full.length - cutBars);
      const hit = [200, 150].map(p => ({ p, m: MA.read(vals, p) })).find(({ m }) => m && m.state && (m.state === 'reclaimed' || m.state === 'lost') && m.crossedAgo === MAXAGO[tf] + 1);
      if (hit) { stale.push({ s: sym, tf, cutBars, p: hit.p, state: hit.m.state, ago: hit.m.crossedAgo }); break; }
    }
  }
}
console.log('stale cases:', JSON.stringify(stale));
const SECTIONS = [['breakout', 'breakout'], ['watch', 'watch'], ['target', 'target'], ['reentered', 'breakout'], ['stopped', 'breakout'], ['failed', 'failed'], ['removed', 'watch'], ['watch', 'watch']];
const rowsCase = [];
pick.forEach((f, i) => {
  const [section, state] = SECTIONS[i % SECTIONS.length];
  const cutBars = { daily: 0, weekly: 0, monthly: 0 }; cutBars[f.tf] = f.cutBars;
  rowsCase.push({ sym: f.s, dir: i % 3 === 1 ? 'short' : 'long', section, state, cutBars });
});
for (const f of stale) {
  const cutBars = { daily: 0, weekly: 0, monthly: 0 }; cutBars[f.tf] = f.cutBars;
  rowsCase.push({ sym: f.s, dir: 'long', section: 'breakout', state: 'breakout', cutBars, stale: { tf: f.tf, period: f.p } });
}
// the same symbol listed both long and short, to show events are per setup
if (pick[0]) rowsCase.push({ sym: pick[0].s, dir: 'short', section: 'breakout', state: 'breakout', cutBars: { daily: 0, weekly: 0, monthly: 0, [pick[0].tf]: pick[0].cutBars } });
const cutVals = (r, tf) => { const full = closesFor(r.sym, tf); return full.slice(0, full.length - r.cutBars[tf]); };
const stubAll = rowsCase.map(r => ({ section: r.section, p: { sym: r.sym, dir: r.dir }, prevClose: 1, st: { state: r.state },
  ma: { d: cutVals(r, 'daily'), w: cutVals(r, 'weekly'), m: cutVals(r, 'monthly') } }));
const struct = structHarness(fmtStub, stubAll);
const events = struct.map(e => {
  const m = /^(\S+) (long|short) — (reclaimed|lost) its (monthly|weekly|daily) (150|200) \(.*\)( on the latest bar| (\d+) bars? ago)/.exec(e[3]);
  if (!m) throw new Error('cannot read ' + e[3]);
  return { sym: m[1], dir: m[2], state: m[3], tf: m[4], period: +m[5], ago: m[6] ? +m[7] : 0, helps: e[2] === 'new', rank: e[0], stateTag: e[4] };
});
console.log('structure events from the old code:', events.length);
console.log(events.map(e => `${e.sym} ${e.dir} ${e.tf} ${e.period} ${e.state} ago=${e.ago} ${e.helps ? 'helps' : 'against'} (${e.stateTag})`).join('\n'));

// ---- relative strength: the old block on stub rows and index histories
const idxHist = (settled, live, liveDate) => ({ settled: settled.map((c, i) => [`2026-10-${String(20 + i).padStart(2, '0')}`, c]), live, liveDate });
const histStub = {
  '^GSPC': idxHist([100, 101, 102], 103, '2026-10-24'),          // live tick on a day past the last settled close
  '^N225': idxHist([200, 198, 199], 199, '2026-10-22'),          // live date equal to the last settled: use the one before
  '^FTSE': idxHist([300, 303], null, ''),                         // no live tick: no day move
  '^GDAXI': idxHist([400, 396], 392, '2026-10-22'),
};
const relRows = [
  { sym: 'A', dir: 'long', country: 'US', sector: 'Tech', dayPct: 2.0 }, { sym: 'B', dir: 'long', country: 'US', sector: 'Tech', dayPct: -1.0 },
  { sym: 'C', dir: 'short', country: 'Japan', sector: 'Tech', dayPct: 0.5 }, { sym: 'D', dir: 'long', country: 'UK', sector: 'Energy', dayPct: 1.0 },
  { sym: 'E', dir: 'long', country: 'Germany', sector: 'Energy', dayPct: -3.0 }, { sym: 'F', dir: 'long', country: 'UAE', sector: 'Banks', dayPct: 0.4 },
  { sym: 'G', dir: 'long', country: 'US', sector: 'Banks', dayPct: null }, { sym: 'H', dir: 'long', country: 'Japan', sector: null, dayPct: 1.2 },
  { sym: 'I', dir: 'long', country: 'US', sector: 'Tech', dayPct: 0.0 }, { sym: 'J', dir: 'long', country: 'Atlantis', sector: 'Banks', dayPct: 2.2 },
];
const relAll = relRows.map(r => ({ p: { sym: r.sym, dir: r.dir, country: r.country }, ev: r.sector ? { sector: r.sector } : {}, dayPct: r.dayPct }));
relHarness(histStub, relAll);
const relExpected = relAll.map((r, i) => ({ sym: relRows[i].sym, relm: r.relm, rels: r.rels }));
console.log('relative:', JSON.stringify(relExpected));

const extra = {};
for (const f of pick) if (!chosen.includes(f.s) && !extra[f.s]) extra[f.s] = Object.fromEntries(TFS.map(tf => [tf, closesFor(f.s, tf)]));
const out = {
  about: "What the old site's own code answered on the closes of the frozen 2026-11-01 capture (daily) and series.json of the same day (weekly, monthly): ma.js read, slope, emaSeries and crosses, and the structure and day-against-index blocks of watch.html, run out of their source. See docs/PARITY.md.",
  sources: {
    'macro-compass docs/ma.js': sha(maSrc),
    'macro-compass docs/watch.html': Object.fromEntries(Object.entries(cuts).map(([k, c]) => [k, { lines: c.from + '-' + c.to, sha256: sha(c.text) }])),
  },
  periods: PERIODS, lookback: LOOK,
  symbols: Object.fromEntries(chosen.map(s => [s, Object.fromEntries(TFS.map(tf => [tf, symbols[s][tf]]))])),
  oldRuleSame: Object.fromEntries(chosen.map(s => [s, symbols[s].oldRuleSame])),
  structure: { rows: rowsCase, events, extra },
  indexMap: new Function(cuts.indexMap.text + '\nreturn INDEX_MAP;')(),
  relative: { index: histStub, rows: relRows, expected: relExpected },
};
writeFileSync(REPO + 'tests/fixtures/signals-old-page.json', JSON.stringify(out));
console.log('wrote tests/fixtures/signals-old-page.json', (JSON.stringify(out).length / 1024).toFixed(0) + ' KB');
