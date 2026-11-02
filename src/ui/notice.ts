import { Store } from '../store';

/** One short message at a time: what an action just did, or why it could not. It clears itself.
    An action it offers (Undo) is run once and clears the message. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface NoticeState {
  text: string | null;
  tone: 'ok' | 'warn';
  id: number;
  action: NoticeAction | null;
}

export const notice = new Store<NoticeState>({ text: null, tone: 'ok', id: 0, action: null });

let timer: ReturnType<typeof setTimeout> | undefined;

export function say(text: string, tone: 'ok' | 'warn' = 'ok', ms = 6000, action: NoticeAction | null = null): void {
  const id = notice.get().id + 1;
  notice.set({ text, tone, id, action });
  clearTimeout(timer);
  timer = setTimeout(() => { if (notice.get().id === id) notice.set({ text: null, action: null }); }, ms);
}

export const dismiss = (): void => notice.set({ text: null, action: null });
