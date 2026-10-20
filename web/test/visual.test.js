import test from "node:test";
import assert from "node:assert/strict";
import {bindColorWheel,wheelDelta} from "../js/visual.js";
test("wheel pointer movement stays local and commits exactly once; cancel never commits",async()=>{
  const events={},commits=[],draws=[];
  const canvas={addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint:(...point)=>draws.push(point),onCommit:async(x,y)=>commits.push([x,y]),onError(){}});
  const point=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(20,20));events.pointermove(point(60,30));events.pointermove(point(90,50));assert.equal(commits.length,0);
  events.pointerup();await Promise.resolve();assert.equal(commits.length,1);assert.ok(Math.hypot(...commits[0])<=1);
  events.pointerdown(point(10,10));events.pointermove(point(140,140));events.keydown({key:"Escape",stopPropagation(){},preventDefault(){}});events.pointerup();assert.equal(commits.length,1);
  events.pointerdown(point(10,10));events.pointermove(point(100,100));events.lostpointercapture();events.pointerup();assert.equal(commits.length,1);
});
test("wheel coordinates use the native unit disc and Shift gives fine travel",()=>{
  assert.ok(Math.abs(Math.hypot(...wheelDelta(0,0,1000,1000,69))-1)<1e-9);
  assert.equal(wheelDelta(0,0,20,0,100,true)[0],wheelDelta(0,0,20,0,100)[0]*0.2);
});
