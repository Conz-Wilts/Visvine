---
id: 047
title: ToolFrame hides the runtime's own error/diagnostics document
status: todo
kind: build
size: s
wave: 4
depends_on: []
touches: [apps/web/features/tools/components/ToolFrame.tsx, apps/web/lib/tools/frameDocument.ts, apps/web/features/tools/lib/hostBridge.ts, apps/web/tests/tools-host-bridge.test.ts]
created_by: 019
session: null
model: null
effort: null
---

## Task

`/api/tools/runtime/frame` renders a real diagnostics document when a build failed (renderFrameErrorDocument, with the compile errors in it), but nobody ever reads it: ToolFrame overlays any frame that has not completed the postMessage handshake with a skeleton, and 15s later the READY_TIMEOUT swaps the whole slot for a generic ToolErrorCard ("This Tool did not finish loading"). Verified live on 2026-08-18 against a deliberately broken ui.tsx: skeleton for 15s, then the generic card; the `ui.tsx:3:0 …` lines the frame document had rendered were never visible.

Task 019 worked around this on the AUTHOR's preview page (features/tools/components/ToolPreview.tsx renders the build row's diagnostics itself when `!build.ok`, and never mounts a frame with no bundle behind it). That does nothing for an INSTALLED Tool, where the frame is the viewer's only surface and the host is the only thing that could show the error.

Fix in the host, not per-page. Either (a) have renderFrameErrorDocument post `visvine:error` (or a `visvine:ready` + an error payload) so the host stops covering it and can surface it deliberately, or (b) have ToolFrame drop the skeleton once the iframe fires `load` without a handshake, and make the timeout card additive rather than replacing the frame. (a) is preferred: the frame document already knows exactly what went wrong, and the host guessing is what produced the misleading "may be failing to start" wording.

Whichever way, keep the origin/source gates in hostBridge.ts untouched — an error document is still untrusted code on an opaque origin.
