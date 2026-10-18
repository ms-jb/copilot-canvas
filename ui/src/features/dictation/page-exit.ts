// When the page stops being in front of the user. Dictation ends then, so the microphone never stays
// open for a page nobody is looking at.

export type PageExit = "hidden" | "pagehide" | "blur";

export interface ExitPage {
  document: EventTarget & { readonly visibilityState: DocumentVisibilityState };
  window: EventTarget;
}

/**
 * Calls `onExit` when the page is hidden (another tab, the app minimized, the phone locked), left
 * (pagehide) or, with `blur`, loses focus. Returns the unsubscribe.
 */
export function watchPageExit(
  page: ExitPage,
  onExit: (reason: PageExit) => void,
  { blur = false }: { blur?: boolean } = {},
): () => void {
  const onVisibility = () => {
    if (page.document.visibilityState === "hidden") onExit("hidden");
  };
  const onPageHide = () => onExit("pagehide");
  const onBlur = () => onExit("blur");
  page.document.addEventListener("visibilitychange", onVisibility);
  page.window.addEventListener("pagehide", onPageHide);
  if (blur) page.window.addEventListener("blur", onBlur);
  return () => {
    page.document.removeEventListener("visibilitychange", onVisibility);
    page.window.removeEventListener("pagehide", onPageHide);
    page.window.removeEventListener("blur", onBlur);
  };
}
