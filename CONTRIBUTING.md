# Contributing to Copilot Canvas

Thanks for helping make the canvas better.

## Report a bug or suggest an idea

Use [Issues](https://github.com/ms-jb/copilot-canvas/issues/new/choose). For bugs, include:

- what you did and what you expected,
- your Copilot app or CLI version and operating system,
- a screenshot of the canvas if it helps.

Never paste tokens, tunnel addresses or private conversation content into an issue.

## Make a change

1. Fork the repository and create a branch.
2. Install and preview without Copilot:

   ```bash
   npm install
   npx vp dev
   ```

3. Keep the checks green, and rebuild the installable output:

   ```bash
   npx vp check
   npx vp test
   npx vp build
   ```

4. Commit the rebuilt `extension/` folder with your change and open a pull request that explains
   the why.

## Ground rules

- Keep it a lean starter: no heavy dependencies, no feature that only one setup can use.
- Keep the safety model intact: loopback only, explicit taps for every decision, nothing approved
  automatically, owner-only tunnels.
- Code is erasable TypeScript (no enums or namespaces), formatted and linted by `vp check`.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
