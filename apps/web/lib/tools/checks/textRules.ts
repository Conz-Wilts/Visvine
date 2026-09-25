/**
 * The security stage's rules over a Tool's TEXT — what a parser either never
 * sees or sees too late: characters that make code read differently from how
 * it runs, code written so no one can read it, secrets pasted into a source
 * that ships to every viewer, and copy that asks for a password. Pure.
 *
 * Positions here are the author's own lines, because the text is the author's
 * own file.
 */
import type { CheckFile, CheckFinding } from './findings'

/**
 * Bidirectional controls (Trojan Source, CVE-2021-42574): the line displays in
 * one order and runs in another. Invisible characters hide an identifier's
 * real name. Neither has a place in a source a reviewer is asked to read.
 */
const BIDI = /[‪-‮⁦-⁩]/
const INVISIBLE = /[​-‏⁠-⁤﻿­]/

/** An identifier spelled in escapes: `eval` is `eval` to the engine and nothing to a reader. */
const ESCAPED_IDENTIFIER = /(^|[^\\'"`\w$])\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/
const STRING_ESCAPE = /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\})/g

const BASE64_BLOB = /[A-Za-z0-9+/]{240,}={0,2}/
const HEX_BLOB = /(?:[0-9a-fA-F]{2}){120,}/

/** A line a person did not write: long, and dense with statements. */
const MINIFIED_LINE_CHARS = 500
const MINIFIED_LINE_SEPARATORS = 25

interface SecretPattern {
  rule: string
  label: string
  pattern: RegExp
  severity: 'high' | 'medium'
}

