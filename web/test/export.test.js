import test from "node:test";
import assert from "node:assert/strict";
import { exportRequest } from "../js/export.js";

test("export captures an integer exclusive range and native settings without changing the document", () => {
  const state = { project_epoch: "p:1", if_generation: "4", timeline_id: "2", revision: "r", start_frame: 0, end_frame: 8000, fps: { num: 24000, den: 1001 }, width: 960 };
  const values = { start: "12", end: "7180", width: "1920", quality: "23", preset: "medium", audio: true };
  const body = exportRequest(state, values);
  assert.equal(body.range.start_frame,12); assert.equal(body.range.end_frame,7180);
  assert.equal(body.range.revision,"r"); assert.equal(body.range.width,1920);
  assert.equal(body.range.fps,undefined); assert.deepEqual(body.settings,{quality:23,preset:"medium",audio:true});
  assert.equal(state.start_frame,0);
  assert.equal(exportRequest(state,{...values,end:"8000"}).range.end_frame,8000,"Export may include the full timeline beyond the preview duration cap");
  for (const patch of [{start:""},{start:"-1"},{start:"1.5"},{end:"8001"},{end:"12"},{width:"8192"},{quality:"NaN"},{quality:"52"},{audio:"false"}]) assert.throws(()=>exportRequest(state,{...values,...patch}));
  assert.throws(()=>exportRequest(null,values));
});
