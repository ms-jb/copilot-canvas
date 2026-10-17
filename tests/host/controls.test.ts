import { expect, it, vi } from "vite-plus/test";
import { createControlsService } from "../../extension-src/lib/controls.mts";
import type { SessionMode } from "../../extension-src/shared/contract.mts";
import { deferred, fakeSession } from "./fixtures";

it("serializes changes through confirmation and supplies the confirmed expected mode", async () => {
  let mode: SessionMode = "interactive";
  const firstWrite = deferred<unknown>();
  const started = deferred<void>();
  const set = vi.fn(async (params: { mode: SessionMode; expectedMode?: SessionMode }) => {
    if (set.mock.calls.length === 1) {
      started.resolve();
      await firstWrite.promise;
    }
    mode = params.mode;
    return { modeApplied: true };
  });
  const service = createControlsService(fakeSession({ mode: { get: async () => mode, set } }));
  await service.ready;
  const first = service.apply({ mode: "plan" });
  const second = service.apply({ mode: "autopilot" });
  await started.promise;
  expect(set).toHaveBeenCalledTimes(1);
  firstWrite.resolve({});
  expect(await first).toMatchObject({ mode: "plan" });
  expect(await second).toMatchObject({ mode: "autopilot" });
  expect(set.mock.calls.map(([params]) => params)).toEqual([
    { mode: "plan", expectedMode: "interactive" },
    { mode: "autopilot", expectedMode: "plan" },
  ]);
  service.dispose();
});

it("continues the serialized queue after a failed change", async () => {
  let mode: SessionMode = "interactive";
  const set = vi.fn(async ({ mode: next }: { mode: SessionMode }) => {
    if (next === "plan") throw new Error("refused");
    mode = next;
  });
  const service = createControlsService(fakeSession({ mode: { get: async () => mode, set } }));
  const first = service.apply({ mode: "plan" });
  const second = service.apply({ mode: "autopilot" });
  await expect(first).rejects.toThrow("The session did not apply the change.");
  expect(await second).toMatchObject({ mode: "autopilot" });
  service.dispose();
});
