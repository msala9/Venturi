import test from "node:test";
import assert from "node:assert/strict";
import {bindColorWheel,wheelDelta} from "../js/visual.js";
test("wheel pointer movement stays local and commits exactly once; cancel never commits",async()=>{
  const events={},commits=[],draws=[];
  const canvas={addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint:(...point)=>draws.push(point),onCommit:async(x,y)=>commits.push([x,y]),onError(){}});
  const point=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(20,20));events.pointermove(point(60,30));events.pointermove(point(90,50));assert.equal(commits.length,0);
  events.pointerup();await Promise.resolve();await Promise.resolve();assert.equal(commits.length,1);assert.ok(Math.hypot(...commits[0])<=1);
  events.pointerdown(point(10,10));events.pointermove(point(140,140));events.keydown({key:"Escape",stopPropagation(){},preventDefault(){}});events.pointerup();assert.equal(commits.length,1);
  events.pointerdown(point(10,10));events.pointermove(point(100,100));events.lostpointercapture();events.pointerup();assert.equal(commits.length,1);
});
test("wheel coordinates use the native unit disc and Shift gives fine travel",()=>{
  assert.ok(Math.abs(Math.hypot(...wheelDelta(0,0,1000,1000,69))-1)<1e-9);
  assert.equal(wheelDelta(0,0,20,0,100,true)[0],wheelDelta(0,0,20,0,100)[0]*0.2);
});

test('wheel guards cancel stale pointer drafts and reject detached or newly blocked release without a command',async()=>{
  const events={},commits=[],draws=[];let allowed=true,captured=false,released=0;
  const canvas={isConnected:true,addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;released++;events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint:(...point)=>draws.push(point),onCommit:async(x,y)=>commits.push([x,y]),onError(){},canInteract:()=>allowed});
  const point=(x,y)=>({button:0,buttons:1,pointerId:1,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(10,10));events.pointermove(point(50,20));allowed=false;events.pointermove(point(70,30));events.pointerup({pointerId:1});assert.equal(released,1);assert.equal(commits.length,0);assert.deepEqual(draws.at(-1),[0,0,false]);
  allowed=true;events.pointerdown(point(10,10));events.pointermove(point(60,30));events.pointerup({pointerId:1});allowed=false;await Promise.resolve();await Promise.resolve();assert.equal(commits.length,0);
  allowed=true;events.pointerdown(point(10,10));events.pointermove(point(60,30));events.pointerup({pointerId:1});await Promise.resolve();await Promise.resolve();assert.equal(commits.length,1);
  canvas.isConnected=false;events.pointerdown(point(10,10));events.keydown({key:'ArrowRight',preventDefault(){},stopPropagation(){}});events.dblclick();await Promise.resolve();assert.equal(commits.length,1);
});

test('wheel shares one pending native action and ignores unrelated pointers or a second release',async()=>{
  const events={},commits=[];let resolve,captures=0;
  const canvas={addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){captures++;},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint(){},onCommit:(x,y)=>{commits.push([x,y]);return new Promise(done=>{resolve=done;});},onError(){}});
  const point=(x,y,id=1)=>({button:0,buttons:1,pointerId:id,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(10,10));events.pointermove(point(90,50,2));events.pointerup({pointerId:2});assert.equal(commits.length,0);
  events.pointermove(point(50,30));events.pointerup({pointerId:1});events.pointerup({pointerId:1});await Promise.resolve();assert.equal(commits.length,1);events.pointerdown(point(10,10));assert.equal(captures,1);resolve();await Promise.resolve();await Promise.resolve();assert.equal(commits.length,1);
});
