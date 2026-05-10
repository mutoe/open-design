import { describe, expect, it } from 'vitest';

import { type ArtifactEvent, createArtifactParser } from '../../src/artifacts/parser';

function collect(input: string): ArtifactEvent[] {
  const parser = createArtifactParser();
  const events: ArtifactEvent[] = [];
  for (const e of parser.feed(input)) events.push(e);
  for (const e of parser.flush()) events.push(e);
  return events;
}

describe('createArtifactParser', () => {
  it('parses a real artifact tag in prose', () => {
    const events = collect(
      'Here is a page:\n<artifact identifier="hello" type="text/html" title="Hi">\n<h1>Hi</h1>\n</artifact>\nDone.',
    );
    const start = events.find((e) => e.type === 'artifact:start');
    const end = events.find((e) => e.type === 'artifact:end');
    expect(start).toMatchObject({ identifier: 'hello', artifactType: 'text/html', title: 'Hi' });
    expect(end).toMatchObject({ identifier: 'hello' });
    const trailing = events
      .filter((e): e is Extract<ArtifactEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(trailing).toContain('Done.');
  });

  it('does not enter artifact mode for a tag inside inline backticks', () => {
    const events = collect(
      'To emit an artifact, wrap output in `<artifact identifier="x" type="text/html" title="X">` and continue writing normal prose afterwards.',
    );
    expect(events.find((e) => e.type === 'artifact:start')).toBeUndefined();
    const text = events
      .filter((e): e is Extract<ArtifactEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toContain('continue writing normal prose afterwards.');
  });

  it('does not enter artifact mode for a tag inside a fenced code block', () => {
    const events = collect(
      [
        'Example:',
        '```html',
        '<artifact identifier="demo" type="text/html" title="Demo">',
        '<h1>Demo</h1>',
        '</artifact>',
        '```',
        'After the fence, more prose.',
      ].join('\n'),
    );
    expect(events.find((e) => e.type === 'artifact:start')).toBeUndefined();
    const text = events
      .filter((e): e is Extract<ArtifactEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toContain('After the fence, more prose.');
  });

  it('does not enter artifact mode when a fenced tag arrives across multiple chunks', () => {
    const parser = createArtifactParser();
    const chunks = [
      'Example:\n```html\n<artifact identifier="demo"',
      ' type="text/html" title="Demo">\n<h1>Demo</h1>\n</artif',
      'act>\n```\nAfter the fence, more prose.',
    ];
    const events: ArtifactEvent[] = [];
    for (const c of chunks) for (const e of parser.feed(c)) events.push(e);
    for (const e of parser.flush()) events.push(e);
    expect(events.find((e) => e.type === 'artifact:start')).toBeUndefined();
    const text = events
      .filter((e): e is Extract<ArtifactEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toContain('After the fence, more prose.');
  });
});
