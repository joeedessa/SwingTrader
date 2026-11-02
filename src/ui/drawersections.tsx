import type { ComponentChildren } from 'preact';
import { ackable } from '../engine/flags';
import type { Flag } from '../engine/flags';
import type { TimelineItem } from '../engine/chips';
import { HEADLINES, fmtBig } from '../engine/earnings';
import type { EarningsView, Figure } from '../engine/earnings';
import { daysTag, fmt, fmtD, MINUS } from '../engine/format';
import { googleNewsUrl, newsUrl, chartUrl } from './links';
import { detailOf, kindLabel, TONE } from './flagview';
import type { AverageLine } from './mareads';

/* The parts of the setup drawer that read from the flag engine, the moving averages and the earnings feed. Each is a
   plain function of its props, so what it says can be read in a test. */

export function DSection({ title, children, action }: { title: string; children: ComponentChildren; action?: ComponentChildren }) {
  return (
    <section class="dsec">
      <header><h3>{title}</h3>{action}</header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ flags and events */

const EV_CLASS = { good: 'new', bad: 'bad', warn: 'warn', info: '' } as const;

export function FlagsSection({ timeline, onAck, onUndo }: {
  timeline: readonly TimelineItem[];
  onAck: (flags: Flag[]) => void;
  onUndo: (flags: Flag[]) => void;
}) {
  const open = timeline.filter(t => t.state === 'open' && ackable(t.flag)).map(t => t.flag);
  return (
    <DSection title="Flags and events"
      action={open.length > 1 ? <button type="button" class="linkbtn" onClick={() => onAck(open)}>Acknowledge all {open.length}</button> : undefined}>
      {timeline.length ? (
        <ol class="events tl">
          {timeline.map(({ flag: f, state }) => (
            <li class={'ev ' + EV_CLASS[TONE[f.kind]] + (state === 'past' ? ' past' : '')}>
              <span class="evdate">{f.when === 'live' ? 'Live' : fmtD(f.when)}</span>
              <span class="evtext">{detailOf(f)}</span>
              {state === 'open' && ackable(f)
                ? <button type="button" class="btn small evact" aria-label={'Acknowledge ' + kindLabel(f)} onClick={() => onAck([f])}>Acknowledge</button>
                : state === 'acked'
                  ? <span class="evact done">acknowledged <button type="button" class="linkbtn" aria-label={'Undo the acknowledgement of ' + kindLabel(f)} onClick={() => onUndo([f])}>Undo</button></span>
                  : null}
            </li>
          ))}
        </ol>
      ) : <p class="note">Nothing has happened to this setup yet.</p>}
      <p class="note">Rebuilt from the settled closes on every load. An event stays open until it is acknowledged, or for five sessions; the line stays here either way.</p>
    </DSection>
  );
}

/* ------------------------------------------------------------------ moving averages */

export function AveragesSection({ lines }: { lines: readonly AverageLine[] }) {
  return (
    <DSection title="Moving averages (daily)">
      <dl class="facts">
        {lines.map(l => (
          <div>
            <dt>{l.label}</dt>
            <dd>
              <span class={'maval ' + (l.above == null ? '' : l.above ? 'up' : 'down')}>{l.value}</span>
              {l.state ? <span class={'matag ' + l.state}>{l.state}</span> : null}
              {l.slope ? <span class={'maslope ' + l.slope.state}>{l.slope.glyph} {l.slope.label}</span> : null}
              <p class="note">{l.text}</p>
            </dd>
          </div>
        ))}
      </dl>
      <p class="note">Simple averages of settled closes. A level test is shown while price is still near the line, with "near" scaled to how much the name normally moves.</p>
    </DSection>
  );
}

/* ------------------------------------------------------------------ earnings and news */

const Verdict = ({ f, suffix = '%' }: { f: Figure; suffix?: string }) => (
  <span class={f.good ? 'tone-good' : 'tone-bad'}>{(f.value > 0 ? '+' : f.value < 0 ? MINUS : '') + Math.abs(f.value) + suffix}</span>
);

export function EarningsSection({ v, ccy, today, sym, name, live }: {
  v: EarningsView;
  ccy: string;
  today: string;
  sym: string;
  name: string;
  live: number | null;
}) {
  const unit = ccy ? ' ' + ccy : '';
  const last = v.last;
  const tag = v.next.date ? daysTag(v.next.date, today) : null;
  return (
    <DSection title="Earnings and news">
      {v.latest ? <p class="note">Latest activity {fmtD(v.latest)}.</p> : null}

      <div class="eblock">
        <h4>Last reported{last ? <span class="ewhen"> · {fmtD(last.reported)}{last.when ? ', ' + last.when : ''}</span> : null}</h4>
        {last ? (
          <dl class="facts">
            {last.eps ? (
              <div><dt>EPS</dt><dd><b>{last.eps.actual}</b>{last.eps.estimate != null ? <> vs {last.eps.estimate} est </> : null}
                {last.eps.surprise ? <Verdict f={last.eps.surprise} /> : last.eps.estimate == null ? ' (no consensus on file)' : null}</dd></div>
            ) : null}
            {last.revenue ? (
              <div><dt>Revenue</dt><dd><b>{fmtBig(last.revenue.actual)}{unit}</b>{last.revenue.estimate != null ? <> vs {fmtBig(last.revenue.estimate)} est </> : null}
                {last.revenue.surprise ? <Verdict f={last.revenue.surprise} /> : null}</dd></div>
            ) : null}
            {last.epsYoy ? <div><dt>EPS year on year</dt><dd><Verdict f={last.epsYoy} /></dd></div> : null}
            {last.reaction ? (
              <div><dt>Market reaction</dt><dd><span class={last.reaction.good ? 'tone-good' : 'tone-bad'}>{(last.reaction.pct > 0 ? '+' : last.reaction.pct < 0 ? MINUS : '') + Math.abs(last.reaction.pct) + '%'}</span> on {fmtD(last.reaction.when)}</dd></div>
            ) : null}
          </dl>
        ) : <p class="note">No reported result in the feed.</p>}
      </div>

      {v.wire ? (
        <div class="eblock">
          <h4>On the wire</h4>
          {v.wire.cues.length ? <ul class="cues">{v.wire.cues.map(c => <li class={'cue ' + c.tone}>{c.text}</li>)}</ul> : null}
          <ul class="heads">
            {v.wire.heads.slice(0, HEADLINES).map(h => (
              <li><a href={h.u} target="_blank" rel="noopener noreferrer">{h.t}</a><span class="hsrc">{fmtD(h.d)}{h.s ? ' · ' + h.s : ''}</span></li>
            ))}
          </ul>
          <p class="note">The tags classify the language of the headlines only; no number is read out of the text.</p>
        </div>
      ) : null}

      <div class="eblock">
        <h4>Next report{v.next.date ? <span class="ewhen"> · {fmtD(v.next.date)}{v.next.when ? ', ' + v.next.when : ''}{tag ? <> <span class={'days ' + tag.cls}>{tag.text}</span></> : null}</span> : null}</h4>
        {v.next.date ? (
          v.next.eps != null || v.next.revenue != null ? (
            <dl class="facts"><div><dt>Consensus</dt><dd>
              {v.next.eps != null ? <><b>{v.next.eps}</b> EPS</> : null}
              {v.next.eps != null && v.next.revenue != null ? ' · ' : null}
              {v.next.revenue != null ? <><b>{fmtBig(v.next.revenue)}{unit}</b> revenue</> : null}
            </dd></div></dl>
          ) : <p class="note">No consensus estimates on file for the coming quarter.</p>
        ) : <p class="note">No scheduled date in the feed.</p>}
      </div>

      {v.street ? (
        <div class="eblock">
          <h4>Street view</h4>
          <dl class="facts">
            {v.street.targetAvg != null ? (
              <div><dt>Consensus target</dt><dd><b>{fmt(v.street.targetAvg)}{unit}</b>
                {v.street.vsLive && live != null ? <> · <Verdict f={v.street.vsLive} /> vs live</> : null}</dd></div>
            ) : null}
            {v.street.yours ? <div><dt>Your target</dt><dd><b>{fmt(v.street.yours.target)}{unit}</b> · the street is {v.street.yours.streetIs} yours</dd></div> : null}
            {v.street.analysts ? (
              <div><dt>Analysts</dt><dd><b>{v.street.analysts.total}</b> covering · <span class="tone-good">{v.street.analysts.bullish} bullish</span> · {v.street.analysts.hold} hold · <span class="tone-bad">{v.street.analysts.bearish} bearish</span></dd></div>
            ) : null}
          </dl>
          <p class="note">Analyst consensus, not company guidance: that is not available from a free feed.</p>
        </div>
      ) : null}

      <p class="dlinks">
        <a href={newsUrl(sym)} target="_blank" rel="noopener noreferrer">Yahoo news</a>
        <a href={googleNewsUrl(name, sym)} target="_blank" rel="noopener noreferrer">Google News</a>
        <a href={chartUrl(sym)} target="_blank" rel="noopener noreferrer">Chart</a>
      </p>
    </DSection>
  );
}
