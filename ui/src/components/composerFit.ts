/**
 * How much of the toolbar the composer shows inline, decided by the composer's own width (the chat
 * rail is resizable and the chat is also a full-width screen on a phone), never the viewport:
 * - `wide`: attach, mic, skills and the mode, model and effort pickers.
 * - `medium`: one "Model · Effort" control that opens all the settings.
 * - `narrow`: the settings are an icon, and attach and skills fold into a "+" menu.
 */
export type ComposerFit = "wide" | "medium" | "narrow";

/** At least this wide (the text box, not the composer around it) fits every picker in a row. */
export const WIDE_MIN = 740;
/** Under this the model name no longer fits beside three icon buttons and the context ring. */
export const MEDIUM_MIN = 520;

/** A width of 0 is a composer not measured yet (first paint, or no layout): show everything. */
export function composerFit(width: number): ComposerFit {
  if (width === 0 || width >= WIDE_MIN) return "wide";
  return width >= MEDIUM_MIN ? "medium" : "narrow";
}
