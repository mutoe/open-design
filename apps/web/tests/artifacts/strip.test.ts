import { describe, expect, it } from 'vitest';

import { stripArtifact } from '../../src/artifacts/strip';

describe('stripArtifact', () => {
  it('removes a real artifact tag and its body from prose', () => {
    const out = stripArtifact(
      'Header.\n<artifact identifier="x" type="text/html" title="X">\n<h1>x</h1>\n</artifact>\nFooter.',
    );
    expect(out).toBe('Header.\n\nFooter.');
  });

  it('preserves an artifact tag wrapped in inline backticks', () => {
    const input = 'Wrap output as `<artifact identifier="x">demo</artifact>` to ship it.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('preserves an artifact tag inside a fenced code block', () => {
    const input = [
      'Example:',
      '```html',
      '<artifact identifier="demo" type="text/html" title="Demo">',
      '<h1>Demo</h1>',
      '</artifact>',
      '```',
      'After.',
    ].join('\n');
    expect(stripArtifact(input)).toBe(input);
  });

  it('preserves a tag wrapped in double backticks', () => {
    const input = 'Use ``<artifact identifier="x" type="text/html" title="X">`` here.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('returns content unchanged when no artifact open tag is present', () => {
    const input = 'Just prose, no markup.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('does not truncate when an open tag has no matching close', () => {
    // A bare orphan open without a close should not nuke the rest of the
    // message (the previous implementation sliced to end-of-string).
    const input = 'Trailing prose<artifact identifier="x"> with no closer.';
    expect(stripArtifact(input)).toBe(input);
  });
});
