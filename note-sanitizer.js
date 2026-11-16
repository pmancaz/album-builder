/* Notes are small documents, not executable webpages. Keep the formatting we
   support while removing scripts, remote images and unexpected attributes. */
export function sanitizeNoteHtml(value) {
  const source = document.createElement('template');
  source.innerHTML = String(value || '');
  const allowed = new Set(['DIV', 'P', 'BR', 'UL', 'OL', 'LI', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'BLOCKQUOTE']);
  const discarded = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'LINK', 'META']);

  function copyChildren(parent, target) {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(child.textContent)); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || discarded.has(child.tagName)) continue;
      if (child.classList.contains('checklist-item')) {
        // Older versions sometimes left typed text beside the empty label.
        // Gather all non-checkbox content so those existing words are retained.
        const row = document.createElement('div'); row.className = 'checklist-item'; row.contentEditable = 'false';
        const depth = Number(child.style.getPropertyValue('--checklist-depth'));
        row.style.setProperty('--checklist-depth', String(Number.isFinite(depth) ? Math.max(0, Math.min(5, depth)) : 0));
        const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'note-checkbox'; box.setAttribute('aria-label', 'Mark checklist item complete');
        box.checked = child.classList.contains('is-checked'); box.toggleAttribute('checked', box.checked); row.classList.toggle('is-checked', box.checked);
        const label = document.createElement('span'); label.className = 'checklist-label'; label.contentEditable = 'true';
        for (const part of child.childNodes) {
          if (part.nodeType === Node.ELEMENT_NODE && part.tagName === 'INPUT') continue;
          if (part.nodeType === Node.ELEMENT_NODE && part.classList.contains('checklist-label')) copyChildren(part, label);
          else { const holder = document.createElement('div'); holder.append(part.cloneNode(true)); copyChildren(holder, label); }
        }
        // A line break gives an empty editable label a stable caret position.
        if (!label.hasChildNodes()) label.append(document.createElement('br'));
        row.append(box, label); target.append(row); continue;
      }
      if (!allowed.has(child.tagName)) { copyChildren(child, target); continue; }
      const clean = document.createElement(child.tagName.toLowerCase());
      copyChildren(child, clean); target.append(clean);
    }
  }

  const output = document.createElement('div'); copyChildren(source.content, output);
  return output.innerHTML;
}

/* HTML serialization normally forgets a checkbox's live checked property.
   Copy that property into the document before saving or taking an Undo snapshot. */
export function readNoteHtml(editor) {
  const copy = editor.cloneNode(true);
  const originalBoxes = editor.querySelectorAll('.note-checkbox');
  copy.querySelectorAll('.note-checkbox').forEach((box, index) => {
    const checked = originalBoxes[index].checked;
    box.toggleAttribute('checked', checked);
    box.closest('.checklist-item')?.classList.toggle('is-checked', checked);
  });
  return sanitizeNoteHtml(copy.innerHTML.replace(/<div><br><\/div>$/, '').trim());
}
