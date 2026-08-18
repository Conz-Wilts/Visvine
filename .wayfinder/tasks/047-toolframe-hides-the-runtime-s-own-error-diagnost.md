---
id: 047
title: ToolFrame hides the runtime's own error/diagnostics document
status: done
kind: build
size: s
wave: 4
depends_on: []
touches: [apps/web/features/tools/components/ToolFrame.tsx, apps/web/lib/tools/frameDocument.ts, apps/web/features/tools/lib/hostBridge.ts, apps/web/tests/tools-host-bridge.test.ts]
created_by: 019
session: 87180f36-3357-4846-ac39-506f5d5f1b3f
model: sonnet
effort: high
---

## Task

`/api/tools/runtime/frame` renders a real diagnostics document when a build failed (renderFrameErrorDocument, with the compile errors in it), but nobody ever reads it: ToolFrame overlays any frame that has not completed the postMessage handshake with a skeleton, and 15s later the READY_TIMEOUT swaps the whole slot for a generic ToolErrorCard ("This Tool did not finish loading"). Verified live on 2026-08-18 against a deliberately broken ui.tsx: skeleton for 15s, then the generic card; the `ui.tsx:3:0 …` lines the frame document had rendered were never visible.

Task 019 worked around this on the AUTHOR's preview page (features/tools/components/ToolPreview.tsx renders the build row's diagnostics itself when `!build.ok`, and never mounts a frame with no bundle behind it). That does nothing for an INSTALLED Tool, where the frame is the viewer's only surface and the host is the only thing that could show the error.

Fix in the host, not per-page. Either (a) have renderFrameErrorDocument post `visvine:error` (or a `visvine:ready` + an error payload) so the host stops covering it and can surface it deliberately, or (b) have ToolFrame drop the skeleton once the iframe fires `load` without a handshake, and make the timeout card additive rather than replacing the frame. (a) is preferred: the frame document already knows exactly what went wrong, and the host guessing is what produced the misleading "may be failing to start" wording.

Whichever way, keep the origin/source gates in hostBridge.ts untouched — an error document is still untrusted code on an opaque origin.

## Outcome

Fixed by making ToolFrame stop hiding the frame's own content while it's loading, rather than by piping the error document through postMessage (option (b) from the task, chosen because option (a) would require CSP-nonce plumbing in app/api/tools/runtime/frame/route.ts, which is outside this task's file scope, and the host can never distinguish "compile-error document loaded fine" from "real Tool still mounting" by reading the cross-origin iframe anyway).

Changes in apps/web/features/tools/components/ToolFrame.tsx only:
- Added `frameLoaded` state, set by a new `onLoad` handler on the iframe. The skeleton overlay now hides only while `status !== 'ready' && !frameLoaded` — once the iframe fires `load` (whether it loaded the real bootstrap document or `renderFrameErrorDocument`'s static diagnostics page), the skeleton drops and whatever the frame actually rendered becomes visible, including compile-error text with line/column info, well before the 15s deadline.
- The READY_TIMEOUT_MS effect no longer calls `setError(...)` (which used to swap the whole slot for the generic ToolErrorCard). It now sets a new `timedOut` flag.
- Added a small `ToolFrameSlowNotice` component: a thin dismissible-by-success strip pinned to the top of the slot ("This Tool is taking longer than usual to start." + Reload + View this Tool), shown additively over the still-mounted, still-visible iframe when `timedOut && status !== 'ready'` — it never unmounts or covers the frame the way the old full-replace ToolErrorCard did. A genuine posted `visvine:error` (a Tool crashing after mount) still uses the full ToolErrorCard as before — that path already carries a real, specific message and is unaffected.
- hostBridge.ts, frameDocument.ts and tools-host-bridge.test.ts needed no changes: the fix is entirely in the host's display logic, and the origin/source gates in hostBridge.ts are untouched as required.

Verified: `pnpm --filter @visvine/web exec tsc --noEmit` clean, `eslint features/tools/components/ToolFrame.tsx --max-warnings=0` clean, existing `tests/tools-host-bridge.test.ts` (27/27) and `tests/tools-frame-document.test.ts` (11/11) still pass unmodified, confirming no protocol/document behavior changed — only ToolFrame's own display logic. No new test file added since there was no pre-existing ToolFrame.tsx test to extend and the task's test-file scope (tools-host-bridge.test.ts) covers hostBridge, which wasn't touched.
