import { Badge, Button, Skeleton, Text, Tooltip } from "@mantine/core";
import type { Connection } from "../../useConnection";
import { nativeSessionPanel, relativeSessionTime, sessionLink, stateLabels } from "./model";
import { useSessions } from "./useSessions";
import classes from "./SessionsSection.module.css";

export function SessionsSection({ connection }: { connection: Connection }) {
  const { data, stale, retry } = useSessions(connection);
  const nativePanel = nativeSessionPanel(
    location.hostname,
    window.parent !== window,
    import.meta.env.DEV,
  );
  const now = Date.now();
  return (
    <section className={classes.section} aria-label="Sessions">
      <Text component="h2" className={classes.heading}>
        Sessions
      </Text>
      {stale && (
        <div className={classes.notice} role="status">
          <Text size="xs">{data ? "Last known sessions. Not live." : "Sessions unavailable."}</Text>
          {connection.phase === "connected" && (
            <Button variant="subtle" size="compact-xs" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}
      {!data && !stale && <Skeleton height={48} radius="sm" aria-label="Loading sessions" />}
      {data?.source === "local" && (
        <Text size="xs" c="dimmed">
          Recent local sessions. Other activity and app links are unavailable.
        </Text>
      )}
      {data && data.source !== "unavailable" && data.sessions.length === 0 && (
        <Text size="xs" c="dimmed">
          No sessions to show.
        </Text>
      )}
      <ul className={classes.list}>
        {data?.sessions.map((row) => {
          const href = !stale ? sessionLink(row, nativePanel) : undefined;
          const label = stale ? "Activity unknown" : stateLabels[row.state];
          const content = (
            <>
              <span
                className={classes.dot}
                data-state={stale ? "unknown" : row.state}
                aria-hidden="true"
              />
              <span className={classes.details}>
                <span className={classes.title}>{row.title}</span>
                {row.project && <span className={classes.project}>{row.project}</span>}
                <span className={classes.meta}>
                  {label} ·{" "}
                  <time dateTime={row.updatedAt ?? undefined}>
                    {relativeSessionTime(row.updatedAt, now)}
                  </time>
                </span>
                {row.current && (
                  <Badge size="xs" variant="light">
                    Current
                  </Badge>
                )}
              </span>
            </>
          );
          return (
            <li key={row.id}>
              <Tooltip
                label={
                  href
                    ? "Open in Copilot. This canvas stays in its current session."
                    : "Read-only here. Open this session from the Copilot app."
                }
                multiline
                w={220}
                events={{ hover: true, focus: true, touch: true }}
              >
                {href ? (
                  <a href={href} className={classes.row}>
                    {content}
                  </a>
                ) : (
                  <div className={classes.row}>{content}</div>
                )}
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
