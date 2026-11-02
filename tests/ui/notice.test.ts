import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismiss, notice, say } from '../../src/ui/notice';

describe('the notice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { dismiss(); vi.useRealTimers(); });

  it('says one thing at a time, and clears itself', () => {
    say('Saved.');
    expect(notice.get()).toMatchObject({ text: 'Saved.', tone: 'ok', action: null });
    vi.advanceTimersByTime(5999);
    expect(notice.get().text).toBe('Saved.');
    vi.advanceTimersByTime(2);
    expect(notice.get()).toMatchObject({ text: null, action: null });
  });

  it('can offer an action, which goes with the message', () => {
    const run = vi.fn();
    say('7 flags acknowledged.', 'ok', 8000, { label: 'Undo', run });
    expect(notice.get().action).toEqual({ label: 'Undo', run });
    notice.get().action!.run();
    expect(run).toHaveBeenCalledTimes(1);
    dismiss();
    expect(notice.get()).toMatchObject({ text: null, action: null });
  });

  it('a newer message is not cleared by the timer of an older one', () => {
    say('first', 'ok', 1000);
    vi.advanceTimersByTime(500);
    say('second', 'warn', 1000, { label: 'Undo', run: () => {} });
    vi.advanceTimersByTime(600);
    expect(notice.get()).toMatchObject({ text: 'second', tone: 'warn' });
    vi.advanceTimersByTime(500);
    expect(notice.get().text).toBeNull();
  });
});
