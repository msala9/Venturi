import test from "node:test";
import assert from "node:assert/strict";
import { request, sendMutation, persistentClientId, observeRequests, ApiFailure } from "../js/api.js";

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

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("request observations include JSON decoding and expose no request identity", async () => {
  const decode = deferred(), reports = [], begins = [];
  let clock = 10;
  const unsubscribe = observeRequests((...args) => {
    begins.push(args);
    return (...values) => reports.push(values);
  }, { now: () => clock });
  try {
    const pending = request('/private/item-secret', { command_id: 'private-command', value: 'secret-body' }, async () => {
      clock = 25;
      return { ok: true, json: () => decode.promise };
    });
    await Promise.resolve();
    assert.deepEqual(begins, [[]]);
    assert.deepEqual(reports, [], 'Receiving headers does not finish the observation');
    clock = 47;
    const data = { private_result: 'secret-result' };
    decode.resolve(data);
    assert.equal(await pending, data);
    assert.deepEqual(reports, [[{ duration_ms: 37, method: 'POST', outcome: 'success' }]]);
    assert.deepEqual(Object.keys(reports[0][0]).sort(), ['duration_ms', 'method', 'outcome']);
  } finally { unsubscribe(); }
});

test("request observations classify errors without changing their existing public errors", async () => {
  const cases = [
    { outcome: 'http_error', response: { ok: false, status: 409, json: async () => ({ error: { code: 'STALE', message: 'Changed' } }) }, check: error => error instanceof ApiFailure && error.code === 'STALE' && error.status === 409 && error.message === 'Changed' },
    { outcome: 'invalid_json', response: { ok: true, status: 200, json: async () => { throw new SyntaxError('Bad JSON'); } }, check: error => error instanceof ApiFailure && error.code === 'INVALID_RESPONSE' && error.status === 200 },
    { outcome: 'network_error', error: new TypeError('Offline') },
    ...['AbortError', 'TimeoutError'].flatMap(name => [
      { outcome: 'aborted', error: Object.assign(new Error(name), { name }) },
      { outcome: 'aborted', response: { ok: true, status: 200, json: async () => { throw Object.assign(new Error(name), { name }); } }, check: error => error instanceof ApiFailure && error.code === 'INVALID_RESPONSE' && error.status === 200 },
    ]),
  ];
  for (const item of cases) {
    let clock = 3;
    const reports = [];
    const unsubscribe = observeRequests(() => value => reports.push(value), { now: () => clock });
    try {
      await assert.rejects(request('/private', undefined, async () => {
        clock = 14;
        if (item.error) throw item.error;
        return item.response;
      }), item.check || (error => error === item.error));
      assert.deepEqual(reports, [{ duration_ms: 11, method: 'GET', outcome: item.outcome }]);
    } finally { unsubscribe(); }
  }
});

test("throwing observers and clocks cannot change a successful request or original failure", async () => {
  for (const stage of ['begin', 'start-clock', 'end-clock', 'finish']) {
    for (const fails of [false, true]) {
      let clockCalls = 0, finished = 0;
      const failure = new TypeError('Original network error');
      const unsubscribe = observeRequests(() => {
        if (stage === 'begin') throw new Error('Observer begin');
        return () => { finished++; if (stage === 'finish') throw new Error('Observer finish'); };
      }, { now: () => {
        clockCalls++;
        if ((stage === 'start-clock' && clockCalls === 1) || (stage === 'end-clock' && clockCalls === 2)) throw new Error('Clock');
        return clockCalls * 5;
      } });
      try {
        const pending = request('/private', undefined, async () => {
          if (fails) throw failure;
          return { ok: true, json: async () => ({ intact: true }) };
        });
        if (fails) await assert.rejects(pending, error => error === failure);
        else assert.deepEqual(await pending, { intact: true });
        assert.equal(finished, stage === 'finish' ? 1 : 0);
      } finally { unsubscribe(); }
    }
  }
});

test("unsubscribe and replacement discard in-flight observations without clearing a newer owner", async () => {
  const first = deferred(), second = deferred(), reports = [];
  const oldUnsubscribe = observeRequests(() => value => reports.push(['old', value]), { now: () => 1 });
  const oldRequest = request('/first', undefined, async () => ({ ok: true, json: () => first.promise }));
  const unsubscribe = observeRequests(() => value => reports.push(['new', value]), { now: () => 2 });
  oldUnsubscribe();
  try {
    first.resolve({ first: true });
    assert.deepEqual(await oldRequest, { first: true });
    assert.deepEqual(reports, []);
    assert.deepEqual(await request('/new', undefined, async () => ({ ok: true, json: async () => ({ new: true }) })), { new: true });
    assert.deepEqual(reports, [['new', { duration_ms: 0, method: 'GET', outcome: 'success' }]]);
    const pending = request('/second', undefined, async () => ({ ok: true, json: () => second.promise }));
    unsubscribe();
    second.resolve({ second: true });
    assert.deepEqual(await pending, { second: true });
    assert.equal(reports.length, 1);
  } finally { oldUnsubscribe(); unsubscribe(); }
});

test("observer replacement during its finishing clock cannot deliver to a stale owner", async () => {
  let calls = 0, reports = 0, replacement;
  const unsubscribe = observeRequests(() => () => { reports++; }, { now: () => {
    if (++calls === 2) replacement = observeRequests(() => () => { reports += 10; });
    return calls;
  } });
  try {
    assert.deepEqual(await request('/session', undefined, async () => ({ ok: true, json: async () => ({}) })), {});
    assert.equal(reports, 0);
  } finally { unsubscribe(); replacement?.(); }
});

test("observing a lost mutation receipt retains POST then GET recovery without replay", async () => {
  const reports = [], methods = [];
  let clock = 0;
  const unsubscribe = observeRequests(() => value => reports.push(value), { now: () => clock });
  try {
    const receipt = { command_id: 'same-id', status: 'applied' };
    const result = await sendMutation('/projects/commands', { command_id: 'same-id' }, async (_path, options) => {
      methods.push(options.method);
      clock += 7;
      if (options.method === 'POST') throw new TypeError('Lost response');
      return { ok: true, json: async () => { clock += 2; return receipt; } };
    });
    assert.equal(result, receipt);
    assert.deepEqual(methods, ['POST', 'GET']);
    assert.deepEqual(reports, [
      { duration_ms: 7, method: 'POST', outcome: 'network_error' },
      { duration_ms: 9, method: 'GET', outcome: 'success' },
    ]);
  } finally { unsubscribe(); }
});
