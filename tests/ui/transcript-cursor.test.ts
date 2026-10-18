import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import { Transcript } from "../../ui/src/components/Transcript";

const assistantEntry = {
  id: "assistant:a1",
  kind: "assistant" as const,
  text: "Partial reply",
  timestamp: "2026-10-18T12:00:00.000Z",
  streaming: true,
};

const render = (streaming: boolean) =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(Transcript, {
        entries: [assistantEntry],
        pending: [],
        assistantName: "Cortana",
        onPickPrompt: () => {},
        streaming,
      }),
    ),
  );

it("shows the markdown streaming cursor only while a reply is actively streaming", () => {
  expect(render(true)).toContain('data-streaming="true"');
  expect(render(false)).not.toContain('data-streaming="true"');
});
