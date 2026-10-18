import { Button, CopyButton, Image, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useState, type JSX } from "react";
import { renderSVG } from "uqr";
import { API, toPublicOrigin, type ShareInfo } from "../../shared";
import { getJson } from "../../api";
import { isRemote } from "../../remote";
import type { Connection } from "../../useConnection";
import styles from "./OpenOnPhone.module.css";

function PhoneIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 18h3" />
    </svg>
  );
}

/** "Open on phone": shown only when the gateway publishes a public origin for this canvas. */
export function OpenOnPhone({ connection }: { connection: Connection }): JSX.Element | null {
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const generation = connection.context?.generation ?? null;

  // Fetched once per provider run, after bootstrap; the response holds only a root origin.
  useEffect(() => {
    if (!generation) return;
    const controller = new AbortController();
    getJson<Partial<ShareInfo> | null>(API.share, controller.signal)
      .then((info) => setPublicUrl(toPublicOrigin(info?.publicUrl)))
      .catch(() => {
        if (!controller.signal.aborted) setPublicUrl(null);
      });
    return () => controller.abort();
  }, [generation]);

  if (!publicUrl || isRemote()) return null;
  // The SVG has its own white quiet zone, so it scans in dark mode too.
  const qr = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(publicUrl, { border: 2 }))}`;

  return (
    <>
      <Button
        variant="subtle"
        color="gray"
        size="compact-sm"
        className={styles.trigger}
        leftSection={<PhoneIcon />}
        onClick={open}
        aria-label="Open on phone"
      >
        <span className={styles.label}>Open on phone</span>
      </Button>
      <Modal opened={opened} onClose={close} title="Open on phone" centered size="sm">
        <Stack gap="md" align="center">
          <Image src={qr} w={200} h={200} radius="sm" alt={`QR code for ${publicUrl}`} />
          <Text className={styles.note}>Scan with your phone's camera, then sign in.</Text>
          <Text className={styles.url}>{publicUrl}</Text>
          <CopyButton value={publicUrl}>
            {({ copied, copy }) => (
              <Button variant="light" size="xs" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </Button>
            )}
          </CopyButton>
          <Text className={styles.note}>
            Use an owner-only tunnel and open it in a browser signed in as the tunnel owner.
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
