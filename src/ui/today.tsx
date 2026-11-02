import { useEffect, useMemo } from 'preact/hooks';
import { ackStore, acknowledge, unacknowledge } from '../data/acks';
import { app, load } from '../data/app';
import { boardView, flagsOf, todayOf } from '../data/selectors';
import { visits } from '../data/visit';
import { dataInfo, publish, publishToday } from '../debug';
import { setupEvents, weekLog } from '../engine/events';
import type { LogItem } from '../engine/events';
import type { Flag } from '../engine/flags';
import { ackable } from '../engine/flags';
import { fmtDay } from '../engine/format';
import type { Row } from '../engine/row';
import { tapeOf } from '../engine/tape';
import type { Tape } from '../engine/tape';
import { shownIds } from '../engine/today';
import type { Group, ShownTier, TierView } from '../engine/today';
import { go } from '../router';
import { Store, useStore } from '../store';
import { Choice, Segmented } from './components';
import { DataLine } from './dataline';
import { DrawerHost } from './drawerhost';
import { detailOf, figureView, GROUP_RULE, GROUP_TITLE, kindLabel, previewOf, sinceLabel, summaryOf, TONE, whenOf } from './flagview';
import { useNarrow } from './hooks';
import { IconCheck, IconChevron, IconRefresh } from './icons';
import { say } from './notice';

/* Today: what needs a decision this morning, and what changed since the last look.

   Everything on it is a flag the engine raised (flags.ts), rebuilt from the bars on every load. The page only sorts
   them out for a person: the live conditions in a strip of their own, then one tier at a time, each tier's flags
   grouped by kind so that dozens of them read as a handful of lines. A flag is acknowledged with a tap, and then waits
   in a folded group until the day is over. */

type Week = 'this' | 'last';

interface TodayUi {
  /** The tier the person chose; null opens on the most urgent one that has anything in it. */
  tier: ShownTier | null;
  /** Groups opened or folded by hand, keyed `tier:kind`. */
  folds: Record<string, boolean>;
  week: Week;
}

/** Kept for the length of the visit, so a trip into a setup's drawer or another page leaves Today as it was. */
export const todayUi = new Store<TodayUi>({ tier: null, folds: {}, week: 'this' });

/** A group with this many flags or fewer opens by itself; a longer one shows its names and waits to be opened. */
export const GROUP_OPEN_UP_TO = 3;

const isOpen = (tier: ShownTier, g: Group, folds: Record<string, boolean>): boolean =>
  folds[tier + ':' + g.kind] ?? g.flags.length <= GROUP_OPEN_UP_TO;

const PANEL = 'today-flags';

/* ------------------------------------------------------------------ pieces */

export function TapeLine({ tape }: { tape: Tape }) {
  const tone = tape.tone === 'bad' ? 'bad' : tape.tone === 'warn' ? 'warn' : 'good';
  return (
    <p class="tape" aria-label="The tape">
      <span class="meter" aria-hidden="true"><i class={'tone-fill-' + tone} style={{ width: tape.pctDown + '%' }} /></span>
      <span>
        <strong>{tape.down} of {tape.known} down today</strong>
        <span class="read"> · {tape.pctDown}% · {tape.read}</span>
      </span>
    </p>
  );
}

export function FlagRow({ f, today, isNew, onOpen, onAck, onUndo }: {
  f: Flag;
  today: string;
  isNew: boolean;
  onOpen: (f: Flag) => void;
  /** Present on an open flag that can be acknowledged. */
  onAck?: (f: Flag) => void;
  /** Present on an acknowledged one. */
  onUndo?: (f: Flag) => void;
}) {
  const when = whenOf(f, today);
  const fig = f.figure ? figureView(f.figure) : null;
  const who = `${f.sym} ${f.dir}, ${kindLabel(f)}`;
  return (
    <li class={'flag' + (onUndo ? ' done' : '')}>
      <button type="button" class="hit" aria-label={who + ': open details'} onClick={() => onOpen(f)} />
      <span class="gutter">{isNew ? <span class="newdot" role="img" aria-label="New since your last visit" /> : null}</span>
      <div class="flagmain">
        <div class="flagtitle">
          <span class="flagsym">{f.sym}</span>
          <span class={'dirpill ' + f.dir}>{f.dir}</span>
          <span class={'flagkind tone-' + TONE[f.kind]}>{kindLabel(f)}</span>
        </div>
        <p class="flagdetail">{detailOf(f)}</p>
      </div>
      <div class="flagmeta">
        {fig ? (
          <div class="flagfig">
            <div class="v">{fig.value}{fig.ccy ? <span class="ccy">{fig.ccy}</span> : null}</div>
            <div class="s">{fig.sub}</div>
          </div>
        ) : null}
        <div class="flagwhen">
          <div class="v">{when.main}</div>
          {when.sub ? <div class="s">{when.sub}</div> : null}
        </div>
      </div>
      {onUndo ? (
        <button type="button" class="btn small undo" onClick={() => onUndo(f)}>Undo</button>
      ) : onAck && ackable(f) ? (
        <button type="button" class="ackbtn" aria-label={'Acknowledge ' + who} title="Acknowledge" onClick={() => onAck(f)}><IconCheck /></button>
      ) : <span class="noack" />}
    </li>
  );
}

