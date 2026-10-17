// Only the Mantine styles this UI uses, to keep the bundle lean. When you use another Mantine
// component, add its stylesheet here (or switch back to "@mantine/core/styles.css").
import "@mantine/core/styles/baseline.css";
import "@mantine/core/styles/default-css-variables.css";
import "@mantine/core/styles/global.css";
import "@mantine/core/styles/UnstyledButton.css";
import "@mantine/core/styles/Button.css";
import "@mantine/core/styles/CloseButton.css";
import "@mantine/core/styles/Input.css";
import "@mantine/core/styles/InlineInput.css";
import "@mantine/core/styles/Switch.css";
import "@mantine/core/styles/Popover.css";
import "@mantine/core/styles/Combobox.css";
import "@mantine/core/styles/Tooltip.css";
import "@mantine/core/styles/Loader.css";
import "@mantine/core/styles/Skeleton.css";
import "@mantine/core/styles/Overlay.css";
import "@mantine/core/styles/ModalBase.css";
import "@mantine/core/styles/Modal.css";
import "@mantine/core/styles/Drawer.css";
import "@mantine/core/styles/ScrollArea.css";
import "@mantine/core/styles/Stack.css";
import "@mantine/core/styles/Text.css";
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
