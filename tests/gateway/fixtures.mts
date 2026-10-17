import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach } from "vite-plus/test";

export const APPLE = "https://web.push.apple.com/QGuQyavXutnMH4b";
export const FCM = "https://fcm.googleapis.com/fcm/send/abc";

export function usePushDirectory(): () => string {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(process.cwd(), "tests", "gateway", ".push-"));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  return () => directory;
}
