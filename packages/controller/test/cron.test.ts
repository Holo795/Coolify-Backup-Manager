import { test } from "node:test";
import assert from "node:assert/strict";
import { cronMatches, isValidCron } from "../src/lib/cron";

function at(iso: string) {
  return new Date(iso);
}

test("matches a daily 02:00 schedule", () => {
  assert.equal(cronMatches("0 2 * * *", at("2026-06-23T02:00:00Z")), true);
  assert.equal(cronMatches("0 2 * * *", at("2026-06-23T02:01:00Z")), false);
  assert.equal(cronMatches("0 2 * * *", at("2026-06-23T03:00:00Z")), false);
});

test("supports steps and lists", () => {
  assert.equal(cronMatches("*/15 * * * *", at("2026-06-23T10:30:00Z")), true);
  assert.equal(cronMatches("*/15 * * * *", at("2026-06-23T10:31:00Z")), false);
  assert.equal(cronMatches("0 0,12 * * *", at("2026-06-23T12:00:00Z")), true);
});

test("day-of-week matching (Sunday=0)", () => {
  // 2026-06-21 is a Sunday
  assert.equal(cronMatches("0 9 * * 0", at("2026-06-21T09:00:00Z")), true);
  assert.equal(cronMatches("0 9 * * 1", at("2026-06-21T09:00:00Z")), false);
});

test("validates cron expressions", () => {
  assert.equal(isValidCron("0 2 * * *"), true);
  assert.equal(isValidCron("nonsense"), false);
  assert.equal(isValidCron("0 2 * *"), false);
});
