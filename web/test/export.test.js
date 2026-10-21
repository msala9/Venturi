import test from "node:test";
import assert from "node:assert/strict";
import { exportRequest, exportAudioLabel,exportReference,savedExportJobs,exportCanDiscard,exportDiscardRequest,exportScales,exportMarkedRange,exportProgressLabel,exportStageLabel } from "../js/export.js";

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

test('native scales select exact server dimensions and leave old requests unchanged when omitted',()=>{
  const state={project_epoch:'e',if_generation:'1',timeline_id:'t',revision:'r',end_frame:100,marks:{start_frame:11,end_frame:31},export_scales:[{percent:100,width:1920,height:1080},{percent:75,width:1440,height:810},{percent:50,width:960,height:540},{percent:25,width:480,height:270}]},values={scope:'marks',start:'0',end:'100',width:'1920',quality:'18',preset:'veryfast',audio:false,scale_percent:'25'};
  assert.equal(exportScales(state)[3].width,480);assert.deepEqual(exportMarkedRange(state),{start_frame:11,end_frame:31});
  const body=exportRequest(state,values);assert.equal(body.settings.scale_percent,25);assert.equal(body.range.start_frame,11);assert.equal(body.range.end_frame,31);assert.equal(body.range.marks,undefined);assert.equal(body.range.export_scales,undefined);
  assert.equal(exportRequest(state,{...values,scope:'whole'}).range.end_frame,100);assert.equal(exportRequest(state,{...values,scope:'custom',start:'17',end:'19'}).range.start_frame,17);
  assert.equal(exportRequest(state,{...values,scale_percent:''}).settings.scale_percent,undefined);
  for(const patch of [{scale_percent:'33'},{scale_percent:'25.5'},{scope:'unknown'}])assert.throws(()=>exportRequest(state,{...values,...patch}));
  assert.deepEqual(exportMarkedRange({...state,marks:{start_frame:100,end_frame:100}}),{start_frame:100,end_frame:100});assert.throws(()=>exportRequest({...state,marks:{start_frame:100,end_frame:100}},values));assert.throws(()=>exportScales({...state,export_scales:[...state.export_scales.slice(0,3),state.export_scales[0]]}));
});

test('progress estimates use measured positive rates only during running and retain native stage measurements',()=>{
  const progress={current_frame:24,total_frames:72,elapsed_ms:1500,fps:24,decode_fps:120,compose_fps:30,encode_fps:60,startup_ms:250};
  assert.match(exportProgressLabel(progress,'running'),/Elapsed 0:01.*24.0 fps.*Remaining ~0:02/);
  for(const state of ['ready','failed','canceled','interrupted','queued'])assert.doesNotMatch(exportProgressLabel(progress,state),/Remaining/);
  assert.doesNotMatch(exportProgressLabel(progress,'queued'),/fps/);
  for(const fps of [0,-1,NaN,Infinity,null])assert.doesNotMatch(exportProgressLabel({...progress,fps},'running'),/fps|Remaining/);
  assert.match(exportStageLabel(progress),/Decode 120.0 fps.*Compose 30.0 fps.*Encode 60.0 fps.*Startup 0:00/);
  assert.match(exportStageLabel({decode_fps:NaN,compose_fps:0,encode_fps:-1}),/Decode not yet measured.*Compose not yet measured.*Encode not yet measured/);
});
