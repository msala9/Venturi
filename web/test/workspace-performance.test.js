import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspacePerformance,createWorkspacePerformancePanel} from '../js/workspace-performance.js';

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
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  dispatch(type){for(const callback of [...(this.listeners.get(type)||[])])callback();}
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
