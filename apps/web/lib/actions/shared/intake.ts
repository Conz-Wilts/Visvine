/**
 * What to ask before building an agent or a connector — the intake.
 *
 * The failure this exists to stop is the eager one: a request like "make me an
 * agent that watches the deals folder" is enough to write SOMETHING, so a model
 * writes it, and the person gets an agent that runs at a time nobody chose,
 * writes where nobody asked, and reaches nothing. The answers are cheap to get
 * and expensive to guess wrong, because both artefacts are configuration that
 * then runs unattended.
 *
 * The opposite failure is as real: an interview. So this is a BUDGET, not a
 * questionnaire — at most four questions, asked once, in one message, and only
 * ones whose answer changes what gets built. Every question carries `decides`
 * (what it changes) and `skipWhen` (when it is already answered), and both are
 * rendered, so the model has the grounds to skip rather than a rule to obey.
 *
 * Pure: this is content, and like every recipe it is rendered into the Visvine
 * space's notes by `db:actions:sync`, where it can be improved without a deploy.
 */

/** The most questions an intake may spend. Four is a message, five is a form. */
export const MAX_INTAKE_QUESTIONS = 4

export type IntakeKind = 'agent' | 'connector'

export interface IntakeQuestion {
  /** The question, in words worth asking a person. */
  ask: string
  /** What the answer decides — why it is worth one of the four slots. */
  decides: string
  /** When it is already answered, and asking it wastes the person's time. */
  skipWhen: string
}

/**
 * The rules, which matter more than the questions: the questions are a
 * starting set, and a good one that came out of the actual request beats any
 * of them.
 */
function rules(kind: IntakeKind): readonly string[] {
  return [
    `Ask at most ${MAX_INTAKE_QUESTIONS}, in ONE message, before you build. Fewer is better; none is right when the request already said everything.`,
    'Only ask what changes what you build. If two answers produce the same artefact, the question is not worth asking.',
    'Look before you ask. The steps below start with a list call for a reason — the roster, the existing notes and the space\'s conventions answer half of these for free, and asking something the space already told you reads as not having looked.',
    kind === 'connector'
      ? 'Never ask for a credential, token or key in the open. Ask what the service is and what the secret should be CALLED; the value is stored by an admin, on the connector\'s own page.'
      : 'Never ask for a credential or key. An agent reaches a service through a connector the space already has, and the connector holds the value.',
    'Take an answer that is not an answer. "You decide", "whatever\'s normal", silence — all mean pick the safe default and go. Never ask twice.',
    'Then say the plan in two or three lines — what you are about to create, when it will run, what it will touch — and build it. Do not make the plan a fifth question.',
    'When you build on a default rather than an answer, name the default in what you report back. That is what makes it correctable in one sentence instead of a re-run.',
  ]
}

const AGENT_QUESTIONS: readonly IntakeQuestion[] = [
  {
    ask: 'What should it produce each run, and where should that land?',
    decides: 'The whole brief body, and the output path — its own folder as a dated note, one note it keeps current, or a folder you name.',
    skipWhen: 'The request already names the output ("a weekly digest in reports/") — then confirm the shape rather than ask again.',
  },
  {
    ask: 'When should it run — on a clock (and in whose timezone), or when something in the space changes?',
    decides: 'The activation: `schedule`/`at` versus `every` versus `on.context` globs. A clock cannot be activated without a timezone, so this one is usually unskippable.',
    skipWhen: 'The request said "every Monday" AND the timezone is already known from the space or an earlier answer.',
  },
  {
    ask: 'What may it read and use — which folders, and which of the space\'s connectors?',
    decides: 'The brief\'s `connectors:` (its entire external reach) and `tools:`, and what the instructions tell it to read first.',
    skipWhen: 'The space has no connectors, or the job is plainly context-only — then say what you assumed instead of asking. Declare a connector the job needs even when the space lacks it: create_agent reports it in `needs` with how to add it, which is better than a brief that quietly cannot do the job.',
  },
  {
    ask: 'Should the first runs be a rehearsal rather than the real thing?',
    decides: '`dry_run: true` in the brief, so the first runs are captured in the transcript rather than applied to the space.',
    skipWhen: 'Always skippable. Ask it only when the agent WRITES somewhere shared — a rehearsal of a read-only brief decides nothing.',
  },
]

const CONNECTOR_QUESTIONS: readonly IntakeQuestion[] = [
  {
    ask: 'Which service and which account, and do you have a link to its API docs?',
    decides: 'The note itself: `hosts:` (the whole network perimeter), the base URL in the body, and whether the catalog already has a recipe for it.',
    skipWhen: 'The service is in the catalog and the request named it — then the recipe answers this, and you are confirming the account rather than asking.',
  },
  {
    ask: 'How does it authenticate, and what should the secret be called?',
    decides: '`env:` and its `{{secret:NAME}}` references, and whether an `auth:` block is needed. Never ask for the value here.',
    skipWhen: 'The docs make it unambiguous (one bearer token) — then propose the name and let them correct it.',
  },
  {
    ask: 'What should agents be able to do with it — which two or three calls matter most?',
    decides: 'The `actions:` block. A named action is what a future agent calls instead of writing JavaScript, so the ones you declare are the ones that get used.',
    skipWhen: 'The request already named the job ("pull recent invoices") — then build that one and say what else could be added.',
  },
  {
    ask: 'Read-only, or should it be able to write back?',
    decides: '`allow:` rules — whether POST/PATCH/DELETE reach the service at all. Read-only is the safe default and the one to build unless they say otherwise.',
    skipWhen: 'Never really skippable for a service that can be written to, but it is a yes/no: fold it into another question rather than spending a slot.',
  },
]

export function intakeQuestions(kind: IntakeKind): readonly IntakeQuestion[] {
  return kind === 'agent' ? AGENT_QUESTIONS : CONNECTOR_QUESTIONS
}

/**
 * The intake as the section of a recipe note — rules first, because a model
 * that reads only the first three lines still behaves correctly.
 */
export function renderIntake(kind: IntakeKind): string {
  const what = kind === 'agent' ? 'an agent' : 'a connector'
  const out: string[] = [
    `Building ${what} is configuration that then runs on its own, so spend a moment on intake before you write anything.`,
    '',
  ]
  for (const rule of rules(kind)) out.push(`- ${rule}`)
  out.push('', 'The questions worth the budget, best first:', '')
  intakeQuestions(kind).forEach((q, i) => {
    out.push(`${i + 1}. **${q.ask}**`, `   - Decides: ${q.decides}`, `   - Skip when: ${q.skipWhen}`)
  })
  return out.join('\n')
}

/**
 * The one-paragraph version, for a surface with no room for the section — an
 * action's own description, where a client may never read the recipe at all.
 */
export function intakeSummary(kind: IntakeKind): string {
  const first = intakeQuestions(kind)
    .slice(0, 2)
    .map((q) => q.ask.replace(/\?$/, ''))
    .join('; ')
  return (
    `Ask before you build: at most ${MAX_INTAKE_QUESTIONS} questions, in one message, and only ones whose answer changes what gets built — ` +
    `chiefly ${first}. Skip anything the request or the space already answered, never ask for a credential value, ` +
    'and if the person says "you decide", pick the safe default, build it, and name the default you chose.'
  )
}
