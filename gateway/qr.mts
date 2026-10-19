// The QR for the phone link. `uqr` is the gateway's only npm package, so it is loaded lazily: a
// fresh clone without node_modules still serves the link, and the QR appears once the install lands.
import { writePrivateFile } from "../src/shared/node/runtime-state.mts";

type Uqr = typeof import("uqr");

export interface QrOptions {
  url: string;
  imagePath: string;
  importUqr?: () => Promise<Uqr>;
  retryMs?: number;
  attempts?: number;
  log?: (line: string) => void;
}

export interface QrPublication {
  /** Resolves true once the image is written, false when `uqr` never became available or it was stopped. */
  done: Promise<boolean>;
  stop(): void;
}

export function publishQr(options: QrOptions): QrPublication {
  const {
    url,
    imagePath,
    importUqr = () => import("uqr"),
    retryMs = 5000,
    attempts = 360,
    log = console.log,
  } = options;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let finish: (written: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => {
    finish = resolve;
  });

  const attempt = async (left: number): Promise<void> => {
    if (stopped) return finish(false);
    let uqr: Uqr;
    try {
      uqr = await importUqr();
    } catch {
      if (left <= 1) return finish(false);
      timer = setTimeout(() => void attempt(left - 1), retryMs);
      timer.unref();
      return;
    }
    writePrivateFile(imagePath, uqr.renderSVG(url, { border: 2, pixelSize: 8 }));
    log(`\n${uqr.renderUnicodeCompact(url, { border: 2 })}\n`);
    log(`QR image: ${imagePath}`);
    finish(true);
  };
  void attempt(attempts);

  return {
    done,
    stop() {
      stopped = true;
      clearTimeout(timer);
      finish(false);
    },
  };
}
