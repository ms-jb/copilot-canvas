// Where the page is running: in the Copilot app on this computer, or remotely through the gateway.

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** True when the page came through the gateway and tunnel (for example on a phone). */
export function isRemote(): boolean {
  return !LOOPBACK_HOSTS.includes(window.location.hostname);
}

/** True when the page runs as an installed home-screen app rather than in a browser tab. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}
