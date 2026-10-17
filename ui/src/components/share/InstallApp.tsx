import { Button, List, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useSyncExternalStore } from "react";
import { IconButton } from "../../layout/IconButton";
import { isRemote, isStandalone } from "../../remote";
import { InstallIcon } from "../../views/icons";
import { detectInstallPlatform, installGuide } from "./installGuide";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chromium fires this once, early, when the page is installable; keep it for the Install button.
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  installed = true;
  notify();
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const SEEN_KEY = "cc-install-guide-seen";

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: the guide simply opens again next time.
  }
}

/**
 * "Install app": on the phone, in a browser tab, walks the user through adding the canvas to the
 * home screen for their system and browser. Opens once by itself; the button stays until installed.
 */
export function InstallApp() {
  const [opened, { open, close }] = useDisclosure(false);
  const prompt = useSyncExternalStore(subscribe, () => deferred);
  const done = useSyncExternalStore(subscribe, () => installed);
  const show = isRemote() && !isStandalone() && !done;

  useEffect(() => {
    if (show && !readSeen()) open();
  }, [show, open]);

  if (!show) return null;

  const guide = installGuide(detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints));
  const dismiss = () => {
    markSeen();
    close();
  };
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    deferred = null;
    notify();
    if (outcome === "accepted") dismiss();
  };

  return (
    <>
      <IconButton label="Install app" onClick={open}>
        <InstallIcon />
      </IconButton>
      <Modal opened={opened} onClose={dismiss} title="Add to your home screen" centered size="sm">
        <Stack gap="md">
          <Text size="sm">
            Open the canvas like an app: full screen, one tap from your home screen, and able to
            notify you when Copilot needs you.
          </Text>
          {prompt ? (
            <Button onClick={() => void install()}>Install</Button>
          ) : (
            <>
              <Text size="sm" fw={600}>
                In {guide.label}:
              </Text>
              <List type="ordered" size="sm" spacing="xs">
                {guide.steps.map((step) => (
                  <List.Item key={step}>{step}</List.Item>
                ))}
              </List>
            </>
          )}
          {guide.note && (
            <Text size="xs" c="dimmed">
              {guide.note}
            </Text>
          )}
          <Button variant="default" size="xs" onClick={dismiss}>
            {prompt ? "Not now" : "Done"}
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
