import "@mantine/core/styles.css";
import "./styles.css";
import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
