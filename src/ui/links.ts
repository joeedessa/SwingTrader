/** Where a ticker links to: straight to the chart, which works for every symbol on the list, US and otherwise.
    (The bare /chart/SYM route is reliable for US tickers only.) Nothing here is fetched; it is an href. */
export const chartUrl = (sym: string): string => 'https://finance.yahoo.com/quote/' + encodeURIComponent(sym) + '/chart';

/** Where a name's news is, on Yahoo and as a Google News search by its name. Nothing is fetched; these are hrefs. */
export const newsUrl = (sym: string): string => 'https://finance.yahoo.com/quote/' + encodeURIComponent(sym) + '/news';
export const googleNewsUrl = (name: string, sym: string): string => 'https://news.google.com/search?q=' + encodeURIComponent((name || sym) + ' stock');
