/**
 * What to ask before building something — the intake.
 *
 * Creation happens here, through the actions, and nowhere else: the apps edit
 * what exists and offer no create screens. So the intake is the form a person
 * would otherwise have filled in, asked as a conversation instead.
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

export type IntakeKind = 'agent' | 'connector' | 'event' | 'space' | 'tool'

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
      : kind === 'agent'
        ? 'Never ask for a credential or key. An agent reaches a service through a connector the space already has, and the connector holds the value.'
        : 'Never ask for a credential, token or key. Nothing built here holds one.',
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
    ask: 'What may it read and use — which folders, and which of the space\'s connectors? And is it yours alone, or for anyone who adds themselves?',
    decides: 'The brief\'s `connectors:` (its entire external reach) and `tools:`, and what the instructions tell it to read first. A run acts as one person, on that person\'s accounts: if others will run it, whatever is theirs — the Slack channel it posts in, the inbox, the recipient — is an `inputs` entry the brief names as {{key}}, never a value written into the brief.',
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

const EVENT_QUESTIONS: readonly IntakeQuestion[] = [
  {
    ask: 'What is it, and when — the date, the start time, and the end if it has one?',
    decides: '`title`, `start_at` and `end_at`. A start is required, and a time without a timezone is a guess about when people turn up.',
    skipWhen: 'The request or a plan in the Drive already gives the title and a dated start — then read the timezone from the space and confirm it in the plan.',
  },
  {
    ask: 'Where is it — a venue and address, or online?',
    decides: '`location` — the label and address the event page shows and the invite carries.',
    skipWhen: 'The request or the run sheet names the venue, or it is plainly a call — then say "online" and move on.',
  },
  {
    ask: 'Who should see it — only this space, or anyone with the link?',
    decides: '`visibility`: space (members only) or public, which puts it on the open web at /e/<slug> once published.',
    skipWhen: 'Default to space and say so. Ask only when the request sounds like an open invitation ("launch night", "meetup", "anyone can come").',
  },
  {
    ask: 'Should it go live now, or stay a draft for you to read first?',
    decides: '`status`: draft (only hosts and admins see it) or published. Draft is the safe default.',
    skipWhen: 'Always skippable — build a draft and give the link, unless they already said "publish it".',
  },
]

const SPACE_QUESTIONS: readonly IntakeQuestion[] = [
  {
    ask: 'What should it be called, and what is it for in a sentence?',
    decides: '`name` (and the id derived from it, which cannot be changed later) and `description`.',
    skipWhen: 'The request names it ("a space for the Auckland chapter") — then propose the name and go.',
  },
  {
    ask: 'Private (invite only) or public (listed on Discover, anyone can join)?',
    decides: '`visibility`. Private is the default and the safe one; a public name must be unique among public spaces.',
    skipWhen: 'Default to private and say so, unless the request says open, public or community.',
  },
  {
    ask: 'Is it its own space, or a room inside one you run?',
    decides: '`parent_id` and the room `preset` — a sub-space inherits nothing but its family, and only a parent\'s admin can make one.',
    skipWhen: 'The request did not mention a parent — then it is top-level.',
  },
]

const TOOL_QUESTIONS: readonly IntakeQuestion[] = [
  {
    ask: 'What should it show or let people do — the one screen you picture?',
    decides: 'The whole of `ui.tsx`, its sections (`surfaces.nav`) if it has more than one view, and which notes `data.js` reads.',
    skipWhen: 'The request already describes the screen ("a table of this week\'s RSVPs") — then build it and offer the next step.',
  },
  {
    ask: 'Is this about things the space already keeps (its people, organisations, events), a new kind of note, or data only this tool needs (votes, predictions)?',
    decides: 'Where each thing lives: the space\'s records, a note type of its own (add_type with fields), or the Tool\'s collection — plan_tool says what the space already has.',
    skipWhen: 'plan_tool makes it obvious (the space has 40 organisation records and the request is a board of companies) — then say which you chose.',
  },
  {
    ask: 'Any charts, pictures or a particular icon?',
    decides: 'Which chart per the tool_charts guide, whether rows carry an image (ImageUpload + a resource field), and set_tool_icon.',
    skipWhen: 'The request names them or plainly needs none — pick from the guides and say so.',
  },
  {
    ask: 'Who uses it — everyone in the space, or the admins?',
    decides: 'What it may write, and whether its sections for admins are marked `admin: true`.',
    skipWhen: 'Default to everyone in the space, read-only, and say so.',
  },
]

const QUESTIONS: Record<IntakeKind, readonly IntakeQuestion[]> = {
  agent: AGENT_QUESTIONS,
  connector: CONNECTOR_QUESTIONS,
  event: EVENT_QUESTIONS,
  space: SPACE_QUESTIONS,
  tool: TOOL_QUESTIONS,
}

/** How each kind is named, and why it is worth a moment before building. */
const PREAMBLE: Record<IntakeKind, string> = {
  agent: 'Building an agent is configuration that then runs on its own, so spend a moment on intake before you write anything.',
  connector: 'Building a connector is configuration that then runs on its own, so spend a moment on intake before you write anything.',
  event: 'An event is a date people plan around and a page they are sent to, and nobody fills in a form for it — you are the form. Get the few facts that make it right before you create it.',
  space: 'A space cannot be deleted through an action, and its id is fixed by its name, so confirm the few facts that decide it first.',
  tool: 'A tool is code people will open every day, so run plan_tool, learn the one screen they picture, and agree the plan before you scaffold it.',
}

export function intakeQuestions(kind: IntakeKind): readonly IntakeQuestion[] {
  return QUESTIONS[kind]
}

/**
 * The intake as the section of a recipe note — rules first, because a model
 * that reads only the first three lines still behaves correctly.
 */
export function renderIntake(kind: IntakeKind): string {
  const out: string[] = [PREAMBLE[kind], '']
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
