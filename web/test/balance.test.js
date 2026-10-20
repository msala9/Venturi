import test from "node:test";
import assert from "node:assert/strict";
import { balanceSelected } from "../js/balance.js";

test("native balance commits one supplied operation and refuses obsolete analysis",async()=>{
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:6,width:960,clip:"3"};
  const original={...current}, operation={kind:"apply_grade_at_frame",clip_id:"3",frame:6,values:[{param:"MidtonesX",value:0.1}]};
  const calls=[];let resolve;
  const invoke=()=>balanceSelected({getTarget:()=>current,api:()=>new Promise((r)=>{resolve=r;}),commit:async(op)=>calls.push(op)});
  let pending=invoke();resolve({clip:"3",query:original,operation});assert.equal(await pending,true);assert.deepEqual(calls,[operation]);
  for(const [key,value] of [["clip","other"],["frame",7],["revision","changed"],["project_epoch","p:2"],["if_generation","1"]]) {
    current={...original};pending=invoke();current={...current,[key]:value};resolve({clip:"3",query:original,operation});
    await assert.rejects(pending,/stale/);assert.equal(calls.length,1);
  }
  current={...original};pending=invoke();resolve({clip:"3",query:original,operation:{...operation,values:[]}});assert.equal(await pending,false);
  current=null;await assert.rejects(invoke(),/Select one video clip/);
});
