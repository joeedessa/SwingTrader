/** Where a ticker links to: straight to the chart, which works for every symbol on the list, US and otherwise.
    (The bare /chart/SYM route is reliable for US tickers only.) Nothing here is fetched; it is an href. */
export const chartUrl = (sym: string): string => 'https://finance.yahoo.com/quote/' + encodeURIComponent(sym) + '/chart';
