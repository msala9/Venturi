import test from "node:test";
import assert from "node:assert/strict";
import { createProgramPlayer, sameComposition, containsProgramRange } from "../js/program.js";
import {createFastTransport} from '../js/fast-transport.js';

function fakeTimers(){
  let next=0;const jobs=new Map();
  return {jobs,setTimeout(callback,delay){const id=++next;jobs.set(id,{callback,delay});return id;},clearTimeout(id){jobs.delete(id);},fire(){const entry=jobs.entries().next().value;if(!entry)return;const [id,job]=entry;jobs.delete(id);assert.equal(job.delay,2_000);return job.callback();}};
}

test("composed playback identity follows the document and ignores its advancing clock", () => {
  const value = { project_epoch: "p:1", if_generation: "2", timeline_id: "1", revision: "r", width: 960, start_frame: 0 };
  assert.equal(sameComposition(value, { ...value, start_frame: 120 }), true);
  for (const key of ["project_epoch", "if_generation", "timeline_id", "revision", "width"]) assert.equal(sameComposition(value, { ...value, [key]: "changed" }), false);
  assert.equal(sameComposition(value, null), false);
  const range={...value,start_frame:0,end_frame:48};
  assert.equal(containsProgramRange(range,{...range,start_frame:12}),true);
  assert.equal(containsProgramRange(range,{...range,start_frame:48}),false);
  assert.equal(containsProgramRange(range,{...range,start_frame:12,end_frame:60}),false);
  assert.equal(containsProgramRange({...range,audio_origin_frame:0},{...range,start_frame:12,audio_origin_frame:0}),true);
  assert.equal(containsProgramRange({...range,audio_origin_frame:0},{...range,start_frame:12,audio_origin_frame:12}),false);
  assert.equal(containsProgramRange(range,{...range,audio_origin_frame:0}),false);
});

test("stopped movies resume at a seek only after native input validation; changed inputs rebuild",async()=>{
  const events={},checks=[],requests=[];let nextCheck;
  const video={src:"",currentTime:0,paused:true,readyState:1,seeking:false,pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){},removeAttribute(){this.src="";},addEventListener(name,callback){events[name]=callback;}};
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",width:960,start_frame:0,end_frame:48};
  const ready=(id)=>({id,state:"ready",program:{start_frame:0,end_frame:48,width:960,height:540,fps:{num:24,den:1}}});
  const player=createProgramPlayer({video,status:{textContent:""},cancel:{addEventListener(){}},getState:()=>current,onFrame(){},onState(){},timers:fakeTimers(),api:async(path,query)=>{requests.push(query);return ready(`job${requests.length}`);},fetcher:(url)=>{checks.push(url);return new Promise(resolve=>nextCheck=resolve);}});
  await player.toggle();player.stop();current={...current,start_frame:24};
  const resume=player.toggle();assert.equal(video.src,"");assert.equal(video.paused,true);
  nextCheck(Response.json({state:"ready"}));await resume;
  assert.equal(requests.length,1);assert.match(video.src,/job1/);assert.equal(video.currentTime,1);assert.equal(video.paused,false);
  player.stop();current={...current,start_frame:30};const changed=player.toggle();nextCheck(new Response("",{status:409}));await changed;
  assert.equal(requests.length,2);assert.match(video.src,/job2/);assert.equal(video.currentTime,1.25);
  player.stop();const obsolete=player.toggle();player.stop();nextCheck(Response.json({state:"ready"}));await obsolete;
  assert.equal(video.src,"");assert.equal(video.paused,true);assert.equal(requests.length,2);
  assert.equal(checks.length,3);
});

test("an old composed range cannot replace a later seek; native media time drives the playhead", async () => {
  const requests = [], events = {}, frames = [];
  const video = { src: "", currentTime: 0, paused: true, readyState:1, seeking:false, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {}, removeAttribute() { this.src = ""; }, addEventListener(name, callback) { events[name] = callback; } };
  let state = { project_epoch: "p:1", if_generation: "2", timeline_id: "1", revision: "revision", width: 960, start_frame: 0, end_frame: 48 };
  let stopped=0;
  const cancel={addEventListener:(_,callback)=>events.cancel=callback};
  const player = createProgramPlayer({ video, status: { textContent: "" }, cancel, getState: () => state, onFrame: (frame) => frames.push(frame), onState() {},onStop:()=>stopped++,timers:fakeTimers(), fetcher:async()=>Response.json({state:"ready"}),api: () => new Promise((resolve) => requests.push(resolve)) });
  const old = player.toggle(); player.stop(); state = { ...state, start_frame: 12 };
  const latest = player.toggle();
  requests[1]({ id: "latest", state: "ready", program: {start_frame:12,end_frame:48, width: 320, height: 180, fps: { num: 24, den: 1 } } }); await latest;
  const url = video.src;
  requests[0]({ id: "old", state: "ready", program: {start_frame:0,end_frame:48, width: 960, height: 540, fps: { num: 24, den: 1 } } }); await old;
  assert.equal(video.src, url);
  assert.match(url, /latest\/program.mp4/);
  assert.equal(cancel.disabled,false);assert.equal(cancel.textContent,"Stop playback");
  video.currentTime=.041666;events.timeupdate();assert.equal(frames.at(-1),13);
  video.currentTime = 0.5; events.timeupdate(); assert.equal(frames.at(-1), 24);
  player.pauseLocal();video.currentTime=1;events.timeupdate();assert.equal(frames.at(-1),24,"a delayed pause clock cannot override a manual seek");
  await player.toggle();video.currentTime=0.75;events.timeupdate();assert.equal(frames.at(-1),30,"resuming reattaches the media clock");
  state = { ...state, revision: "next" }; video.currentTime = 1; events.timeupdate(); assert.equal(frames.at(-1), 30);
  events.cancel(); assert.equal(stopped,1);assert.equal(video.src, ""); assert.equal(video.paused, true);
});

