# Performance

How the canvas stays fast on a phone, how to measure it, and what is cached where.

## Measure

```sh
npm run build
node scripts/dev/perf-stack.mts [--entries 500] [--stream]   # real provider + gateway, fake session
node scripts/dev/check-idle-cpu.mts                          # CPU of an idle page (limit 5% of a core)
node scripts/dev/check-prod-layout.mts [screenshot-dir]      # production-build layout and composer
```

`perf-stack.mts` runs the real host HTTP server and the real gateway around a fake session holding
a 500-message conversation (`scripts/dev/long-fixture.mts`); `--stream` streams a 6 KB Markdown
reply every few seconds. The two checks need `playwright-core` and Chrome: set `PLAYWRIGHT_MODULES`
to the folder that holds `playwright-core` (default `/tmp/pw/node_modules`) and `CHROME` to the
browser (default `/usr/bin/google-chrome`). They are not part of `npx vp test`.

Run the checks against the **production build**: the dev server and the build order CSS
differently, so some layout bugs (a panel squeezed by Mantine's own `overflow: hidden`) show only in
the build.

## What is cached

| What                              | Host sends                                     | Gateway                                         |
| --------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Hashed chunks (`assets/*-<hash>`) | `public, max-age=31536000, immutable`, br/gzip | kept                                            |
| `index.html`, icons, manifest     | `no-cache` + ETag (304), br/gzip               | kept                                            |
| JSON reads (`sendReadJson`)       | `private, no-cache` + ETag (304)               | kept; `api/skills` also held 15 s per run       |
| Bootstrap, writes, errors         | `no-store`                                     | `no-store`                                      |
| App shell on the phone            | -                                              | `sw.js`: page network first, chunks cache first |

API JSON is never compressed: `api/bootstrap` carries the CSRF token next to transcript text.

## What changed, measured

Perf stack, 500 messages, desktop Chrome through the gateway:

| Metric                        | Before            | After                                                             |
| ----------------------------- | ----------------- | ----------------------------------------------------------------- |
| Main chunk over the wire (br) | 771 KB (no-store) | 219 KB, then 0 (304/immutable)                                    |
| `index.html` over the wire    | 3.5 KB            | 2.2 KB                                                            |
| `api/bootstrap`               | about 160 KB      | 21 KB (newest 60 entries; the stream's snapshot carries the rest) |
| Idle renderer CPU, chat open  | -                 | 0.0% (GPU 0.0%)                                                   |

## Rules that keep it fast

- Nothing animates or ticks at rest: the activity dots pulse only while the row is open, the minute
  clock and queue ages run only while something shows them, and hidden pages never poll.
- Streamed text is applied once per animation frame, long transcripts are virtualized above 80
  rows, and a reconnect resumes from `Last-Event-ID` instead of resending the transcript.
- A page that comes back (tab shown, screen woken, network returned) opens a fresh event stream at
  once instead of waiting for the browser to notice a socket the OS killed.
- Add a read route with `sendReadJson`; keep anything sensitive on `sendJson`.
