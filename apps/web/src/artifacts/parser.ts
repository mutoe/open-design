/**
 * Streaming parser for <artifact identifier="..." type="..." title="...">...</artifact>
 * tags. Simplified from packages/artifacts/src/parser.ts in the reference
 * repo: handles one artifact at a time, ignores nesting.
 *
 * Feed deltas in, iterate events. Every event type here has a direct
 * counterpart in the reference parser — the shape is intentionally preserved
 * so you can upgrade later without rewriting consumers.
 */

export type ArtifactEvent =
  | { type: 'text'; delta: string }
  | { type: 'artifact:start'; identifier: string; artifactType: string; title: string }
  | { type: 'artifact:chunk'; identifier: string; delta: string }
  | { type: 'artifact:end'; identifier: string; fullContent: string };

const OPEN_PREFIX = '<artifact';
const CLOSE_TAG = '</artifact>';

interface ParserState {
  inside: boolean;
  buffer: string;
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
}

function parseAttrs(raw: string): Record<string, string> {
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null = re.exec(raw);
  while (m !== null) {
    out[m[1] as string] = (m[2] ?? m[3] ?? '') as string;
    m = re.exec(raw);
  }
  return out;
}

type OpenTagMatch =
  | { kind: 'complete'; start: number; end: number; attrs: string }
  | { kind: 'partial'; start: number }
  | { kind: 'none' };

// Line-anchored fence regex, identical to apps/web/src/runtime/markdown.tsx so
// the parser's view of "what's a fenced code block" matches what the chat UI
// will actually render. Mid-line ```html in prose is NOT a fence per the
// renderer, so it must not be one here either — otherwise a real artifact tag
// that follows such prose would be wrongly suppressed.
const FENCE_LINE_RE = /^[ ]{0,3}```(\w[\w+-]*)?\s*$/;

// CommonMark-style inline code span: a single backtick, then one or more
// non-backtick characters, then a single backtick. Matches the renderer's
// renderInline regex so the two stay in lockstep.
const INLINE_CODE_RE = /`[^`]+`/g;

function rangeContains(ranges: Array<readonly [number, number]>, p: number): boolean {
  for (const [s, e] of ranges) {
    if (p >= s && p < e) return true;
  }
  return false;
}

// Scan the buffer for `<artifact …>` while skipping any positions that the
// chat markdown renderer would render as a fenced code block or inline code
// span. Streaming caveat: when the buffer ends mid-fence (no closing fence
// yet) or with an unmatched inline backtick, return a partial anchored at the
// region's start so the caller waits for more data instead of emitting prose
// that may turn out to be code.
function findOpenTag(buffer: string): OpenTagMatch {
  const len = buffer.length;
  const skip: Array<readonly [number, number]> = [];

  // Pass 1: classify whole, \n-terminated lines as fence delimiters and
  // collect [open-line-start, close-line-end+1) ranges.
  let pos = 0;
  let inFence = false;
  let fenceStart = -1;
  while (pos < len) {
    const eol = buffer.indexOf('\n', pos);
    if (eol === -1) {
      // The tail is unterminated — we cannot classify it as a fence delimiter
      // until \n arrives. If we're inside an open fence, hold back from the
      // opening line so the next chunk can resolve the close.
      if (inFence) return { kind: 'partial', start: fenceStart };
      // Otherwise, if the tail looks like the start of a fence delimiter that
      // hasn't completed yet (e.g. "```", "```ht"), hold back so a future \n
      // can promote it to a real fence.
      const tail = buffer.slice(pos);
      if (/^[ ]{0,3}```\w*$/.test(tail) || /^[ ]{0,3}`{1,2}$/.test(tail)) {
        return { kind: 'partial', start: pos };
      }
      break;
    }
    const line = buffer.slice(pos, eol);
    if (FENCE_LINE_RE.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceStart = pos;
      } else {
        inFence = false;
        skip.push([fenceStart, eol + 1]);
        fenceStart = -1;
      }
    }
    pos = eol + 1;
  }
  if (inFence) return { kind: 'partial', start: fenceStart };

  // Pass 2: collect inline code spans with the same regex the renderer uses.
  // A span that overlaps a fence range is benign — rangeContains is OR.
  INLINE_CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null = INLINE_CODE_RE.exec(buffer);
  while (m !== null) {
    skip.push([m.index, m.index + m[0].length]);
    m = INLINE_CODE_RE.exec(buffer);
  }

  // Streaming: an unmatched opening backtick after the last \n could close in
  // a future chunk. Hold back from the first such backtick.
  const lastNl = buffer.lastIndexOf('\n');
  let firstUnmatched = -1;
  let parity = 0;
  for (let k = lastNl + 1; k < len; k++) {
    if (buffer.charAt(k) !== '`') continue;
    if (rangeContains(skip, k)) continue;
    if (parity === 0) {
      firstUnmatched = k;
      parity = 1;
    } else {
      firstUnmatched = -1;
      parity = 0;
    }
  }
  if (firstUnmatched !== -1) return { kind: 'partial', start: firstUnmatched };

  // Pass 3: find the first `<artifact …>` that is not in any skip range.
  let from = 0;
  while (from < len) {
    const idx = buffer.indexOf(OPEN_PREFIX, from);
    if (idx === -1) break;
    if (rangeContains(skip, idx)) {
      from = idx + OPEN_PREFIX.length;
      continue;
    }
    const after = idx + OPEN_PREFIX.length;
    const next = buffer.charAt(after);
    if (next === '') return { kind: 'partial', start: idx };
    if (!/\s/.test(next)) {
      // Not a real <artifact ...> open (e.g. "<artifactual"). Keep scanning.
      from = after;
      continue;
    }
    let j = after;
    let quote: '"' | "'" | null = null;
    while (j < len) {
      const c = buffer.charAt(j);
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        return { kind: 'complete', start: idx, end: j + 1, attrs: buffer.slice(after, j) };
      }
      j++;
    }
    return { kind: 'partial', start: idx };
  }

  // Strict prefix at the tail (e.g. "<art") — hold back.
  const tail = buffer.lastIndexOf('<');
  if (tail !== -1 && !rangeContains(skip, tail)) {
    const slice = buffer.slice(tail);
    if (OPEN_PREFIX.startsWith(slice) && slice.length < OPEN_PREFIX.length) {
      return { kind: 'partial', start: tail };
    }
  }

  return { kind: 'none' };
}

