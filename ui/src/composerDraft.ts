// A tiny bridge so any part of the shell can drop a suggested prompt into the chat composer.
// Suggestions only fill the draft; the user still decides whether to send.

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
let undelivered: string | null = null;

export function suggestPrompt(text: string): void {
  if (!window.location.hash.startsWith("#/chat")) window.location.hash = "#/chat";
  if (listeners.size === 0) {
    undelivered = text; // the chat view mounts after navigation and picks it up
    return;
  }
  for (const listener of listeners) listener(text);
}

export function onSuggestedPrompt(listener: Listener): () => void {
  listeners.add(listener);
  if (undelivered !== null) {
    listener(undelivered);
    undelivered = null;
  }
  return () => {
    listeners.delete(listener);
  };
}
