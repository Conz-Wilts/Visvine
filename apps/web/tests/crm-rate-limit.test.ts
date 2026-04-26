import test from "node:test";
import assert from "node:assert/strict";
import { checkImportRateLimit } from "../lib/crm/rateLimit";

test("rate limiter allows requests within limit", () => {
  // Use unique keys to avoid cross-test pollution
  const uid = `test-${Date.now()}-allow`;
  const cid = "comm-1";

  for (let i = 0; i < 5; i++) {
    const result = checkImportRateLimit(uid, cid);
    assert.ok(result.allowed, `request ${i + 1} should be allowed`);
  }
});

test("rate limiter blocks after exceeding limit", () => {
  const uid = `test-${Date.now()}-block`;
  const cid = "comm-2";

  for (let i = 0; i < 5; i++) {
    checkImportRateLimit(uid, cid);
  }

  const result = checkImportRateLimit(uid, cid);
  assert.ok(!result.allowed, "6th request should be blocked");
  assert.ok(result.retryAfterMs > 0, "retryAfterMs should be positive");
});

test("rate limiter scopes by user and community", () => {
  const uid1 = `test-${Date.now()}-scope1`;
  const uid2 = `test-${Date.now()}-scope2`;
  const cid = "comm-3";

  for (let i = 0; i < 5; i++) {
    checkImportRateLimit(uid1, cid);
  }

  // Different user should still be allowed
  const result = checkImportRateLimit(uid2, cid);
  assert.ok(result.allowed, "different user should be allowed");
});
