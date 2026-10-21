import test from "node:test";
import assert from "node:assert/strict";
import { exportRequest, exportAudioLabel,exportReference,savedExportJobs,exportCanDiscard,exportDiscardRequest } from "../js/export.js";

test('saved export history retains its original epoch across a new editor session',()=>{
  const ready={id:'export-9007199254740993',project_epoch:'old-server:7',state:'ready'},interrupted={id:'export-2',project_epoch:'old-server:8',state:'interrupted',previous_state:'running'};
  assert.deepEqual(savedExportJobs({jobs:[ready,interrupted]}),[ready,interrupted]);
  assert.deepEqual(exportReference(ready),{id:ready.id,epoch:'old-server:7'});
  assert.throws(()=>exportReference({...ready,id:'../outside'}));
  assert.throws(()=>exportReference({...ready,project_epoch:7}));
  assert.throws(()=>savedExportJobs({jobs:Array(65).fill(ready)}));
  assert.throws(()=>savedExportJobs({jobs:[{...ready,state:'resumed'}]}));
});

test('discard binds the original saved epoch and exact current manifest revision',()=>{
  const job={id:'9007199254740993',project_epoch:'old-server:7',state:'ready',durable:true,export_revision:'a'.repeat(64)},reference=exportReference(job),command='123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(exportDiscardRequest(reference,job,command),{project_epoch:'old-server:7',revision:'a'.repeat(64),command_id:command});
  for(const state of ['queued','running','discarding'])assert.equal(exportCanDiscard({...job,state}),false);
  for(const changed of [{...job,project_epoch:'new-server:1'},{...job,id:'9007199254740995'},{...job,durability_error:true},{...job,export_revision:null},{...job,state:'running'}])assert.throws(()=>exportDiscardRequest(reference,changed,command));
  assert.deepEqual(savedExportJobs({jobs:[{...job,state:'discarding'}]})[0].state,'discarding');
});
test("the download describes actual native audio presence rather than the requested checkbox",()=>{
  assert.equal(exportAudioLabel({audio_present:false,export_settings:{audio:true}})," · silent");
  assert.equal(exportAudioLabel({audio_present:true,export_settings:{audio:true}})," + AAC");
});

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
