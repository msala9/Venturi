import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspacePerformance,createWorkspacePerformancePanel,createWorkspaceInputTiming,previewDiagnosticsSnapshot} from '../js/workspace-performance.js';

test('paint samples retain a bounded chronological window and nearest-rank percentiles',()=>{
  const performance=createWorkspacePerformance({limit:4});
  for(const value of [1000,1,2,3,4])performance.recordPaint(value,'current');
  assert.deepEqual(performance.snapshot('current').draw,{samples:[1,2,3,4],count:4,p50_ms:2,p95_ms:4,max_ms:4});
  const outlier=createWorkspacePerformance();
  for(let i=0;i<128;i++)outlier.recordPaint(i===127?900:1,'current');
  assert.equal(outlier.snapshot('current').draw.p95_ms,1);
  assert.equal(outlier.snapshot('current').draw.max_ms,900);
  outlier.recordPaint(2,'current');assert.equal(outlier.snapshot('current').draw.count,128);
  const capped=createWorkspacePerformance({limit:10000});
  for(let i=0;i<129;i++)capped.recordPaint(i,'current');
  assert.equal(capped.snapshot('current').draw.count,128);
  assert.equal(capped.snapshot('current').draw.samples[0],1);
});

test('invalid samples and stale contexts cannot publish old timings or private identities',()=>{
  const performance=createWorkspacePerformance();
  performance.recordPaint(12,'private/path/media-identity');
  for(const bad of [NaN,Infinity,-1,'3',null])assert.equal(performance.recordPaint(bad,'private/path/media-identity'),false);
  for(const context of [null,undefined,'',{},'another-context']){
    assert.deepEqual(performance.snapshot(context).draw,{samples:[],count:0,p50_ms:null,p95_ms:null,max_ms:null});
  }
  performance.recordPaint(0,'next');assert.deepEqual(performance.snapshot('next').draw.samples,[0]);
  assert.equal(performance.snapshot('private/path/media-identity').draw.count,0);
  const cache=Object.freeze({entries:2,bytes:1048576,max_entries:32,max_bytes:2097152,path:'/private/media',extra:Infinity});
  const snapshot=performance.snapshot('next',cache);
  assert.deepEqual(snapshot.cache,{entries:2,bytes:1048576,max_entries:32,max_bytes:2097152});
  snapshot.draw.samples.push(99);snapshot.cache.entries=99;
  assert.deepEqual(performance.snapshot('next',cache).draw.samples,[0]);
  assert.equal(cache.entries,2);
  assert.ok(!JSON.stringify(performance.snapshot('next',cache)).includes('private'));
  assert.deepEqual(performance.snapshot('next',{entries:NaN,bytes:-1,max_entries:'32',max_bytes:Infinity}).cache,{entries:null,bytes:null,max_entries:null,max_bytes:null});
});

