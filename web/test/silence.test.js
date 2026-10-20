import test from "node:test";
import assert from "node:assert/strict";
import {speechIdentity,speechOperation} from "../js/silence.js";

test("speech proposals use native integer cuts and reject malformed operations",()=>{
  const result={operation:{kind:"remove_silences",ranges:[[12,24],[48,60]]}};
  assert.equal(speechOperation(result),result.operation);
  for(const operation of [{kind:"delete",ranges:[[1,2]]},{kind:"remove_silences",ranges:[[2,1]]},{kind:"remove_silences",ranges:[[1.5,2]]},{kind:"remove_silences",ranges:[]}])assert.throws(()=>speechOperation({operation}));
});
test("speech identity follows the native document, selection and parameters but ignores transport position",()=>{
  const target={query:{project_epoch:"epoch",if_generation:"2",timeline_id:"1",revision:"r",frame:0},clip_ids:["2","1"]};
  const params={threshold:0.5,min_silence_secs:0.3,head_secs:0.1,tail_secs:0.1};
  const key=speechIdentity(target,params);
  assert.equal(key,speechIdentity({...target,query:{...target.query,frame:10},clip_ids:["1","2"]},params));
  assert.notEqual(key,speechIdentity({...target,clip_ids:["1"]},params));
  assert.notEqual(key,speechIdentity(target,{...params,threshold:0.6}));
  assert.notEqual(key,speechIdentity({...target,query:{...target.query,if_generation:"3"}},params));
});
