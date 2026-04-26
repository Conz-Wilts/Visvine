import test from "node:test";
import assert from "node:assert/strict";
import { buildColumns } from "../features/crm/utils/buildColumns";

const sampleFields = [
  { key: "lead_status", label: "Lead Status", type: "select" as const, options: ["Hot", "Warm", "Cold"] },
  { key: "notes", label: "Notes", type: "text" as const },
];

test("admin can edit public fields and private fields", () => {
  const cols = buildColumns(sampleFields, "admin");
  const nameCol = cols.find((c) => c.key === "name");
  const leadCol = cols.find((c) => c.key === "lead_status");
  const emailCol = cols.find((c) => c.key === "email");

  assert.ok(nameCol?.editable, "admin should edit name");
  assert.ok(leadCol?.editable, "admin should edit lead_status");
  assert.ok(!emailCol?.editable, "email should never be editable");
});

test("moderator cannot edit public fields but can edit private fields", () => {
  const cols = buildColumns(sampleFields, "moderator");
  const nameCol = cols.find((c) => c.key === "name");
  const leadCol = cols.find((c) => c.key === "lead_status");

  assert.ok(!nameCol?.editable, "moderator should not edit name");
  assert.ok(leadCol?.editable, "moderator should edit lead_status");
});

test("member cannot edit anything", () => {
  const cols = buildColumns(sampleFields, "member");
  for (const col of cols) {
    assert.ok(!col.editable, `member should not edit ${col.key}`);
  }
});

test("public columns come before private columns", () => {
  const cols = buildColumns(sampleFields, "admin");
  const publicIdx = cols.findIndex((c) => c.key === "name");
  const privateIdx = cols.findIndex((c) => c.key === "lead_status");
  assert.ok(publicIdx < privateIdx, "public columns should come first");
});

test("activeUserLocked is set for name and headline", () => {
  const cols = buildColumns([], "admin");
  const nameCol = cols.find((c) => c.key === "name");
  const headlineCol = cols.find((c) => c.key === "headline");
  const emailCol = cols.find((c) => c.key === "email");

  assert.ok(nameCol?.activeUserLocked);
  assert.ok(headlineCol?.activeUserLocked);
  assert.ok(!emailCol?.activeUserLocked);
});