test('obsolete delayed prepare ACKs never DELETE a deduplicated job or disturb the newer ready player',async()=>{
  for(const oldState of ['queued','ready']){
    const pending=[],calls=[],timers=fakeTimers(),status={textContent:''};let current={project_epoch:'epoch',if_generation:'1',timeline_id:'t',revision:'revision',width:960,start_frame:0,end_frame:48};
    const video={src:'',currentTime:0,paused:true,readyState:1,seeking:false,plays:0,pause(){this.paused=true;},async play(){this.paused=false;this.plays++;},load(){},removeAttribute(){this.src='';},addEventListener(){}};
    const player=createProgramPlayer({video,status,cancel:{addEventListener(){}},getState:()=>current,onFrame(){},onState(){},timers,api:()=>new Promise(resolve=>pending.push(resolve)),fetcher:async(url,options)=>{calls.push({url,options});return Response.json({state:'ready'});}});
    try{
      const old=player.toggle();player.stop();current={...current,start_frame:12};const latest=player.toggle();
      const program={start_frame:0,end_frame:48,width:960,height:540,fps:{num:24,den:1}};
      pending[1]({id:'shared-job',state:'ready',program});await latest;const url=video.src,text=status.textContent;
      assert.equal(player.state(),'ready');assert.equal(video.currentTime,0.5);assert.equal(timers.jobs.size,1);
      pending[0]({id:'shared-job',state:oldState,program});await old;
      assert.deepEqual(calls,[]);assert.equal(video.src,url);assert.equal(status.textContent,text);assert.equal(player.state(),'ready');assert.equal(video.paused,false);assert.equal(video.plays,1);assert.equal(timers.jobs.size,1);
    }finally{player.stop();}
  }
});

