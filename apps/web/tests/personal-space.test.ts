import test from "node:test";
import assert from "node:assert/strict";
import { isForeignPersonalSpace } from "../lib/communities/personalSpace";

test("non-personal (shared) communities are accessible to anyone", () => {
  assert.equal(isForeignPersonalSpace(null, "user_a"), false);
  assert.equal(isForeignPersonalSpace(undefined, "user_a"), false);
});

test("a user's own personal space is accessible to them", () => {
  assert.equal(isForeignPersonalSpace("user_a", "user_a"), false);
});

test("another user's personal space is forbidden", () => {
  assert.equal(isForeignPersonalSpace("user_b", "user_a"), true);
  assert.equal(isForeignPersonalSpace("user_a", "user_b"), true);
});

test("empty-string owner is treated as a real owner id (not null)", () => {
  // Defensive: an empty string is not null, so it must not be mistaken for a
  // shared community. A different (non-empty) user is still forbidden.
  assert.equal(isForeignPersonalSpace("", "user_a"), true);
  assert.equal(isForeignPersonalSpace("", ""), false);
});
