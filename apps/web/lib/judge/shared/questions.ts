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

// ── Clean ───────────────────────────────────────────────────────────────────

const score = (instructions: string, criteria: string[]): ScoreQuestion => ({ type: 'score', instructions, criteria })

/** State: { passage, candidate: { title, type, description } }. */
export const MENTION_QUESTION = noul(
  'In the passage, does the name refer to the candidate?',
  'The passage uses the name to mean this specific person, organisation or thing.',
  'The passage uses the word in its ordinary sense, or means someone or something else with the same name.',
)
/** A mention under this is not auto-linked. */
export const MENTION_VETO_BELOW = 0.3
/** An ambiguous mention's suggested target is named only above this confidence. */
export const MENTION_PICK_CONFIDENCE = 0.75

/** State: { a: { title, text }, b: { title, text } }. Levels 0..2. */
export const SAME_NOTE_QUESTION = score('How do these two notes relate?', [
  'They are about different subjects, or different instances of the same kind of thing (two meetings, two people).',
  'They are about the same subject but each says things the other does not.',
  'They record the same thing: one could be deleted and almost nothing would be lost.',
])
/** At or over this position the pair is a duplicate; under DIFFERENT_BELOW a mechanical duplicate is dismissed. */
export const DUPLICATE_AT = 1.6
export const DIFFERENT_BELOW = 0.5

/** State: { a: { title, statements }, b: { title, statements } }. */
export const CONFLICT_QUESTION = noul(
  'Do the two notes state conflicting facts about the same subject?',
  'One note states something about a subject that the other note states differently: both cannot be true at once.',
  'The notes agree, or are about different subjects, or one only adds detail the other lacks.',
)
export const CONFLICT_AT = 0.7

/** State: { title, type, text }. Levels 0..2. */
export const DURABILITY_QUESTION = score('How long does what this note records stay true and useful?', [
  'Ephemeral: logistics, a status update, a to-do list, something about one moment.',
  'Working knowledge: true for a while, expected to change.',
  'Durable: a record of a person, a decision, a policy, a reference that does not age by being left alone.',
])
/** At or over this a note is not marked stale for being untouched. */
export const DURABLE_AT = 1.4

// ── Derived memories ────────────────────────────────────────────────────────

/** State: { note, statement }. One request per extracted claim. */
export const CLAIM_QUESTIONS = {
  stated: noul(
    'Does the note state what the statement says?',
    'The note says this, in these or other words.',
    'The note does not say this: it is absent from the note, or changed, or inferred beyond it.',
  ),
  standalone: noul(
    'Can the statement be understood by someone who has not read the note?',
    'The statement names who or what it is about.',
    'The statement depends on the note for its subject: it says "he", "she", "it", "they", "this" or "the company" without naming them.',
  ),
}
/** A claim the note does not state is dropped. */
export const CLAIM_STATED_FLOOR = 0.4
export const CLAIM_STANDALONE_FLOOR = 0.25

/** State: { note, statements }. Asked of an EDITED note, about the claims stored from its previous save. */
export const CLAIMS_COVER_QUESTION = noul(
  'Does the note state any fact that none of the statements cover?',
  'The note states a fact — a name, a decision, a detail — that no statement in the list records.',
  'Every fact the note states is recorded by some statement in the list.',
)
/** The stored claims stand when each is still stated at or over this, and the note adds nothing over COVER_BELOW. */
export const CLAIM_STILL_STATED = 0.7
export const CLAIMS_COVER_BELOW = 0.6
