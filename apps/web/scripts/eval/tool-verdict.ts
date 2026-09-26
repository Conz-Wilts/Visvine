/** Strict evaluator contract: an omitted screen is never an implicit pass. */
import { combineVerdicts, parseVerdict, type VisualVerdict } from '../../lib/tools/shared/visualRubric'

export interface ScreenJudgment {
  verdict: VisualVerdict
  broken: string[]
  fit: string
  screens: Array<{ screen: string; score: number }>
}

export function parseScreenJudgment(text: string, expected: string[], capturedFiles: string[] = []): ScreenJudgment {
  let answer: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an object')
    answer = value as Record<string, unknown>
  } catch {
    throw new Error('Judge returned no JSON object')
  }
  if (!expected.length || !Array.isArray(answer.screens) || answer.screens.length !== expected.length) {
    throw new Error('Judge did not score every captured screen')
  }
  const verdicts: VisualVerdict[] = []
  const screens = answer.screens.map((value: unknown, i) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid screen judgment')
    const screen = value as Record<string, unknown>
    const alias = expected[i].replace(/^the (.+) section$/, '$1').replace(/^the dialog opened by pressing "(.+)"$/, '$1')
    const names = [expected[i], alias, ...(capturedFiles[i] ? [capturedFiles[i].split('/').at(-1)!] : []), ...(expected[i].endsWith(' section') ? [`${alias} section`] : []), ...(expected[i].startsWith('the dialog opened') ? [`${alias} dialog`] : []), ...(expected[i] === 'the main page' ? ['Main page'] : [])]
    const normalized = (name: string) => name.replace(/\\"/g, '"').replace(/^the /i, '').trim().toLowerCase()
    if (typeof screen.screen !== 'string' || !names.some((name) => normalized(name) === normalized(screen.screen as string))) throw new Error(`Judge screen ${i + 1} does not match the captured screen`)
    const verdict = parseVerdict(JSON.stringify(screen))
    if (!verdict) throw new Error(`Judge omitted a numeric criterion for ${expected[i]}`)
    verdicts.push(verdict)
    return { screen: expected[i], score: verdict.score }
  })
  if (!Array.isArray(answer.broken) || answer.broken.some((v) => typeof v !== 'string') || typeof answer.fit !== 'string') {
    throw new Error('Judge omitted its broken-controls or fit assessment')
  }
  return { verdict: combineVerdicts(verdicts)!, screens, broken: answer.broken as string[], fit: answer.fit }
}
