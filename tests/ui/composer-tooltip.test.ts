import { MantineProvider } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import { ComposerTooltip } from "../../ui/src/components/ComposerIconButton";

it("keeps the button's own class when a Popover or Menu target adds one", () => {
  const html = renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(ComposerTooltip, {
        label: "Tip",
        className: "from-target",
        children: createElement("button", { className: "own-class" }, "Go"),
      }),
    ),
  );
  expect(html).toContain("own-class");
  expect(html).toContain("from-target");
});