export function createArtifactParser() {
  const state: ParserState = {
    inside: false,
    buffer: '',
    identifier: '',
    artifactType: '',
    title: '',
    content: '',
  };

  function* feed(delta: string): Generator<ArtifactEvent> {
    state.buffer += delta;

    while (state.buffer.length > 0) {
      if (!state.inside) {
        const open = findOpenTag(state.buffer);
        if (open.kind === 'none') {
          yield { type: 'text', delta: state.buffer };
          state.buffer = '';
          return;
        }
        if (open.kind === 'partial') {
          if (open.start > 0) {
            yield { type: 'text', delta: state.buffer.slice(0, open.start) };
            state.buffer = state.buffer.slice(open.start);
          }
          return;
        }
        if (open.start > 0) {
          yield { type: 'text', delta: state.buffer.slice(0, open.start) };
        }
        const attrs = parseAttrs(open.attrs);
        state.inside = true;
        state.identifier = attrs['identifier'] ?? '';
        state.artifactType = attrs['type'] ?? '';
        state.title = attrs['title'] ?? '';
        state.content = '';
        state.buffer = state.buffer.slice(open.end);
        yield {
          type: 'artifact:start',
          identifier: state.identifier,
          artifactType: state.artifactType,
          title: state.title,
        };
        continue;
      }

      const closeIdx = state.buffer.indexOf(CLOSE_TAG);
      if (closeIdx === -1) {
        // Hold back enough bytes to detect a partial close tag at the tail.
        const flushUpTo = state.buffer.length - (CLOSE_TAG.length - 1);
        if (flushUpTo > 0) {
          const chunk = state.buffer.slice(0, flushUpTo);
          state.content += chunk;
          state.buffer = state.buffer.slice(flushUpTo);
          yield { type: 'artifact:chunk', identifier: state.identifier, delta: chunk };
        }
        return;
      }
      const finalChunk = state.buffer.slice(0, closeIdx);
      if (finalChunk.length > 0) {
        state.content += finalChunk;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: finalChunk };
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
      state.buffer = state.buffer.slice(closeIdx + CLOSE_TAG.length);
      state.inside = false;
      state.identifier = '';
      state.artifactType = '';
      state.title = '';
      state.content = '';
    }
  }

  function* flush(): Generator<ArtifactEvent> {
    if (state.inside) {
      if (state.buffer.length > 0) {
        state.content += state.buffer;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: state.buffer };
        state.buffer = '';
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
    } else if (state.buffer.length > 0) {
      yield { type: 'text', delta: state.buffer };
    }
    state.buffer = '';
    state.inside = false;
  }

  return { feed, flush };
}
