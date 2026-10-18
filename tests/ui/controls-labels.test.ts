import { expect, it } from "vite-plus/test";
import { tierLabel } from "../../ui/src/components/controls/labels";

it("labels a context tier by the window size the catalog publishes, else by name", () => {
  const model = { id: "m", name: "M", contextTokens: { long_context: 1_000_000 } };
  expect(tierLabel(model, "long_context")).toBe("1M");
  expect(tierLabel(model, "default")).toBe("Standard");
  expect(tierLabel(undefined, "long_context")).toBe("Long context");
});
