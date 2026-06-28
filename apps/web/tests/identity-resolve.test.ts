import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  linkedinHandle,
  websiteDomain,
  nameKey,
  normalizeCompany,
} from "../lib/identity/normalize";
import {
  toSignals,
  scoreCandidate,
  decideMatch,
  type ResolveInput,
} from "../lib/identity/match";

// Build a candidate (id + canonicalName + normalized signals) from raw input.
function candidate(id: string, input: ResolveInput) {
  return { identityId: id, canonicalName: input.name, signals: toSignals(input) };
}

// ── normalization ──────────────────────────────────────────────────────────

test("normalizeEmail lowercases valid emails and rejects junk", () => {
  assert.equal(normalizeEmail(" Craig@Halter.IO "), "craig@halter.io");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
});

test("linkedinHandle canonicalizes real LinkedIn refs but not bare names", () => {
  assert.equal(linkedinHandle("https://www.linkedin.com/in/craig-piggott/"), "linkedin.com/in/craig-piggott");
  assert.equal(linkedinHandle("in/craig-piggott"), "linkedin.com/in/craig-piggott");
  // A name typed into a LinkedIn field must NOT become a fake handle.
  assert.equal(linkedinHandle("Craig Piggott"), null);
  assert.equal(linkedinHandle(""), null);
});

test("websiteDomain strips protocol/www/path", () => {
  assert.equal(websiteDomain("https://www.Halter.io/about"), "halter.io");
  assert.equal(websiteDomain("halter.io"), "halter.io");
  assert.equal(websiteDomain("localhost"), null);
});

test("nameKey folds case, punctuation and diacritics", () => {
  assert.equal(nameKey("Craig  Piggott"), "craig piggott");
  assert.equal(nameKey("José  Núñez"), "jose nunez");
  assert.equal(nameKey("O'Brien-Smith"), "o brien smith");
});

test("normalizeCompany strips legal suffixes", () => {
  assert.equal(normalizeCompany("Halter Inc."), "halter");
  assert.equal(normalizeCompany("Halter Ltd"), "halter");
  assert.equal(normalizeCompany("  Halter  "), "halter");
});

// ── scoring tiers ────────────────────────────────────────────────────────────

test("Tier A: matching email is a strong auto-match", () => {
  const a = toSignals({ kind: "person", name: "Craig Piggott", email: "craig@halter.io" });
  const b = toSignals({ kind: "person", name: "C. Piggott", email: "Craig@Halter.io" });
  const s = scoreCandidate(a, b);
  assert.equal(s.tier, "A");
  assert.ok(s.confidence >= 0.9);
});

test("Tier A: organization matches on website domain", () => {
  const a = toSignals({ kind: "organization", name: "Halter", website: "https://halter.io" });
  const b = toSignals({ kind: "organization", name: "Halter NZ", website: "www.halter.io/careers" });
  assert.equal(scoreCandidate(a, b).tier, "A");
});

test("Tier B: same name + same company auto-matches", () => {
  const a = toSignals({ kind: "person", name: "Craig Piggott", company: "Halter" });
  const b = toSignals({ kind: "person", name: "craig piggott", company: "Halter Inc." });
  const s = scoreCandidate(a, b);
  assert.equal(s.tier, "B");
  assert.ok(s.confidence >= 0.9);
});

test("Tier C: same name, DIFFERENT company is only a suggestion", () => {
  const a = toSignals({ kind: "person", name: "Craig Piggott", company: "Halter" });
  const b = toSignals({ kind: "person", name: "Craig Piggott", company: "Rocket Lab" });
  const s = scoreCandidate(a, b);
  assert.equal(s.tier, "C");
  assert.ok(s.confidence < 0.9);
});

test("different name + no strong id is not a candidate", () => {
  const a = toSignals({ kind: "person", name: "Craig Piggott" });
  const b = toSignals({ kind: "person", name: "Peter Beck" });
  assert.equal(scoreCandidate(a, b).tier, null);
});

test("a person never matches an organization of the same name", () => {
  const a = toSignals({ kind: "person", name: "Halter" });
  const b = toSignals({ kind: "organization", name: "Halter" });
  assert.equal(scoreCandidate(a, b).tier, null);
});

// ── decisions ────────────────────────────────────────────────────────────────

test("decideMatch auto-links the same person across communities (email)", () => {
  const input = toSignals({ kind: "person", name: "Craig Piggott", email: "craig@halter.io" });
  const r = decideMatch(input, [
    candidate("id-craig", { kind: "person", name: "Craig Piggott", email: "craig@halter.io" }),
  ]);
  assert.equal(r.decision, "auto_strong");
  assert.equal(r.identityId, "id-craig");
});

test("decideMatch auto-links on name + company", () => {
  const input = toSignals({ kind: "person", name: "Craig Piggott", company: "Halter" });
  const r = decideMatch(input, [
    candidate("id-craig", { kind: "person", name: "Craig Piggott", company: "Halter Inc" }),
  ]);
  assert.equal(r.decision, "auto_name_company");
  assert.equal(r.identityId, "id-craig");
});

test("decideMatch SUGGESTS (never auto-merges) two same-name people at different orgs", () => {
  const input = toSignals({ kind: "person", name: "Craig Piggott", company: "Halter" });
  const r = decideMatch(input, [
    candidate("id-other-craig", { kind: "person", name: "Craig Piggott", company: "Rocket Lab" }),
  ]);
  assert.equal(r.decision, "suggested");
  assert.equal(r.identityId, null); // not attached
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0].identityId, "id-other-craig");
});

test("decideMatch mints a new identity when nothing matches", () => {
  const input = toSignals({ kind: "person", name: "Brand New Person", email: "new@example.com" });
  const r = decideMatch(input, [
    candidate("id-craig", { kind: "person", name: "Craig Piggott", email: "craig@halter.io" }),
  ]);
  assert.equal(r.decision, "created");
  assert.equal(r.identityId, null);
});

test("anti-match suppression: a rejected identity is never suggested or linked", () => {
  const input = toSignals({ kind: "person", name: "Craig Piggott", email: "craig@halter.io" });
  const r = decideMatch(
    input,
    [candidate("id-craig", { kind: "person", name: "Craig Piggott", email: "craig@halter.io" })],
    new Set(["id-craig"]),
  );
  assert.equal(r.decision, "created");
  assert.equal(r.suggestions.length, 0);
});

test("decideMatch prefers the strongest candidate and surfaces the rest", () => {
  const input = toSignals({ kind: "person", name: "Craig Piggott", email: "craig@halter.io", company: "Halter" });
  const r = decideMatch(input, [
    candidate("id-weak", { kind: "person", name: "Craig Piggott", company: "Rocket Lab" }), // Tier C
    candidate("id-strong", { kind: "person", name: "Craig Piggott", email: "craig@halter.io" }), // Tier A
  ]);
  assert.equal(r.decision, "auto_strong");
  assert.equal(r.identityId, "id-strong");
  assert.ok(r.suggestions.some((s) => s.identityId === "id-weak"));
});
