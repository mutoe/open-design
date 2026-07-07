import { describe, expect, test } from 'vitest';

import { resolvePageCaptureCrop, type PageContentExtent } from '../../src/main/deck-capture.js';

// Ordinary-page image export lays the document out in a fixed 1440x1000
// off-screen viewport. `scrollHeight` can never report less than the viewport
// height, so a page whose content occupies less than one screen used to export
// as the full viewport with the page background filling the border (the
// "exported PNG has a background halo" bug). resolvePageCaptureCrop decides
// when the capture may shrink to the measured content box instead.
const VIEWPORT = { w: 1440, h: 1000 };

function extent(overrides: Partial<PageContentExtent>): PageContentExtent {
  return {
    scrollW: VIEWPORT.w,
    scrollH: VIEWPORT.h,
    union: null,
    body: null,
    backdropPaintsDesign: false,
    ...overrides,
  };
}

describe('resolvePageCaptureCrop', () => {
  test('a centered card smaller than the viewport crops to the card box', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: 320, t: 8, r: 1120, b: 608 },
        // Default body: block-stretched to the viewport width minus the UA 8px
        // margin, auto height wrapping the card. Its near-viewport width must
        // NOT veto the horizontal crop.
        body: { l: 8, t: 8, r: 1432, b: 608 },
      }),
      VIEWPORT,
    );
    expect(crop).toEqual({ x: 320, y: 8, width: 800, height: 600 });
  });

  test('a viewport-centering body (min-height:100vh flex) still crops to the card', () => {
    // The most common artifact shape: body { min-height: 100vh; display: flex;
    // place-items: center } around one poster/card. The body box fills the
    // viewport, so it must not veto the crop on either axis.
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: 320, t: 200, r: 1120, b: 800 },
        body: { l: 0, t: 0, r: 1440, b: 1000 },
      }),
      VIEWPORT,
    );
    expect(crop).toEqual({ x: 320, y: 200, width: 800, height: 600 });
  });

  test('full-width content that is shorter than the viewport crops height only', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: 0, t: 0, r: 1440, b: 420 },
        body: { l: 0, t: 0, r: 1440, b: 420 },
      }),
      VIEWPORT,
    );
    expect(crop).toEqual({ x: 0, y: 0, width: 1440, height: 420 });
  });

  test('an author-constrained body contributes its own padding box to the crop', () => {
    // body { width: 800px; height: 600px; padding: 40px } with content inside:
    // the crop must keep the body's deliberate padding, not cut to the inner
    // children union.
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: 360, t: 40, r: 1080, b: 560 },
        body: { l: 320, t: 0, r: 1120, b: 600 },
      }),
      VIEWPORT,
    );
    expect(crop).toEqual({ x: 320, y: 0, width: 800, height: 600 });
  });

  test('content covering the whole viewport keeps the full capture', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: 0, t: 0, r: 1440, b: 1000 },
        body: { l: 0, t: 0, r: 1440, b: 1000 },
      }),
      VIEWPORT,
    );
    expect(crop).toBeNull();
  });

  test('a full-bleed backdrop (html/body background-image or gradient) is design — never cropped', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: 320, t: 200, r: 1120, b: 800 },
        body: { l: 0, t: 0, r: 1440, b: 1000 },
        backdropPaintsDesign: true,
      }),
      VIEWPORT,
    );
    expect(crop).toBeNull();
  });

  test('a scrolling page keeps the full-width stitch untouched', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        scrollH: 5000,
        union: { l: 320, t: 200, r: 1120, b: 800 },
        body: { l: 8, t: 8, r: 1432, b: 4992 },
      }),
      VIEWPORT,
    );
    expect(crop).toBeNull();
  });

  test('horizontally overflowing content keeps the full capture', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        scrollW: 2400,
        union: { l: 0, t: 0, r: 2400, b: 400 },
      }),
      VIEWPORT,
    );
    expect(crop).toBeNull();
  });

  test('coordinates are rounded outward and clamped to the viewport', () => {
    const crop = resolvePageCaptureCrop(
      extent({
        union: { l: -12.6, t: 10.4, r: 900.2, b: 1080.5 },
      }),
      VIEWPORT,
    );
    expect(crop).toEqual({ x: 0, y: 10, width: 901, height: 990 });
  });

  test('no measurable content keeps the full capture', () => {
    expect(resolvePageCaptureCrop(extent({ union: null }), VIEWPORT)).toBeNull();
    expect(resolvePageCaptureCrop(null, VIEWPORT)).toBeNull();
  });
});
