/**
 * Pre-write structural validation for AI-emitted HTML artifacts.
 *
 * Defends the project-file persistence path (`persistArtifact` →
 * `writeProjectTextFile`) against the failure mode in #50 / #1143 where the
 * model emits an `<artifact type="text/html">…</artifact>` block whose body is
 * a one-line prose summary instead of a complete document. Without this gate,
 * such content lands on disk as a real `.html` file with `kind: html` manifest
 * and pollutes the project file panel as a phantom artifact tab.
 *
 * Policy (intentionally narrow — false positives here block real saves):
 * - non-empty after trimming
 * - meets a minimum length threshold (a single sentence cannot pass)
 * - contains either `<!doctype` or an `<html` opening tag (case-insensitive)
 *
 * The gate is *not* an HTML linter. Malformed but recognizably-structured HTML
 * passes; only content that obviously isn't a document fails. Hand-edited
 * partial drafts go through a different code path (FileViewer / FileWorkspace)
 * and are intentionally not gated here.
 */

const MIN_HTML_LENGTH = 64;
const HTML_OPENING_TAG_RE = /<html\b/i;
const DOCTYPE_RE = /<!doctype\s+html/i;

export type HtmlArtifactValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateHtmlArtifact(content: string): HtmlArtifactValidationResult {
  const trimmed = content.trim().replace(/^﻿/, '');
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty content' };
  }
  if (trimmed.length < MIN_HTML_LENGTH) {
    return { ok: false, reason: `content too short to be HTML (got ${trimmed.length} chars, need ≥${MIN_HTML_LENGTH})` };
  }
  if (!HTML_OPENING_TAG_RE.test(trimmed) && !DOCTYPE_RE.test(trimmed)) {
    return { ok: false, reason: 'no <!doctype html> or <html> tag found — content does not look like a complete HTML document' };
  }
  return { ok: true };
}
