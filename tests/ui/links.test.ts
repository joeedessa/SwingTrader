import { describe, expect, it } from 'vitest';
import { chartUrl } from '../../src/ui/links';

describe('chartUrl', () => {
  it('goes straight to the chart, and encodes what needs it', () => {
    expect(chartUrl('TVE.TO')).toBe('https://finance.yahoo.com/quote/TVE.TO/chart');
    expect(chartUrl('^GSPC')).toBe('https://finance.yahoo.com/quote/%5EGSPC/chart');
    expect(chartUrl('GC=F')).toBe('https://finance.yahoo.com/quote/GC%3DF/chart');
    expect(chartUrl('ROKO-B.ST')).toBe('https://finance.yahoo.com/quote/ROKO-B.ST/chart');
  });
});
