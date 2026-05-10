/**
 * Shared Markdown-context helpers used by both the streaming artifact parser
 * and the post-stream `<artifact>` stripper. The single source of truth for
 * what counts as a fenced code block or an inline code span — kept in lock
 * step with apps/web/src/runtime/markdown.tsx so the parser/stripper view of
 * a buffer matches what the chat UI will actually render.
 *
 * Anything that "looks like" an artifact tag inside one of these regions is
 * literal Markdown and must not be treated as a real protocol tag.
 */

// Line-anchored fence delimiters, mirror runtime/markdown.tsx:44 (open) and
// runtime/markdown.tsx:49 (close). The renderer is asymmetric on purpose:
// an opening fence may carry an info string (e.g. ```html), a closing fence
// must be a bare triple-backtick line. Neither permits leading indentation —
// an indented "   ```" line is rendered as a paragraph, not a fence.
export const FENCE_OPEN_RE = /^```(\w[\w+-]*)?\s*$/;
export const FENCE_CLOSE_RE = /^```\s*$/;

// Inline code span (single-backtick pair), mirrors runtime/markdown.tsx:164.
export const INLINE_CODE_RE = /`[^`]+`/g;

export type Range = readonly [number, number];

/**
 * Compute the half-open `[start, end)` ranges of `buffer` that the renderer
 * would treat as fenced code blocks or inline code spans. The `unclosedFenceStart`
 * is the index of an opening fence with no matching close in the buffer (or
 * `null` if every fence is closed) — the streaming parser uses it to hold
 * back; the stripper ignores it.
 *
 * Lines without a terminating `\n` (the trailing partial line during
 * streaming) are not classified as fence delimiters here. Callers that care
 * about partial-state behavior should inspect the tail themselves.
 */
export function computeSkipRanges(buffer: string): {
  ranges: Range[];
  unclosedFenceStart: number | null;
} {
  const ranges: Range[] = [];

  let pos = 0;
  let inFence = false;
  let fenceStart = -1;
  while (pos < buffer.length) {
    const eol = buffer.indexOf('\n', pos);
    if (eol === -1) break;
    const line = buffer.slice(pos, eol);
    if (!inFence) {
      if (FENCE_OPEN_RE.test(line)) {
        inFence = true;
        fenceStart = pos;
      }
    } else if (FENCE_CLOSE_RE.test(line)) {
      inFence = false;
      ranges.push([fenceStart, eol + 1]);
      fenceStart = -1;
    }
    pos = eol + 1;
  }

  INLINE_CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null = INLINE_CODE_RE.exec(buffer);
  while (m !== null) {
    ranges.push([m.index, m.index + m[0].length]);
    m = INLINE_CODE_RE.exec(buffer);
  }

  return { ranges, unclosedFenceStart: inFence ? fenceStart : null };
}

export function rangeContains(ranges: ReadonlyArray<Range>, p: number): boolean {
  for (const [s, e] of ranges) {
    if (p >= s && p < e) return true;
  }
  return false;
}
