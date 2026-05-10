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

// Linear scan that ignores `<artifact` occurrences inside Markdown code spans
// (single-backtick `…`) and fenced code blocks (```…```). The model frequently
// recites the artifact tag literally when documenting the protocol; without
// this gating, the parser would enter artifact mode on the recitation and
// suppress the rest of the rendered reply. If a code span/fence is still open
// at the end of the buffer, hold back from its start so a later chunk can
// resolve the boundary without losing fence context.
function findOpenTag(buffer: string): OpenTagMatch {
  const len = buffer.length;
  let i = 0;
  let inFence = false;
  let inInline = false;
  let fenceStart = -1;

  while (i < len) {
    const c = buffer.charAt(i);

    if (!inInline && c === '`' && buffer.charAt(i + 1) === '`' && buffer.charAt(i + 2) === '`') {
      if (inFence) {
        inFence = false;
        fenceStart = -1;
      } else {
        inFence = true;
        fenceStart = i;
      }
      i += 3;
      continue;
    }

    if (!inFence && c === '`') {
      if (inInline) {
        inInline = false;
        fenceStart = -1;
      } else {
        inInline = true;
        fenceStart = i;
      }
      i += 1;
      continue;
    }

    if (inFence || inInline) {
      i += 1;
      continue;
    }

    if (c === '<' && buffer.startsWith(OPEN_PREFIX, i)) {
      const after = i + OPEN_PREFIX.length;
      const next = buffer.charAt(after);
      if (next === '') return { kind: 'partial', start: i };
      if (!/\s/.test(next)) {
        // Not a real <artifact ...> open (e.g. "<artifactual"). Keep scanning.
        i = after;
        continue;
      }

      // Quote-aware scan for the closing '>'.
      let j = after;
      let quote: '"' | "'" | null = null;
      while (j < len) {
        const cc = buffer.charAt(j);
        if (quote !== null) {
          if (cc === quote) quote = null;
        } else if (cc === '"' || cc === "'") {
          quote = cc;
        } else if (cc === '>') {
          return { kind: 'complete', start: i, end: j + 1, attrs: buffer.slice(after, j) };
        }
        j++;
      }
      return { kind: 'partial', start: i };
    }

    i += 1;
  }

  // An unclosed code span/fence at the tail: hold back so the next chunk can
  // close it (or reveal a real artifact tag once the fence ends).
  if (fenceStart !== -1) {
    return { kind: 'partial', start: fenceStart };
  }

  // Strict prefix at the tail (e.g. "<art") — hold back.
  const tail = buffer.lastIndexOf('<');
  if (tail !== -1) {
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
