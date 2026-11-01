/* Every data file is fetched from the page's own origin, relative to the base path, so this works at
   /SwingTrader/ on Pages and under the dev server. The files change hourly, so each is revalidated rather
   than trusted from cache: a 304 costs a round trip, not the 3 MB of bars. */
export function dataUrl(name: string): string {
  return `${import.meta.env.BASE_URL}data/${name}`;
}

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
