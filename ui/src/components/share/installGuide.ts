// Pure install-guide content, chosen from the browser's user agent so it is testable.

/** Dispatched on `window` to open the Add to Home Screen walkthrough from elsewhere in the app. */
export const OPEN_INSTALL_GUIDE = "copilot-companion:open-install-guide";

export type InstallPlatform =
  | "ios-safari"
  | "ios-other"
  | "android-chrome"
  | "android-edge"
  | "android-samsung"
  | "android-firefox"
  | "other";

export interface InstallGuide {
  /** Short name of the browser and system, e.g. "Safari on iPhone". */
  label: string;
  steps: string[];
  /** Extra caveat shown under the steps, if any. */
  note?: string;
}

/**
 * Picks the platform. iPadOS reports a Mac user agent, so a "Macintosh" with touch points counts as
 * iOS. Order matters: Edge, Samsung and Firefox all also say "Chrome" or "Safari".
 */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(userAgent) ? "ios-other" : "ios-safari";
  if (/Android/.test(userAgent)) {
    if (/EdgA\//.test(userAgent)) return "android-edge";
    if (/SamsungBrowser\//.test(userAgent)) return "android-samsung";
    if (/Firefox\//.test(userAgent)) return "android-firefox";
    if (/Chrome\//.test(userAgent)) return "android-chrome";
  }
  return "other";
}

const IOS_NOTE =
  "The home-screen app keeps its own sign-in, so you may need to sign in to the tunnel once more the first time you open it.";

export function installGuide(platform: InstallPlatform): InstallGuide {
  switch (platform) {
    case "ios-safari":
      return {
        label: "Safari on iPhone or iPad",
        steps: [
          "Tap the Share button (the square with an arrow pointing up). On iPhone it is at the bottom; on iPad, at the top.",
          "Scroll down and tap Add to Home Screen. If you see an Open as Web App switch, leave it on.",
          "Tap Add, then open Copilot from your home screen.",
        ],
        note: IOS_NOTE,
      };
    case "ios-other":
      return {
        label: "iPhone or iPad",
        steps: [
          "Tap the Share button in the address bar or the browser menu.",
          "Tap Add to Home Screen, then Add.",
          "If you don't see it, open this link in Safari and add it from there.",
        ],
        note: IOS_NOTE,
      };
    case "android-chrome":
      return {
        label: "Chrome on Android",
        steps: [
          "Tap the menu (three dots) at the top right.",
          "Tap Add to Home screen, or Install app if you see it.",
          "Tap Install, then open Copilot from your home screen.",
        ],
      };
    case "android-edge":
      return {
        label: "Edge on Android",
        steps: [
          "Tap the menu (three dots) at the bottom.",
          "Tap Add to phone.",
          "Tap Install, then open Copilot from your home screen.",
        ],
      };
    case "android-samsung":
      return {
        label: "Samsung Internet",
        steps: [
          "Tap the menu (three lines) at the bottom right.",
          "Tap Add page to, then Home screen.",
          "Tap Add, then open Copilot from your home screen.",
        ],
      };
    case "android-firefox":
      return {
        label: "Firefox on Android",
        steps: [
          "Tap the menu (three dots).",
          "Tap Add app to Home screen (or Install).",
          "Tap Add, then open Copilot from your home screen.",
        ],
      };
    default:
      return {
        label: "your browser",
        steps: [
          "Open the browser's menu.",
          "Look for Install app, Add to Home Screen, or Add to phone.",
          "Confirm, then open Copilot from your home screen.",
        ],
      };
  }
}
