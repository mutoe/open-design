/**
 * Relay for workspace tab shortcuts that are pressed inside a preview iframe.
 *
 * Key events do not cross a frame boundary. Once the user clicks into a design
 * preview to interact with it, every host-level tab shortcut (Cmd/Ctrl+W to
 * close the tab, Cmd+T for the launcher, Ctrl+Tab to cycle, Cmd+1..9 to jump)
 * is delivered to the iframe's Window and dies there — the host listener in
 * FileWorkspace never sees it. The bridge below forwards exactly those strokes
 * back up to the host and lets everything else through untouched, so an
 * artifact keeps full control of its own keyboard.
 *
 * The host validates and applies the payload; see
 * `workspaceTabShortcutFromMessage` in FileWorkspace.
 */

/** postMessage discriminator for a relayed stroke. */
export const WORKSPACE_TAB_SHORTCUT_MESSAGE = 'od:workspace-tab-shortcut';

/**
 * Injectable `<script>` that forwards host tab shortcuts out of a preview
 * frame.
 *
 * Deliberately narrow: it matches the same combinations the host acts on and
 * nothing else. A shortcut an artifact might plausibly own (Cmd+S, Cmd+Z,
 * plain keys, anything with Shift on the letter forms) is never intercepted.
 * Forwarding is fire-and-forget — the host owns the decision, and a stroke
 * that matches no host command simply goes nowhere.
 */
export function buildWorkspaceTabShortcutBridge(): string {
  return `<script data-od-workspace-tab-shortcuts>(function(){
  var MESSAGE = ${JSON.stringify(WORKSPACE_TAB_SHORTCUT_MESSAGE)};
  function isHostTabShortcut(e){
    var key = e.key;
    if (typeof key !== 'string' || !key) return false;
    var lower = key.toLowerCase();
    var primary = (e.metaKey || e.ctrlKey) && !e.altKey;
    var ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    var commandOption = e.metaKey && e.altKey && !e.ctrlKey;
    if (primary && !e.shiftKey && (lower === 't' || lower === 'w')) return true;
    if (ctrlOnly && key === 'Tab') return true;
    if (ctrlOnly && !e.shiftKey && (key === 'PageDown' || key === 'PageUp')) return true;
    if (commandOption && !e.shiftKey && (key === 'ArrowRight' || key === 'ArrowLeft')) return true;
    if (primary && !e.shiftKey && /^[1-9]$/.test(key)) return true;
    return false;
  }
  window.addEventListener('keydown', function(e){
    if (!e || !e.isTrusted || e.isComposing) return;
    if (!isHostTabShortcut(e)) return;
    // Stop the artifact from also reacting to a stroke the host is about to
    // consume, then hand it up. preventDefault keeps the frame from running
    // any default action for the combination.
    e.preventDefault();
    e.stopPropagation();
    try {
      parent.postMessage({
        type: MESSAGE,
        key: e.key,
        metaKey: !!e.metaKey,
        ctrlKey: !!e.ctrlKey,
        altKey: !!e.altKey,
        shiftKey: !!e.shiftKey
      }, '*');
    } catch (_) {}
  }, true);
})();</script>`;
}
