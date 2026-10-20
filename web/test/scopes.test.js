import test from "node:test";
import assert from "node:assert/strict";
import { scopeTarget, scopeURL, matchesScope } from "../js/scopes.js";
import { createViewer } from "../js/viewer.js";

test("scopes isolate exactly one selected video target and retain integer frame identity", () => {
  const document = { capabilities:{scopes:true}, project_epoch:"p:1",generation:"4" };
  const timeline = { id:"2",revision:"r",tracks:[{kind:"video",clips:[{id:"3",start_frame:12,length_frames:24}]},{kind:"audio",clips:[{id:"4",start_frame:12,length_frames:24}]}] };
  const target=scopeTarget(document,timeline,["3","4"],12);
  assert.equal(target.clip,"3");assert.equal(target.frame,12);
  assert.equal(scopeTarget(document,timeline,["4"],12),null);
  assert.equal(scopeTarget(document,timeline,["3"],36),null);
  assert.equal(scopeTarget(document,timeline,["3"],11),null);
  assert.equal(scopeTarget({...document,capabilities:{}},timeline,["3"],12),null);
  const state={...target,first:"Waveform",second:"Parade"};
  const url=new URL(scopeURL(state),"http://localhost");
  assert.equal(url.pathname,"/api/v1/preview/scopes/3/Waveform/Parade");
  assert.equal(url.searchParams.get("frame"),"12");assert.equal(url.searchParams.has("clip"),false);
  assert.equal(matchesScope(state,{...state}),true);
  for(const key of ["clip","first","second","revision","if_generation","project_epoch","frame"])
    assert.equal(matchesScope(state,{...state,[key]:"changed"}),false,key);
});

test("an obsolete scope response cannot become current after selection changes",async(t)=>{
  const pending=[];t.mock.method(globalThis,"fetch",()=>new Promise((resolve)=>pending.push(resolve)));
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:960,clip:"3",first:"Waveform",second:"Parade"};
  const image={hidden:true,src:"",decode:async()=>{},classList:{add(){},remove(){}}},status={textContent:""};
  const viewer=createViewer({image,status,empty:{hidden:false},getState:()=>current,matches:matchesScope,endpoint:scopeURL});
  const first=viewer.seek();current={...current,clip:"5"};const second=viewer.seek();
  pending[1](new Response(new Blob(["new"],{type:"image/png"})));await second;
  const url=image.src;pending[0](new Response(new Blob(["old"],{type:"image/png"})));await first;
  assert.equal(image.src,url);assert.equal(status.textContent,"CURRENT");viewer.destroy();
});
