import test from "node:test";
import assert from "node:assert/strict";
import {createMeterReader} from "../js/audio-meters.js";

const query={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:960};
const reading={frame:0,samples:4096,sample_rate:48000,channels:[]};
test("native meter requests are single-flight and canceled/obsolete replies cannot replace current readings",async()=>{
  let current={query,insert:null};const requests=[],values=[],states=[];
  const reader=createMeterReader({getTarget:()=>current,onRead:value=>values.push(value),onStatus:message=>states.push(message),fetcher:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
  const old=reader.refresh();await reader.refresh();assert.equal(requests.length,1);
  reader.invalidate();current={query:{...query,revision:"next",frame:24},insert:{channel:"1",index:0}};
  const latest=reader.refresh();assert.equal(requests[0].options.signal.aborted,true);
  requests[1].resolve(Response.json({...reading,frame:24}));await latest;
  requests[0].resolve(Response.json(reading));await old;
  assert.deepEqual(values.map(value=>value.frame),[24]);
  assert.match(states.at(-1),/85 ms window · Program frame 24/);
  assert.equal(requests[1].url,"/api/v1/preview/audio/meters");
  assert.deepEqual(JSON.parse(requests[1].options.body),current);
});

test("meter errors and changed documents remain visible without changing the editing model",async()=>{
  let current={query,insert:null},mode="busy",pending;
  const values=[],states=[];
  const reader=createMeterReader({getTarget:()=>current,onRead:value=>values.push(value),onStatus:message=>states.push(message),fetcher:()=>mode==="busy"?Promise.resolve(Response.json({error:{code:"AUDIO_BUSY"}},{status:409})):new Promise(resolve=>pending=resolve)});
  await reader.refresh();assert.equal(states.at(-1),"AUDIO_BUSY");assert.equal(values.length,0);
  mode="pending";const old=reader.refresh();current={query:{...query,if_generation:"1"},insert:null};pending(Response.json(reading));await old;assert.equal(values.length,0);
  const snapshot=JSON.stringify(current);const next=reader.refresh();current.query={...current.query,frame:1};pending(Response.json(reading));await next;
  assert.equal(values.length,1,"Advancing playback may show the explicitly labeled native reading frame");
  assert.equal(JSON.parse(snapshot).query.frame,0);assert.equal(current.query.frame,1);
  current=null;await reader.refresh();assert.equal(states.at(-1),"Select a native Program timeline");
});
