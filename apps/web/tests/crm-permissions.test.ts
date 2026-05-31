import test from "node:test";
import assert from "node:assert/strict";
import { canManageCrm } from "../lib/crm/roles";

test("admin can manage CRM", () => {
  assert.equal(canManageCrm("admin"), true);
});

test("non-admin roles cannot manage CRM", () => {
  assert.equal(canManageCrm("member"), false);
  assert.equal(canManageCrm("moderator"), false);
  assert.equal(canManageCrm(""), false);
});
