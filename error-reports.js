/*
  Error reports stay in memory on this Mac. Nothing is uploaded: the person
  using the app decides whether to copy the report and share it for help.
*/
export function createErrorReporter(readContext, readPrivateValues = () => []) {
  const notices = new Map();
  const recentActions = [];

  // Record control names only, never typed values. This short trail explains
  // what was clicked immediately before an error without recording writing.
  for (const eventName of ['click', 'change']) {
    document.addEventListener(eventName, (event) => {
      const control = event.target.closest?.('button, input, select, summary');
      if (!control || control.closest('.error-report-notice')) return;
      recentActions.push(`${eventName}: ${control.id || control.classList[0] || control.tagName.toLowerCase()}`);
      if (recentActions.length > 8) recentActions.shift();
    }, true);
  }

  // Reports include the error itself, but never copy the album's notes or the
  // licence form. Remove known credentials if an upstream error repeats them.
  function safeText(value) {
    let text = String(value ?? '');
    for (const secret of readPrivateValues().filter(Boolean)) {
      text = text.split(String(secret)).join('[private value removed]');
    }
    return text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
      .replace(/((?:licen[cs]e[_ -]?key|authorization|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[private value removed]')
      .slice(0, 16000);
  }

  function errorDetails(error) {
    if (error == null) return 'No additional error details were supplied.';
    if (typeof error === 'string') return safeText(error);
    // Read only these familiar error fields, not an arbitrary response that
    // could contain a complete project or a saved licence record.
    return ['name', 'message', 'code', 'stack']
      .filter((key) => error[key] !== undefined)
      .map((key) => `${key}: ${safeText(error[key])}`).join('\n') || 'An error occurred without a message.';
  }

  function clear(host = document.body) {
    notices.get(host)?.remove();
    notices.delete(host);
  }

  function show(operation, error, { host = document.body, kind = 'error' } = {}) {
    const context = readContext();
    const report = [
      kind === 'info' ? 'Album Builder export report' : 'Album Builder error report',
      `Time: ${new Date().toISOString()}`,
      `Operation: ${safeText(operation)}`,
      ...Object.entries(context).map(([key, value]) => `${key}: ${safeText(value)}`),
      '', 'Recent controls:', ...recentActions.map(safeText),
      '', 'Error details:', errorDetails(error),
      '', 'This report excludes album notes, artwork, audio contents and licence credentials.',
    ].join('\n');

    clear(host);
    const notice = document.createElement('section');
    notice.className = 'error-report-notice';
    notice.setAttribute('aria-label', 'Error report');
    // Theme variables let this small notice follow every appearance choice.
    Object.assign(notice.style, {
      padding: '12px 14px', border: kind === 'info' ? '1px solid var(--border-strong)' : '1px solid var(--danger)', background: 'var(--bg)',
      color: 'var(--fg)', font: '11px/1.5 "IBM Plex Mono", monospace',
      maxHeight: 'min(440px, 70vh)', overflow: 'auto',
    });
    if (host === document.body) Object.assign(notice.style, {
      position: 'fixed', zIndex: '150', right: '16px', bottom: '46px',
      width: 'min(420px, calc(100vw - 32px))',
    });
    else notice.style.margin = '16px 0 0';

    const message = document.createElement('p');
    message.className = 'error-report-message';
    message.setAttribute('role', 'status');
    message.style.margin = '0 0 8px';
    message.textContent = safeText(operation);
    const actions = document.createElement('div');
    actions.className = 'error-report-actions';
    Object.assign(actions.style, { display: 'flex', gap: '14px', alignItems: 'center' });
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'quiet-action'; copy.textContent = kind === 'info' ? 'copy export report' : 'copy error report';
    const dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.className = 'quiet-action'; dismiss.textContent = 'dismiss';
    dismiss.addEventListener('click', () => clear(host));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(report);
        copy.textContent = 'report copied';
      } catch {
        // Some desktop/browser permissions block clipboard access. Keep a
        // selectable copy on screen so the report can still be shared by hand.
        let fallback = notice.querySelector('textarea');
        if (!fallback) {
          fallback = document.createElement('textarea');
          fallback.className = 'error-report-fallback'; fallback.readOnly = true;
          fallback.setAttribute('aria-label', 'Error report — select and copy this text');
          Object.assign(fallback.style, { width: '100%', minHeight: '160px', marginTop: '10px', color: 'var(--fg)', background: 'var(--bg-tint)', border: '1px solid var(--border)', font: 'inherit' });
          fallback.value = report; notice.append(fallback);
        }
        copy.textContent = 'select report and copy';
        fallback.focus(); fallback.select();
      }
    });
    actions.append(copy, dismiss); notice.append(message, actions); host.append(notice);
    notices.set(host, notice);
  }

  return { show, clear };
}
