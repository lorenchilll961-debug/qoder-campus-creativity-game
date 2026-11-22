const IDLE_MS = 5000;

export function bindHudPanel(hud, panel, shortcut, canvas) {
  const toggle = hud.querySelector(`button[aria-controls="${panel.id}"]`);
  let idleTimer;

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (!panel.hidden) idleTimer = setTimeout(() => setExpanded(false), IDLE_MS);
  }

  function setExpanded(expanded) {
    if (!expanded && panel.contains(document.activeElement)) {
      canvas.focus({ preventScroll: true });
    }
    panel.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    resetIdleTimer();
  }

  for (const event of ['pointermove', 'click', 'wheel', 'focusin', 'keydown', 'change']) {
    panel.addEventListener(event, resetIdleTimer);
  }

  toggle.addEventListener('click', (event) => {
    setExpanded(panel.hidden);
    if (event.detail > 0) canvas.focus({ preventScroll: true });
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== shortcut || event.repeat || event.defaultPrevented ||
        event.ctrlKey || event.altKey || event.metaKey || hud.hidden ||
        hud.classList.contains('quiet') || toggle.closest('[hidden]') ||
        event.target.closest?.('dialog, input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    setExpanded(panel.hidden);
  });

  resetIdleTimer();
}
