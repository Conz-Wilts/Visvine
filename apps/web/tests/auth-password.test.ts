import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePassword,
  validateName,
  validateSignup,
  MIN_PASSWORD_LENGTH,
} from "../lib/auth/password";

test("hashPassword produces a verifiable scrypt hash", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.ok(verifyPassword("correct horse battery staple", hash));
});

test("verifyPassword rejects the wrong password", () => {
  const hash = hashPassword("s3cret-password");
  assert.ok(!verifyPassword("s3cret-passwor", hash));
  assert.ok(!verifyPassword("", hash));
});

test("each hash uses a fresh salt (hashes differ for same input)", () => {
  const a = hashPassword("same-password-123");
  const b = hashPassword("same-password-123");
  assert.notEqual(a, b);
  assert.ok(verifyPassword("same-password-123", a));
  assert.ok(verifyPassword("same-password-123", b));
});

test("verifyPassword returns false for null / malformed stored values", () => {
  assert.ok(!verifyPassword("anything", null));
  assert.ok(!verifyPassword("anything", undefined));
  assert.ok(!verifyPassword("anything", ""));
  assert.ok(!verifyPassword("anything", "not-a-hash"));
  assert.ok(!verifyPassword("anything", "scrypt$$"));
  assert.ok(!verifyPassword("anything", "bcrypt$abc$def"));
});

test("validateEmail accepts valid and rejects invalid addresses", () => {
  assert.ok(validateEmail("a@b.co").ok);
  assert.ok(!validateEmail("not-an-email").ok);
  assert.ok(!validateEmail("a@b").ok);
  assert.ok(!validateEmail("").ok);
  assert.ok(!validateEmail(123).ok);
});

test("validatePassword enforces the minimum length", () => {
  assert.ok(!validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok);
  assert.ok(validatePassword("a".repeat(MIN_PASSWORD_LENGTH)).ok);
  assert.ok(!validatePassword(undefined).ok);
});

test("validateName requires a non-empty name", () => {
  assert.ok(!validateName("   ").ok);
  assert.ok(!validateName("").ok);
  assert.ok(validateName("Ada Lovelace").ok);
});

test("validateSignup checks name, email, then password", () => {
  assert.ok(validateSignup({ name: "Ada", email: "ada@x.io", password: "longenough" }).ok);

  const badName = validateSignup({ name: "", email: "ada@x.io", password: "longenough" });
  assert.ok(!badName.ok && /name/i.test(badName.error));

  const badEmail = validateSignup({ name: "Ada", email: "nope", password: "longenough" });
  assert.ok(!badEmail.ok && /email/i.test(badEmail.error));

  const badPw = validateSignup({ name: "Ada", email: "ada@x.io", password: "short" });
  assert.ok(!badPw.ok && /password/i.test(badPw.error));
});
