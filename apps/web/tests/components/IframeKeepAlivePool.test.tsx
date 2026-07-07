// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { adoptPooledIframeElement } from '../../src/components/IframeKeepAlivePool';

type HostWithMoveBefore = HTMLElement & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

function createConnectedIframe(): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  return frame;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('adoptPooledIframeElement', () => {
  it('prefers moveBefore for a connected element so the browsing context survives the move', () => {
    const host = document.createElement('div') as HostWithMoveBefore;
    document.body.appendChild(host);
    const frame = createConnectedIframe();
    const moveBefore = vi.fn((node: Node, child: Node | null) => {
      host.insertBefore(node, child);
    });
    host.moveBefore = moveBefore;

    adoptPooledIframeElement(host, frame);

    expect(moveBefore).toHaveBeenCalledWith(frame, null);
    expect(frame.parentElement).toBe(host);
  });

  it('falls back to appendChild when the element is not connected yet', () => {
    const host = document.createElement('div') as HostWithMoveBefore;
    document.body.appendChild(host);
    const frame = document.createElement('iframe');
    const moveBefore = vi.fn();
    host.moveBefore = moveBefore;

    adoptPooledIframeElement(host, frame);

    expect(moveBefore).not.toHaveBeenCalled();
    expect(frame.parentElement).toBe(host);
  });

  it('falls back to appendChild when moveBefore is unavailable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const frame = createConnectedIframe();

    adoptPooledIframeElement(host, frame);

    expect(frame.parentElement).toBe(host);
  });

  it('falls back to appendChild when moveBefore rejects the move', () => {
    const host = document.createElement('div') as HostWithMoveBefore;
    document.body.appendChild(host);
    const frame = createConnectedIframe();
    host.moveBefore = vi.fn(() => {
      throw new DOMException('bad move', 'HierarchyRequestError');
    });

    adoptPooledIframeElement(host, frame);

    expect(frame.parentElement).toBe(host);
  });
});
