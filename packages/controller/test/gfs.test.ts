import { test } from "node:test";
import assert from "node:assert/strict";
import { computeKeepSet } from "../src/lib/gfs";

function snap(id: string, iso: string) {
  return { id, at: new Date(iso) };
}

test("keeps N most recent days", () => {
  const snaps = [
    snap("d1", "2026-06-23T02:00:00Z"),
    snap("d2", "2026-06-22T02:00:00Z"),
    snap("d3", "2026-06-21T02:00:00Z"),
    snap("d4", "2026-06-20T02:00:00Z"),
  ];
  const keep = computeKeepSet(snaps, 2, 0, 0);
  assert.deepEqual([...keep].sort(), ["d1", "d2"]);
});

test("keeps daily then weekly then monthly tiers", () => {
  const snaps = [
    snap("today", "2026-06-23T02:00:00Z"),
    snap("yesterday", "2026-06-22T02:00:00Z"),
    snap("priorWeek", "2026-06-15T02:00:00Z"),
    snap("priorMonth", "2026-05-20T02:00:00Z"),
    snap("ancient", "2026-03-01T02:00:00Z"),
  ];
  const keep = computeKeepSet(snaps, 2, 1, 1);
  assert.equal(keep.has("today"), true); // daily #1
  assert.equal(keep.has("yesterday"), true); // daily #2
  assert.equal(keep.has("priorWeek"), true); // weekly tier
  assert.equal(keep.has("priorMonth"), true); // monthly tier
  assert.equal(keep.has("ancient"), false); // exceeds all tiers -> pruned
  assert.equal(keep.size, 4);
});

test("empty retention keeps nothing", () => {
  const keep = computeKeepSet([snap("x", "2026-06-23T02:00:00Z")], 0, 0, 0);
  assert.equal(keep.size, 0);
});
