import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for email/password accounts. Uses Node's built-in scrypt
 * (no third-party dependency). Stored format: `scrypt$<saltHex>$<hashHex>`.
 *
 * Google-only accounts have a null `passwordHash` and never reach `verifyPassword`
 * with a real value — `verifyPassword(plain, null)` returns false.
 */

const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_LEN = 64;

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plain, salt, KEY_LEN);
  return `${SCHEME}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== SCHEME) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length);
  } catch {
    return false;
  }
  // Lengths always match here (we derive `expected.length` bytes), but guard anyway
  // since timingSafeEqual throws on a length mismatch.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateEmail(email: unknown): ValidationResult {
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return { ok: false, error: "Enter a valid email address." };
  }
  return { ok: true };
}

export function validatePassword(password: unknown): ValidationResult {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return { ok: true };
}

export function validateName(name: unknown): ValidationResult {
  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, error: "Enter your name." };
  }
  return { ok: true };
}

export function validateSignup(input: {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}): ValidationResult {
  const name = validateName(input.name);
  if (!name.ok) return name;
  const email = validateEmail(input.email);
  if (!email.ok) return email;
  const password = validatePassword(input.password);
  if (!password.ok) return password;
  return { ok: true };
}
