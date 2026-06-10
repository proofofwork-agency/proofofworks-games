// Tiny DOM helpers shared by the runtime and its internal systems.

export function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  return e
}

export function btn(label: string, extra: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = ('btn ' + extra).trim()
  b.textContent = label
  return b
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
