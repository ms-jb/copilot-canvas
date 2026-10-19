// Every Mantine component's styles, so any native component renders correctly without a per-component import.
import "@mantine/core/styles.css";
import "./styles.css";
import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isRemote } from "./remote";
import { cssVariablesResolver, theme, usePrefersDark } from "./theme";

function Root() {
  const dark = usePrefersDark();
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme={dark ? "dark" : "light"}
    >
      <App />
    </MantineProvider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
// iOS Safari ignores user-scalable=no, so block its pinch gestures directly.
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}
// On the phone, the gateway's worker keeps the app shell cached (gateway/sw.js). Registering it
// asks for no permission; notifications stay off until turned on.
if (isRemote() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  });
}
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
