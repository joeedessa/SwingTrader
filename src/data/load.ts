// Every data file is fetched from the page's own origin, relative to the base path,
// so this works at /SwingTrader/ on Pages and at / under the dev server.
export function dataUrl(name: string): string {
  return `${import.meta.env.BASE_URL}data/${name}`;
}

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
