import test from "node:test";
import assert from "node:assert/strict";
import { parseCSVClient, validateCSVHeaders } from "../features/crm/utils/parseCSV";

test("parseCSVClient parses basic CSV", () => {
  const csv = `email,name,headline
john@example.com,John Doe,Engineer
jane@example.com,Jane Smith,Designer`;

  const result = parseCSVClient(csv);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.headers, ["email", "name", "headline"]);
  assert.equal(result.rows[0]["email"], "john@example.com");
  assert.equal(result.rows[0]["name"], "John Doe");
  assert.equal(result.rows[1]["headline"], "Designer");
});

test("parseCSVClient handles quoted fields with commas", () => {
  const csv = `email,name,headline
john@example.com,"Doe, John","Engineer, Sr."`;

  const result = parseCSVClient(csv);
  assert.equal(result.rows[0]["name"], "Doe, John");
  assert.equal(result.rows[0]["headline"], "Engineer, Sr.");
});

test("parseCSVClient handles escaped double-quotes", () => {
  const csv = `email,name
john@example.com,"John ""JD"" Doe"`;

  const result = parseCSVClient(csv);
  assert.equal(result.rows[0]["name"], 'John "JD" Doe');
});

test("parseCSVClient returns empty for header-only CSV", () => {
  const result = parseCSVClient("email,name");
  assert.equal(result.rowCount, 0);
  assert.deepEqual(result.rows, []);
});

test("parseCSVClient handles Windows line endings", () => {
  const csv = "email,name\r\njohn@example.com,John\r\njane@example.com,Jane";
  const result = parseCSVClient(csv);
  assert.equal(result.rowCount, 2);
});

test("validateCSVHeaders requires email and name", () => {
  assert.ok(validateCSVHeaders(["email", "name"]).valid);
  assert.ok(validateCSVHeaders(["email", "name", "extra"]).valid);
  assert.ok(!validateCSVHeaders(["email"]).valid);
  assert.ok(!validateCSVHeaders(["name"]).valid);
  assert.ok(!validateCSVHeaders([]).valid);
  assert.deepEqual(validateCSVHeaders(["email"]).missing, ["name"]);
});
