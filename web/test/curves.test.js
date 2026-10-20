import test from "node:test";
import assert from "node:assert/strict";
import {bindCurveGesture, curveGeometry, curveHandles, curveKeyOperation} from "../js/curves.js";

test("curve edits retain exact source frames, outgoing Bezier and deletion identity", () => {
  const target = {kind: "transform", param: "Opacity"};
  const operation = curveKeyOperation("3", target, 25, 27, 30, "Bezier", [0.2, -0.5, 0.8, 1.5]);
  assert.deepEqual(operation, {kind: "edit_curve_key", clip_id: "3", edit: {target, previous_source_frame: 25, source_frame: 27, value: 30, interpolation: {Bezier: {c1: [0.2, -0.5], c2: [0.8, 1.5]}}}});
  assert.equal(curveKeyOperation("3", target, 25, 25, null, "Hold", []).edit.value, null);
  assert.equal(curveKeyOperation("3", target, -2, -2, null, "Hold", []).edit.previous_source_frame, -2);
  for (const frame of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => curveKeyOperation("3", target, null, frame, 20, "Linear", []));
  assert.throws(() => curveKeyOperation("3", target, null, 25, Infinity, "Linear", []));
  assert.throws(() => curveKeyOperation("3", target, null, 25, 20, "Bezier", [1.1, 0, 0.5, 1]));
});

test("curve drags stay local until one release; Escape, capture loss and disposal cancel", () => {
  const events = {}, commits = [], drafts = [];
  let resets = 0, busy = false, writable = true;
  const canvas = {addEventListener: (name, action) => { events[name] = action; }, focus() {}, setPointerCapture() {}, releasePointerCapture() { events.lostpointercapture(); }, getBoundingClientRect: () => ({left: 0, top: 0})};
  const control = bindCurveGesture(canvas, {
    getCurve: () => ({keys: [{source_frame: 10, value: 20}]}),
    getGeometry: () => ({x: (x) => x, y: (y) => y, frame: Math.round, value: (y) => y}),
    isBusy: () => busy, canEdit: () => writable, select() {},
    draft: (point) => drafts.push(point), finish: (point) => commits.push(point), reset: () => resets++,
  });
  const point = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y});
  events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); events.pointermove(point(25, 40));
  assert.equal(commits.length, 0); assert.equal(drafts.length, 2);
  events.pointerup(point(25, 40)); assert.deepEqual(commits, [{frame: 25, value: 40}]);
  for (const cancel of [() => events.keydown({key: "Escape", stopPropagation() {}, preventDefault() {}}), events.lostpointercapture, events.pointercancel, control.cancel]) {
    events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); cancel(); events.pointerup(point(20, 30));
    assert.equal(commits.length, 1);
  }
  assert.equal(resets, 4);
  busy = true; events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); events.pointerup(point(20, 30));
  busy = false; writable = false; events.pointerdown(point(10, 20)); events.pointermove(point(20, 30)); events.pointerup(point(20, 30));
  assert.equal(commits.length, 1);
});

test("curve geometry plots supplied native samples without evaluating interpolation", () => {
  const range = {source_start: 24, source_end: 120};
  const curve = {min: 0, max: 100, samples: [[24, 30], [70, 47.123], [120, 80]], keys: [{source_frame: 25, value: 20}]};
  const g = curveGeometry(curve, range, 300, 190);
  assert.equal(g.frame(g.x(70)), 70);
  assert.equal(g.frame(-1000), 24); assert.equal(g.frame(1000), 120);
  assert.equal(g.value(-1000), 100); assert.equal(g.value(1000), 0);
  assert.ok(Math.abs(g.value(g.y(47.123)) - 47.123) < 1e-9);
  assert.ok(g.min < 20 && g.max > 80);
});

test("Bezier handle coordinates use native controls and one command per completed drag", () => {
  const curve = {min: 0, max: 100, samples: [[7, 20], [18, 90]], keys: [{source_frame: 7, value: 20, controls: [[0.2, -0.5], [0.8, 1.5]]}, {source_frame: 18, value: 90, controls: null}]};
  const handles = curveHandles(curve, 7), g = curveGeometry(curve, {source_start: 7, source_end: 18}, 300, 190, 7);
  assert.equal(handles.length, 2); assert.equal(handles[0].frame, 9.2); assert.equal(handles[0].value, -15);
  assert.ok(g.min < -15 && g.max > 125);
  const normalized = g.control(handles[0], g.x(9.2), g.y(-15));
  assert.ok(Math.abs(normalized[0] - 0.2) < 1e-10); assert.equal(normalized[1], -0.5);
  assert.deepEqual(curveHandles(curve, 18), []);
  const events = {}, drafts = [], commits = [];
  const canvas = {addEventListener: (name, action) => { events[name] = action; }, focus() {}, setPointerCapture() {}, releasePointerCapture() { events.lostpointercapture(); }, getBoundingClientRect: () => ({left: 0, top: 0})};
  bindCurveGesture(canvas, {getCurve: () => curve, getGeometry: () => g, getHandles: () => handles, isBusy: () => false, canEdit: () => true, select() {}, draft() { assert.fail("A handle cannot move a key"); }, draftHandle: (index, point) => drafts.push({index, point}), finish: (point) => commits.push(point), reset() {}});
  const point = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y});
  events.pointerdown(point(g.x(9.2), g.y(-15)));
  events.pointermove(point(g.x(10), g.y(5))); events.pointermove(point(g.x(11), g.y(8)));
  assert.equal(commits.length, 0); assert.equal(drafts.length, 2);
  events.pointerup(point(g.x(11), g.y(8))); assert.equal(commits.length, 1);
});