class Target {
  listeners=new Map();
  captureFlags=[];
  addEventListener(type,callback,capture){this.captureFlags.push(capture);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  capture(type,target=this){const event={type,eventPhase:2,currentTarget:this,target};for(const callback of [...(this.listeners.get(type)||[])])callback(event);return event;}
  end(event){event.eventPhase=0;event.currentTarget=null;}
  dispatch(type,target=this){this.end(this.capture(type,target));}
  count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
function panelFixture(visible=false){
  const root=new Target(),menu=new Target(),document=new Target(),timers=new Map(),callbacks=[];
  let reads=0,writes=0,text='',next=0;
  const output={set textContent(value){writes++;text=value;}};
  const controller=createWorkspacePerformancePanel({root,output,eventTargets:[root,menu,document,root],isVisible:()=>visible,getSnapshot:()=>{reads++;return {draw:{count:2,p50_ms:1,p95_ms:3,max_ms:3},cache:{entries:2,bytes:1048576,max_entries:32,max_bytes:2097152}};},setTimer:(callback,delay)=>{assert.equal(delay,1000);const id=++next;timers.set(id,callback);callbacks.push(callback);return id;},clearTimer:id=>timers.delete(id)});
  return {root,menu,document,timers,callbacks,controller,visible(value){visible=value;},read:()=>reads,write:()=>writes,text:()=>text,tick(){const [id,callback]=timers.entries().next().value;timers.delete(id);callback();}};
}

test('closed diagnostics do no reads or writes; visible updates have one timer and stale callbacks cannot restart it',()=>{
  const h=panelFixture();
  assert.equal(h.read(),0);assert.equal(h.write(),0);assert.equal(h.timers.size,0);
  h.root.dispatch('toggle');h.document.dispatch('visibilitychange');assert.equal(h.read(),0);
  h.visible(true);h.menu.dispatch('toggle');assert.equal(h.read(),1);assert.equal(h.timers.size,1);
  assert.match(h.text(),/draw CPU.*p50 1.00 ms.*p95 3.00 ms.*max 3.00 ms.*sample window 2/);
  assert.match(h.text(),/Accounted media cache.*1.00 \/ 2.00 MiB.*2 \/ 32 items/);
  assert.match(h.text(),/RPC JSON roundtrip \(excludes direct fetch\/media\)/);
  assert.match(h.text(),/Software input dispatch → Canvas callback \(not hardware\/display latency\)/);
  assert.match(h.text(),/Native preview queue · unavailable/);
  assert.match(h.text(),/Composed frame cache \/ lookup counters · unavailable/);
  assert.match(h.text(),/Decoder choice \/ VRAM \/ physical A\/V drift: unavailable/);
  h.tick();assert.equal(h.read(),2);assert.equal(h.timers.size,1);
  const stale=[...h.callbacks];h.visible(false);h.menu.dispatch('toggle');
  assert.equal(h.timers.size,0);const reads=h.read(),writes=h.write();
  for(const callback of stale)callback();assert.equal(h.read(),reads);assert.equal(h.write(),writes);assert.equal(h.timers.size,0);
  h.visible(true);h.root.dispatch('toggle');assert.equal(h.read(),reads+1);assert.equal(h.timers.size,1);
  h.controller.refresh();assert.equal(h.timers.size,1);
  h.visible(false);h.document.dispatch('visibilitychange');assert.equal(h.timers.size,0);
  h.controller.dispose();
});

test('disposal removes every listener and makes pending callbacks and explicit refresh inert',()=>{
  const h=panelFixture(true);assert.equal(h.root.count(),2);assert.equal(h.menu.count(),2);assert.equal(h.document.count(),2);
  const callbacks=[...h.callbacks],reads=h.read(),writes=h.write();
  h.controller.dispose();h.controller.dispose();assert.equal(h.timers.size,0);
  for(const target of [h.root,h.menu,h.document]){assert.equal(target.count(),0);target.dispatch('toggle');}
  for(const callback of callbacks)callback();h.controller.refresh();assert.equal(h.read(),reads);assert.equal(h.write(),writes);
});

test('closing during snapshot acquisition cannot write a hidden panel or create a timer',()=>{
  const root=new Target();let visible=true,writes=0,timers=0;
  const panel=createWorkspacePerformancePanel({root,output:{set textContent(value){writes++;}},isVisible:()=>visible,getSnapshot:()=>{visible=false;return {};},setTimer:()=>{timers++;},clearTimer:()=>{}});
  assert.equal(writes,0);assert.equal(timers,0);panel.dispose();assert.equal(root.count(),0);
});

function nativeDiagnostics(){
  return {preview:{frame_queue:{available:true,waiting:1,capacity:1,scope:'waiting_only'},composed_frame_cache:{available:true,entries:3,bytes:1048576,entry_capacity:8,byte_capacity:16777216,lookup_hits:12,lookup_misses:4,source_validation_rejections:2,scope:'process_lifetime_program_draft_scopes_balance'},private_path:'/not/displayed'}};
}
test('native diagnostic snapshots validate bounded queue/cache schemas without substituting zero or retaining other fields',()=>{
  const value=nativeDiagnostics(),snapshot=previewDiagnosticsSnapshot(value);
  assert.deepEqual(snapshot.frame_queue,{available:true,waiting:1,capacity:1});assert.equal(snapshot.composed_frame_cache.lookup_hits,12);
  snapshot.composed_frame_cache.lookup_hits=99;assert.equal(value.preview.composed_frame_cache.lookup_hits,12);assert.ok(!JSON.stringify(snapshot).includes('private'));
  value.preview.frame_queue={available:false,waiting:null,capacity:1,scope:'waiting_only',reason:'disabled'};
  value.preview.composed_frame_cache.available=false;for(const key of ['entries','bytes','lookup_hits','lookup_misses','source_validation_rejections'])value.preview.composed_frame_cache[key]=null;
  const unavailable=previewDiagnosticsSnapshot(value);assert.equal(unavailable.frame_queue.waiting,null);assert.equal(unavailable.composed_frame_cache.lookup_hits,null);
  for(const change of [v=>v.preview.frame_queue.waiting=2,v=>v.preview.frame_queue.scope='active_and_waiting',v=>v.preview.frame_queue.capacity=2]){
    const invalid=nativeDiagnostics();change(invalid);assert.equal(previewDiagnosticsSnapshot(invalid).frame_queue,null);
  }
  for(const change of [v=>v.preview.composed_frame_cache.entries=9,v=>v.preview.composed_frame_cache.bytes=16777217,v=>v.preview.composed_frame_cache.lookup_hits=Number.MAX_SAFE_INTEGER+1,v=>v.preview.composed_frame_cache.lookup_misses=-1,v=>v.preview.composed_frame_cache.scope='current_project']){
    const invalid=nativeDiagnostics();change(invalid);assert.equal(previewDiagnosticsSnapshot(invalid).composed_frame_cache,null);
  }
  assert.deepEqual(previewDiagnosticsSnapshot(null),{frame_queue:null,composed_frame_cache:null});
});

function diagnosticsFixture(){
  const root=new Target(),menu=new Target(),document=new Target(),timers=new Map(),calls=[];
  let visible=false,context='epoch1',time=1000,text='',next=0,video=null;
  const panel=createWorkspacePerformancePanel({root,output:{set textContent(value){text=value;}},eventTargets:[root,menu,document],isVisible:()=>visible,getContext:()=>context,now:()=>time,
    getSnapshot:()=>({video_playback:video}),readDiagnostics:({signal})=>new Promise((resolve,reject)=>calls.push({signal,resolve,reject})),
    setTimer:callback=>{timers.set(++next,callback);return next;},clearTimer:id=>timers.delete(id)});
  return {root,menu,document,panel,timers,calls,text:()=>text,setVisible(value){visible=value;root.dispatch('toggle');},setHidden(value){visible=!value;document.dispatch('visibilitychange');},setContext(value){context=value;panel.refresh();},setTime(value){time=value;},setVideo(value){video=value;},tick(){const [id,callback]=timers.entries().next().value;timers.delete(id);callback();}};
}
async function settleDiagnostics(){for(let i=0;i<5;i++)await Promise.resolve();}
test('native preview diagnostics fetch once per visible opening; the existing timer only formats snapshot age and browser counters',async()=>{
  const h=diagnosticsFixture();try{
    h.root.dispatch('toggle');await settleDiagnostics();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
    h.setVisible(true);await settleDiagnostics();assert.equal(h.calls.length,1);assert.match(h.text(),/Preview snapshot · loading/);
    h.menu.dispatch('toggle');h.root.dispatch('toggle');h.panel.refresh();h.tick();await settleDiagnostics();assert.equal(h.calls.length,1);
    h.calls[0].resolve(nativeDiagnostics());await settleDiagnostics();
    assert.match(h.text(),/Native preview queue · 1 \/ 1 waiting \(excludes active worker\)/);
    assert.match(h.text(),/Composed frame cache · 1.00 \/ 16.00 MiB · 3 \/ 8 entries · process-lifetime lookups: hits 12, misses 4, source-validation rejections 2/);
    h.setTime(3500);h.setVideo({total_frames:120,dropped_frames:2});h.tick();assert.match(h.text(),/2.5 s old/);assert.match(h.text(),/Current video element · total 120 frames · dropped 2 \(browser playback API\)/);assert.equal(h.calls.length,1);
    h.setVideo({total_frames:120,dropped_frames:121});h.tick();assert.match(h.text(),/Current video element playback counters · unavailable/);
    h.setVisible(false);assert.equal(h.timers.size,0);h.setVisible(true);await settleDiagnostics();assert.equal(h.calls.length,2);
  }finally{h.panel.dispose();}
});
test('closed, hidden, changed-epoch and disposed diagnostic requests cannot publish late values or automatically retry',async()=>{
  const h=diagnosticsFixture();try{
    h.setVisible(true);await settleDiagnostics();const first=h.calls[0];
    h.setVisible(false);assert.equal(first.signal.aborted,true);first.resolve(nativeDiagnostics());await settleDiagnostics();assert.equal(h.timers.size,0);
    h.setVisible(true);await settleDiagnostics();const second=h.calls[1];h.setContext('epoch2');assert.equal(second.signal.aborted,true);assert.match(h.text(),/Preview snapshot · unavailable/);
    second.resolve(nativeDiagnostics());await settleDiagnostics();h.tick();h.document.dispatch('visibilitychange');await settleDiagnostics();assert.equal(h.calls.length,2);assert.doesNotMatch(h.text(),/hits 12/);
    h.setVisible(false);h.setVisible(true);await settleDiagnostics();h.calls[2].reject(Error('network failed'));await settleDiagnostics();assert.match(h.text(),/unavailable · request failed/);h.tick();assert.equal(h.calls.length,3);
    h.setVisible(false);h.setVisible(true);await settleDiagnostics();const last=h.calls[3];h.panel.dispose();assert.equal(last.signal.aborted,true);last.resolve(nativeDiagnostics());await settleDiagnostics();assert.equal(h.timers.size,0);assert.equal(h.root.count(),0);
  }finally{h.panel.dispose();}
});
test('document hiding aborts its one read and busy native snapshots stay unavailable without a retry loop',async()=>{
  const h=diagnosticsFixture();try{
    h.setVisible(true);await settleDiagnostics();const first=h.calls[0];h.setHidden(true);assert.equal(first.signal.aborted,true);
    first.resolve(nativeDiagnostics());await settleDiagnostics();assert.equal(h.timers.size,0);
    h.setHidden(false);await settleDiagnostics();assert.equal(h.calls.length,2);
    const value=nativeDiagnostics();value.preview.frame_queue.available=false;value.preview.frame_queue.waiting=null;value.preview.composed_frame_cache.available=false;
    for(const key of ['entries','bytes','lookup_hits','lookup_misses','source_validation_rejections'])value.preview.composed_frame_cache[key]=null;
    h.calls[1].resolve(value);await settleDiagnostics();assert.match(h.text(),/Native preview queue · unavailable/);assert.match(h.text(),/Composed frame cache \/ lookup counters · unavailable/);assert.doesNotMatch(h.text(),/hits 0/);
    h.tick();h.panel.refresh();await settleDiagnostics();assert.equal(h.calls.length,2);
  }finally{h.panel.dispose();}
});

test('RPC outcomes follow only the retained window and all rings reset together without recording identities',()=>{
  const performance=createWorkspacePerformance({limit:3});
  const names=['success','http_error','invalid_json','aborted','network_error'];
  for(const [i,outcome] of names.entries())performance.recordRequest(Object.freeze({duration_ms:i+1,method:'/private/request-identity',outcome,path:'/private/media'}),'epoch/timeline/revision');
  performance.recordPaint(10,'epoch/timeline/revision');performance.recordInput(20,'epoch/timeline/revision');
  let snapshot=performance.snapshot('epoch/timeline/revision');
  assert.deepEqual(snapshot.rpc.samples,[3,4,5]);assert.equal(snapshot.rpc.p50_ms,4);
  assert.deepEqual(snapshot.rpc.outcomes,{success:0,http_error:0,invalid_json:1,aborted:1,network_error:1});
  assert.equal(performance.recordRequest({duration_ms:7,outcome:'unknown'},'epoch/timeline/revision'),false);
  assert.equal(performance.recordRequest({duration_ms:NaN,outcome:'success'},'epoch/timeline/revision'),false);
  assert.equal(performance.recordInput(-1,'epoch/timeline/revision'),false);
  assert.ok(!JSON.stringify(snapshot).includes('private'));assert.ok(!JSON.stringify(snapshot).includes('epoch'));
  snapshot.rpc.samples[0]=999;snapshot.rpc.outcomes.network_error=999;snapshot.input.samples[0]=999;
  assert.deepEqual(performance.snapshot('epoch/timeline/revision').rpc.samples,[3,4,5]);
  assert.equal(performance.snapshot('epoch/timeline/revision').rpc.outcomes.network_error,1);
  for(const duration of [21,22,23])performance.recordInput(duration,'epoch/timeline/revision');
  assert.deepEqual(performance.snapshot('epoch/timeline/revision').input.samples,[21,22,23]);
  performance.recordInput(7,'new epoch');snapshot=performance.snapshot('new epoch');
  assert.deepEqual(snapshot.input.samples,[7]);assert.equal(snapshot.draw.count,0);assert.equal(snapshot.rpc.count,0);
  for(const context of ['epoch/timeline/revision',null]){
    snapshot=performance.snapshot(context);for(const kind of ['draw','rpc','input'])assert.equal(snapshot[kind].count,0);
    assert.deepEqual(snapshot.rpc.outcomes,{success:0,http_error:0,invalid_json:0,aborted:0,network_error:0});
  }
  performance.recordPaint(1,'third');assert.equal(performance.snapshot('third').input.count,0);
});

function inputFixture(onSample){
  const target=new Target(),documentRef=new Target(),windowRef=new Target(),samples=[];
  let time=0,context='current';documentRef.hidden=false;
  const controller=createWorkspaceInputTiming({target,documentRef,windowRef,getContext:()=>{if(context instanceof Error)throw context;return context;},now:()=>{if(time instanceof Error)throw time;return time;},onSample:onSample || ((duration,ctx)=>samples.push([duration,ctx]))});
  return {target,documentRef,windowRef,controller,samples,time(value){time=value;},context(value){context=value;}};
}

test('input ownership survives capture-to-handler microtasks but cannot attribute a later unrelated navigation',async()=>{
  const h=inputFixture();assert.ok(h.target.captureFlags.every(value=>value===true));
  h.time(4);const event=h.target.capture('wheel');
  await Promise.resolve();
  assert.equal(h.controller.navigationChanged(),true);h.target.end(event);
  h.time(11);assert.equal(h.controller.painted('current'),true);assert.deepEqual(h.samples,[[7,'current']]);
  h.time(20);h.target.dispatch('pointerdown');await Promise.resolve();
  assert.equal(h.controller.navigationChanged(),false);h.time(30);assert.equal(h.controller.painted('current'),false);
  assert.equal(h.samples.length,1);h.controller.dispose();
});

test('coalesced navigation measures the first changing input and consumes exactly one Canvas completion',()=>{
  const h=inputFixture();h.time(10);let event=h.target.capture('pointermove');
  assert.equal(h.controller.navigationChanged(),true);h.target.end(event);
  assert.equal(h.controller.painted('stale'),false);assert.equal(h.controller.painted('current'),false);assert.deepEqual(h.samples,[]);
  h.time(10);event=h.target.capture('pointermove');assert.equal(h.controller.navigationChanged(),true);h.target.end(event);
  h.time(15);event=h.target.capture('keydown');assert.equal(h.controller.navigationChanged(),true);h.target.end(event);
  h.time(25);assert.equal(h.controller.painted('current'),true);
  assert.deepEqual(h.samples,[[15,'current']]);h.time(40);assert.equal(h.controller.painted('current'),false);
  event=h.target.capture('wheel');h.controller.navigationChanged();h.target.end(event);
  assert.equal(h.controller.painted(null),false);assert.equal(h.controller.painted('current'),false);assert.equal(h.samples.length,1);
  h.controller.dispose();
});

test('input context, hidden state and gesture cancellation invalidate pending samples; disposal removes listeners',()=>{
  const h=inputFixture();
  function pending(){const event=h.target.capture('pointerup');assert.equal(h.controller.navigationChanged(),true);h.target.end(event);}
  pending();h.context('new');h.time(10);assert.equal(h.controller.painted('current'),false);assert.equal(h.controller.painted('new'),false);
  for(const [target,type] of [[h.target,'pointercancel'],[h.target,'lostpointercapture'],[h.windowRef,'blur'],[h.documentRef,'visibilitychange']]){
    pending();target.dispatch(type);assert.equal(h.controller.painted('new'),false);
  }
  pending();h.documentRef.hidden=true;assert.equal(h.controller.painted('new'),false);
  h.documentRef.hidden=false;assert.equal(h.controller.painted('new'),false);
  pending();h.controller.dispose();assert.equal(h.controller.navigationChanged(),false);assert.equal(h.controller.painted('new'),false);
  for(const target of [h.target,h.documentRef,h.windowRef])assert.equal(target.count(),0);
  assert.deepEqual(h.samples,[]);
});

test('focus moving from a field to Canvas does not cancel the changing input; actual window blur does',()=>{
  const h=inputFixture();h.time(3);const event=h.target.capture('pointerdown');
  h.windowRef.dispatch('blur',{tagName:'INPUT'});
  assert.equal(h.controller.navigationChanged(),true);h.target.end(event);
  h.time(12);assert.equal(h.controller.painted('current'),true);assert.deepEqual(h.samples,[[9,'current']]);
  const next=h.target.capture('wheel');h.controller.navigationChanged();h.target.end(next);
  h.windowRef.dispatch('blur');assert.equal(h.controller.painted('current'),false);assert.equal(h.samples.length,1);
  h.controller.dispose();
});

test('diagnostic callback errors and invalid clocks cannot break the input handler or painting',()=>{
  const h=inputFixture(()=>{throw new Error('diagnostic only');});
  let event=h.target.capture('drop');assert.equal(h.controller.navigationChanged(),true);h.target.end(event);
  h.time(5);assert.doesNotThrow(()=>h.controller.painted('current'));
  event=h.target.capture('dblclick');h.controller.navigationChanged();h.target.end(event);h.time(1);
  assert.equal(h.controller.painted('current'),false);h.time(NaN);h.target.dispatch('wheel');assert.equal(h.controller.navigationChanged(),false);
  h.time(new Error('clock only'));assert.doesNotThrow(()=>h.target.dispatch('pointerdown'));assert.equal(h.controller.navigationChanged(),false);
  h.context(new Error('context only'));assert.doesNotThrow(()=>h.target.dispatch('wheel'));assert.equal(h.controller.navigationChanged(),false);assert.equal(h.controller.painted('current'),false);
  h.controller.dispose();
});
