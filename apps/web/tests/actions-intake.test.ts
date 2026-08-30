/**
 * The intake: a budget, not a questionnaire. What is worth asserting is the
 * shape that keeps it one — a hard cap, every question carrying what it decides
 * AND when to skip it, and both build recipes actually rendering it above their
 * steps, since a rule that only exists in a module nothing reads is not a rule.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_INTAKE_QUESTIONS,
  intakeQuestions,
  intakeSummary,
  renderIntake,
  type IntakeKind,
} from '@/lib/actions/shared/intake'
import { allRecipes, recipeById, renderRecipeBody } from '@/lib/actions/recipes'

const KINDS: IntakeKind[] = ['agent', 'connector']

test('no intake may cost more than four questions, and each earns its slot', () => {
  assert.equal(MAX_INTAKE_QUESTIONS, 4)
  for (const kind of KINDS) {
    const questions = intakeQuestions(kind)
    assert.ok(questions.length > 0 && questions.length <= MAX_INTAKE_QUESTIONS, kind)
    for (const q of questions) {
      assert.match(q.ask, /\?$/, `${kind}: a question ends in a question mark`)
      assert.ok(q.decides.length > 20, `${kind}: "${q.ask}" must say what it decides`)
      assert.ok(q.skipWhen.length > 20, `${kind}: "${q.ask}" must say when not to ask it`)
    }
  }
})

test('the rendered intake leads with the budget and never asks for a secret value', () => {
  for (const kind of KINDS) {
    const text = renderIntake(kind)
    assert.match(text, new RegExp(`at most ${MAX_INTAKE_QUESTIONS}`, 'i'), kind)
    assert.match(text, /ONE message/, kind)
    assert.match(text, /credential|value/i, kind)
    // "You decide" has to be an answer, or the intake becomes a wall.
    assert.match(text, /You decide|safe default/i, kind)
    for (const q of intakeQuestions(kind)) assert.ok(text.includes(q.ask), q.ask)
  }
  assert.match(intakeSummary('agent'), /at most 4 questions/)
})

test('both build recipes ask first, and no other recipe does', () => {
  const asks = allRecipes().filter((r) => r.intake).map((r) => r.id)
  assert.deepEqual(asks.sort(), ['create_agent', 'create_connector'])
  for (const id of asks) {
    const body = renderRecipeBody(recipeById(id)!)
    assert.ok(body.includes('## Ask first'), id)
    assert.ok(body.indexOf('## Ask first') < body.indexOf('## Steps'), `${id}: the intake comes before the steps`)
  }
})
