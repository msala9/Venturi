import test from "node:test";
import assert from "node:assert/strict";
import {createFastTransport,windowPayload} from "../js/fast-transport.js";
const turn=()=>new Promise(resolve=>setTimeout(resolve,10));
const version="a".repeat(64);
function fixture() {
  const events={},pending=[],buffers=[],gains=[];
  let target={identity:"p:r:movie",fps:{num:24,den:1},origin:0,url:"/native",query:{project_epoch:"p"}};
  const video={currentTime:0,duration:10,readyState:4,paused:false,volume:1,muted:false,playbackRate:1,dataset:{},addEventListener:(name,fn)=>(events[name]??=[]).push(fn),removeEventListener(){},pause(){if(this.paused)return;this.paused=true;queueMicrotask(()=>{for(const fn of events.pause || [])fn();});},async play(){this.paused=false;for(const fn of events.play || [])fn();}};
  const select={value:"8",addEventListener(){}},status={textContent:""};
  const context={state:"running",currentTime:0,destination:{},async resume(){},createGain(){const node={gain:{value:1,setValueAtTime(value){this.value=value;}},connect(){},disconnect(){}};gains.push(node);return node;},createMediaElementSource(){return {connect(){}};},async decodeAudioData(bytes){return {duration:bytes.byteLength/48000/4};},createBufferSource(){const node={connect(){},disconnect(){},start(when){this.when=when;},stop(){this.stopped=true;}};buffers.push(node);return node;}};
  const transport=createFastTransport({videos:[video],select,status,getTarget:()=>target,getVideo:()=>video,contextFactory:()=>context,frame:()=>1,cancelFrame(){},fetcher:(url,options)=>new Promise(resolve=>pending.push({resolve,url,body:JSON.parse(options.body)}))});
  function reply(index,start,end,last=false,hash=version) {
    const headers=new Map([["x-audio-start-sample",String(start)],["x-audio-end-sample",String(end)],["x-audio-tempo","8"],["x-audio-source-version",hash],["x-audio-last",String(last)]]);
    pending[index].resolve({ok:true,headers,arrayBuffer:async()=>new ArrayBuffer((end-start)/8*4)});
  }
  return {events,video,select,status,context,pending,buffers,gains,transport,reply,play:()=>video.play(),changeTarget:()=>target={...target,identity:"new-document"}};
}
test("native window positions follow the rational sample clock and refuse unsafe sample numbers",()=>{
  const target={fps:{num:30000,den:1001},query:{project_epoch:"p"}};
  const payload=windowPayload(target,96000,4,8,version);
  assert.equal(payload.query.frame,59);assert.equal(payload.window.source_version,version);
  assert.throws(()=>windowPayload(target,Number.MAX_SAFE_INTEGER+1,2,2,null));
});
test("fast playback waits for native audio, binds subsequent windows and keeps the queue bounded",async()=>{
  const f=fixture();await f.play();await turn();assert.equal(f.video.paused,true);assert.equal(f.pending.length,1);assert.equal(f.buffers.length,0);
  f.reply(0,0,96000);await turn();assert.equal(f.buffers[0].when,.05);assert.equal(f.pending.length,2);
  assert.equal(f.pending[1].body.window.source_version,version);assert.equal(f.pending[1].body.window.seconds,4);
  f.reply(1,96000,288000);await turn();assert.equal(f.buffers.length,2);assert.equal(f.pending.length,2);
  f.context.currentTime=.3;f.buffers[0].onended();await turn();assert.equal(f.pending.length,3);assert.equal(f.pending[2].body.window.seconds,8);
  f.transport.stop();assert.equal(f.buffers[1].stopped,true);
});
test("obsolete native windows never start audio after a changed document or stop",async()=>{
  const f=fixture();await f.play();await turn();f.changeTarget();f.reply(0,0,96000);await turn();assert.equal(f.buffers.length,0);assert.equal(f.status.textContent,"");f.transport.stop();
  const g=fixture();await g.play();await turn();assert.equal(g.transport.cancelPreparation(),true);g.reply(0,0,96000);await turn();assert.equal(g.buffers.length,0);
});
test("normal speed restores media audio routing and leaves volume and mute controls intact",async()=>{
  const f=fixture();f.video.volume=.4;await f.play();await turn();assert.equal(f.gains[0].gain.value,0);assert.equal(f.gains[1].gain.value,.4);
  f.transport.normal();assert.equal(f.gains[0].gain.value,1);assert.equal(f.video.volume,.4);assert.equal(f.video.muted,false);assert.equal(f.video.playbackRate,1);
  f.reply(0,0,96000);await turn();assert.equal(f.buffers.length,0);
});
test("changed source files stop fast playback and require a new prepared media identity",async()=>{
  const f=fixture();await f.play();await turn();f.pending[0].resolve({ok:false,json:async()=>({error:{code:"SOURCE_CHANGED",message:"Source changed"}})});await turn();assert.equal(f.video.paused,true);assert.equal(f.status.textContent,"Source changed");
  await f.play();await turn();assert.equal(f.pending.length,1);assert.match(f.status.textContent,/reopen/);f.transport.stop();
});
test("video EOF waits for the queued native audio completion event",async()=>{
  const f=fixture();await f.play();await turn();f.reply(0,0,96000,true);await turn();
  f.video.ended=true;f.video.currentTime=f.video.duration;for(const fn of f.events.ended)fn();
  assert.equal(f.transport.active(),true);assert.equal(f.buffers[0].stopped,undefined);
  f.buffers[0].onended();assert.equal(f.transport.active(),false);
  assert.equal(JSON.parse(f.video.dataset.fastPlaybackMetrics).audio_complete,true);
});
