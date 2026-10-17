import { Button, CopyButton, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { lazy, Suspense, useEffect, useState, type JSX } from "react";
import { API, toPublicOrigin } from "../../../../extension-src/shared/contract.mts";
import type { ShareInfo } from "../../../../extension-src/shared/contract.mts";
import { getJson } from "../../api";
import { isRemote } from "../../remote";
import type { Connection } from "../../useConnection";
import styles from "./OpenOnPhone.module.css";

// The encoder loads only when the dialog opens, keeping it out of the main bundle.
const QrCode = lazy(() => import("./QrCode"));

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
          <div className={styles.plate}>
            <Suspense fallback={<div className={styles.qr} />}>
              <QrCode value={publicUrl} />
            </Suspense>
          </div>
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