function GroupView({ tier, g, open, today, fresh, onToggle, onOpen, onAck }: {
  tier: ShownTier;
  g: Group;
  open: boolean;
  today: string;
  /** The ids not on screen at the last visit. */
  fresh: ReadonlySet<string>;
  onToggle: () => void;
  onOpen: (f: Flag) => void;
  onAck: (fs: Flag[]) => void;
}) {
  const id = PANEL + '-' + tier + '-' + g.kind;
  return (
    <section class="flaggroup" aria-label={GROUP_TITLE[g.kind]}>
      <div class="ghead">
        <button type="button" class="gtoggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span class="gchev" aria-hidden="true"><IconChevron /></span>
          <span class="gtitle">{GROUP_TITLE[g.kind]}</span>
          <span class="gcount">{g.flags.length}</span>
          <span class="grule">{GROUP_RULE[g.kind]}</span>
          {g.fresh ? <span class="gnew">{g.fresh} new</span> : null}
        </button>
        <button type="button" class="linkbtn groupack" onClick={() => onAck(g.flags)}>Acknowledge<span class="wideonly"> {g.flags.length === 1 ? 'it' : 'all'}</span></button>
      </div>
      {open ? (
        <ul class="flags" id={id}>
          {g.flags.map(f => <FlagRow key={f.id} f={f} today={today} isNew={fresh.has(f.id)} onOpen={onOpen} onAck={a => onAck([a])} />)}
        </ul>
      ) : <button type="button" class="gpreview" id={id} onClick={onToggle}>{previewOf(g.flags)}</button>}
    </section>
  );
}

