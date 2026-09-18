// Every question the judge is asked, and the floor its answer is read against —
// one pure file, so a threshold is tuned in one place against the eval rather
// than guessed where it is used.
//
// The model is LITERAL: a question is a plain statement about the state, and
// its criteria say the same thing twice, once for each side. It is weak at
// dates, numbers and counting, so none of these ask about them — anything
// ordered in time or quantity is decided in code, from the data.

import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from './types'

const noul = (instructions: string, yes: string, no: string): NoulQuestion => ({
  type: 'noul',
  instructions,
  criteria: { true: yes, false: no },
})

// ── Search ──────────────────────────────────────────────────────────────────

/** State: { query, passage: { title, text } }. */
export const SEARCH_QUESTIONS = {
  relevant: noul(
    'Does the passage address the subject of the query?',
    'The passage is about the person, thing or topic the query asks about.',
    'The passage is about something else, or only shares words with the query.',
  ),
  answers: noul(
    'Does the passage state information that could be used in a direct answer to the query?',
    'The passage states a fact, decision or detail that answers the query or part of it.',
    'The passage mentions the topic but states nothing that answers the query.',
  ),
}
/** A hit under this relevance is dropped. Low on purpose: dropping the right answer costs more than keeping a weak one. */
export const SEARCH_RELEVANT_FLOOR = 0.35
/** How the two answers become one ordering score. */
export const searchScore = (relevant: number, answers: number | undefined): number =>
  answers === undefined ? relevant : 0.5 * relevant + 0.5 * answers

/** State: the query alone. */
export const REWRITE_QUESTION = noul(
  'Could this search query be worded in a noticeably different way and still mean the same thing?',
  'The query is a question or a description whose key words have common synonyms or another natural phrasing.',
  'The query is a name, an identifier, a quoted phrase or a literal keyword with no useful paraphrase.',
)
export const REWRITE_FLOOR = 0.4

// ── Agents ──────────────────────────────────────────────────────────────────

/** State: { agent_instructions, saved_note: { path, title, text } }. */
export const WAKE_QUESTION = noul(
  'Does the saved note give this agent something to do, according to its instructions?',
  'The note is the kind of thing the instructions tell the agent to act on, check, summarise or react to.',
  'The note is unrelated to what the instructions describe, or is a change the agent would do nothing about.',
)
/** Under this the save does not start a run. Low: a missed wake is worse than a wasted one. */
export const WAKE_FLOOR = 0.2