test("Program play waits for metadata and the initial seek, and cancellation cannot start a late movie",async()=>{
  let metadataWaiting,sought;
  const metadata=new Promise(resolve=>metadataWaiting=resolve),seek=new Promise(resolve=>sought=resolve);
  class Video extends EventTarget {
    readyState=0;seeking=false;paused=true;position=0;plays=0;
    addEventListener(name,callback,options){super.addEventListener(name,callback,options);if(name==="loadedmetadata")metadataWaiting();}
    set currentTime(value){this.position=value;this.seeking=true;sought();}
    get currentTime(){return this.position;}
    pause(){this.paused=true;}
    play(){assert.equal(this.seeking,false);assert.equal(this.readyState,1);this.paused=false;this.plays++;return Promise.resolve();}
    removeAttribute(){this.src="";this.readyState=0;}
    load(){}
  }
  const video=new Video(),state={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",width:960,start_frame:12,end_frame:48};
  const player=createProgramPlayer({video,status:{textContent:""},cancel:{addEventListener(){}},getState:()=>state,onFrame(){},onState(){},timers:fakeTimers(),api:async()=>({id:"movie",state:"ready",program:{start_frame:0,end_frame:48,fps:{num:24,den:1}}}),fetcher:async()=>Response.json({state:"ready"})});
  const first=player.toggle();await metadata;assert.equal(video.plays,0);
  video.readyState=1;video.dispatchEvent(new Event("loadedmetadata"));await seek;
  assert.equal(video.currentTime,.5);assert.equal(video.plays,0);video.seeking=false;video.dispatchEvent(new Event("seeked"));await first;assert.equal(video.plays,1);
  player.stop();
  let waiting;const nextMetadata=new Promise(resolve=>waiting=resolve);metadataWaiting=waiting;
  const late=player.toggle();await nextMetadata;player.stop();video.readyState=1;video.dispatchEvent(new Event("loadedmetadata"));await late;
  assert.equal(video.plays,1);assert.equal(video.paused,true);
});

function heartbeatFixture(fetcher=async()=>Response.json({state:"ready"})){
  class Video extends EventTarget {
    src="";currentTime=0;readyState=1;seeking=false;paused=true;plays=0;
    pause(){this.paused=true;this.dispatchEvent(new Event("pause"));}
    play(){this.paused=false;this.plays++;this.dispatchEvent(new Event("play"));return Promise.resolve();}
    removeAttribute(){this.src="";}
    getAttribute(){return this.src;}
    load(){}
  }
  const video=new Video(),status={textContent:""},frames=[],timers=fakeTimers(),calls=[];
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",width:960,start_frame:0,end_frame:48},prepared=0;
  const player=createProgramPlayer({video,status,cancel:new EventTarget(),timers,getState:()=>current,onState(){},onFrame:frame=>frames.push(frame),fetcher:(url,options)=>{calls.push({url,...options});return fetcher(url,options);},api:async()=>({id:`movie${++prepared}`,state:"ready",program:{start_frame:0,end_frame:48,width:960,height:540,fps:{num:24,den:1}}})});
  return {video,status,frames,timers,calls,player,setCurrent:value=>current=value,current:()=>current};
}

test("paused attached Program keeps exactly one ready-cache heartbeat without playing or presenting frames",async()=>{
  const f=heartbeatFixture();await f.player.toggle();assert.equal(f.timers.jobs.size,1);assert.equal(f.calls.length,0);
  f.player.pauseLocal();const plays=f.video.plays;f.video.currentTime=1;f.video.dispatchEvent(new Event("timeupdate"));
  await f.timers.fire();assert.equal(f.calls.length,1);assert.equal(f.timers.jobs.size,1);assert.equal(f.player.state(),"ready");assert.equal(f.video.paused,true);assert.equal(f.video.plays,plays);assert.deepEqual(f.frames,[]);
  await f.timers.fire();assert.equal(f.calls.length,2);assert.equal(f.timers.jobs.size,1);assert.equal(f.video.plays,plays);
  f.player.stop();assert.equal(f.timers.jobs.size,0);assert.equal(f.video.src,"");assert.equal(f.calls.at(-1).signal.aborted,true);
});

test("slow status validation has no overlapping request and stop aborts its owner without rescheduling",async()=>{
  const replies=[],f=heartbeatFixture(()=>new Promise(resolve=>replies.push(resolve)));await f.player.toggle();
  const first=f.timers.fire();assert.equal(f.calls.length,1);assert.equal(f.timers.jobs.size,0);f.timers.fire();assert.equal(f.calls.length,1);
  replies[0](Response.json({state:"ready"}));await first;assert.equal(f.timers.jobs.size,1);
  const second=f.timers.fire();assert.equal(f.calls.length,2);f.player.stop();assert.equal(f.calls[1].signal.aborted,true);
  replies[1](new Response("",{status:409}));await second;assert.equal(f.player.state(),"stopped");assert.equal(f.timers.jobs.size,0);
});

test("an obsolete heartbeat cannot fail or unschedule a replacement Program player",async()=>{
  for(const outcome of ['refused','network']){
    const replies=[],f=heartbeatFixture(()=>new Promise((resolve,reject)=>replies.push({resolve,reject})));await f.player.toggle();
    const old=f.timers.fire();f.player.stop();f.setCurrent({...f.current(),revision:'next'});await f.player.toggle();const currentSrc=f.video.src,currentStatus=f.status.textContent;
    assert.equal(f.timers.jobs.size,1);assert.equal(f.calls[0].signal.aborted,true);
    if(outcome==='refused')replies[0].resolve(new Response("",{status:409}));else replies[0].reject(new Error('old disconnected request'));
    await old;assert.equal(f.player.state(),"ready");assert.equal(f.video.src,currentSrc);assert.equal(f.status.textContent,currentStatus);assert.equal(f.timers.jobs.size,1);
    const latest=f.timers.fire();replies[1].resolve(Response.json({state:"ready"}));await latest;assert.equal(f.timers.jobs.size,1);f.player.stop();
  }
});

test("stale or disconnected document stops the heartbeat before sending another status request",async()=>{
  for(const disconnected of [false,true]){
    const f=heartbeatFixture();await f.player.toggle();f.player.pauseLocal();f.setCurrent(disconnected?null:{...f.current(),revision:'changed'});
    await f.timers.fire();assert.equal(f.calls.length,0);assert.equal(f.player.state(),"failed");assert.equal(f.video.paused,true);assert.equal(f.timers.jobs.size,0);assert.match(f.status.textContent,/STALE_REVISION/);f.player.stop();
  }
});

test("status failure, nonready result and media error release all ready-cache monitoring",async()=>{
  for(const response of [()=>new Response("",{status:409}),()=>Response.json({state:'cancelled'}),()=>{throw new Error('offline');}]){
    const f=heartbeatFixture(async()=>response());await f.player.toggle();await f.timers.fire();assert.equal(f.player.state(),"failed");assert.equal(f.video.paused,true);assert.equal(f.timers.jobs.size,0);f.player.stop();
  }
  let reply;const f=heartbeatFixture(()=>new Promise(resolve=>reply=resolve));await f.player.toggle();const pending=f.timers.fire();f.video.dispatchEvent(new Event('error'));
  assert.equal(f.player.state(),"failed");assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.timers.jobs.size,0);reply(Response.json({state:'ready'}));await pending;assert.equal(f.player.state(),"failed");assert.equal(f.timers.jobs.size,0);f.player.stop();
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<40;i++)await Promise.resolve();}
function windowFixture({origin=0,total=18_010,fps={num:30,den:1},api,fetcher,beforeWindowChange,isInternalSeek,lineage=false}={}){
  class Video extends EventTarget {
    movie="";position=0;readyState=1;seeking=false;paused=true;ended=false;duration=0;plays=0;waitMetadata=false;waitSeek=false;fastPause=false;
    callbacks=new Map();canceled=[];nextCallback=0;
    requestVideoFrameCallback(callback){const id=++this.nextCallback;this.callbacks.set(id,callback);return id;}
    cancelVideoFrameCallback(id){this.canceled.push(id);}
    get src(){return this.movie;}
    set src(value){this.movie=value;this.ended=false;this.position=0;this.readyState=this.waitMetadata?0:1;}
    get currentTime(){return this.position;}
    set currentTime(value){this.position=value;this.seeking=true;this.dispatchEvent(new Event("seeking"));if(!this.waitSeek)this.seeking=false;}
    pause(){this.paused=true;this.dispatchEvent(new Event("pause"));}
    async play(){this.paused=false;this.ended=false;this.plays++;this.dispatchEvent(new Event("play"));if(this.fastPause)this.pause();}
    removeAttribute(){this.movie="";this.ended=false;}
    getAttribute(){return this.movie;}
    load(){}
    finish(range){this.duration=(range.end_frame-range.start_frame)*fps.den/fps.num;this.position=this.duration;this.ended=true;this.pause();this.dispatchEvent(new Event("timeupdate"));this.dispatchEvent(new Event("ended"));}
  }
  const video=new Video(),status={textContent:""},timers=fakeTimers(),requests=[],frames=[],fetches=[];
  let playhead=origin,document={project_epoch:"epoch",if_generation:"1",timeline_id:"timeline",revision:"revision",width:960};
  const getState=(start,audioOrigin)=>{
    if(!document)return null;
    const frame=start===undefined?Math.min(playhead,total-1):start;
    return Number.isSafeInteger(frame) && frame>=0 && frame<total ? {...document,start_frame:frame,end_frame:Math.min(total,frame+Math.floor(300*fps.num/fps.den)),...(lineage?{audio_origin_frame:audioOrigin===undefined?frame:audioOrigin}:{})} : null;
  };
  const ready=(range,id=`window${requests.length}`)=>({id,state:"ready",program:{start_frame:range.start_frame,end_frame:range.end_frame,fps,width:960,height:540,...(lineage?{audio_origin_frame:range.audio_origin_frame}:{})}});
  const player=createProgramPlayer({video,status,timers,cancel:new EventTarget(),getState,beforeWindowChange,isInternalSeek,onState(){},onFrame:frame=>{frames.push(frame);playhead=frame;},api:async(path,range)=>{requests.push({...range});return api?api(range,ready):ready(range);},fetcher:async(url,options)=>{fetches.push({url,...options});return fetcher?fetcher(url,options):Response.json({state:"ready",...(lineage?{program:{audio_origin_frame:Number(new URL(url,'http://host').searchParams.get('audio_origin_frame'))}}:{})});}});
  return {video,status,timers,requests,frames,fetches,player,ready,getState,setDocument:value=>{document=value;},setPlayhead:value=>{playhead=value;}};
}

