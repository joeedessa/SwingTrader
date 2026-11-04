import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIST_BEGAN, SIZINGS, STRATEGY_IDS } from '../../src/engine/backtest/settings';
import { cleanLabel, DEFAULT_VIEW, engineSettings, modelQuery, parseModelQuery, PCT_MAX, readNumber, TRADE_SORTS, UNITS_MAX } from '../../src/ui/modelurl';
import type { ModelView } from '../../src/ui/modelurl';

/* The Model's dials in the address: a scenario is a link. Only what differs from the defaults is written, everything
   survives a round trip, and anything unreadable falls back to its default. */

describe('the Model\'s address', () => {
  it('is empty for the defaults, and reads back as them', () => {
    expect(modelQuery(DEFAULT_VIEW)).toBe('');
    expect(parseModelQuery('')).toEqual(DEFAULT_VIEW);
    expect(parseModelQuery(undefined)).toEqual(DEFAULT_VIEW);
    expect(parseModelQuery(null)).toEqual(DEFAULT_VIEW);
  });

  it('writes every dial that moved, and reads each back', () => {
    const v: ModelView = {
      settings: { ...DEFAULT_SETTINGS, entry: 'close', importedEntry: 'close', targetOn: 'touch', reentryStop: 'new', removed: 'exclude', from: 'list', commissionPct: 0.05, slippagePct: 0, size: 5000, riskUnits: 250, maxSize: 12000 },
      strategy: 'S2-2', sizing: 'risk', scope: 'closed', label: 'USD', sort: 'best',
    };
    const q = modelQuery(v);
    expect(q).toBe('s=S2-2&sz=risk&scope=closed&entry=close&imp=close&tgt=touch&re=new&rm=exclude&from=list&c=0.05&sl=0&n=5000&r=250&max=12000&cur=USD&sort=best');
    expect(parseModelQuery(q)).toEqual(v);
  });

  it('round-trips every strategy, sizing and order, and the entry at the trigger', () => {
    for (const strategy of STRATEGY_IDS) expect(parseModelQuery(modelQuery({ ...DEFAULT_VIEW, strategy })).strategy).toBe(strategy);
    expect(STRATEGY_IDS[0]).toBe('S0');
    const trigger: ModelView = { ...DEFAULT_VIEW, settings: { ...DEFAULT_SETTINGS, entry: 'trigger' } };
    expect(modelQuery(trigger)).toBe('entry=trigger');
    expect(parseModelQuery('entry=trigger')).toEqual(trigger);
    for (const sizing of SIZINGS) expect(parseModelQuery(modelQuery({ ...DEFAULT_VIEW, sizing })).sizing).toBe(sizing);
    for (const sort of TRADE_SORTS) expect(parseModelQuery(modelQuery({ ...DEFAULT_VIEW, sort })).sort).toBe(sort);
  });

  it('falls back to the default for a dial it cannot read, and keeps the ones it can', () => {
    const v = parseModelQuery('s=S9&sz=huge&scope=some&entry=sideways&tgt=touch&c=-1&sl=abc&n=1e12&r=&max=200&cur=&sort=nope&from=yes');
    expect(v.strategy).toBe(DEFAULT_VIEW.strategy);
    expect(v.sizing).toBe(DEFAULT_VIEW.sizing);
    expect(v.scope).toBe(DEFAULT_VIEW.scope);
    expect(v.settings.entry).toBe(DEFAULT_SETTINGS.entry);
    expect(v.settings.targetOn).toBe('touch');
    expect(v.settings.commissionPct).toBe(DEFAULT_SETTINGS.commissionPct);
    expect(v.settings.slippagePct).toBe(DEFAULT_SETTINGS.slippagePct);
    expect(v.settings.size).toBe(DEFAULT_SETTINGS.size);
    expect(v.settings.riskUnits).toBe(DEFAULT_SETTINGS.riskUnits);
    expect(v.settings.maxSize).toBe(200);
    expect(v.label).toBe(DEFAULT_VIEW.label);
    expect(v.sort).toBe(DEFAULT_VIEW.sort);
    expect(v.settings.from).toBeNull();
  });

  it('keeps the bootstrap fixed: the resamples and the seed are not dials, so a link reproduces its interval', () => {
    const v = parseModelQuery('resamples=5&seed=99');
    expect(v.settings.resamples).toBe(DEFAULT_SETTINGS.resamples);
    expect(v.settings.seed).toBe(DEFAULT_SETTINGS.seed);
  });

  it('turns the "from" dial into the day the list began for the engine, and nothing else changes', () => {
    const v = parseModelQuery('from=list');
    expect(v.settings.from).toBe('list');
    const s = engineSettings(v, LIST_BEGAN);
    expect(s.from).toBe(LIST_BEGAN);
    expect({ ...s, from: null }).toEqual(DEFAULT_SETTINGS);
    expect(engineSettings(DEFAULT_VIEW, LIST_BEGAN).from).toBeNull();
  });

  it('reads a number field as a number from zero to the cap, and nothing else', () => {
    expect(readNumber('0.15', PCT_MAX)).toBe(0.15);
    expect(readNumber(' 0 ', PCT_MAX)).toBe(0);
    expect(readNumber('', PCT_MAX)).toBeNull();
    expect(readNumber('abc', PCT_MAX)).toBeNull();
    expect(readNumber('-5', PCT_MAX)).toBeNull();
    expect(readNumber('150', PCT_MAX)).toBeNull();
    expect(readNumber('1e12', UNITS_MAX)).toBeNull();
    expect(readNumber('20000', UNITS_MAX)).toBe(20000);
  });

  it('keeps the currency label a short word', () => {
    expect(cleanLabel('  USD ')).toBe('USD');
    expect(cleanLabel('€')).toBe('€');
    expect(cleanLabel('₺')).toBe('₺');
    expect(cleanLabel('₩ won')).toBe('₩ won');
    expect(cleanLabel('<script>')).toBe('script');
    expect(cleanLabel('a very long currency name indeed')).toBe('a very long');
    expect(cleanLabel('   ')).toBe('units');
    expect(parseModelQuery('cur=%3Cb%3EGBP').label).toBe('bGBP');
  });
});
