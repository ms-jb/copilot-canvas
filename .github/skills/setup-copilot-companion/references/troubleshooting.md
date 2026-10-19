# Troubleshooting and undo

`<FOLDER>` is the user's copy from [SKILL.md](../SKILL.md). Match the symptom, apply the fix, and
confirm the canvas or phone works again before you report it fixed.

- **The canvas is missing:** run `npm run install-ext`, wait a few seconds and open it again. If it
  is not registered, follow the fallback in step 1 (Instant canvas) of [SKILL.md](../SKILL.md), or tap
  the canvas's reload button (restarting the Copilot app also works).
- **The canvas shows another copy's changes:** another folder in `~/.copilot/extensions` has the same
  canvas id; remove it.
- **The phone link stopped working:** the computer slept or `npm run devtunnel` stopped. Start it again.
- **A new panel works on desktop but is "Not found" on the phone:** the gateway reads its route list
  when `npm run devtunnel` starts. Restart it after a change to `gateway/`, and make sure the canvas
  picked up the new build so the provider serves the new route too.
- **"Not connected" on the phone:** the canvas was closed. Open it again in Copilot, then refresh the
  phone. The desktop canvas must be open and phone hosting (`npm run devtunnel`) must be running.

## Undo

Stop `npm run devtunnel`; `devtunnel delete <tunnel-id>` (the id is in
`~/.copilot/canvas-runtime/copilot-companion/phone.json`); remove `~/.copilot/extensions/copilot-companion`
and `~/.copilot/canvas-runtime/copilot-companion` (tunnel id, notification keys, subscriptions and
setup progress); delete `<FOLDER>` and, if they want, their private repository
(`gh repo delete <login>/copilot-companion`, after they confirm). The profile, skills, agents and
automations from [rest-of-copilot.md](rest-of-copilot.md) are not part of the canvas; they stay until
the user removes them.