test('native DSP playback origin survives multiple fractional windows; manual seek starts a new lineage instead of covering-cache reuse',async()=>{
  const fps={num:30000,den:1001},span=Math.floor(300*fps.num/fps.den),origin=137,f=windowFixture({origin,total:origin+2*span+11,fps,lineage:true});
  try{
    await f.player.toggle();assert.equal(f.requests[0].audio_origin_frame,origin);
    f.video.finish(f.player.range());await settle();f.video.finish(f.player.range());await settle();
    assert.equal(f.player.state(),'ready');assert.deepEqual(f.requests.map(query=>query.audio_origin_frame),[origin,origin,origin]);
    assert.deepEqual(f.requests.map(query=>query.start_frame),[origin,origin+span,origin+2*span]);
    f.player.pauseLocal();f.setPlayhead(500);await f.player.toggle();assert.equal(f.requests.length,4);assert.equal(f.requests.at(-1).audio_origin_frame,500);assert.equal(f.requests.at(-1).start_frame,500);
  }finally{f.player.stop();}
});

test('a mismatched or missing authoritative DSP origin cannot attach or silently fall back to a cold preview',async()=>{
  for(const wrong of [undefined,0,8]){
    const f=windowFixture({origin:7,lineage:true,api:(range,ready)=>{const job=ready(range);job.program.audio_origin_frame=wrong;return job;}});
    try{await f.player.toggle();assert.equal(f.player.state(),'failed');assert.equal(f.video.plays,0);assert.equal(f.requests.length,1);assert.match(f.status.textContent,/audio origin changed/);}finally{f.player.stop();}
  }
});

