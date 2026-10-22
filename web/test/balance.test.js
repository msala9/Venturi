import test from "node:test";
import assert from "node:assert/strict";
import { balanceSelected, balanceTarget } from "../js/balance.js";

test("native balance commits one supplied operation and refuses obsolete analysis",async()=>{
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:6,width:960,clip:"3"};
  const original={...current}, operation={kind:"apply_grade_at_frame",clip_id:"3",frame:6,values:[{param:"MidtonesX",value:0.1}]};
  const calls=[],owner={};let resolve;
  const invoke=()=>balanceSelected({owner,getTarget:()=>current,api:()=>new Promise((r)=>{resolve=r;}),commit:async(op)=>calls.push(op)});
  let pending=invoke();resolve({clip:"3",query:original,operation});assert.equal(await pending,true);assert.deepEqual(calls,[operation]);
  for(const [key,value] of [["clip","other"],["frame",7],["revision","changed"],["project_epoch","p:2"],["if_generation","1"]]) {
    current={...original};pending=invoke();current={...current,[key]:value};resolve({clip:"3",query:original,operation});
    await assert.rejects(pending,/stale/);assert.equal(calls.length,1);
  }
  current={...original};pending=invoke();resolve({clip:"3",query:original,operation:{...operation,values:[]}});assert.equal(await pending,false);
  current=null;await assert.rejects(invoke(),/Select one video clip/);
});

test("balance target remains exactly one writable video even when scopes permit a primary",()=>{
  const document={capabilities:{scopes:true},project_epoch:"p",generation:"3"};
  const timeline={id:"2",revision:"r",tracks:[
    {kind:"video",locked:false,clips:[{id:"9007199254740993",start_frame:10,length_frames:12},{id:"4",start_frame:10,length_frames:12}]},
    {kind:"audio",clips:[{id:"5",start_frame:10,length_frames:12}]}
  ]};
  assert.equal(balanceTarget(document,timeline,["9007199254740993","5"],10).clip,"9007199254740993");
  for(const selection of [[],["5"],["9007199254740993","4"]]) assert.equal(balanceTarget(document,timeline,selection,10),null);
  for(const frame of [9,22,10.5,NaN]) assert.equal(balanceTarget(document,timeline,["4"],frame),null);
  timeline.tracks[0].locked=true;assert.equal(balanceTarget(document,timeline,["4"],10),null);
  assert.equal(balanceTarget({...document,capabilities:{}},timeline,["4"],10),null);
});

test("balance is singleflight through commit and late interaction/context changes never commit",async()=>{
  const owner={},original={project_epoch:"p",if_generation:"0",timeline_id:"1",revision:"r",frame:6,width:960,clip:"3"};
  const operation={kind:"apply_grade_at_frame",clip_id:"3",frame:6,values:[{param:"MidtonesX",value:0.1}]};
  let current={...original},allowed=true,resolve,finishCommit,requests=0,commits=0;
  const invoke=()=>balanceSelected({owner,getTarget:()=>current,canInteract:()=>allowed,
    api:()=>{requests++;return new Promise(r=>resolve=r);},
    commit:async()=>{commits++;await new Promise(r=>finishCommit=r);}});
  const pending=invoke();await assert.rejects(invoke(),/already running/);assert.equal(requests,1);
  resolve({clip:"3",query:original,operation});await Promise.resolve();
  assert.equal(commits,1);await assert.rejects(invoke(),/already running/);finishCommit();assert.equal(await pending,true);
  for(const reason of ["reader","modal","workspace","disconnected"]){
    allowed=true;const late=invoke();allowed=false;resolve({clip:"3",query:original,operation});
    await assert.rejects(late,/unavailable/,reason);assert.equal(commits,1);
  }
  const previousRequests=requests;await assert.rejects(invoke(),/unavailable/);assert.equal(requests,previousRequests);
  allowed=true;const changed=invoke();current={...original,revision:"new"};resolve({clip:"3",query:original,operation});await assert.rejects(changed,/stale/);
  current={...original};const malformed=invoke();resolve({clip:"3",query:original,operation:{...operation,clip_id:"4"}});await assert.rejects(malformed,/does not match/);
  await assert.rejects(balanceSelected({owner,getTarget:()=>current,api:async()=>{throw new Error("GPU busy");},commit:()=>{commits++;}}),/GPU busy/);
  await assert.rejects(balanceSelected({owner,getTarget:()=>current,api:async()=>({clip:"3",query:original,operation}),commit:async()=>{throw new Error("Writer disconnected");}}),/Writer disconnected/);
  assert.equal(await balanceSelected({owner,getTarget:()=>current,api:async()=>({clip:"3",query:original,operation:{...operation,values:[]}}),commit:()=>{commits++;}}),false);
  assert.equal(commits,1);
});
