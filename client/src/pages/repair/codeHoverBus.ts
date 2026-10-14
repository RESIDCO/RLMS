/**
 * Shared hover-tooltip bus — only one CodeHover open at a time;
 * Esc / mouseleave / blur close the active tip.
 */
type Listener = (activeId: string | null) => void;

let activeId: string | null = null;
const listeners = new Set<Listener>();
let escBound = false;

function ensureEsc() {
  if (escBound || typeof window === "undefined") return;
  escBound = true;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}

export function subscribeHover(listener: Listener): () => void {
  ensureEsc();
  listeners.add(listener);
  listener(activeId);
  return () => {
    listeners.delete(listener);
  };
}

export function openHover(id: string) {
  ensureEsc();
  if (activeId === id) return;
  activeId = id;
  for (const l of listeners) l(activeId);
}

export function closeHover(id?: string) {
  if (id != null && activeId !== id) return;
  activeId = null;
  for (const l of listeners) l(activeId);
}

export function closeAll() {
  activeId = null;
  for (const l of listeners) l(activeId);
}

export function getActiveHoverId() {
  return activeId;
}