test('continuation timeout remains visible and never retries with a reset DSP origin',async()=>{
  let calls=0;
  const f=windowFixture({origin:17,lineage:true,api:(range,ready)=>{if(++calls>1)throw new Error('PREVIEW_TIMEOUT');return ready(range);}});
  try{
    await f.player.toggle();f.video.finish(f.player.range());await settle();
    assert.equal(f.player.state(),'failed');assert.match(f.status.textContent,/PREVIEW_TIMEOUT/);assert.deepEqual(f.requests.map(query=>query.audio_origin_frame),[17,17]);assert.equal(f.video.plays,1);
  }finally{f.player.stop();}
});

test("natural EOF advances exactly three foreground windows including a fractional-fps tail and nonzero origin",async()=>{
  const fps={num:30_000,den:1001},span=Math.floor(300*fps.num/fps.den),origin=137,total=origin+2*span+11;
  let hooks=0;const f=windowFixture({origin,total,fps,beforeWindowChange:()=>{hooks++;}});
  try{
    await f.player.toggle();assert.equal(f.requests.length,1);
    for(const boundary of [origin+span,origin+2*span]){
      const previous=f.player.range();f.video.finish(previous);
      assert.equal(f.player.state(),"preparing");assert.match(f.status.textContent,/Paused.*next/);assert.equal(f.frames.at(-1),boundary-1);
      f.video.dispatchEvent(new Event("ended"));await settle();
      assert.equal(f.player.state(),"ready");assert.equal(f.requests.at(-1).start_frame,boundary);assert.equal(f.frames.at(-1),boundary);assert.equal(f.video.currentTime,0);
      const count=f.requests.length;f.video.dispatchEvent(new Event("ended"));await settle();assert.equal(f.requests.length,count,"a stale ended event cannot advance the new movie");
      assert.equal(f.timers.jobs.size,1);
    }
    assert.equal(f.requests.length,3);assert.equal(f.player.range().end_frame,total);assert.equal(hooks,2);
    f.video.finish(f.player.range());await settle();assert.equal(f.requests.length,3);assert.equal(f.frames.at(-1),total-1);assert.equal(f.status.textContent,"End of timeline");
    f.video.dispatchEvent(new Event("ended"));await settle();assert.equal(f.requests.length,3);
  }finally{f.player.stop();}
});

test("rollover uses the acknowledged covering range boundary and retains the old frame until tail, metadata and seek finish",async()=>{
  const tail=deferred();let count=0;
  const f=windowFixture({origin:137,total:20_000,beforeWindowChange:()=>tail.promise,api:(range,ready)=>ready({...range,start_frame:count++===0?0:range.start_frame,end_frame:range.end_frame+5})});
  try{
    await f.player.toggle();assert.equal(f.video.currentTime,137/30);const old=f.player.range(),src=f.video.src;
    f.video.waitMetadata=true;f.video.waitSeek=true;f.video.finish(old);await settle();
    assert.equal(f.requests[1].start_frame,old.end_frame);assert.equal(f.video.src,src);assert.equal(f.player.range(),old);assert.equal(f.frames.at(-1),old.end_frame-1);
    tail.resolve();await settle();assert.notEqual(f.video.src,src);assert.equal(f.video.plays,1);assert.equal(f.frames.at(-1),old.end_frame-1);
    f.video.readyState=1;f.video.dispatchEvent(new Event("loadedmetadata"));await settle();assert.equal(f.video.plays,1);assert.equal(f.frames.at(-1),old.end_frame-1);
    f.video.seeking=false;f.video.dispatchEvent(new Event("seeked"));await settle();assert.equal(f.video.plays,2);assert.equal(f.frames.at(-1),old.end_frame);
  }finally{f.player.stop();}
});

