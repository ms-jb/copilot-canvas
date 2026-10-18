import {
  Badge,
  Box,
  Code,
  Collapse,
  Loader,
  Stack,
  Text,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useId, useState, type ReactNode } from "react";
import { MarkdownView } from "../MarkdownView";
import type { ActivityItem, ReasoningItem, ToolItem } from "../shared";
import { firstLine, formatDuration, TOOL_STATE_LABEL } from "./activity";
import { CheckIcon, ChevronRightIcon, Icon } from "./ChatIcons";
import styles from "./ActivityRows.module.css";

const CrossIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M7 7l10 10M17 7 7 17" />
  </Icon>
);

const ClockIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

/** One expandable row: a header that toggles a panel. Rows without a panel are plain text. */
function Expander({
  header,
  opened,
  onToggle,
  children,
}: {
  header: ReactNode;
  opened: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const panelId = useId();
  if (!children) {
    return (
      <Box className={styles.toggle} data-static>
        <span className={styles.chevronSpace} />
        {header}
      </Box>
    );
  }
  return (
    <>
      <UnstyledButton
        className={styles.toggle}
        aria-expanded={opened}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className={styles.chevron}>
          <ChevronRightIcon size={12} />
        </span>
        {header}
      </UnstyledButton>
      <Collapse expanded={opened} id={panelId} keepMounted={false}>
        <Box className={styles.panel}>{children}</Box>
      </Collapse>
    </>
  );
}

/** Thinking: open while it streams, then a closed "Thought" that opens on demand. */
function Thought({ item }: { item: ReasoningItem }) {
  const streaming = item.streaming === true;
  const [opened, setOpened] = useState(streaming);
  const [wasStreaming, setWasStreaming] = useState(streaming);
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming);
    setOpened(streaming);
  }
  const title = streaming ? "Thinking…" : "Thought";
  return (
    <Box className={styles.item} data-kind="reasoning">
      <Expander
        opened={opened}
        onToggle={() => setOpened((value) => !value)}
        header={
          <>
            <Text span size="xs" fw={500} c="dimmed" className={styles.label}>
              {title}
            </Text>
            {!opened && (
              <Text span size="xs" c="dimmed" truncate="end" className={styles.detail}>
                {firstLine(item.text)}
              </Text>
            )}
          </>
        }
      >
        <Box className={styles.thoughtText}>
          <MarkdownView text={item.text} streaming={streaming} />
          {item.truncated && (
            <Text size="xs" c="dimmed" fs="italic">
              Thinking shortened.
            </Text>
          )}
        </Box>
      </Expander>
    </Box>
  );
}

function StatusIcon({ state }: { state: ToolItem["state"] }) {
  const reduceMotion = useReducedMotion();
  return (
    <span className={styles.status} data-state={state} aria-hidden="true">
      {state === "succeeded" ? (
        <CheckIcon size={14} />
      ) : state === "failed" ? (
        <CrossIcon size={14} />
      ) : reduceMotion ? (
        <ClockIcon size={14} />
      ) : (
        <Loader size={12} color="var(--cc-accent)" />
      )}
    </span>
  );
}

function ToolRow({ item }: { item: ToolItem }) {
  const [opened, setOpened] = useState(false);
  const name = item.title ?? item.name;
  const detail = item.state === "running" ? (item.progress ?? item.detail) : item.detail;
  const duration = item.durationMs === undefined ? undefined : formatDuration(item.durationMs);
  const panel =
    item.args || item.result ? (
      <Stack gap={6}>
        {item.title && item.title !== item.name && (
          <Text size="xs" c="dimmed">
            Tool <Code>{item.name}</Code>
          </Text>
        )}
        {item.args && (
          <div>
            <Text size="xs" c="dimmed" mb={2}>
              Arguments
            </Text>
            <Code block className={styles.code}>
              {item.args}
            </Code>
          </div>
        )}
        {item.result && (
          <div>
            <Text size="xs" c={item.state === "failed" ? "red" : "dimmed"} mb={2}>
              {item.state === "failed" ? "Error" : "Result"}
            </Text>
            <Code block className={styles.code}>
              {item.result}
            </Code>
          </div>
        )}
      </Stack>
    ) : undefined;
  return (
    <Box className={styles.item} data-kind="tool" data-state={item.state}>
      <Expander
        opened={opened}
        onToggle={() => setOpened((value) => !value)}
        header={
          <>
            <StatusIcon state={item.state} />
            <VisuallyHidden>{TOOL_STATE_LABEL[item.state]}</VisuallyHidden>
            <Text span size="xs" fw={600} className={styles.name}>
              {name}
            </Text>
            {detail && (
              <Text span size="xs" c="dimmed" truncate="end" className={styles.detail}>
                {detail}
              </Text>
            )}
            {item.state === "failed" && (
              <Badge size="xs" color="red" variant="light" className={styles.meta}>
                Failed
              </Badge>
            )}
            {duration && (
              <Text span size="xs" c="dimmed" className={styles.meta}>
                {duration}
              </Text>
            )}
          </>
        }
      >
        {panel}
      </Expander>
    </Box>
  );
}

/** A run of thinking blocks and tool calls between two messages of a turn. */
export function ActivityGroup({ items }: { items: ActivityItem[] }) {
  return (
    <Box className={styles.group} role="group" aria-label="Steps">
      {items.map((item) =>
        item.kind === "reasoning" ? (
          <Thought key={item.id} item={item} />
        ) : (
          <ToolRow key={item.id} item={item} />
        ),
      )}
    </Box>
  );
}
