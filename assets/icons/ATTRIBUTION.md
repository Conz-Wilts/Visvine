# Icon attribution

Every glyph in this directory is a file we own and can edit. Where the art came
from still matters — both for the licence below and so a future redraw knows
what it is replacing.

## Visvine originals (18)

Drawn in-house to the sidebar spec (24x24, 1.8 stroke, round caps, currentColor).
These were lifted out of inline JSX in `apps/web/features/shared/lib/features.tsx`
and `apps/web/features/tools/components/toolIcons.tsx` when the icon system was
introduced; the geometry is unchanged from what shipped there.

| `nav-agents` | `nav-events` | `tool-folder` | `tool-people` |
| `nav-channels` | `nav-resources` | `tool-grid` | `tool-sparkle` |
| `nav-connectors` | `nav-tools` | `tool-kanban` | `tool-table` |
| `nav-context` | `tool-calendar` | `tool-list` |  |
| `nav-directory` | `tool-chart` | `tool-note` |  |

## Derived from Lucide (130)

Copied verbatim from `lucide-react` 0.545.0 — the version the app depended on
before it owned its icons — then normalised into this directory's file shape
(root-level paint attributes, no width/height). The file name is Lucide's own
canonical icon name, so an upstream glyph is always findable if we want to
compare or re-pull.

Copying individual glyphs is what the ISC licence permits, and retaining the
notice below is the condition it attaches. Keep it in place. Any glyph we redraw
should move into the Visvine-originals list above once it no longer derives from
the upstream art.

| `arrow-down` | `coins` | `list` | `settings-2` |
| `arrow-left` | `compass` | `loader-circle` | `settings` |
| `arrow-right` | `copy` | `lock-open` | `share-2` |
| `arrow-up` | `download` | `lock` | `shield-check` |
| `at-sign` | `earth` | `log-out` | `smile` |
| `ban` | `external-link` | `mail` | `sparkles` |
| `bell` | `eye` | `map-pin` | `sprout` |
| `bird` | `file-code-2` | `megaphone` | `square-check` |
| `blocks` | `file-down` | `message-circle` | `square` |
| `bold` | `file-text` | `message-square` | `star` |
| `book-open` | `flame` | `minus` | `sun` |
| `bookmark` | `folder-open` | `moon` | `table` |
| `bot` | `folder` | `music` | `tag` |
| `brain` | `gamepad-2` | `network` | `target` |
| `briefcase` | `git-pull-request` | `newspaper` | `text-quote` |
| `calendar-check` | `globe` | `palette` | `trash-2` |
| `calendar-plus` | `grip-vertical` | `party-popper` | `trending-up` |
| `calendar` | `hammer` | `pencil` | `triangle-alert` |
| `camera` | `hand` | `phone` | `trophy` |
| `check` | `handshake` | `pin` | `twitter` |
| `chevron-down` | `hash` | `pizza` | `upload` |
| `chevron-left` | `heart` | `play` | `user-check` |
| `chevron-right` | `house` | `plug` | `user-plus` |
| `chevron-up` | `image-plus` | `plus` | `user` |
| `chevrons-up-down` | `info` | `radio` | `users-round` |
| `circle-arrow-up` | `italic` | `refresh-cw` | `users` |
| `circle-check` | `key-round` | `reply` | `video` |
| `circle-question-mark` | `lightbulb` | `rocket` | `vote` |
| `clipboard-list` | `link-2-off` | `rotate-ccw` | `waypoints` |
| `clock` | `link-2` | `rotate-cw` | `x` |
| `code` | `linkedin` | `search` | `zoom-in` |
| `coffee` | `list-ordered` | `send` | `zoom-out` |
| `eye-off` | `type` |  |  |

### Licence — Lucide (ISC, with portions from Feather under MIT)

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Connector logos (`apps/web/public/images/connectors/`)

Brand marks shown in the "Add connector" catalog, not part of the icon
system. Monochrome marks are from [Simple Icons](https://simpleicons.org)
(CC0), filled with each brand's hex. `google.svg`, `googledrive.svg` and
`microsoft.svg` are the brands' own multi-colour marks redrawn as SVG. The
two PNGs (`granola.png`, `fireflies.png`) are the vendors' favicons.
`openrouter.svg` is ours — a routing glyph drawn for this catalog, not the
vendor's mark. Logos are used to identify the service, under each owner's
trademark.
