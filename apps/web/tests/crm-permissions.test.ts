import test from "node:test";
import assert from "node:assert/strict";

// Test the permission rank logic (extracted from permissions.ts)
const ROLE_RANK: Record<string, number> = {
  admin: 2,
  moderator: 1,
  member: 0,
};

const REQUIRED_RANK: Record<string, number> = {
  view_crm: 1,
  edit_public: 2,
  edit_private: 1,
  manage_members: 2,
  configure_fields: 2,
};

function hasPermission(role: string, action: string): boolean {
  const rank = ROLE_RANK[role] ?? 0;
  return rank >= REQUIRED_RANK[action];
}

test("admin has all CRM permissions", () => {
  for (const action of Object.keys(REQUIRED_RANK)) {
    assert.ok(hasPermission("admin", action), `admin should have ${action}`);
  }
});

test("moderator can view_crm and edit_private", () => {
  assert.ok(hasPermission("moderator", "view_crm"));
  assert.ok(hasPermission("moderator", "edit_private"));
});

test("moderator cannot edit_public, manage_members, or configure_fields", () => {
  assert.ok(!hasPermission("moderator", "edit_public"));
  assert.ok(!hasPermission("moderator", "manage_members"));
  assert.ok(!hasPermission("moderator", "configure_fields"));
});

test("member has no CRM permissions", () => {
  for (const action of Object.keys(REQUIRED_RANK)) {
    assert.ok(!hasPermission("member", action), `member should not have ${action}`);
  }
});

test("unknown role has no permissions", () => {
  assert.ok(!hasPermission("unknown", "view_crm"));
  assert.ok(!hasPermission("", "view_crm"));
});
