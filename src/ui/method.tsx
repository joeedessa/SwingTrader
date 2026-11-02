import { app } from '../data/app';
import { flagsOf } from '../data/selectors';
import { LFD_LOOKBACK } from '../engine/lfd';
import { RULES, THRESHOLDS } from '../engine/flags';
import type { FlagKind, Surface, Tier } from '../engine/flags';
import { fmtD } from '../engine/format';
import { MA_RULES, MIN_BARS, TF_WORDS, TIERS } from '../engine/ma';
import { FRESH_WITHIN, MIN_SECTOR_PEERS } from '../engine/signals';
import { useStore } from '../store';
import { Hero } from './hero';
import { GROUP_TITLE } from './flagview';
import { dataRows } from './methoddata';

/* Method: what the rules are, where the data comes from, and how fresh it is. It replaces the prose that used to sit in
   footers and tooltips. The rules are written for a reader; every threshold comes from the engine's own constants, and
   every count from the data of the day, so the page cannot drift from what the engine does. */

const TIER_NAME: Record<Tier, string> = { act: 'Act', watch: 'Watch', info: 'Info' };
const SURFACE_NAME: Record<Surface, string> = { today: 'Today', setups: 'Setups', positions: 'Positions', history: 'History', method: 'Method' };

/** The rule's words without the code marks the plan wrote around field names. */
const plain = (rule: string) => rule.replace(/`/g, '');

export function FlagTable() {
  const kinds = Object.keys(RULES) as FlagKind[];
  return (
    <div class="ruletable" role="table" aria-label="Every flag rule">
      <div class="rulehead" role="row">
        <span role="columnheader">Flag</span><span role="columnheader">Tier</span><span role="columnheader">When it fires</span>
        <span role="columnheader">Shows on</span><span role="columnheader">Clears</span>
      </div>
      {kinds.map(k => (
        <div class="rulerow" role="row">
          <span class="rname" role="cell">{GROUP_TITLE[k]}<code>{k}</code></span>
          <span class={'rtier ' + RULES[k].tier} role="cell">{TIER_NAME[RULES[k].tier]}{RULES[k].live ? ' · live' : ''}</span>
          <span class="rwhen" role="cell">{plain(RULES[k].rule)}</span>
          <span class="rwhere" role="cell">{RULES[k].surfaces.map(x => SURFACE_NAME[x]).join(', ')}</span>
          <span class="rclears" role="cell">{RULES[k].clears === 'ack' ? 'when acknowledged' : 'by itself'}</span>
        </div>
      ))}
    </div>
  );
}

/** "the latest bar on a monthly or weekly chart, or the latest 2 bars on a daily chart": the freshness windows, grouped by their length. */
function freshWords(): string {
  const groups = new Map<number, string[]>();
  for (const f of FRESH_WITHIN) groups.set(f.bars, [...(groups.get(f.bars) ?? []), f.tf]);
  return [...groups].map(([n, tfs]) => `${n === 1 ? 'the latest bar' : `the latest ${n} bars`} on a ${tfs.join(' or ')} chart`).join(', or ');
}

export function MethodPage() {
  const s = useStore(app);
  const ready = s.phase === 'ready';
  const rows = ready ? dataRows(s, s.now) : [];
  const gaps = ready ? flagsOf(s, 'watchlist').filter(f => f.kind === 'data') : [];
  const T = THRESHOLDS;
  return (
    <main class="page method" data-underlay>
      <Hero title="Method" stamp="The rules, where the data comes from, and how fresh it is." />

      <section class="prose" aria-labelledby="m-data">
        <h2 id="m-data">Data and freshness</h2>
        {ready ? (
          <ul class="datalist">
            {rows.map(r => (
              <li class={'drow ' + r.tone}>
                <span class="dname"><span class={'dot ' + r.tone} aria-hidden="true" />{r.name}</span>
                <span class="dwhat">{r.what}</span>
                <span class="dstate">{r.age ? r.age : ''}{r.at && r.age ? <span class="dat"> · {fmtD(r.at.slice(0, 10))} {r.at.slice(11, 16)} UTC</span> : null}</span>
                <span class="ddetail">{r.detail}</span>
              </li>
            ))}
          </ul>
        ) : <p class="note">Loading…</p>}
        {ready ? (gaps.length ? (
          <>
            <h3>Gaps today</h3>
            <ul class="gaplist">{gaps.map(f => <li>{f.text}.</li>)}</ul>
          </>
        ) : <p class="note">No gaps: every symbol has history, daily bars and a calendar entry, and the latest prices are fresh.</p>) : null}
        {ready && (s.problems.length || s.seriesProblems.length) ? <><h3>Problems loading</h3><ul class="gaplist">{[...s.problems, ...s.seriesProblems].map(p => <li>{p}</li>)}</ul></> : null}
        <p>Where it comes from: the levels are Tech Charts' (from their weekly report, which is licensed and never published here). Daily bars, the latest prices and live quotes come from Yahoo Finance's public endpoints, with no key; the browser reaches them through a small Cloudflare Worker, because Yahoo sends no cross-origin header. Earnings and dividend dates, the last result and the consensus come from TradingView's public scanner, and the headlines from Google News's public feed. Nothing needs a key or a paid account.</p>
        <p>How it stays current: a job on GitHub rewrites the latest prices about every fifteen minutes, and the daily bars and the earnings file about hourly. A day's bar is written once that exchange's session has ended, keyed by the exchange's own date, kept as Yahoo sent it, and never rewritten. The page is rebuilt from those files on every load, and opens a newer copy of itself when you come back to it.</p>
        <p>Prices stay in each instrument's listing currency. Nothing is converted, and the currency is printed next to a price wherever it is not obvious.</p>
      </section>

      <section class="prose" aria-labelledby="m-rules">
        <h2 id="m-rules">How a setup is tracked</h2>
        <p>Every rule runs on settled daily closes, rebuilt from the bars on each load. A live price only ever adds a live flag; it never moves a setup.</p>
        <ol class="rules">
          <li><b>Levels.</b> Each setup has a <i>trigger</i> (the pattern boundary plus a 3% filter), a <i>target</i>, and, once a breakout is on, a <i>negation</i>. The source publishes a negation only after a breakout, so a waiting row can show none.</li>
          <li><b>Comparisons.</b> Prices and levels are rounded to 7 significant digits before every comparison: Yahoo's prices carry float32 noise, and a close exactly on a level should follow the written rule, not the noise.</li>
          <li><b>Breakout.</b> The first settled close strictly past the trigger (above for a long, below for a short). A row the source already counted as broken out starts there, on that date.</li>
          <li><b>Negation.</b> An intraday touch (the low for a long, the high for a short), tested only after the breakout. Failed is final: there are no re-entries after a failure.</li>
          <li><b>Target.</b> A settled close at or past it, or a date the source counted it on.</li>
          <li><b>Last full day, the tight stop.</b> The source's level where it gives one (0 means it gives none). Otherwise the low (a long) or high (a short) of the bar before the first close strictly past the pattern boundary, in the run that carries into the confirmation; with no boundary on file, the bar before the trigger close. It is looked for within {LFD_LOOKBACK} sessions. A derived stop beyond the negation is no stop at all.</li>
          <li><b>Types, followed day by day.</b> B1: no pullback through the trigger since the confirming close. B2: pulled back through it with the last full day intact (a pullback starts on a touch of the trigger and ends on the first day trading entirely past it). B3: touched the last full day, an exit (a breach); a settled close back past the trigger is a re-entry, with the original last full day as the stop. B4: the negation was touched. The type is final at the target.</li>
          <li><b>Sections.</b> Watching; Confirmed (B1 and B2); Re-entered (B3, back in); Stopped out (B3, out); At target; Failed; Removed (dropped by the source, or removed here).</li>
        </ol>
      </section>

      <section class="prose" aria-labelledby="m-pos">
        <h2 id="m-pos">Positions and the journal</h2>
        <p>The stop ladder lists what is in trade (Confirmed and Re-entered), nearest its stop first. The stop is the last full day where one is known and tighter than the pattern, else the negation. The trailing stop is twice the 14-day ATR from the price, widened for a long by a dividend still to go ex. R so far is the move since the entry close (the confirming close, or the re-entry close after an exit) over the distance from that close to the stop: 1R is being stopped out.</p>
        <p>The journal is your own record of fills, by price and date, with no sizes. Each buy pairs with the next sell, first in first out, to make a round trip; a sell with nothing open opens a short. It is kept apart from the setups: logging a buy never moves one, and a "held" mark on a row means only that the journal has the position open. P&amp;L is in each instrument's own currency and price-based.</p>
        <p>On History, each setup counts once, by what happened first. Reaching the target before the negation is touched is a hit, and the negation touched first is a miss. The hit rate is hits as a share of both, so setups still in play are not in it. A hit stays a hit if the negation is touched or the source drops the setup later: the sections show where a setup stands now, the tiles what it did first. The type is the one it had then: B1 to B3 at the target, and B4 for a miss. For a setup the source dropped, only what happened up to that day counts.</p>
      </section>

      <section class="prose" aria-labelledby="m-signals">
        <h2 id="m-signals">Signals</h2>
        <p>Signals reads every setup still in play (not Failed, not Removed) on three timeframes: the settled daily closes, and weekly and monthly closes that the data job fetches about once a day, with the week and the month in progress closed at the latest settled daily close, so every figure is as current as the daily bars. Every average is simple and read on closes only, because the feed carries no intraday high or low here, so a wick through a line that closed back on the other side reads as held.</p>
        <p>The level test says what the close did the last time it came near an average: a close within {MA_RULES.tolShare * 100}% of the instrument's typical bar-to-bar move (never under {MA_RULES.tolFloor * 100}% or over {MA_RULES.tolCap * 100}%) in the last {MA_RULES.testBars} bars, counted only while the latest close is still within {MA_RULES.stillNear} times that distance of the line. Near it from above and still above is <i>held</i>, from below and still below <i>rejected</i>, from below and now above <i>reclaimed</i>, from above and now below <i>lost</i>. The arrow says which way the average itself is heading: its move over a window of a {MA_RULES.slopeDivisor}th of its period (between {MA_RULES.slopeFloor} and {MA_RULES.slopeCap} bars) against the window before, with "flat" scaled to how much the instrument normally moves.</p>
        <p>A level change is a close that has changed sides on a 150 or 200 within {freshWords()}, and that the level test calls reclaimed or lost, so it is still near the line; the monthly ones are listed first. A decisive cross, from far under to far over, is not a level change, but the scan below has it. The cross scan looks back {TF_WORDS.daily.lookback} sessions, {TF_WORDS.weekly.lookback} weeks or {TF_WORDS.monthly.lookback} months for crosses on five tiers, quickest to slowest: {TIERS.map(t => t.label).join(', ')}, the 5 and 21 exponential and the rest simple. A cross that the following bars gave back is marked whipsawed. A name needs {MIN_BARS} bars on a timeframe to be scanned on it.</p>
        <p>The day against the market is a setup's day move less its local index's, and less the median of the day moves of its sector across the whole list, in percentage points; a sector needs {MIN_SECTOR_PEERS} names (a name listed both long and short counts once). Yahoo pads every weekly and monthly series with a bar stamped at the last trade, which would count the week or month in progress twice: Signals leaves it out when it falls inside the period the bar before it opened.</p>
      </section>

      <section class="prose" aria-labelledby="m-flags">
        <h2 id="m-flags">Flags</h2>
        <p>Every settled event the engine produces becomes a flag, rebuilt from the bars on every load, so nothing is missed because it was not noticed. Live and proximity rules and the calendar are added to them. A flag is Act (needs a decision), Watch (worth a look) or Info.</p>
        <p>An acknowledgement is a tap on the flag, and is kept in this browser only: the phone and the desktop each keep their own, and Export and Import carry them across. A settled flag nobody acknowledges leaves Today after {T.expirySessions} sessions of its symbol (or {T.expiryWeekdays} weekdays on the board for a symbol that has stopped trading), but stays on the setup's own record. A live flag is a condition and needs no acknowledgement.</p>
        <p>On the Setups board the Flags column shows up to three chips per row: a red dot for what needs a decision, an amber dot for what is worth a look, a calendar glyph for the next earnings or ex-dividend date. They are summaries of the same open flags Today lists.</p>
        <p>The numbers the rules use: near the trigger or the stop means a last close within {T.nearAtr} ATR; a late entry has used {T.lateUsed * 100}% of the move from the trigger to the target; a dividend matters to a stop at {T.dividendAtr} ATR, acted on within {T.exdivActDays} days and watched to {T.exdivWatchDays}; earnings count within {T.earningsDays} days; the source has kept a failed setup when {T.sourceSheets} or more weekly sheets still list it; the latest-price file is stale after {T.staleTipHours} hours.</p>
        <details class="ruledetails">
          <summary>Every rule</summary>
          <FlagTable />
        </details>
      </section>

      <section class="prose" aria-labelledby="m-kept">
        <h2 id="m-kept">What this browser keeps</h2>
        <p>Your edits to levels, setups added here, what you moved by hand, your acknowledgements, when you last looked at Today, the section you were in, and the journal are kept in this browser's own storage and nowhere else: there is no server. Clearing the site's data removes them. Export writes the setups, the journal and the acknowledgements to a file, and Import reads one back.</p>
        <p>These are this site's own keys. The first time it opened in this browser it copied what the old watchlist page had saved (its edits and its journal) into them, once; it never writes the old page's keys, and what the old page saves from then on does not reach this site, so a save on one cannot overwrite a save on the other. Another tab of this site is read before every save, so two tabs do not erase each other's.</p>
      </section>

      <footer class="foot">
        <p>Levels come from Tech Charts, whose reports are licensed. This is a record of rules applied to published levels, not investment advice.</p>
      </footer>
    </main>
  );
}
