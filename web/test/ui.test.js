import test from "node:test";
import assert from "node:assert/strict";
import { isTextTarget } from "../js/ui.js";

test("editor shortcuts stay out of editable elements and dialogs", () => {
  assert.equal(
    isTextTarget({
      closest: (selector) => (selector.includes("input") ? {} : null),
    }),
    true,
  );
  assert.equal(isTextTarget({ closest: () => null }), false);
  assert.equal(isTextTarget(null), false);
});
