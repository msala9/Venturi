import test from "node:test";
import assert from "node:assert/strict";
import { request, sendMutation, persistentClientId } from "../js/api.js";

test("only native Replace Take requests receive the bounded thirty-second deadline",async()=>{
  const timeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=milliseconds=>{deadlines.push(milliseconds);return new AbortController().signal;};
  try{
    const replacement={operation:{kind:'replace_take'}},cases=[
      ['/review/replace/plan',{query:{},replacement:{}},30_000],
      ['/timelines/0/commands',replacement,30_000],
      ['/timelines/9007199254740993/commands',replacement,30_000],
      ['/timelines/0/commands',{operation:{kind:'split'}},20_000],
      ['/projects/commands',replacement,20_000],
      ['/timelines/00/commands',replacement,20_000],
      ['/timelines/0/commands?extra=1',replacement,20_000],
      ['/other/timelines/0/commands',replacement,20_000],
      ['/review/replace/plan',undefined,20_000],
      ['/review/replace/plan/other',{},20_000],
      ['/session',undefined,20_000],
    ];
    for(const [path,body,deadline] of cases){
      await request(path,body,async(url,options)=>{assert.equal(url,`/api/v1${path}`);assert.equal(options.method,body===undefined?'GET':'POST');assert(options.signal instanceof AbortSignal);return {ok:true,json:async()=>({})};});
      assert.equal(deadlines.at(-1),deadline,path);
    }
    assert.equal(deadlines.length,cases.length);
  }finally{AbortSignal.timeout=timeout;}
});

test("the Replace Take deadline remains composable with an owning controller cancellation",async()=>{
  const timeout=AbortSignal.timeout,deadline=new AbortController(),owner=new AbortController();let signal;
  AbortSignal.timeout=milliseconds=>{assert.equal(milliseconds,30_000);return deadline.signal;};
  try{
    const pending=request('/review/replace/plan',{query:{},replacement:{}},async(_url,options)=>{
      signal=AbortSignal.any([options.signal,owner.signal]);
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    });
    owner.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(signal.aborted,true);assert.equal(deadline.signal.aborted,false);
  }finally{AbortSignal.timeout=timeout;}
});
test("writer identity survives reload in one tab and remains isolated from another tab",()=>{
  const values = new Map(), storage = {getItem:(key)=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(persistentClientId(storage,()=>"first-client"),"first-client");
  assert.equal(persistentClientId(storage,()=>"different-client"),"first-client");
  assert.equal(persistentClientId({getItem:()=>null,setItem(){}},()=>"other-tab"),"other-tab");
  assert.equal(persistentClientId({getItem(){throw new Error("Blocked");}},()=>"fallback"),"fallback");
});
test("a lost mutation response looks up the same ID without replaying", async () => {
  const calls = [];
  let posted;
  const fetcher = async (path, options) => {
    if(options.method==="POST")posted=JSON.parse(options.body);
    calls.push({ path, method: options.method });
    if (calls.length === 1) throw new TypeError("Disconnected");
    return {
      ok: true,
      json: async () => ({ command_id: "same-id", status: "applied" }),
    };
  };
  const result = await sendMutation(
    "/timelines/0/commands",
    { command_id: "same-id",command_epoch:"7" },
    fetcher,
  );
  assert.equal(result.status, "applied");
  assert.equal(posted.command_epoch,"7","Receipt recovery preserves the original epoch without resubmitting");
  assert.deepEqual(calls, [
    { path: "/api/v1/timelines/0/commands", method: "POST" },
    { path: "/api/v1/commands/same-id", method: "GET" },
  ]);
});
test("unknown outcomes remain explicit and are never blindly resent", async () => {
  let count = 0;
  await assert.rejects(
    sendMutation("/projects/commands", { command_id: "unknown" }, async () => {
      count++;
      throw new TypeError("Offline");
    }),
    (error) => error.code === "OUTCOME_UNKNOWN",
  );
  assert.equal(count, 2);
});
test("a restarted server returns a historical receipt and recovery checkpoint without replay", async () => {
  const receipt={command_id:"before-restart",status:"applied",server_restarted:true,receipt_persisted:true,durability:{state:"recovery",recovery_revision:"native-checkpoint"}};
  const calls=[];
  const result=await sendMutation('/projects/commands',{command_id:receipt.command_id},async(path,options)=>{
    calls.push(options.method);
    if(options.method==='POST')throw new TypeError('Connection closed during restart');
    assert.equal(path,'/api/v1/commands/before-restart');
    return {ok:true,json:async()=>receipt};
  });
  assert.deepEqual(calls,['POST','GET']);
  assert.deepEqual(result,receipt);
});