test("user pause and seek revoke continuation while natural EOF pause and fast startup pause retain it",async()=>{
  for(const action of ["pause","seek","local"]){
    const f=windowFixture();try{
      await f.player.toggle();
      if(action==="pause")f.video.pause();else if(action==="seek")f.video.currentTime=1;else f.player.pauseLocal();
      f.video.finish(f.player.range());await settle();assert.equal(f.requests.length,1,action);
    }finally{f.player.stop();}
  }
  const f=windowFixture({beforeWindowChange:()=>f.video.pause()});try{
    f.video.fastPause=true;await f.player.toggle();assert.equal(f.video.paused,true);
    f.video.finish(f.player.range());await settle();assert.equal(f.requests.length,2);assert.equal(f.video.plays,2);
  }finally{f.player.stop();}
  let correcting=false;const corrected=windowFixture({isInternalSeek:()=>correcting});try{
    await corrected.player.toggle();correcting=true;corrected.video.currentTime=1;correcting=false;
    corrected.video.finish(corrected.player.range());await settle();assert.equal(corrected.requests.length,2,"fast clock correction retains continuation intent");
  }finally{corrected.player.stop();}
});

test("stop, pause, stale document and disconnect invalidate a pending continuation ACK without deleting shared jobs",async()=>{
  for(const action of ["stop","pause","stale","disconnect"]){
    const ack=deferred();let calls=0;const f=windowFixture({api:(range,ready)=>++calls===1?ready(range):ack.promise});
    try{
      await f.player.toggle();const old=f.player.range(),src=f.video.src;f.video.finish(old);await settle();
      if(action==="stop")f.player.stop();else if(action==="pause")f.player.pauseLocal();else f.setDocument(action==="disconnect"?null:{...f.getState(),revision:"changed"});
      ack.resolve(f.ready(f.requests[1]));await settle();assert.equal(f.video.plays,1);assert.equal(f.video.paused,true);assert.equal(f.fetches.some(call=>call.method==="DELETE"),false);
      assert.equal(f.video.src,action==="stop"?"":src);if(action==="stale" || action==="disconnect")assert.equal(f.player.state(),"failed");else assert.equal(f.player.state(),'stopped');
    }finally{f.player.stop();}
  }
});

test("canceled tail and media waits cannot install or play a late continuation",async()=>{
  for(const phase of ["tail","metadata","seek"]){
    const tail=deferred(),f=windowFixture({beforeWindowChange:()=>tail.promise});
    try{
      await f.player.toggle();f.video.waitMetadata=phase==="metadata";f.video.waitSeek=phase==="seek";f.video.finish(f.player.range());await settle();
      if(phase!=="tail"){tail.resolve();await settle();}
      f.player.stop();tail.resolve();f.video.readyState=1;f.video.seeking=false;f.video.dispatchEvent(new Event("loadedmetadata"));f.video.dispatchEvent(new Event("seeked"));await settle();
      assert.equal(f.video.src,"");assert.equal(f.video.plays,1);assert.equal(f.player.state(),"stopped");assert.equal(f.timers.jobs.size,0);
    }finally{f.player.stop();}
  }
});

test("continuation failures do not autoplay and an old heartbeat cannot disrupt the next window",async()=>{
  for(const failure of ["renderer","range","tail"]){
    let count=0;const f=windowFixture({beforeWindowChange:()=>{if(failure==="tail")throw new Error("Audio tail incomplete");},api:(range,ready)=>{
      if(++count===1)return ready(range);
      if(failure==="renderer")return {state:"failed",error:"PREVIEW_STORAGE_PRESSURE",program:range};
      return ready(failure==="range"?{...range,end_frame:range.start_frame}:range);
    }});
    try{await f.player.toggle();f.video.finish(f.player.range());await settle();assert.equal(f.player.state(),"failed");assert.equal(f.video.plays,1);assert.equal(f.timers.jobs.size,0);}finally{f.player.stop();}
  }
  const response=deferred(),f=windowFixture({fetcher:()=>response.promise});
  await f.player.toggle();const pending=f.timers.fire();assert.equal(f.fetches.length,1);
  f.video.finish(f.player.range());await settle();const src=f.video.src;
  assert.equal(f.fetches[0].signal.aborted,true);response.resolve(new Response("",{status:409}));await pending;
  assert.equal(f.video.src,src);assert.equal(f.player.state(),"ready");assert.equal(f.timers.jobs.size,1);
  f.player.stop();
});

test("a late canceled frame callback cannot clear the next window's callback owner",async()=>{
  const f=windowFixture();try{
    await f.player.toggle();const old=f.video.callbacks.get(1);
    f.video.finish(f.player.range());await settle();const current=f.video.nextCallback,frames=f.frames.length;
    assert.ok(current>1);old(0,{presentedFrames:99,mediaTime:999});assert.equal(f.frames.length,frames);assert.equal(f.video.nextCallback,current);
    f.player.pauseLocal();assert.equal(f.video.canceled.at(-1),current,"pause must retain and cancel the replacement callback ID");
  }finally{f.player.stop();}
});

