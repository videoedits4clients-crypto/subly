/**
 * P23 — the pure scope rules shared by the Templates, Presets, Style and Animation tabs.
 *
 * Run with: node --test src/lib/__tests__/edit-scope.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { describeOverrides, hasOwnLook, resolveEditScope, selectionKeyOf, summarizeOverrides, validWordIndex } from "../edit-scope.ts";

const KEY = selectionKeyOf("c1", ["c1"]);

test("with nothing selected every panel acts on the project, whatever was chosen", () => {
  for (const stored of [null, { scope: "all" as const, selectionKey: "" }, { scope: "selected" as const, selectionKey: "" }]) for (const d of ["all", "selected"] as const) assert.equal(resolveEditScope(stored, "", false, d), "all");
});

test("an unchosen scope uses each panel's own default; a scope chosen for this selection wins everywhere", () => {
  assert.equal(resolveEditScope(null, KEY, true, "all"), "all", "Style / Animation / Presets default");
  assert.equal(resolveEditScope(null, KEY, true, "selected"), "selected", "Templates default");
  assert.equal(resolveEditScope({ scope: "selected", selectionKey: KEY }, KEY, true, "all"), "selected");
  assert.equal(resolveEditScope({ scope: "all", selectionKey: KEY }, KEY, true, "selected"), "all");
});

test("a chosen scope lapses when the selection changes — 'apply to all' can never leak onto the next caption's template click", () => {
  const chosenAll = { scope: "all" as const, selectionKey: selectionKeyOf(null, []) };
  const nowSelected = selectionKeyOf("c2", ["c2"]);
  assert.equal(resolveEditScope(chosenAll, nowSelected, true, "selected"), "selected", "Templates fall back to the selection");
  const chosenForC1 = { scope: "all" as const, selectionKey: KEY };
  assert.equal(resolveEditScope(chosenForC1, selectionKeyOf("c2", ["c2"]), true, "selected"), "selected");
  assert.equal(resolveEditScope(chosenForC1, selectionKeyOf("c1", ["c1", "c3"]), true, "selected"), "selected", "adding a caption is a new selection too");
});

test("selectionKeyOf is order-independent and counts the focused caption once", () => {
  assert.equal(selectionKeyOf("b", ["a", "b", "c"]), "a,b,c");
  assert.equal(selectionKeyOf("a", ["c", "a"]), "a,c");
  assert.equal(selectionKeyOf(null, []), "");
});

test("summarizeOverrides counts captions with their own look; word styling is never a caption look", () => {
  const subs = [
    { id: "a" },
    { id: "b", style: { fontSize: 50 } },
    { id: "c", animation: { entrance: "pop" as const } },
    { id: "d", style: { color: "#fff" }, animation: { exit: "fade" as const } },
  ];
  const s = summarizeOverrides(subs);
  assert.deepEqual(s.style, ["b", "d"]);
  assert.deepEqual(s.animation, ["c", "d"]);
  assert.deepEqual(s.any, ["b", "c", "d"]);
  assert.equal(hasOwnLook(subs[0]), false);
  assert.equal(hasOwnLook(subs[2]), true);
});

test("describeOverrides words the notice and says nothing when there is nothing to say", () => {
  const s = summarizeOverrides([{ id: "a", style: { fontSize: 1 } }, { id: "b", style: { fontSize: 2 } }, { id: "c" }]);
  assert.equal(describeOverrides(s, "style"), "2 captions have their own style");
  assert.equal(describeOverrides(s, "animation"), null);
  assert.equal(describeOverrides(summarizeOverrides([{ id: "a", animation: { exit: "fade" } }]), "look"), "1 caption has its own style or animation");
});

test("a remembered word index is dropped when the focus moves to another caption, and when it is out of range", () => {
  const long = { id: "a", words: [1, 2, 3, 4, 5, 6].map((i) => ({ text: String(i), start: i, end: i + 1 })) };
  const short = { id: "b", words: [{ text: "x", start: 0, end: 1 }] };
  const remembered = { subtitleId: "a", index: 5 };
  assert.equal(validWordIndex(remembered, long), 5);
  assert.equal(validWordIndex(remembered, short), null, "a different caption — never shown, and never indexed past its words");
  assert.equal(validWordIndex({ subtitleId: "b", index: 5 }, short), null, "out of range for that caption");
  assert.equal(validWordIndex(null, long), null);
  assert.equal(validWordIndex(remembered, undefined), null);
});
