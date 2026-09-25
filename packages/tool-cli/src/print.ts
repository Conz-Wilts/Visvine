/** Terminal output: plain lines, colour only on a terminal that shows it. */
const tty = process.stdout.isTTY && !process.env.NO_COLOR

const paint = (code: string) => (text: string) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text)

export const dim = paint('2')
export const bold = paint('1')
export const red = paint('31')
export const green = paint('32')
export const yellow = paint('33')

export function line(text = ''): void {
  process.stdout.write(`${text}\n`)
}

export function fail(text: string): void {
  process.stderr.write(`${red('✗')} ${text}\n`)
}

export function done(text: string): void {
  line(`${green('✓')} ${text}`)
}

/** A list under a heading, indented — diagnostics, findings, files. */
export function list(items: readonly string[], paintItem: (text: string) => string = (t) => t): void {
  for (const item of items) line(`  ${paintItem(item)}`)
}
