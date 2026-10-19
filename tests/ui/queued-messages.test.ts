import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import { queueAgeLabel, QueuedMessages } from "../../ui/src/components/QueuedMessages";
import type { QueueItem } from "../../ui/src/shared";

const NOW = Date.parse("2026-10-18T16:00:00.000Z");

it("labels how long a message has been queued", () => {
  expect(queueAgeLabel("2026-10-18T15:59:40.000Z", NOW)).toBe("Queued just now");
  expect(queueAgeLabel("2026-10-18T15:58:00.000Z", NOW)).toBe("Queued 2m ago");
  expect(queueAgeLabel("2026-10-18T13:00:00.000Z", NOW)).toBe("Queued 3h ago");
  expect(queueAgeLabel("2026-10-16T16:00:00.000Z", NOW)).toBe("Queued 2d ago");
  expect(queueAgeLabel("2026-10-18T16:05:00.000Z", NOW)).toBe("Queued just now");
  expect(queueAgeLabel(undefined, NOW)).toBe("Queued");
  expect(queueAgeLabel("nope", NOW)).toBe("Queued");
});

function render(queuedAt: string) {
  const item: QueueItem = { id: "q1", kind: "message", text: "waiting", queuedAt };
  return renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(QueuedMessages, {
        rows: [{ kind: "item", item }],
        nowMs: NOW,
        onChange: async () => null,
      }),
    ),
  );
}

it("shows the age and highlights Send now once a message has waited five minutes", () => {
  const fresh = render("2026-10-18T15:58:00.000Z");
  expect(fresh).toContain("Queued 2m ago");
  expect(fresh).toContain('aria-label="Send queued message now"');
  expect(fresh).toContain('data-variant="default"');
  const stuck = render("2026-10-18T15:00:00.000Z");
  expect(stuck).toContain("Queued 1h ago");
  expect(stuck).toContain('data-variant="light"');
});