test('pauseLocal, native pause and user seek end pending preparation truthfully and the next Play works once',async t=>{
  for(const phase of ['ack','tail','metadata','seek'])for(const action of ['local','pause','seek'])await t.test(`${phase}/${action}`,async()=>{
    const ack=deferred(),tail=deferred();let calls=0;
    const f=windowFixture({beforeWindowChange:()=>tail.promise,api:(range,ready)=>++calls===2 && phase==='ack'?ack.promise:ready(range)});
    try{
      await f.player.toggle();f.video.waitMetadata=phase==='metadata';f.video.waitSeek=phase==='seek';f.video.finish(f.player.range());await settle();
      if(phase==='metadata' || phase==='seek'){tail.resolve();await settle();}
      assert.equal(f.player.state(),'preparing');
      if(action==='local')f.player.pauseLocal();else if(action==='pause')f.video.pause();else f.video.currentTime=1;
      assert.equal(f.player.state(),'stopped');assert.equal(f.video.paused,true);assert.match(f.status.textContent,/preparation paused.*Play/);assert.equal(f.timers.jobs.size,0);
      ack.resolve(f.ready(f.requests[1]));tail.resolve();f.video.readyState=1;f.video.seeking=false;f.video.dispatchEvent(new Event('loadedmetadata'));f.video.dispatchEvent(new Event('seeked'));await settle();
      assert.equal(f.player.state(),'stopped');assert.equal(f.video.plays,1);assert.equal(f.fetches.some(call=>call.method==='DELETE'),false);
      f.video.waitMetadata=false;f.video.waitSeek=false;await f.player.toggle();assert.equal(f.player.state(),'ready');assert.equal(f.video.plays,2);assert.equal(f.timers.jobs.size,1);
    }finally{f.player.stop();}
  });
});

test('a queued old error with cleared MediaError cannot fail the replacement ready movie',async()=>{
  const f=windowFixture();
  try{
    await f.player.toggle();const old=f.video.src;f.video.finish(f.player.range());await settle();assert.notEqual(f.video.src,old);
    const src=f.video.src,text=f.status.textContent;f.video.error=null;f.video.dispatchEvent(new Event('error'));
    assert.equal(f.player.state(),'ready');assert.equal(f.video.src,src);assert.equal(f.status.textContent,text);assert.equal(f.video.plays,2);assert.equal(f.timers.jobs.size,1);
    f.video.error={code:3,message:'Current media decode failed'};f.video.dispatchEvent(new Event('error'));assert.equal(f.player.state(),'failed');assert.equal(f.video.paused,true);assert.equal(f.timers.jobs.size,0);
  }finally{f.player.stop();}
});

test('cleared old MediaError events cannot reject replacement metadata or seek waits',async()=>{
  const f=windowFixture();
  try{
    await f.player.toggle();f.video.waitMetadata=true;f.video.waitSeek=true;f.video.finish(f.player.range());await settle();assert.equal(f.player.state(),'preparing');
    f.video.error=null;f.video.dispatchEvent(new Event('error'));await settle();assert.equal(f.player.state(),'preparing');assert.equal(f.video.plays,1);
    f.video.readyState=1;f.video.dispatchEvent(new Event('loadedmetadata'));await settle();assert.equal(f.player.state(),'preparing');f.video.dispatchEvent(new Event('error'));await settle();assert.equal(f.player.state(),'preparing');
    f.video.seeking=false;f.video.dispatchEvent(new Event('seeked'));await settle();assert.equal(f.player.state(),'ready');assert.equal(f.video.plays,2);
  }finally{f.player.stop();}
});

test('queued old pause and seeking events cannot revoke the playing replacement or cancel its frame owner',async()=>{
  const f=windowFixture();
  try{
    await f.player.toggle();f.video.finish(f.player.range());await settle();const callback=f.video.nextCallback,canceled=f.video.canceled.length;
    assert.equal(f.video.paused,false);assert.equal(f.video.seeking,false);f.video.dispatchEvent(new Event('pause'));f.video.dispatchEvent(new Event('seeking'));
    assert.equal(f.player.state(),'ready');assert.equal(f.video.paused,false);assert.equal(f.video.canceled.length,canceled);assert.equal(f.video.nextCallback,callback);
    f.video.finish(f.player.range());await settle();assert.equal(f.requests.length,3);assert.equal(f.video.plays,3);
  }finally{f.player.stop();}
});

