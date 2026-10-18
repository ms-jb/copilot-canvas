import { Button, Group, Loader, Popover, RingProgress, Text, UnstyledButton } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { fetchContextUsage } from "../../api";
import type { Connection } from "../../useConnection";
import {
  describeCompaction,
  describeUsage,
  formatTokens,
  usageBreakdown,
  usagePercent,
  usageTone,
} from "./usage";
import styles from "./ContextUsage.module.css";

const TONE_COLORS = { ok: "accent", warn: "yellow", danger: "red" } as const;

/**
 * How full the session's context window is, with a read-only refresh. Renders nothing
 * when the provider doesn't track context.
 */
export function ContextUsageIndicator({
  connection,
  withLabel = true,
}: {
  connection: Connection;
  /** Show the percentage next to the ring (hide it where space is tight). */
  withLabel?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setWorking(false);
    setError(null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [connection.phase, connection.context?.sessionId, connection.context?.generation]);
  const state = connection.view.context;
  if (!state) return null;

  const { usage, compacting, lastCompaction, actions } = state;
  const target = connection.context;
  const offline = connection.phase !== "connected" || target === null;
  const percent = usage ? usagePercent(usage) : 0;
  const tone = usage ? usageTone(usage) : "ok";
  const parts = usage ? usageBreakdown(usage) : [];
  const summary = describeUsage(usage);

  const run = async () => {
    if (!target || working) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setWorking(true);
    setError(null);
    try {
      await fetchContextUsage(controller.signal);
    } catch {
      if (!controller.signal.aborted) setError("Couldn't refresh context usage. Try again.");
    } finally {
      if (!controller.signal.aborted) setWorking(false);
    }
  };

  return (
    <>
      <Popover
        opened={opened}
        onChange={setOpened}
        position="top-end"
        width={280}
        shadow="md"
        withArrow
        trapFocus
        returnFocus
      >
        <Popover.Target>
          <UnstyledButton
            className={styles.trigger}
            data-tone={usage ? tone : "empty"}
            aria-label={compacting ? `${summary}. Compacting.` : summary}
            aria-haspopup="dialog"
            aria-expanded={opened}
            title={summary}
            onClick={() => setOpened((open) => !open)}
          >
            {compacting ? (
              <Loader size={14} color="currentColor" />
            ) : (
              <RingProgress
                size={16}
                thickness={2.5}
                roundCaps
                rootColor="var(--cc-border-strong)"
                sections={[{ value: percent, color: TONE_COLORS[tone] }]}
                aria-hidden="true"
              />
            )}
            {withLabel && <span className={styles.label}>{usage ? `${percent}%` : "–"}</span>}
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown className={styles.panel} aria-label="Context window">
          <div className={styles.head}>
            <Text size="sm" fw={600}>
              Context window
            </Text>
            {usage && (
              <Text size="sm" className={styles.percent} data-tone={tone}>
                {percent}%
              </Text>
            )}
          </div>
          {usage ? (
            <>
              <Text size="xs" c="dimmed">
                {formatTokens(usage.currentTokens)} of {formatTokens(usage.tokenLimit)} tokens
                {usage.messages !== undefined ? ` · ${usage.messages} messages` : ""}
              </Text>
              <div className={styles.bar} aria-hidden="true">
                {parts.length > 0 ? (
                  parts.map((part) => (
                    <span
                      key={part.key}
                      className={styles.segment}
                      data-part={part.key}
                      style={{ width: `${part.percent}%` }}
                    />
                  ))
                ) : (
                  <span
                    className={styles.segment}
                    data-part="total"
                    data-tone={tone}
                    style={{ width: `${percent}%` }}
                  />
                )}
                {usage.compactionThreshold !== undefined && (
                  <span
                    className={styles.threshold}
                    style={{
                      left: `${Math.min(100, (usage.compactionThreshold / usage.tokenLimit) * 100)}%`,
                    }}
                  />
                )}
              </div>
              {parts.length > 0 && (
                <ul className={styles.parts}>
                  {parts.map((part) => (
                    <li key={part.key}>
                      <span className={styles.swatch} data-part={part.key} />
                      <span className={styles.partLabel}>{part.label}</span>
                      <span className={styles.partValue}>{formatTokens(part.tokens)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {usage.compactionThreshold !== undefined && (
                <Text size="xs" c="dimmed">
                  Copilot compacts on its own at {formatTokens(usage.compactionThreshold)} tokens.
                </Text>
              )}
            </>
          ) : (
            <Text size="xs" c="dimmed">
              The session reports usage after its first reply.
            </Text>
          )}
          {compacting ? (
            <Text size="xs" className={styles.status} role="status">
              <Loader size={12} color="currentColor" /> Compacting the conversation…
            </Text>
          ) : (
            lastCompaction && (
              <Text size="xs" c="dimmed" role="status">
                {describeCompaction(lastCompaction)}
              </Text>
            )
          )}
          {error && (
            <Text size="xs" c="red" role="alert">
              {error}
            </Text>
          )}
          {actions.refresh && (
            <Group gap="xs" justify="flex-end" className={styles.actions}>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={offline || working}
                loading={working}
                onClick={() => void run()}
              >
                Refresh
              </Button>
            </Group>
          )}
        </Popover.Dropdown>
      </Popover>
    </>
  );
}