/** The gitleaks core, for the credentials a Tool author is likeliest to paste. */
const SECRETS: SecretPattern[] = [
  { rule: 'secret.private-key', label: 'a private key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/, severity: 'high' },
  { rule: 'secret.aws', label: 'an AWS access key', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/, severity: 'high' },
  { rule: 'secret.github', label: 'a GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/, severity: 'high' },
  { rule: 'secret.slack', label: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, severity: 'high' },
  { rule: 'secret.slack-webhook', label: 'a Slack webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/, severity: 'high' },
  { rule: 'secret.google', label: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: 'high' },
  { rule: 'secret.stripe', label: 'a Stripe live key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/, severity: 'high' },
  { rule: 'secret.anthropic', label: 'an Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/, severity: 'high' },
  { rule: 'secret.openai', label: 'an OpenAI key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/, severity: 'high' },
  { rule: 'secret.openrouter', label: 'an OpenRouter key', pattern: /\bsk-or-v1-[0-9a-f]{40,}\b/, severity: 'high' },
  { rule: 'secret.jwt', label: 'a signed token (JWT)', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/, severity: 'medium' },
  {
    rule: 'secret.assignment',
    label: 'a credential assigned in source',
    pattern: /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)["']?\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i,
    severity: 'medium',
  },
]

/** Copy that asks a person for what only a sign-in page should. */
const PHISHING_COPY: RegExp[] = [
  /session (?:has )?(?:expired|timed out)/i,
  /(?:sign|log) ?in again/i,
  /re-?(?:enter|type) your password/i,
  /(?:enter|confirm|verify) your (?:password|passcode|pin|credentials)/i,
  /verify your (?:account|identity)/i,
  /your password/i,
  /\b(?:card number|cvv|cvc|security code|social security|seed phrase|recovery phrase|private key)\b/i,
]

/** HTML in a string: the shape an innerHTML write would carry. */
const HTML_ESCAPES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /<meta[^>]+http-equiv/i, message: 'A string of HTML carries <meta http-equiv>' },
  { pattern: /<link[^>]+rel=["']?(?:dns-prefetch|preconnect|prefetch|prerender)/i, message: 'A string of HTML carries a prefetch link' },
  { pattern: /<(?:script|iframe|object|embed|base)\b/i, message: 'A string of HTML carries a script or a nested document' },
]

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/** Shannon entropy, bits per character. */
export function entropy(text: string): number {
  if (!text) return 0
  const counts = new Map<string, number>()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) {
    const p = n / text.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** Is this position inside a quoted string on its line? A cheap reading, good enough for escapes. */
function insideQuotes(lineText: string, column: number): boolean {
  let quote: string | null = null
  for (let i = 0; i < column; i++) {
    const ch = lineText[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch
  }
  return quote !== null
}

/** Characters, escapes, blobs and minification — over a source file as written. */
export function scanSourceText(source: string, file: CheckFile): CheckFinding[] {
  const findings: CheckFinding[] = []
  const lines = source.split('\n')
  const isCode = file !== 'index.md'
  let escapes = 0
  lines.forEach((text, i) => {
    const line = i + 1
    if (BIDI.test(text)) {
      findings.push({
        rule: 'obfuscation.bidi',
        severity: isCode ? 'high' : 'medium',
        message: 'A bidirectional control character makes this line run differently from how it reads',
        file,
        line,
      })
    }
    // A BOM at the very start of a file is an editor's habit, not a hiding place.
    const invisible = INVISIBLE.exec(i === 0 ? text.replace(/^﻿/, '') : text)
    if (invisible && isCode) {
      findings.push({ rule: 'obfuscation.invisible', severity: 'high', message: 'An invisible character hides in the code', file, line })
    }
    if (isCode) {
      const escaped = ESCAPED_IDENTIFIER.exec(text)
      if (escaped && !insideQuotes(text, escaped.index + escaped[1].length)) {
        findings.push({ rule: 'obfuscation.escaped-identifier', severity: 'high', message: 'A name is spelled in escapes', file, line })
      }
      escapes += text.match(STRING_ESCAPE)?.length ?? 0
      const separators = text.match(/[;{}]/g)?.length ?? 0
      if (text.length >= MINIFIED_LINE_CHARS && separators >= MINIFIED_LINE_SEPARATORS) {
        findings.push({
          rule: 'obfuscation.minified',
          severity: 'high',
          message: 'Minified code — what runs must be what a reviewer can read',
          file,
          line,
        })
      }
    }
    if (BASE64_BLOB.test(text) || HEX_BLOB.test(text)) {
      findings.push({ rule: 'obfuscation.encoded-blob', severity: 'medium', message: 'A long encoded blob no reviewer can read', file, line })
    }
  })
  if (isCode && escapes >= 16) {
    findings.push({
      rule: 'obfuscation.escaped-strings',
      severity: 'medium',
      message: `${escapes} escaped characters in strings`,
      file,
    })
  }
  return findings
}

/** Secrets, in any of the files — sources ship to every viewer, and the index note is read by all. */
export function scanSecrets(source: string, file: CheckFile): CheckFinding[] {
  const findings: CheckFinding[] = []
  for (const secret of SECRETS) {
    const match = secret.pattern.exec(source)
    if (!match) continue
    findings.push({
      rule: secret.rule,
      severity: secret.severity,
      message: `Carries ${secret.label} (${match[0].slice(0, 6)}…) — anyone who can open the Tool can read it`,
      file,
      line: lineAt(source, match.index),
    })
  }
  return findings
}

/** Copy and HTML in the program's string literals. */
export function scanStrings(strings: ReadonlyArray<{ value: string; line?: number }>, file: CheckFile): CheckFinding[] {
  const findings: CheckFinding[] = []
  for (const { value, line } of strings) {
    const at = line === undefined ? {} : { line }
    if (PHISHING_COPY.some((pattern) => pattern.test(value))) {
      findings.push({ rule: 'phishing.copy', severity: 'medium', message: `Asks for credentials: "${value.trim().slice(0, 60)}"`, file, ...at })
    }
    for (const html of HTML_ESCAPES) {
      if (html.pattern.test(value)) findings.push({ rule: 'escape.html-string', severity: 'high', message: html.message, file, ...at })
    }
    if (/url\(\s*["']?(?:https?:)?\/\//i.test(value)) {
      findings.push({ rule: 'exfil.css-url', severity: 'medium', message: 'A style loads an off-site url()', file, ...at })
    }
    const compact = value.trim()
    if (compact.length >= 40 && !/\s/.test(compact) && !/^(?:https?:|data:|\/)/.test(compact) && entropy(compact) >= 4.8) {
      findings.push({
        rule: 'obfuscation.high-entropy',
        severity: 'medium',
        message: `A random-looking ${compact.length}-character string`,
        file,
        ...at,
      })
    }
  }
  return findings
}