test('task-delayed fast pauses preserve Program intent in either listener order while a later user pause still revokes it',async t=>{
  for(const order of ['program-first','fast-first'])for(const userPause of [false,true])await t.test(`${order}/${userPause?'user-pause':'continue'}`,async()=>{
    const pauseTasks=[],requests=[],audioRequests=[],buffers=[],frames=[],programTimers=fakeTimers(),audioTimers={jobs:new Map(),next:0,setTimeout(callback,delay){const id=++this.next;this.jobs.set(id,{callback,delay});return id;},clearTimeout(id){this.jobs.delete(id);}};
    class Video extends EventTarget{
      movie='';position=0;readyState=1;seeking=false;paused=true;ended=false;duration=.1;volume=1;muted=false;playbackRate=1;plays=0;
      get src(){return this.movie;}set src(value){this.movie=value;this.position=0;this.ended=false;}
      get currentTime(){return this.position;}set currentTime(value){this.position=value;this.seeking=true;this.dispatchEvent(new Event('seeking'));this.seeking=false;}
      getAttribute(){return this.movie;}removeAttribute(){this.movie='';this.ended=false;}load(){}
      pause(){if(this.paused)return;this.paused=true;pauseTasks.push(()=>this.dispatchEvent(new Event('pause')));}
      async play(){if(!this.paused)return;this.paused=false;this.ended=false;this.plays++;this.dispatchEvent(new Event('play'));}
    }
    const video=new Video(),select={value:'8',addEventListener(){}},context={state:'running',currentTime:0,destination:{},async resume(){},createGain:()=>({gain:{value:1,setValueAtTime(){}},connect(){},disconnect(){}}),createMediaElementSource:()=>({connect(){}}),async decodeAudioData(bytes){return {duration:bytes.byteLength/48000/4};},createBufferSource(){const source={connect(){},disconnect(){},start(){},stop(){}};buffers.push(source);return source;}};
    let player,transport,playhead=0;
    const getState=start=>{const frame=start===undefined?Math.min(playhead,5):start;return frame>=6?null:{project_epoch:'epoch',if_generation:'1',timeline_id:'timeline',revision:'revision',width:960,start_frame:frame,end_frame:Math.min(6,frame+3)};};
    const makeProgram=()=>createProgramPlayer({video,status:{textContent:''},cancel:new EventTarget(),timers:programTimers,getState,isInternalPause:event=>Boolean(transport?.pausing(video,event)),isInternalSeek:()=>Boolean(transport?.correcting(video)),beforeWindowChange:async()=>{if(!await transport.finishWindow(video))throw Error('Audio tail did not finish');},onState(){},onFrame:frame=>{frames.push(frame);playhead=frame;},fetcher:async()=>Response.json({state:'ready'}),api:async(path,range)=>{requests.push(range);return {id:`movie${requests.length}`,state:'ready',program:{...range,fps:{num:30,den:1},height:540}};}});
    const makeFast=()=>createFastTransport({videos:[video],select,status:{textContent:''},getVideo:()=>video,getTarget:()=>{const range=player?.range();return range?{identity:JSON.stringify([range.start_frame,range.end_frame,video.src]),fps:range.fps,origin:Math.round(range.start_frame/30*48000),end:Math.round(range.end_frame/30*48000),url:'/audio',query:{project_epoch:'epoch'}}:null;},contextFactory:()=>context,timers:audioTimers,frame:()=>1,cancelFrame(){},fetcher:(url,options)=>new Promise(resolve=>audioRequests.push({resolve,body:JSON.parse(options.body)}))});
    if(order==='program-first'){player=makeProgram();transport=makeFast();}else{transport=makeFast();player=makeProgram();}
    try{
      await player.toggle();await settle();assert.equal(pauseTasks.length,1);assert.equal(video.paused,true);assert.equal(transport.pausing(video),true);
      pauseTasks.shift()();assert.equal(transport.pausing(video),false);assert.equal(transport.pausing(video,new Event('pause')),false);assert.equal(player.state(),'ready');
      video.position=1/30;video.dispatchEvent(new Event('timeupdate'));assert.equal(frames.at(-1),1,'late internal pause must not suspend the current Program frame clock');
      const request=audioRequests[0].body,start=request.window.start_sample,end=request.window.end_sample,headers=new Map([['x-audio-start-sample',String(start)],['x-audio-end-sample',String(end)],['x-audio-tempo','8'],['x-audio-source-version','a'.repeat(64)],['x-audio-last','true']]);
      audioRequests[0].resolve({ok:true,headers,arrayBuffer:async()=>new ArrayBuffer((end-start)/8*4)});await settle();const timer=[...audioTimers.jobs].find(([,job])=>job.delay===50);assert.ok(timer);audioTimers.jobs.delete(timer[0]);timer[1].callback();await settle();assert.equal(video.paused,false);
      if(userPause){video.pause();await settle();pauseTasks.shift()();assert.equal(transport.active(),false);}
      video.position=video.duration;video.ended=true;video.paused=true;video.dispatchEvent(new Event('pause'));video.dispatchEvent(new Event('ended'));await settle();
      if(userPause)assert.equal(requests.length,1,'an actual user pause must still stop continuation');
      else{assert.equal(requests.length,2);buffers[0].onended();await settle();assert.equal(player.state(),'ready');assert.match(video.src,/movie2/);assert.equal(pauseTasks.length,1);pauseTasks.shift()();assert.equal(player.state(),'ready');}
    }finally{transport.stop();player.stop();while(pauseTasks.length)pauseTasks.shift()();assert.equal(audioTimers.jobs.size,0);assert.equal(programTimers.jobs.size,0);}
  });
});
