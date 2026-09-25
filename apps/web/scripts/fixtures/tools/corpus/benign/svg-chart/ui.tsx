import { useState } from 'react'
import { Stack, useQuery, useVisvine } from '@visvine/tool-kit'

// Local names that happen to match window globals are the author's own.
const top = 12
const parent = { id: 'root' }

function Tree({ parent, open }: { parent: { id: string }; open: boolean }) {
  return <p>{open ? parent.id : '…'}</p>
}

function fetchRows(rows: string[]) {
  return rows.map((row) => row.trim())
}

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export default function Chart() {
  const visvine = useVisvine()
  const [location] = useState('metrics/index.md')
  const metrics = useQuery(() => visvine.context.read(location), [location])
  return (
    <Stack gap="md">
      <svg viewBox="0 0 660 100" style={{ marginTop: top }}>
        <path d="M0 0 L0 0 L3 7 L6 14 L9 21 L12 28 L15 35 L18 42 L21 49 L24 56 L27 63 L30 70 L33 77 L36 84 L39 91 L42 1 L45 8 L48 15 L51 22 L54 29 L57 36 L60 43 L63 50 L66 57 L69 64 L72 71 L75 78 L78 85 L81 92 L84 2 L87 9 L90 16 L93 23 L96 30 L99 37 L102 44 L105 51 L108 58 L111 65 L114 72 L117 79 L120 86 L123 93 L126 3 L129 10 L132 17 L135 24 L138 31 L141 38 L144 45 L147 52 L150 59 L153 66 L156 73 L159 80 L162 87 L165 94 L168 4 L171 11 L174 18 L177 25 L180 32 L183 39 L186 46 L189 53 L192 60 L195 67 L198 74 L201 81 L204 88 L207 95 L210 5 L213 12 L216 19 L219 26 L222 33 L225 40 L228 47 L231 54 L234 61 L237 68 L240 75 L243 82 L246 89 L249 96 L252 6 L255 13 L258 20 L261 27 L264 34 L267 41 L270 48 L273 55 L276 62 L279 69 L282 76 L285 83 L288 90 L291 0 L294 7 L297 14 L300 21 L303 28 L306 35 L309 42 L312 49 L315 56 L318 63 L321 70 L324 77 L327 84 L330 91 L333 1 L336 8 L339 15 L342 22 L345 29 L348 36 L351 43 L354 50 L357 57 L360 64 L363 71 L366 78 L369 85 L372 92 L375 2 L378 9 L381 16 L384 23 L387 30 L390 37 L393 44 L396 51 L399 58 L402 65 L405 72 L408 79 L411 86 L414 93 L417 3 L420 10 L423 17 L426 24 L429 31 L432 38 L435 45 L438 52 L441 59 L444 66 L447 73 L450 80 L453 87 L456 94 L459 4 L462 11 L465 18 L468 25 L471 32 L474 39 L477 46 L480 53 L483 60 L486 67 L489 74 L492 81 L495 88 L498 95 L501 5 L504 12 L507 19 L510 26 L513 33 L516 40 L519 47 L522 54 L525 61 L528 68 L531 75 L534 82 L537 89 L540 96 L543 6 L546 13 L549 20 L552 27 L555 34 L558 41 L561 48 L564 55 L567 62 L570 69 L573 76 L576 83 L579 90 L582 0 L585 7 L588 14 L591 21 L594 28 L597 35 L600 42 L603 49 L606 56 L609 63 L612 70 L615 77 L618 84 L621 91 L624 1 L627 8 L630 15 L633 22 L636 29 L639 36 L642 43 L645 50 L648 57 L651 64 L654 71 L657 78" fill="none" stroke="currentColor" />
      </svg>
      <img src={PIXEL} alt="" />
      <Tree parent={parent} open={!!metrics.data} />
      <p>{fetchRows([' a ']).join(',')}</p>
    </Stack>
  )
}
