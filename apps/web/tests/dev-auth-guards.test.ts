import test from "node:test";
import assert from "node:assert/strict";
import { isDevAuthEnabled } from "../lib/dev-auth";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): void {
  const before: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) before[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("isDevAuthEnabled is false when NODE_ENV=production even if ENABLE_DEV_AUTH=true", () => {
  withEnv({ NODE_ENV: "production", ENABLE_DEV_AUTH: "true" }, () => {
    assert.equal(isDevAuthEnabled(), false);
  });
});

test("isDevAuthEnabled is false when ENABLE_DEV_AUTH is unset", () => {
  withEnv({ NODE_ENV: "development", ENABLE_DEV_AUTH: undefined }, () => {
    assert.equal(isDevAuthEnabled(), false);
  });
});

test("isDevAuthEnabled is false when ENABLE_DEV_AUTH is something other than 'true'", () => {
  withEnv({ NODE_ENV: "development", ENABLE_DEV_AUTH: "1" }, () => {
    assert.equal(isDevAuthEnabled(), false);
  });
  withEnv({ NODE_ENV: "development", ENABLE_DEV_AUTH: "yes" }, () => {
    assert.equal(isDevAuthEnabled(), false);
  });
});

test("isDevAuthEnabled is true only when both flags are set correctly", () => {
  withEnv({ NODE_ENV: "development", ENABLE_DEV_AUTH: "true" }, () => {
    assert.equal(isDevAuthEnabled(), true);
  });
});

test("isDevAuthEnabled is false in test mode", () => {
  withEnv({ NODE_ENV: "test", ENABLE_DEV_AUTH: "true" }, () => {
    assert.equal(isDevAuthEnabled(), false);
  });
});
