import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
// Renders every preview.html the way the Design System page frames it (tokens,
// fonts, bundle.css, React and the bundle preloaded) and fails on an error or
// an empty card. Run from packages/ui after build.mjs:
//   node .design-sync/artifact/check.mjs
const P = '.design-sync/.cache/artifact/project', SHOT = '.design-sync/.cache/artifact-shots'
mkdirSync(SHOT, { recursive: true })
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }
const fonts = JSON.parse(readFileSync(join(P, 'tokens.json'))).type.fonts.map(f => `@font-face{font-family:'${f.family}';src:url('/${f.file}') format('woff2');font-weight:${f.weight};font-style:normal}`).join('\n')
const pre = `<style>${readFileSync('../tokens/generated/tokens.css', 'utf8')}\n${fonts}</style><link rel="stylesheet" href="/components/bundle.css"><script src="/components/lib/react.js"></script><script src="/components/lib/react-dom.js"></script><script src="/components/bundle.js"></script>`
const srv = createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]); const p = join(P, u)
  if (!existsSync(p)) { r.writeHead(404); return r.end() }
  let body = readFileSync(p)
  if (u.endsWith('preview.html')) body = body.toString().replace('<head>', '<head>' + pre).replace('<html', '<html data-theme="light"')
  r.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream' }); r.end(body)
}).listen(0)
const base = `http://127.0.0.1:${srv.address().port}`
const b = await chromium.launch()
const names = readdirSync(join(P, 'components')).filter(n => existsSync(join(P, 'components', n, 'preview.html')))
let bad = 0
for (const n of names) {
  const pg = await b.newPage({ viewport: { width: 960, height: n === 'Cover' ? 288 : 700 } })
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  await pg.goto(`${base}/components/${n}/preview.html`); await pg.waitForTimeout(700)
  const text = (await pg.evaluate(() => document.body.innerText)).trim().length
  const fam = await pg.evaluate(() => getComputedStyle(document.querySelector('#root, .cover') || document.body).fontFamily)
  if (errs.length || (!text && n !== 'Logo')) { bad++; console.log('✗', n, errs.slice(0, 2).join(' | '), 'text', text) }
  if (['Cover', 'Button', 'Modal', 'Logo', 'SearchMenuList', 'Chip'].includes(n)) await pg.screenshot({ path: `${SHOT}/${n}.png`, fullPage: n !== 'Cover' })
  await pg.close()
}
console.log(`${names.length} previews, ${bad} with problems`)
await b.close(); srv.close()
if (bad) process.exitCode = 1
