import { Store } from '../store';

/** One short message at a time: what an action just did, or why it could not. It clears itself. */
export interface NoticeState {
  text: string | null;
  tone: 'ok' | 'warn';
  id: number;
}

export const notice = new Store<NoticeState>({ text: null, tone: 'ok', id: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;

export function say(text: string, tone: 'ok' | 'warn' = 'ok', ms = 6000): void {
  const id = notice.get().id + 1;
  notice.set({ text, tone, id });
  clearTimeout(timer);
  timer = setTimeout(() => { if (notice.get().id === id) notice.set({ text: null }); }, ms);
}

export const dismiss = (): void => notice.set({ text: null });
