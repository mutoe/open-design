import { describe, expect, test } from 'vitest';

import { resolvePageLayoutWidth, type PageColumnExtent } from '../../src/main/deck-capture.js';
import { planCdpCaptureBands } from '../../src/main/pdf-export.js';

// Chromium composites captureBeyondViewport into one GPU surface that WRAPS
// AROUND past 16384 device px (the page start renders again at the seam, with
// sticky chrome re-stuck there, and the true tail is lost). Tall captures must
// therefore split into clip bands that each stay under the limit.
describe('planCdpCaptureBands', () => {
  test('a page within the surface limit stays one full capture', () => {
    expect(planCdpCaptureBands(7410, 2, 16384)).toEqual([{ y: 0, height: 7410 }]);
    // Exactly at the limit: 8192 * 2 = 16384.
    expect(planCdpCaptureBands(8192, 2, 16384)).toEqual([{ y: 0, height: 8192 }]);
  });

  test('a page past the limit splits into contiguous bands of half the limit', () => {
    // 10253 CSS px @2x = 20506 device px (the miniapp promo page).
    expect(planCdpCaptureBands(10253, 2, 16384)).toEqual([
      { y: 0, height: 4096 },
      { y: 4096, height: 4096 },
      { y: 8192, height: 2061 },
    ]);
  });

  test('bands cover the document exactly with no gap or overlap', () => {
    const bands = planCdpCaptureBands(25000, 2, 16384);
    let cursor = 0;
    for (const band of bands) {
      expect(band.y).toBe(cursor);
      expect(band.height).toBeGreaterThan(0);
      expect(band.height * 2).toBeLessThanOrEqual(16384);
      cursor += band.height;
    }
    expect(cursor).toBe(25000);
  });

  test('degenerate heights still produce one sane band', () => {
    expect(planCdpCaptureBands(0, 2, 16384)).toEqual([{ y: 0, height: 1 }]);
  });
});

// A long page with an author-capped centered column (max-width + margin:auto)
// re-lays out at the column width so the page background doesn't export as
// wide flanks. The decision is deliberately conservative.
describe('resolvePageLayoutWidth', () => {
  function column(overrides: Partial<PageColumnExtent>): PageColumnExtent {
    return {
      l: 296,
      r: 1216,
      viewportW: 1512,
      viewportH: 1048,
      scrollH: 7410,
      bodyPadX: 0,
      ...overrides,
    };
  }

  test('a centered 920px column on a long page narrows to the column width', () => {
    expect(resolvePageLayoutWidth(column({}), 1512)).toBe(920);
  });

  test('body horizontal padding survives as page-level gutters', () => {
    // body { padding: 40px 24px } around a fixed-width card: without the
    // gutters the card would overflow the narrowed viewport.
    expect(resolvePageLayoutWidth(column({ bodyPadX: 48 }), 1512)).toBe(968);
  });

  test('a single-viewport page is left to the content-box crop', () => {
    expect(resolvePageLayoutWidth(column({ scrollH: 1048 }), 1512)).toBeNull();
  });

  test('near-full-width content keeps the requested width', () => {
    expect(resolvePageLayoutWidth(column({ l: 10, r: 1500 }), 1512)).toBeNull();
  });

  test('implausibly narrow columns keep the requested width', () => {
    expect(resolvePageLayoutWidth(column({ l: 600, r: 800 }), 1512)).toBeNull();
  });

  test('no measurable column keeps the requested width', () => {
    expect(resolvePageLayoutWidth(null, 1512)).toBeNull();
  });
});
