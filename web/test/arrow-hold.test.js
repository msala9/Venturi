import test from 'node:test';
import assert from 'node:assert/strict';
import {arrowHoldTarget,createArrowHold,programArrowContext} from '../js/arrow-hold.js';

const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function harness(t,{pending=false,fps={num:25,den:1},frame=100}={}){
  class Surface extends EventTarget{
    constructor(){super();this.listeners=new Map();}
    addEventListener(type,callback,options){super.addEventListener(type,callback,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
    removeEventListener(type,callback,options){super.removeEventListener(type,callback,options);this.listeners.get(type)?.delete(callback);}
    count(){return [...this.listeners.values()].reduce((sum,items)=>sum+items.size,0);}
  }
  const doc=new Surface(),win=new Surface(),frames=new Map(),applied=[],requests=[],settled=[],notices=[],target={},context={document:{project_epoch:'e',generation:'1'},timeline:{id:'t',revision:'r',fps},mode:'program',inputOwner:'timeline',frame,blocked:false};
  let time=0,id=0,starts=0,concurrent=0,maxConcurrent=0;
  const control=createArrowHold({documentRef:doc,windowRef:win,getState:()=>programArrowContext({...context,blocked:context.blocked || doc.hidden}),now:()=>time,requestFrame:callback=>{frames.set(++id,callback);return id;},cancelFrame:key=>frames.delete(key),onStart:()=>{starts++;},onFrame:value=>{context.frame=value;applied.push(value);},onSeek:value=>{concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);if(!pending){requests.push({frame:value});concurrent--;return;}return new Promise(resolve=>requests.push({frame:value,resolve:()=>{concurrent--;resolve();}}));},onSettled:value=>settled.push(value),notice:value=>notices.push(value)});
  t.after(()=>{control.dispose();assert.equal(frames.size,0);assert.equal(doc.count(),0);assert.equal(win.count(),0);});
  const fire=(node,type,values={})=>{const event=new Event(type,{cancelable:true});for(const[key,value]of Object.entries(values))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;};
  return {context,control,doc,win,frames,applied,requests,settled,notices,fire,starts:()=>starts,maxConcurrent:()=>maxConcurrent,
    down:(key='ArrowRight',extra={})=>control.keydown({key,target,...extra}),up:(key='ArrowRight')=>fire(doc,'keyup',{key}),
    tick(ms){time+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(time);},
  };
}

test('native arrow targets use immediate one frame,300ms delay and half rational FPS with zero clamp',()=>{
  assert.equal(arrowHoldTarget(100,1,0,{num:25,den:1}),101);assert.equal(arrowHoldTarget(100,1,299,{num:25,den:1}),101);
  assert.equal(arrowHoldTarget(100,1,1300,{num:25,den:1}),113);assert.equal(arrowHoldTarget(100,-1,1300,{num:25,den:1}),87);
  assert.equal(arrowHoldTarget(100,1,1300,{num:30000,den:1001}),115);assert.equal(arrowHoldTarget(0,-1,1300,{num:25,den:1}),0);
});

test('Program hold pauses once and advances by elapsed time independent of OS repeat or duplicate keydown',async t=>{
  const h=harness(t);assert.equal(h.down(),true);assert.equal(h.context.frame,101);assert.equal(h.starts(),1);
  for(let i=0;i<30;i++)h.down('ArrowRight',{repeat:true});h.down();assert.equal(h.context.frame,101);assert.equal(h.starts(),1);
  h.tick(299);assert.equal(h.context.frame,101);h.tick(1001);assert.equal(h.context.frame,113);h.up();h.tick(5000);await settle();assert.equal(h.context.frame,113);assert.equal(h.frames.size,0);assert.equal(h.control.active(),false);
  assert.equal(h.down('ArrowRight',{repeat:true}),false,'A repeat without a new owned press cannot restart a released hold');
});

test('slow frame seeks remain single-flight and release flushes only the latest native target',async t=>{
  const h=harness(t,{pending:true});h.down();assert.deepEqual(h.requests.map(value=>value.frame),[101]);h.tick(700);h.tick(600);assert.equal(h.context.frame,113);assert.equal(h.requests.length,1);h.up();
  h.requests[0].resolve();await settle();assert.deepEqual(h.requests.map(value=>value.frame),[101,113]);assert.deepEqual(h.settled,[]);assert.equal(h.maxConcurrent(),1);
  h.requests[1].resolve();await settle();assert.deepEqual(h.settled,[113]);assert.equal(h.requests.length,2);assert.equal(h.frames.size,0);
});

test('context and external seek changes discard queued work and never refresh Inspector or audio for the old owner',async t=>{
  const changes={epoch:h=>h.context.document.project_epoch='new',generation:h=>h.context.document.generation='2',timeline:h=>h.context.timeline.id='other',revision:h=>h.context.timeline.revision='other',mode:h=>h.context.mode='source',input:h=>h.context.inputOwner='keys',blocked:h=>h.context.blocked=true,seek:h=>h.context.frame=400};
  for(const[name,change]of Object.entries(changes))await t.test(name,async child=>{const h=harness(child,{pending:true});h.down();h.tick(1300);change(h);h.tick(16);h.requests[0].resolve();await settle();assert.equal(h.requests.length,1);assert.deepEqual(h.settled,[]);assert.equal(h.control.active(),false);assert.equal(h.frames.size,0);});
});

test('both held directions stop until one is released, then native immediate stepping restarts',async t=>{
  const h=harness(t);h.down();h.down('ArrowLeft');assert.equal(h.context.frame,101);assert.equal(h.control.active(),false);h.tick(1000);assert.equal(h.context.frame,101);
  h.up('ArrowRight');assert.equal(h.context.frame,100);h.tick(1300);assert.equal(h.context.frame,88);h.up('ArrowLeft');await settle();assert.equal(h.frames.size,0);
});

test('blur,hidden,focus,modal,pointer,other transport keys and disposal cancel without pending seek replay',async t=>{
  const cancel={blur:h=>h.fire(h.win,'blur'),pagehide:h=>h.fire(h.win,'pagehide'),hidden:h=>{h.doc.hidden=true;h.fire(h.doc,'visibilitychange');},focus:h=>h.fire(h.doc,'focusin',{target:{}}),modal:h=>{h.doc.querySelector=()=>({});h.fire(h.doc,'toggle');},pointer:h=>h.fire(h.doc,'pointerdown'),transport:h=>h.fire(h.doc,'keydown',{key:' '}),dispose:h=>h.control.dispose()};
  for(const[name,stop]of Object.entries(cancel))await t.test(name,async child=>{const h=harness(child,{pending:true});h.down();h.tick(1300);stop(h);h.requests[0].resolve();await settle();h.tick(1000);assert.equal(h.context.frame,113);assert.equal(h.requests.length,1);assert.deepEqual(h.settled,[]);assert.equal(h.frames.size,0);assert.equal(h.control.active(),false);});
});

test('plain Program ownership rejects modified,composing,consumed and Source-context key presses',t=>{
  const h=harness(t);for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229},{defaultPrevented:true}])assert.equal(h.down('ArrowRight',extra),false);
  h.context.mode='source';assert.equal(h.down(),false);assert.deepEqual(h.applied,[]);assert.equal(h.frames.size,0);assert.equal(h.starts(),0);
});