export function LiveNow({ flags, today, fresh, status, marketsOpen, onOpen }: {
  flags: Flag[];
  today: string;
  fresh: ReadonlySet<string>;
  status: 'idle' | 'loading' | 'ok' | 'failed';
  marketsOpen: boolean;
  onOpen: (f: Flag) => void;
}) {
  if (!flags.length) {
    const text = status === 'failed' ? 'Live prices are unavailable, so live flags cannot be raised: showing the last snapshot.'
      : status === 'loading' ? 'Checking live prices…'
      : marketsOpen ? 'Markets are open; nothing live needs you.' : 'No live flags; markets shut.';
    return <p class="livequiet"><span class={'dot ' + (status === 'failed' ? 'warn' : '')} aria-hidden="true" />{text}</p>;
  }
  return (
    <section class="livebox" aria-label="Live now">
      <div class="ghead"><span class="gtitle"><span class="livedot">Live now</span></span><span class="gcount">{flags.length}</span></div>
      <ul class="flags">
        {flags.map(f => <FlagRow key={f.id} f={f} today={today} isNew={fresh.has(f.id)} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

function Acked({ flags, today, onOpen, onUndo }: { flags: Flag[]; today: string; onOpen: (f: Flag) => void; onUndo: (fs: Flag[]) => void }) {
  if (!flags.length) return null;
  return (
    <details class="folded acked">
      <summary>
        <span class="gchev" aria-hidden="true"><IconChevron /></span>
        <span class="gtitle">Acknowledged today</span><span class="gcount">{flags.length}</span>
        <span class="grule">they leave Today at midnight</span>
      </summary>
      <ul class="flags">
        {flags.map(f => <FlagRow key={f.id} f={f} today={today} isNew={false} onOpen={onOpen} onUndo={x => onUndo([x])} />)}
      </ul>
    </details>
  );
}

export function WeeklyLog({ rows, now, week, onWeek, onOpen }: {
  rows: Row[];
  now: number;
  week: Week;
  onWeek: (w: Week) => void;
  onOpen: (sym: string, dir: 'long' | 'short') => void;
}) {
  const items = useMemo(() => rows.flatMap(setupEvents), [rows]);
  const at = new Date(now);
  const logs: Record<Week, LogItem[]> = { this: weekLog(items, 'this', at), last: weekLog(items, 'last', at) };
  const shown = logs[week];
  return (
    <details class="folded weeklog">
      <summary>
        <span class="gchev" aria-hidden="true"><IconChevron /></span>
        <span class="gtitle">Weekly log</span>
        <span class="gcount">{logs.this.length} this week · {logs.last.length} last</span>
        <span class="grule">every event, whether or not it is acknowledged</span>
      </summary>
      <div class="logbar">
        <Choice label="Week" value={week} onChange={onWeek} items={[{ id: 'this', label: 'This week' }, { id: 'last', label: 'Last week' }]} />
      </div>
      {shown.length ? (
        <ol class="events log">
          {shown.map(it => (
            <li class={'ev ' + it.cls}>
              <span class="evdate">{it.when === 'live' ? 'Live' : fmtDay(it.when)}</span>
              <button type="button" class="evtext linklike" onClick={() => onOpen(it.sym, it.dir)}>{it.text}</button>
            </li>
          ))}
        </ol>
      ) : <p class="note">Nothing happened {week === 'this' ? 'this' : 'last'} week.</p>}
    </details>
  );
}

/* ------------------------------------------------------------------ the page */

export function TodayPage() {
  const s = useStore(app);
  const acks = useStore(ackStore);
  const visit = useStore(visits.state);
  const ui = useStore(todayUi);
  const narrow = useNarrow();
  const { bd, today } = boardView(s, 'watchlist');
  const ready = s.phase === 'ready';
  const loading = s.phase === 'loading';

  const seen = useMemo(() => (visit.since ? new Set(visit.since.seen) : null), [visit.since]);
  const view = useMemo(() => todayOf(s, 'watchlist', seen), [s, acks.acks.watchlist, seen]);
  const tape = useMemo(() => tapeOf(bd.rows), [bd]);
  const fresh = useMemo(() => new Set(view.newIds), [view]);

  const tier: ShownTier = ui.tier ?? (view.act.count || !view.watch.count ? 'act' : 'watch');
  const tv: TierView = view[tier];

  /* Looking at a tier is what makes its flags seen; the other tier is a count and a dot until it is opened. */
  const seenKey = shownIds(view, tier).join(' ');
  useEffect(() => { if (ready) visits.noteShown(shownIds(view, tier)); }, [ready, tier, seenKey]);
  useEffect(() => {
    if (!ready) return;
    publish('watchlist', bd, bd.counts, s.problems, flagsOf(s, 'watchlist'), dataInfo(s));
    publishToday(view, visit.since ? visit.since.at : null);
  }, [ready, view, bd, s.problems]);
  const since = sinceLabel(visit.since);

  const open = (f: Flag) => { if (f.sym && f.dir) go({ page: 'today', row: { sym: f.sym, dir: f.dir } }); };

  /* An acknowledgement is quiet and can be undone for a few seconds, from the message or from the folded group.
     A row that is acknowledged by keyboard leaves the list, so focus moves to the next row's tick rather than to nowhere. */
  const ack = (fs: Flag[]) => {
    const list = fs.filter(ackable);
    if (!list.length) return;
    const ids = list.map(f => f.id);
    const here = document.activeElement;
    const row = here instanceof HTMLElement && here.classList.contains('ackbtn') ? here.closest('li.flag') : null;
    const next = row ? (row.nextElementSibling ?? row.previousElementSibling)?.querySelector<HTMLElement>('.ackbtn') : null;
    acknowledge('watchlist', ids);
    if (next) setTimeout(() => next.focus(), 0);
    const text = list.length === 1 ? `${list[0].sym} ${kindLabel(list[0]).toLowerCase()} acknowledged.` : `${list.length} flags acknowledged.`;
    say(text, 'ok', 8000, { label: 'Undo', run: () => unacknowledge('watchlist', ids) });
  };
  const undo = (fs: Flag[]) => unacknowledge('watchlist', fs.map(f => f.id));
  const allOfTier = tv.groups.flatMap(g => g.flags);

  const toggle = (g: Group) => todayUi.set(u => ({ folds: { ...u.folds, [tier + ':' + g.kind]: !isOpen(tier, g, u.folds) } }));

  let body;
  if (s.phase === 'error') {
    body = (
      <div class="empty" role="alert">
        <p>{s.error}</p>
        <button type="button" class="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (loading) {
    body = <div class="empty" aria-busy="true"><p>Loading flags…</p></div>;
  } else if (!tv.groups.length) {
    const other = tier === 'act' ? view.watch : view.act;
    body = (
      <div class="empty" id={PANEL}>
        <p>{tier === 'act' ? 'Nothing needs a decision.' : 'Nothing is worth a look.'}</p>
        {other.count ? (
          <button type="button" class="btn" onClick={() => todayUi.set({ tier: tier === 'act' ? 'watch' : 'act' })}>
            {other.count} {tier === 'act' ? 'to look at' : 'to decide'}
          </button>
        ) : <p class="note">Every flag is acknowledged, or has aged out of the last five sessions.</p>}
      </div>
    );
  } else {
    body = (
      <div id={PANEL} role="tabpanel" aria-label={tier === 'act' ? 'Needs a decision' : 'Worth a look'}>
        {tv.groups.map(g => (
          <GroupView key={tier + g.kind} tier={tier} g={g} open={isOpen(tier, g, ui.folds)} today={today} fresh={fresh}
            onToggle={() => toggle(g)} onOpen={open} onAck={ack} />
        ))}
      </div>
    );
  }

  return (
    <>
      <main class="page today" data-underlay>
        <header class="hero">
          <div class="herotext">
            <h1>Today</h1>
            <p class="stamp">{loading ? 'Loading…' : <>{fmtDay(today)} · {summaryOf(view)}</>}</p>
          </div>
          <div class="heroactions">
            <button type="button" class={'btn primary refresh' + (narrow ? ' round' : '')} aria-label="Refresh prices" aria-busy={s.refreshing} disabled={s.refreshing} onClick={() => void load()}>
              <IconRefresh /><span>Refresh</span>
            </button>
          </div>
        </header>

        {ready && tape ? <TapeLine tape={tape} /> : null}
        {ready ? <LiveNow flags={view.live} today={today} fresh={fresh} status={s.liveStatus} marketsOpen={bd.rows.some(r => r.isLive)} onOpen={open} /> : null}

        <div class="segbar">
          <Segmented label="Tier" panelId={PANEL} value={tier} onChange={t => todayUi.set({ tier: t as ShownTier })}
            items={[
              { id: 'act', label: 'Needs a decision', short: 'Act', ...(ready ? { count: view.act.count, dot: view.act.fresh > 0 } : {}) },
              { id: 'watch', label: 'Worth a look', short: 'Watch', ...(ready ? { count: view.watch.count, dot: view.watch.fresh > 0 } : {}) },
            ]} />
        </div>

        {ready && tv.count ? (
          <div class="listhead">
            <span>
              {since == null
                ? 'First look on this device: nothing to compare with yet.'
                : tv.fresh ? <><strong class="newcount">{tv.fresh} new</strong> since {since}</> : <>Nothing new since {since}</>}
            </span>
            <button type="button" class="linkbtn" onClick={() => ack(allOfTier)}>Acknowledge all {tv.count}</button>
          </div>
        ) : null}

        <div class="panel">{body}</div>

        {ready ? <Acked flags={view.acked} today={today} onOpen={open} onUndo={undo} /> : null}
        {ready ? <WeeklyLog rows={bd.rows} now={s.now} week={ui.week} onWeek={w => todayUi.set({ week: w })} onOpen={(sym, dir) => go({ page: 'today', row: { sym, dir } })} /> : null}

        <section class="dataarea" aria-label="Data">
          <DataLine set="watchlist" />
          {view.data.map(f => <p class="dataline warn">{f.text}. <a class="datalink" href={f.route}>Method</a></p>)}
          {acks.saveFailed ? <p class="dataline bad">This browser would not save the last acknowledgement, so it will be gone on reload.</p> : null}
        </section>

        <footer class="foot">
          <p>Flags are rebuilt from settled closes on every load; a live price only ever adds a live flag. Acknowledgements are kept in this browser only, and a flag you leave alone drops off Today after five sessions. Not investment advice.</p>
        </footer>
      </main>

      <DrawerHost set="watchlist" bd={bd} today={today} loading={loading} />
    </>
  );
}
