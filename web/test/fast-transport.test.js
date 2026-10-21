import test from "node:test";
import assert from "node:assert/strict";
import {createFastTransport,windowPayload} from "../js/fast-transport.js";
const turn=()=>new Promise(resolve=>setTimeout(resolve,10));
const version="a".repeat(64);
function fixture({timers,frame=()=>1,cancelFrame=()=>{},queuePause=queueMicrotask}={}) {
  const events={},pending=[],buffers=[],gains=[];
  let target={identity:"p:r:movie",fps:{num:24,den:1},origin:0,url:"/native",query:{project_epoch:"p"}};
  const video={currentTime:0,duration:10,readyState:4,paused:false,volume:1,muted:false,playbackRate:1,dataset:{},addEventListener:(name,fn)=>(events[name]??=[]).push(fn),removeEventListener(){},pause(){if(this.paused)return;this.paused=true;queuePause(()=>{const event=new Event('pause');for(const fn of events.pause || [])fn(event);});},async play(){this.paused=false;for(const fn of events.play || [])fn();}};
  const select={value:"8",addEventListener(){}},status={textContent:""};
  const context={state:"running",currentTime:0,destination:{},async resume(){},createGain(){const node={gain:{value:1,setValueAtTime(value){this.value=value;}},connect(){},disconnect(){}};gains.push(node);return node;},createMediaElementSource(){return {connect(){}};},async decodeAudioData(bytes){return {duration:bytes.byteLength/48000/4};},createBufferSource(){const node={connect(){},disconnect(){},start(when){this.when=when;},stop(){this.stopped=true;}};buffers.push(node);return node;}};
  const transport=createFastTransport({videos:[video],select,status,getTarget:()=>target,getVideo:()=>video,contextFactory:()=>context,frame,cancelFrame,timers,fetcher:(url,options)=>new Promise(resolve=>pending.push({resolve,url,body:JSON.parse(options.body)}))});
  function reply(index,start,end,last=false,hash=version) {
    const headers=new Map([["x-audio-start-sample",String(start)],["x-audio-end-sample",String(end)],["x-audio-tempo","8"],["x-audio-source-version",hash],["x-audio-last",String(last)]]);
    pending[index].resolve({ok:true,headers,arrayBuffer:async()=>new ArrayBuffer((end-start)/8*4)});
  }
  return {events,video,select,status,context,pending,buffers,gains,transport,reply,play:()=>video.play(),changeTarget:()=>target={...target,identity:"new-document"},setAudio:value=>target={...target,audio:value}};
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

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function drainTimers(){
  let sequence=0;const jobs=new Map();
  return {jobs,setTimeout(callback,delay){const id=++sequence;jobs.set(id,{callback,delay});return id;},clearTimeout(id){jobs.delete(id);},fire(delay){const entry=[...jobs].find(([,job])=>job.delay===delay);assert.ok(entry,`No ${delay} ms timer`);jobs.delete(entry[0]);entry[1].callback();}};
}
async function tailFixture(){
  const timers=drainTimers(),f=fixture({timers});await f.play();await settle();f.reply(0,0,96_000,true);await settle();timers.fire(50);await settle();
  f.video.ended=true;f.video.currentTime=f.video.duration;f.video.paused=true;return {...f,timers};
}

test('finishWindow waits for the paused EOF native tail and completes only on the final source event',async()=>{
  const f=await tailFixture();
  try{
    let settled=false;const finishing=f.transport.finishWindow(f.video);finishing.then(()=>{settled=true;});assert.equal(f.transport.finishWindow(f.video),finishing);await settle();assert.equal(settled,false);
    assert.equal(f.transport.active(),true);assert.deepEqual([...f.timers.jobs.values()].map(job=>job.delay),[250]);assert.equal(f.buffers[0].stopped,undefined);
    f.buffers[0].onended();assert.equal(await finishing,true);assert.equal(f.transport.active(),false);assert.equal(f.timers.jobs.size,0);assert.equal(f.select.value,'8');assert.equal(f.video.playbackRate,8);assert.equal(JSON.parse(f.video.dataset.fastPlaybackMetrics).audio_complete,true);
    assert.equal(await f.transport.finishWindow(f.video),true);
  }finally{f.transport.stop();}
});

test('a preexisting EOF drain keeps its original deadline when the Program handoff joins',async()=>{
  const f=await tailFixture();
  try{
    for(const callback of f.events.ended)callback();const timer=[...f.timers.jobs.entries()][0];const finishing=f.transport.finishWindow(f.video);assert.deepEqual([...f.timers.jobs.entries()],[timer]);
    f.buffers[0].onended();assert.equal(await finishing,true);assert.equal(f.timers.jobs.size,0);
  }finally{f.transport.stop();}
});

test('cancel, media error and tail deadline settle the handoff false and leave no timer or pending tail',async t=>{
  for(const action of ['cancel','error','deadline'])await t.test(action,async()=>{
    const f=await tailFixture();
    try{
      const finishing=f.transport.finishWindow(f.video);
      if(action==='cancel')f.transport.stop();else if(action==='error')for(const callback of f.events.error)callback();else f.timers.fire(250);
      assert.equal(await finishing,false);assert.equal(f.transport.active(),false);assert.equal(f.timers.jobs.size,0);assert.equal(f.buffers[0].onended,null);assert.equal(f.buffers[0].stopped,true);assert.equal(f.select.value,'8');assert.equal(JSON.parse(f.video.dataset.fastPlaybackMetrics).audio_complete,false);
      assert.equal(await f.transport.finishWindow(f.video),false,'the old failed window cannot look like an unused transport');
      if(action==='deadline')assert.match(f.status.textContent,/queued tail/);
      f.transport.normal();assert.equal(await f.transport.finishWindow(f.video),true);assert.equal(f.select.value,'1');
    }finally{f.transport.stop();}
  });
});

test('unfinished native audio at EOF refuses continuation and reports the missing completed window',async()=>{
  const timers=drainTimers(),f=fixture({timers});
  try{
    await f.play();await settle();f.reply(0,0,96_000,false);await settle();timers.fire(50);await settle();f.video.ended=true;f.video.currentTime=f.video.duration;f.video.paused=true;
    assert.equal(await f.transport.finishWindow(f.video),false);assert.match(f.status.textContent,/not completed this window/);assert.equal(f.transport.active(),false);assert.equal(timers.jobs.size,0);
    f.reply(1,96_000,288_000,true);await settle();assert.equal(f.buffers.length,1);assert.equal(await f.transport.finishWindow(f.video),false);
  }finally{f.transport.stop();}
});

test('detached old tail callbacks and deadlines cannot pause or stop a replacement window',async()=>{
  const f=await tailFixture();
  try{
    const finishing=f.transport.finishWindow(f.video),oldEnd=f.buffers[0].onended,oldDeadline=[...f.timers.jobs.values()][0].callback;f.transport.stop();assert.equal(await finishing,false);
    f.changeTarget();f.video.ended=false;f.video.currentTime=0;await f.play();await settle();f.reply(1,0,96_000,true);await settle();f.timers.fire(50);await settle();assert.equal(f.transport.active(),true);assert.equal(f.video.paused,false);
    oldEnd();oldDeadline();assert.equal(f.transport.active(),true);assert.equal(f.video.paused,false);assert.equal(f.buffers[1].stopped,undefined);assert.equal(f.select.value,'8');
    f.video.ended=true;f.video.currentTime=f.video.duration;f.video.paused=true;const latest=f.transport.finishWindow(f.video);f.buffers[1].onended();assert.equal(await latest,true);assert.equal(f.timers.jobs.size,0);
  }finally{f.transport.stop();}
});

test('unused or normal-speed transport does not delay a Program window handoff',async()=>{
  const timers=drainTimers(),f=fixture({timers});
  try{
    assert.equal(await f.transport.finishWindow(f.video),true);assert.equal(f.pending.length,0);assert.equal(timers.jobs.size,0);f.setAudio(false);assert.equal(await f.transport.finishWindow(f.video),true);f.transport.normal();assert.equal(await f.transport.finishWindow(f.video),true);assert.equal(timers.jobs.size,0);
  }finally{f.transport.stop();}
});

test('correcting reports only its active video during an actual drift seek and clears after seeked or stop',async()=>{
  const timers=drainTimers(),frames=new Map();let id=0;
  const f=fixture({timers,frame:callback=>{const next=++id;frames.set(next,callback);return next;},cancelFrame:value=>frames.delete(value)});
  try{
    assert.equal(f.transport.correcting(f.video),false);await f.play();await settle();f.reply(0,0,96_000,true);await settle();timers.fire(50);await settle();
    assert.equal(f.transport.correcting(f.video),false);f.context.currentTime=.3;const [key,callback]=frames.entries().next().value;frames.delete(key);callback();assert.equal(f.transport.correcting(f.video),true);assert.equal(f.transport.correcting({}),false);assert.ok(Math.abs(f.video.currentTime-2)<1e-9);
    for(const seeked of f.events.seeked)seeked();assert.equal(f.transport.correcting(f.video),false);f.transport.stop();assert.equal(f.transport.correcting(f.video),false);assert.equal(frames.size,0);assert.equal(timers.jobs.size,0);
  }finally{f.transport.stop();}
});

test('late internal pause tasks are recognizable before and after the fast listener consumes its pending count',async()=>{
  const tasks=[],f=fixture({queuePause:callback=>tasks.push(callback)}),before=[],after=[];let ownedEvent;
  f.events.pause.unshift(event=>{ownedEvent ??=event;before.push(f.transport.pausing(f.video,event));});f.events.pause.push(event=>after.push(f.transport.pausing(f.video,event)));
  try{
    await f.play();await settle();assert.equal(tasks.length,1);assert.equal(f.transport.pausing(f.video),true);
    tasks.shift()();assert.deepEqual(before,[true]);assert.deepEqual(after,[true]);assert.equal(f.transport.pausing(f.video),false);assert.equal(f.transport.pausing(f.video,ownedEvent),true);assert.equal(f.transport.pausing(f.video,new Event('pause')),false);
    f.video.paused=false;f.video.pause();await settle();tasks.shift()();assert.deepEqual(before,[true,false]);assert.deepEqual(after,[true,false]);assert.equal(f.transport.active(),false);assert.equal(f.transport.pausing(f.video,new Event('pause')),false);
  }finally{f.transport.stop();}
});
