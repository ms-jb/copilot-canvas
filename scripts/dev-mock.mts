// Development-only provider mock. This serve-only plugin never runs in or ships with a build.
// Scenarios: ?state=empty|waiting|busy|nocontrols, or the default live scripted conversation.
// ?state=offline serves samples without the loop; the UI supplies the offline state.
// DEV_PUBLIC_URL sets the "Open on phone" origin ("off" hides the button).
export { devMock } from "./dev/plugin.mts";
