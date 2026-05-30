import test from "node:test";
import assert from "node:assert/strict";

// Test the permission rank logic (extracted from permissions.ts)
const ROLE_RANK: Record<string, number> = {
  admin: 1,
  member: 0,
};

const REQUIRED_RANK: Record<string, number> = {
  view_crm: 1,
  edit_public: 1,
  edit_private: 1,
  manage_members: 1,
  configure_fields: 1,
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

test("member has no CRM permissions", () => {
  for (const action of Object.keys(REQUIRED_RANK)) {
    assert.ok(!hasPermission("member", action), `member should not have ${action}`);
  }
});

test("unknown role has no permissions", () => {
  assert.ok(!hasPermission("unknown", "view_crm"));
  assert.ok(!hasPermission("", "view_crm"));
});
