import { Button, Group, Modal, Stack, Switch, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useEffect, useState } from "react";
import { API, LIMITS } from "../../shared";
import { getJson } from "../../api";
import { IconButton } from "../../layout/IconButton";
import { usePersistentFlag } from "../../layout/usePersistentFlag";
import { isRemote, isStandalone } from "../../remote";
import { BellIcon, BellOffIcon } from "../../views/icons";
import { detectInstallPlatform, OPEN_INSTALL_GUIDE } from "./installGuide";
import { NotificationHours } from "./NotificationHours";
import {
  bellView,
  localOutcomeStore,
  startFirstLaunch,
  toOutcome,
  type Permission,
} from "./notifyLaunch";

type State = "checking" | "off" | "on" | "blocked" | "busy";

// iOS exposes PushManager only in an app added to the home screen, so a Safari tab can't subscribe.
const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function post(path: string, body: unknown, keepalive = false): Promise<boolean> {
  try {
    const response = await fetch(`./${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("./");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const isFocused = () => document.visibilityState === "visible" && document.hasFocus();

/**
 * While `active`, tells the gateway whether this app is in front, so it doesn't push to a phone that
 * is already showing the conversation. Reports again on every focus change and, while focused, often
 * enough to beat the gateway's expiry; a closed app simply stops reporting and gets notified again.
 */
function useFocusPresence(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let endpoint: string | null = null;
    let last: boolean | null = null;
    let cancelled = false;
    const send = (focused: boolean) => {
      if (!endpoint) return;
      last = focused;
      void post(API.pushPresence, { endpoint, focused }, true);
    };
    const onChange = () => {
      const focused = isFocused();
      if (focused !== last) send(focused);
    };
    const onHide = () => send(false);
    const heartbeat = window.setInterval(() => {
      if (isFocused()) send(true);
    }, LIMITS.pushPresenceTtlMs / 3);
    void currentSubscription().then((subscription) => {
      if (cancelled) return;
      endpoint = subscription?.endpoint ?? null;
      send(isFocused());
    });
    // visibilitychange bubbles from the document to the window.
    const events = ["focus", "blur", "visibilitychange"] as const;
    for (const name of events) window.addEventListener(name, onChange);
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      for (const name of events) window.removeEventListener(name, onChange);
      window.removeEventListener("pagehide", onHide);
      send(false);
    };
  }, [active]);
}

/**
 * Phone notifications: when the session replies, asks something or hits an error, a push shows a
 * one-line preview. The gateway on your computer supplies the line; nothing is stored elsewhere.
 */
export function Notifications({ assistantName }: { assistantName: string }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [whileOpen, setWhileOpen] = usePersistentFlag("notify-while-open", false);
  const [deliberatelyOff, setDeliberatelyOff] = usePersistentFlag("notify-off", false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const remote = isRemote();
  const supported = pushSupported();
  useFocusPresence(remote && supported && state === "on" && !whileOpen);

  useEffect(() => {
    if (!remote || !supported || state !== "on") return setEndpoint(null);
    let cancelled = false;
    void currentSubscription().then((subscription) => {
      if (!cancelled) setEndpoint(subscription?.endpoint ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [remote, supported, state]);

  useEffect(() => {
    if (!remote || !supported) return;
    if (Notification.permission === "denied") return setState("blocked");
    void currentSubscription().then((subscription) => setState(subscription ? "on" : "off"));
  }, [remote, supported]);

  // Requests permission and subscribes. The request must be the first await: Safari only asks
  // from a direct tap.
  const enable = useCallback(async (): Promise<Permission> => {
    setMessage(null);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "blocked" : "off");
      return permission;
    }
    setState("busy");
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await getJson<{ publicKey: string }>(API.pushKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(publicKey),
      });
      if (!(await post(API.pushSubscribe, { endpoint: subscription.endpoint }))) {
        await subscription.unsubscribe();
        throw new Error("rejected");
      }
      setDeliberatelyOff(false);
      setState("on");
    } catch {
      setState("off");
      setMessage(
        "Couldn't turn on notifications. Check that npm run devtunnel is running, then try again.",
      );
    }
    return permission;
  }, [setDeliberatelyOff]);

  useEffect(() => {
    if (!remote) return;
    return startFirstLaunch({
      supported,
      needsGesture: detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints).startsWith(
        "ios",
      ),
      permission: () => (supported ? Notification.permission : "default"),
      enable,
      store: localOutcomeStore(),
      gestureTarget: document,
      now: () => performance.now(),
    });
  }, [remote, supported, enable]);

  if (!remote) return null;

  const standalone = isStandalone();
  const bell = bellView({
    supported,
    standalone,
    permission: state === "blocked" ? "denied" : state === "on" ? "granted" : "default",
    subscribed: state === "on",
    checking: state === "checking",
    deliberatelyOff,
  });

  const turnOn = async () => {
    // A tap is an answer too: remember it so the automatic prompt never repeats.
    localOutcomeStore().set(toOutcome(await enable()));
  };

  const showInstallGuide = () => {
    close();
    window.dispatchEvent(new Event(OPEN_INSTALL_GUIDE));
  };

  const turnOff = async () => {
    setDeliberatelyOff(true);
    setState("busy");
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await post(API.pushUnsubscribe, { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
    } finally {
      setState("off");
    }
  };

  const test = async () => {
    setMessage(
      (await post(API.pushTest, {}))
        ? "Test sent."
        : "Couldn't send a test. Try again in a few seconds.",
    );
  };

  const text = !supported
    ? standalone
      ? "This device can't send notifications to this app."
      : "Add to Home Screen to get notifications."
    : {
        checking: "One moment…",
        off: `Get a notification when ${assistantName} replies, asks a question or needs an approval, or hits an error. It shows only a short preview line; your conversation stays on your computer.`,
        on: `Notifications are on. You'll hear from ${assistantName} for each reply, question or approval and error. While ${assistantName} is open and in front on any device, they are held, and the app icon shows how many replies you haven't read.`,
        blocked:
          "Notifications are blocked for this app. Allow them in your phone's settings, then try again.",
        busy: "One moment…",
      }[state];

  return (
    <>
      <IconButton label={bell.label} onClick={open} tooltipOnFocus>
        {bell.slashed ? <BellOffIcon /> : <BellIcon />}
      </IconButton>
      <Modal opened={opened} onClose={close} title="Notifications" centered size="sm">
        <Stack gap="md">
          <Text size="sm">{text}</Text>
          {supported && state === "on" && (
            <Switch
              size="sm"
              label="Also notify while this app is open"
              description="Off: no notifications while you're looking at the conversation."
              checked={whileOpen}
              onChange={(event) => setWhileOpen(event.currentTarget.checked)}
            />
          )}
          {supported && state === "on" && endpoint && <NotificationHours endpoint={endpoint} />}
          {message && (
            <Text size="sm" c="dimmed" role="status">
              {message}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            {!supported ? (
              !standalone && (
                <Button size="xs" onClick={showInstallGuide}>
                  Show me how
                </Button>
              )
            ) : state === "on" ? (
              <>
                <Button variant="default" size="xs" onClick={() => void turnOff()}>
                  Turn off
                </Button>
                <Button size="xs" onClick={() => void test()}>
                  Send test
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                loading={state === "busy" || state === "checking"}
                disabled={state === "blocked"}
                onClick={() => void turnOn()}
              >
                Turn on
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
