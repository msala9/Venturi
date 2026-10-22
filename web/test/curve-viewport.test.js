import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCurveTimeViewport,checkedCurveViewport,createCurveViewportReader} from '../js/curve-viewport.js';
const detail={project_epoch:'epoch',generation:'7',timeline_id:'tl',revision:'revision',clip_id:'clip'};
const query={target:{kind:'transform',param:'Opacity'},source_start:0,source_end:100,points:3};
const reply=(request=query,patch={})=>({...detail,...request,samples:[[request.source_start,-5],[(request.source_start+request.source_end)/2,130],[request.source_end,50]],...patch});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
function harness(){const timers=new Map(),calls=[],changes=[],notices=[];let next=0,current=true;const reader=createCurveViewportReader({detail,canRead:()=>current,read:(request,options)=>{const pending=deferred();calls.push({...pending,request,options});return pending.promise;},onChange:()=>changes.push(true),notice:text=>notices.push(text),schedule:fn=>{timers.set(++next,fn);return next;},unschedule:id=>timers.delete(id)});return {reader,calls,changes,notices,timers,setCurrent:value=>current=value,tick(){const values=[...timers.values()];timers.clear();for(const fn of values)fn();}};}

test('native f32 time zoom anchors under pointer with two-frame minimum and bounded horizontal pan',()=>{
  const full={source_start:0,source_end:100},axis={left:0,plotWidth:100};
  assert.deepEqual(nativeCurveTimeViewport(full,full,axis,{x:75,zoom:2}),{source_start:37,source_end:87});
  assert.deepEqual(nativeCurveTimeViewport({source_start:20,source_end:60},full,axis,{pan:25}),{source_start:10,source_end:50});
  assert.deepEqual(nativeCurveTimeViewport(full,full,axis,{x:100,zoom:1000}),{source_start:98,source_end:100});
  assert.deepEqual(nativeCurveTimeViewport({source_start:20,source_end:40},full,axis,{zoom:.01}),full);
  assert.deepEqual(nativeCurveTimeViewport({source_start:7,source_end:8},{source_start:7,source_end:8},axis,{zoom:100}),{source_start:7,source_end:8});
  assert.deepEqual(nativeCurveTimeViewport({source_start:-20,source_end:80},{source_start:-20,source_end:80},axis,{x:19.5,zoom:2}),{source_start:-11,source_end:39});
});

test('native viewport validates complete captured identity, fractional samples and real overshoot without JS interpolation',()=>{
  const value=reply(query,{samples:[[0,-50],[25.125,180],[100,50]],target:{param:'Opacity',kind:'transform'}});assert.equal(checkedCurveViewport(value,detail,query),value);
  for(const patch of [{generation:'8'},{target:{kind:'gain'}},{source_start:1},{points:2},{samples:[[0,1],[50,Infinity],[100,3]]},{samples:[[0,1],[60,2],[50,3]]},{samples:[[0,1],[101,2],[100,3]]},{samples:[[0,1],[100,3]]}])assert.throws(()=>checkedCurveViewport({...value,...patch},detail,query));
});

test('viewport requests coalesce before dispatch, serialize even when abort is ignored, and reject late samples',async()=>{
  const h=harness(),a={...query,source_end:80},b={...query,source_end:60};h.reader.request(query,'selection');h.reader.request(a,'selection');assert.equal(h.calls.length,0);assert.equal(h.timers.size,1);h.tick();await flush();assert.deepEqual(h.calls[0].request,a);
  h.reader.request(b,'selection');assert.equal(h.calls[0].options.signal.aborted,true);h.tick();assert.equal(h.calls.length,1);h.calls[0].resolve(reply(a));await flush();assert.equal(h.changes.length,0);h.tick();await flush();assert.equal(h.calls.length,2);h.calls[1].resolve(reply(b));await flush();assert.deepEqual(h.reader.request(b,'selection'),reply(b));assert.equal(h.changes.length,1);h.reader.dispose();
});

test('context/navigation cancellation cannot publish a stale graph and failed reads do not retry automatically',async()=>{
  const h=harness();h.reader.request(query,'old context');h.tick();await flush();h.reader.cancel();h.reader.request(query,'new context');h.tick();assert.equal(h.calls.length,1);h.calls[0].resolve(reply());await flush();h.tick();await flush();assert.equal(h.calls.length,2);h.calls[1].reject(Error('Native viewport unavailable'));await flush();
  for(let i=0;i<5;i++){assert.equal(h.reader.request(query,'new context'),null);h.tick();await flush();}assert.equal(h.calls.length,2);assert.equal(h.notices.length,1);h.setCurrent(false);assert.equal(h.reader.request(query,'new context'),null);h.reader.dispose();
});

test('a readonly current viewport may load while disposal aborts its exact owned read',async()=>{
  const h=harness();h.reader.request(query,'readonly');h.tick();await flush();h.calls[0].resolve(reply());await flush();assert.deepEqual(h.reader.request(query,'readonly'),reply());
  h.reader.request({...query,source_start:20},'readonly');h.tick();await flush();h.reader.dispose();assert.equal(h.calls[1].options.signal.aborted,true);h.calls[1].resolve(reply(h.calls[1].request));await flush();assert.equal(h.changes.length,1);assert.equal(h.reader.request(query,'readonly'),null);
});

test('pointer suspension aborts pending work while retaining accepted samples for the same native query only',async()=>{
  const h=harness();h.reader.request(query,'fixed context');h.tick();await flush();h.calls[0].resolve(reply());await flush();
  h.reader.pause();assert.deepEqual(h.reader.peek(query,'fixed context'),reply());assert.equal(h.reader.peek({...query,source_end:80},'fixed context'),null);assert.equal(h.reader.peek(query,'other context'),null);
  assert.deepEqual(h.reader.request(query,'fixed context'),reply());assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);h.reader.cancel();assert.equal(h.reader.peek(query,'fixed context'),null);h.reader.dispose();
});
