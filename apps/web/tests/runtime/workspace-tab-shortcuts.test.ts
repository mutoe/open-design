import { describe, expect, it, vi } from 'vitest';

import {
  WORKSPACE_TAB_SHORTCUT_MESSAGE,
  buildWorkspaceTabShortcutBridge,
} from '@open-design/contracts/runtime/workspace-tab-shortcuts';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

/**
 * Run the bridge's injected script in a stubbed frame and report what a single
 * keydown did. The script is plain ES5 inside a `<script>` tag, so stripping
 * the tags and evaluating it against fake `window`/`parent` objects exercises
 * the real forwarding logic rather than a reimplementation of it.
 */
function pressInPreviewFrame(stroke: Record<string, unknown>) {
  const source = buildWorkspaceTabShortcutBridge()
    .replace(/^<script[^>]*>/, '')
    .replace(/<\/script>$/, '');

  let handler: ((event: unknown) => void) | null = null;
  const fakeWindow = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (type === 'keydown') handler = listener;
    },
  };
  const posted: unknown[] = [];
  const fakeParent = {
    postMessage(message: unknown) {
      posted.push(message);
    },
  };

  // eslint-disable-next-line no-new-func
  new Function('window', 'parent', source)(fakeWindow, fakeParent);
  expect(handler).toBeTypeOf('function');

  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  handler!({
    isTrusted: true,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault,
    stopPropagation,
    ...stroke,
  });

  return { posted, preventDefault, stopPropagation };
}

describe('buildWorkspaceTabShortcutBridge', () => {
  it('forwards the close-tab shortcut so Cmd+W works with the preview focused', () => {
    const { posted, preventDefault } = pressInPreviewFrame({ key: 'w', metaKey: true });

    expect(posted).toEqual([
      {
        type: WORKSPACE_TAB_SHORTCUT_MESSAGE,
        key: 'w',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
    ]);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Ctrl+W on win/linux', { key: 'w', ctrlKey: true }],
    ['the launcher shortcut', { key: 't', metaKey: true }],
    ['tab cycling', { key: 'Tab', ctrlKey: true }],
    ['reverse tab cycling', { key: 'Tab', ctrlKey: true, shiftKey: true }],
    ['Ctrl+PageDown', { key: 'PageDown', ctrlKey: true }],
    ['Cmd+Option+ArrowLeft', { key: 'ArrowLeft', metaKey: true, altKey: true }],
    ['jump-to-index', { key: '3', metaKey: true }],
  ])('forwards %s', (_label, stroke) => {
    expect(pressInPreviewFrame(stroke).posted).toHaveLength(1);
  });

  it.each([
    ['a bare letter the artifact may bind', { key: 'w' }],
    ['a shortcut the artifact owns', { key: 's', metaKey: true }],
    ['undo', { key: 'z', metaKey: true }],
    ['the shifted letter form', { key: 'w', metaKey: true, shiftKey: true }],
    ['plain arrow navigation', { key: 'ArrowLeft' }],
    ['zero, which is not a tab index', { key: '0', metaKey: true }],
  ])('leaves %s to the artifact', (_label, stroke) => {
    const { posted, preventDefault } = pressInPreviewFrame(stroke);

    expect(posted).toEqual([]);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores synthetic and mid-composition strokes', () => {
    expect(pressInPreviewFrame({ key: 'w', metaKey: true, isTrusted: false }).posted).toEqual([]);
    expect(pressInPreviewFrame({ key: 'w', metaKey: true, isComposing: true }).posted).toEqual([]);
  });
});

describe('buildSrcdoc host tab shortcut relay', () => {
  it('injects the relay only when the surface asks for it', () => {
    const html = '<html><head></head><body><p>hi</p></body></html>';

    expect(buildSrcdoc(html, { hostTabShortcuts: true })).toContain(
      'data-od-workspace-tab-shortcuts',
    );
    // Exports, thumbnails, and presenter documents have no tab strip to drive.
    expect(buildSrcdoc(html)).not.toContain('data-od-workspace-tab-shortcuts');
  });
});
