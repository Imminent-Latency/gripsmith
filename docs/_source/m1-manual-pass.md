# M1 running-app walkthrough — P2 rows 22–23

Observed: 2026-09-24T05:23:44.396Z (2026-09-23 America/Denver).
App build timestamp: `1790225999493` (2026-09-24T04:59:59.493000+00:00); the dev UI displays `Build: DEV`.
Source: `5bbe55f` plus row 23's `BaseControls` filename fallback.
Server: `pnpm dev --host 127.0.0.1 --port 5178 --strictPort`, from the P2 worktree.
URL: `http://127.0.0.1:5178/gripsmith/`.
Browser: Chromium 153.0.8010.12, 1440 × 1100 viewport, SwiftShader.

Method: Codex drove the running app through shell-launched Playwright and observed
rendered input values and the uploader pill. This is a browser walkthrough,
not a human observation or a unit-test substitute; no application modules,
shape loaders, downloads, or imports were mocked. The build timestamp was read
from the browser's Vite-injected `globalThis.__BUILD_TIMESTAMP__`.

- **A11a — PASS:** selected Pint, entered Rotation 30 and waited for the debounce,
  selected GT Stock; the rendered Rotation field read **0**. This also passed
  before the row 22 commit at 2026-09-24T05:22:29.452Z with the same app timestamp.
- **A11b — PASS:** exported the GT Stock project ZIP, reloaded the app to discard
  component-local filename state, imported the downloaded ZIP through the file
  chooser; the uploader pill read **GT Stock**, rather than Custom Drawing.

No browser `pageerror` events occurred during either observation.
Temporary local evidence: `/tmp/p2-a11ab-evidence.json`,
`/tmp/p2-a11a-pint-30.png`, `/tmp/p2-a11a-gtstock-0.png`,
`/tmp/p2-a11b-imported-gtstock.png`, and `/tmp/p2-a11b-bundle.zip`.
These are local walkthrough artifacts, not additional committed source files.
