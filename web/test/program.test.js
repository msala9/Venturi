import test from "node:test";
import assert from "node:assert/strict";
import { createProgramPlayer, sameComposition, containsProgramRange } from "../js/program.js";
import {createFastTransport} from '../js/fast-transport.js';
import {buildProgramWindow} from '../js/program-range.js';

function fakeTimers(){
  let next=0;const jobs=new Map();
  return {jobs,setTimeout(callback,delay){const id=++next;jobs.set(id,{callback,delay});return id;},clearTimeout(id){jobs.delete(id);},fire(){const entry=jobs.entries().next().value;if(!entry)return;const [id,job]=entry;jobs.delete(id);assert.equal(job.delay,2_000);return job.callback();},fireDelay(delay){const entry=[...jobs].find(([,job])=>job.delay===delay);assert.ok(entry,`Expected a ${delay} ms timer`);jobs.delete(entry[0]);return entry[1].callback();}};
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
function windowFixture({origin=0,total=18_010,fps={num:30,den:1},api,fetcher,beforeWindowChange,isInternalSeek,isInternalPause,onUserPause,onState=()=>{},lineage=false,strictOrigin=false,canPrefetch,onPrefetch,productionRanges=false}={}){
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
  const video=new Video(),status={textContent:""},timers=fakeTimers(),cancel=new EventTarget(),requests=[],frames=[],fetches=[];
  let playhead=origin,document={project_epoch:"epoch",if_generation:"1",timeline_id:"timeline",revision:"revision",width:960};
  const getState=(start,audioOrigin)=>{
    if(!document)return null;
    if(productionRanges)return buildProgramWindow(
      {project_epoch:document.project_epoch,generation:document.if_generation,capabilities:{playback:true}},
      {id:document.timeline_id,revision:document.revision,fps,tracks:[{clips:[{start_frame:0,length_frames:total}]}]},
      playhead,start,audioOrigin);
    const frame=start===undefined?playhead:start;
    if(strictOrigin && audioOrigin!==undefined && audioOrigin>frame)return null;
    return Number.isSafeInteger(frame) && frame>=0 && frame<total ? {...document,start_frame:frame,end_frame:Math.min(total,frame+Math.floor(300*fps.num/fps.den)),...(lineage?{audio_origin_frame:audioOrigin===undefined?frame:audioOrigin}:{})} : null;
  };
  const ready=(range,id=`window${requests.length}`)=>({id,state:"ready",program:{start_frame:range.start_frame,end_frame:range.end_frame,fps,width:960,height:540,...(lineage?{audio_origin_frame:range.audio_origin_frame}:{})}});
  const player=createProgramPlayer({video,status,timers,cancel,getState,beforeWindowChange,isInternalSeek,isInternalPause,onUserPause,onState,canPrefetch,onPrefetch,onFrame:frame=>{frames.push(frame);playhead=frame;},api:async(path,range)=>{requests.push({...range});return api?api(range,ready):ready(range);},fetcher:async(url,options)=>{fetches.push({url,...options});if(fetcher)return fetcher(url,options);const parsed=new URL(url,'http://host'),params=parsed.searchParams,range={start_frame:Number(params.get('start_frame')),end_frame:Number(params.get('end_frame')),...(lineage?{audio_origin_frame:Number(params.get('audio_origin_frame'))}:{})};return Response.json(ready(range,decodeURIComponent(parsed.pathname.split('/').at(-1))));}});
  return {video,status,timers,cancel,requests,frames,fetches,player,ready,getState,setDocument:value=>{document=value;},setPlayhead:value=>{playhead=value;}};
}

test('production Program ranges play a short startup then adjacent 60-second windows to the exact fractional EOF',async()=>{
  const origin=137,total=2395,fps={num:30_000,den:1001};
  const f=windowFixture({origin,total,fps,lineage:true,productionRanges:true});
  try{
    await f.player.toggle();
    assert.deepEqual([f.player.range().start_frame,f.player.range().end_frame],[137,586]);
    for(const [start,end] of [[586,2384],[2384,2395]]){
      f.video.finish(f.player.range());await settle();
      assert.equal(f.player.state(),'ready');assert.equal(f.video.paused,false);
      assert.deepEqual([f.player.range().start_frame,f.player.range().end_frame],[start,end]);
      assert.equal(f.player.range().audio_origin_frame,origin);assert.equal(f.video.currentTime,0);
      assert.equal(f.player.telemetryTarget().sample,Math.round(start*48000*fps.den/fps.num));
    }
    f.video.finish(f.player.range());await settle();
    assert.equal(f.requests.length,3);assert.equal(f.player.playing(),false);assert.equal(f.status.textContent,'End of timeline');
    assert.deepEqual(f.requests.map(range=>[range.start_frame,range.end_frame,range.audio_origin_frame]),[[137,586,137],[586,2384,137],[2384,2395,137]]);
    f.video.dispatchEvent(new Event('ended'));await settle();assert.equal(f.requests.length,3);
  }finally{f.player.stop();}
});

test('production short-startup prefetch is promoted once and manual seek starts a fresh short DSP lineage',async()=>{
  const f=windowFixture({origin:137,total:6000,fps:{num:30,den:1},lineage:true,productionRanges:true,canPrefetch:()=>true});
  try{
    await f.player.toggle();await settle();
    assert.deepEqual(f.requests.map(range=>[range.start_frame,range.end_frame,range.audio_origin_frame]),[[137,587,137],[587,2387,137]]);
    assert.equal(f.player.prefetchState().state,'ready');
    f.video.finish(f.player.range());await settle();
    assert.deepEqual([f.player.range().start_frame,f.player.range().end_frame],[587,2387]);
    assert.equal(f.video.plays,2);assert.equal(f.requests.filter(range=>range.start_frame===587).length,1);
    assert.equal(await f.player.seekFrame(1000,{resume:false}),true);
    assert.deepEqual([f.player.range().start_frame,f.player.range().end_frame,f.player.range().audio_origin_frame],[1000,1450,1000]);
    assert.equal(f.video.paused,true);assert.equal(f.player.prefetchState().state,'idle');
    assert.equal(f.requests.filter(range=>range.start_frame===1000).length,1);
    assert.ok(f.fetches.every(call=>call.options?.method!=='DELETE'));
  }finally{f.player.stop();}
});

test('toolbar pause, native pause and Stop report the exact owned frame once without replaying presentation callbacks',async()=>{
  for(const action of ['toolbar','native','stop']){
    const notifications=[],f=windowFixture({origin:137,fps:{num:30000,den:1001},onUserPause:ticket=>{notifications.push(ticket);assert.equal(ticket.isCurrent(),true);f.setPlayhead(ticket.frame);f.player.stop();}});
    try{
      await f.player.toggle();await settle();const range=f.player.range();f.video.position=1.234567;
      const expected=range.start_frame+Math.floor((f.video.currentTime+1e-6)*range.fps.num/range.fps.den);
      if(action==='toolbar')await f.player.toggle();else if(action==='native')f.video.pause();else f.cancel.dispatchEvent(new Event('click'));
      assert.equal(notifications.length,1);assert.equal(notifications[0].frame,expected);assert.equal(notifications[0].reason,action==='stop'?'stop':'pause');assert.equal(notifications[0].query,range);assert.equal(notifications[0].isCurrent(),false);
      assert.equal(f.player.state(),'stopped');assert.equal(f.video.src,'');assert.equal(f.video.plays,1);assert.equal(f.getState().start_frame,expected);assert.deepEqual(f.frames,[]);assert.equal(f.timers.jobs.size,0);
      f.video.dispatchEvent(new Event('pause'));f.video.dispatchEvent(new Event('timeupdate'));assert.equal(notifications.length,1);assert.deepEqual(f.frames,[]);
    }finally{f.player.stop();}
  }
});

test('internal fast pause and window handoff do not enter editing; only final whole-timeline EOF reports the exclusive end',async()=>{
  const fps={num:30000,den:1001},origin=137,total=origin+Math.floor(300*fps.num/fps.den)+3,notifications=[];
  let internal=false,handoffs=0;
  const f=windowFixture({origin,total,fps,isInternalPause:()=>internal,beforeWindowChange:()=>{handoffs++;f.video.pause();},onUserPause:ticket=>{notifications.push(ticket);f.player.stop();}});
  try{
    await f.player.toggle();await settle();internal=true;f.video.pause();internal=false;assert.equal(notifications.length,0);await f.video.play();await settle();
    f.video.finish(f.player.range());await settle();assert.equal(f.requests.length,2);assert.equal(handoffs,1);assert.equal(notifications.length,0);assert.equal(f.player.state(),'ready');
    f.video.finish(f.player.range());await settle();assert.equal(notifications.length,1);assert.equal(notifications[0].reason,'ended');assert.equal(notifications[0].frame,total);assert.equal(f.player.state(),'stopped');assert.equal(f.requests.length,2);
    f.video.dispatchEvent(new Event('ended'));assert.equal(notifications.length,1);
  }finally{f.player.stop();}
});

test('old pause tickets cannot stop a replay of the same cached asset or a newer preparation',async()=>{
  const tickets=[],f=windowFixture({total:48,onUserPause:ticket=>tickets.push(ticket)});
  try{
    await f.player.toggle();await settle();f.video.finish(f.player.range());await settle();assert.equal(tickets.length,1);const old=tickets[0],range=old.query;assert.equal(old.isCurrent(),true);
    f.setPlayhead(0);await f.player.toggle();await settle();assert.equal(f.player.range(),range,'covering cache may reuse the same range object after moving away from EOF');assert.equal(f.requests.length,1);
    f.video.paused=true;assert.equal(old.isCurrent(),false,'sequence ownership must reject a cached replay even when its video is paused');assert.equal(f.player.state(),'ready');
    f.video.paused=false;f.video.dispatchEvent(new Event('pause'));assert.equal(tickets.length,1,'a delayed old pause cannot act while the replacement is playing');
  }finally{f.player.stop();}
});

test('stale document, detached source and local scrub pause never publish a user-edit frame',async()=>{
  for(const action of ['document','source','scrub']){
    const notifications=[],f=windowFixture({onUserPause:ticket=>notifications.push(ticket)});
    try{
      await f.player.toggle();await settle();f.video.position=1;
      if(action==='document')f.setDocument({...f.getState(),revision:'new'});
      if(action==='source')f.video.movie='foreign-resource';
      if(action==='scrub')f.player.pauseLocal();else f.video.pause();
      assert.equal(notifications.length,0);assert.deepEqual(f.frames,[]);
    }finally{f.player.stop();}
  }
});

test('verified Program telemetry uses continuous absolute samples and native audio origin, never a cached unattached resource',async()=>{
  const fps={num:30000,den:1001},origin=137,f=windowFixture({origin,fps,lineage:true});
  try{
    assert.equal(f.player.telemetryTarget(),null);await f.player.toggle();await settle();f.video.position=.125;
    const target=f.player.telemetryTarget();assert.equal(target.job_id,'window1');assert.equal(target.query.audio_origin_frame,origin);assert.equal(target.sample,Math.round(origin*48000*fps.den/fps.num)+6000);assert.equal(target.playing,true);
    assert.deepEqual(Object.keys(target.query).sort(),['project_epoch','if_generation','timeline_id','revision','start_frame','end_frame','width','audio_origin_frame'].sort());assert.equal('fps' in target.query,false);
    target.query.revision='forged';assert.equal(f.player.telemetryTarget().query.revision,'revision');
    f.player.pauseLocal();assert.equal(f.player.telemetryTarget().playing,false);f.video.position=1e9;const range=f.player.range();assert.equal(f.player.telemetryTarget().sample,Math.round(range.end_frame*48000*fps.den/fps.num));
    f.player.stop();assert.equal(f.player.telemetryTarget(),null);await f.player.toggle();assert.equal(f.requests.length,1);assert.equal(f.player.telemetryTarget().job_id,'window1');
    f.video.movie='foreign';assert.equal(f.player.telemetryTarget(),null);
  }finally{f.player.stop();}
});

test('short Program EOF exposes its exclusive frame and sample end for the black editing frame and final meter bin',async()=>{
  const tickets=[],f=windowFixture({total:1,onUserPause:ticket=>tickets.push(ticket)});
  try{
    await f.player.toggle();await settle();f.video.position=.01;assert.equal(f.player.telemetryTarget().sample,480);
    f.video.finish(f.player.range());await settle();assert.equal(tickets.length,1);assert.equal(tickets[0].frame,1);assert.equal(tickets[0].playback.sample,1600);assert.equal(tickets[0].playback.playing,false);assert.equal(tickets[0].playback.job_id,'window1');assert.equal(tickets[0].isCurrent(),true);
    assert.equal(f.player.telemetryTarget().sample,1600);f.player.stop();assert.equal(f.player.telemetryTarget(),null);assert.equal(tickets[0].isCurrent(),false);
  }finally{f.player.stop();}
});

test('final Program EOF publishes an exclusive stopped cursor and Play stays idle until an explicit backward seek',async()=>{
  const tickets=[],f=windowFixture({total:48,lineage:true,onUserPause:ticket=>{tickets.push(ticket);if(ticket.reason==='ended'){f.setPlayhead(ticket.frame);assert.equal(ticket.isCurrent(),true);f.player.stop();}}});
  try{
    await f.player.toggle();f.video.finish(f.player.range());await settle();
    assert.equal(tickets.length,1);assert.equal(tickets[0].frame,48);assert.equal(f.getState(),null);assert.equal(f.player.state(),'stopped');assert.equal(f.video.src,'');
    const requests=f.requests.length,plays=f.video.plays;await f.player.toggle();assert.equal(f.requests.length,requests);assert.equal(f.video.plays,plays);assert.equal(f.player.state(),'stopped');
    f.setPlayhead(0);assert.equal(await f.player.seekFrame(0,{resume:false}),true);assert.equal(f.video.paused,true);
    await f.player.toggle();assert.equal(f.video.paused,false);assert.equal(f.video.plays,plays+1);assert.equal(f.requests.length,requests);
  }finally{f.player.stop();}
});

test('recording clock holds the verified fractional window end through rollover and announces ready before play',async()=>{
  const fps={num:30000,den:1001},origin=137,span=Math.floor(300*fps.num/fps.den),ack=deferred(),states=[];let calls=0;
  const f=windowFixture({origin,total:origin+span+3,fps,lineage:true,
    api:(range,ready)=>++calls===1?ready(range):ack.promise,
    onState:state=>states.push({state,clock:f.player.recordingClock()})});
  try{
    assert.equal(f.player.recordingClock(),null);await f.player.toggle();
    const ready=states.find(value=>value.state==='ready').clock;assert.equal(ready.state,'holding');
    assert.equal(ready.sample,Math.round(origin*48000*fps.den/fps.num));assert.equal(ready.audio_origin_frame,origin);
    f.video.position=.125;const playing=f.player.recordingClock();assert.equal(playing.state,'playing');assert.equal(playing.sample,ready.sample+6000);
    const old=f.player.range();f.video.position=(old.end_frame-old.start_frame)*fps.den/fps.num;f.video.ended=true;f.video.pause();
    const boundary=f.player.recordingClock();assert.equal(boundary.state,'holding');assert.equal(boundary.sample,Math.round(old.end_frame*48000*fps.den/fps.num));
    f.video.dispatchEvent(new Event('ended'));await settle();
    assert.equal(f.player.state(),'preparing');assert.deepEqual(f.player.recordingClock(),{...boundary,sequence:f.player.recordingClock().sequence});
    assert.ok(f.player.recordingClock().sequence>boundary.sequence);
    f.video.waitMetadata=true;f.video.waitSeek=true;ack.resolve(f.ready(f.requests[1]));await settle();
    assert.equal(f.player.recordingClock().state,'holding');assert.equal(f.player.recordingClock().sample,boundary.sample);
    f.video.readyState=1;f.video.dispatchEvent(new Event('loadedmetadata'));await settle();assert.equal(f.player.recordingClock().state,'holding');
    f.video.seeking=false;f.video.dispatchEvent(new Event('seeked'));await settle();
    const resumed=f.player.recordingClock();assert.equal(resumed.state,'playing');assert.equal(resumed.window_start_sample,boundary.window_end_sample);assert.equal(resumed.sample,boundary.sample);assert.equal(resumed.audio_origin_frame,origin);
    assert.equal(states.filter(value=>value.state==='ready').at(-1).clock.state,'holding');
    f.video.finish(f.player.range());await settle();assert.equal(f.player.recordingClock().state,'stopped');assert.equal(f.player.recordingClock().sample,resumed.window_end_sample);
  }finally{f.player.stop();}assert.equal(f.player.recordingClock(),null);
});

test('recording clock stops for pause, nonunit speed, failed continuation and stale owners',async()=>{
  for(const action of ['pause','speed','stale','foreign']){
    const f=windowFixture({lineage:true});try{
      await f.player.toggle();assert.equal(f.player.recordingClock().state,'playing');
      if(action==='pause')f.player.pauseLocal();
      if(action==='speed')f.video.playbackRate=2;
      if(action==='stale')f.setDocument({...f.getState(),revision:'other'});
      if(action==='foreign')f.video.movie='unowned';
      if(action==='pause' || action==='speed')assert.equal(f.player.recordingClock().state,'stopped');else assert.equal(f.player.recordingClock(),null);
    }finally{f.player.stop();}
  }
  const ack=deferred();let calls=0;const f=windowFixture({lineage:true,api:(range,ready)=>++calls===1?ready(range):ack.promise});
  try{
    await f.player.toggle();f.video.finish(f.player.range());await settle();assert.equal(f.player.recordingClock().state,'holding');
    ack.reject(Error('GPU_BUSY'));await settle();assert.equal(f.player.state(),'failed');assert.equal(f.player.recordingClock().state,'stopped');
  }finally{f.player.stop();}
  const late=deferred();let prepared=0;const canceled=windowFixture({lineage:true,api:(range,ready)=>++prepared===1?ready(range):late.promise});
  try{
    await canceled.player.toggle();canceled.video.finish(canceled.player.range());await settle();assert.equal(canceled.player.recordingClock().state,'holding');
    canceled.player.stop();assert.equal(canceled.player.recordingClock(),null);late.resolve(canceled.ready(canceled.requests[1]));await settle();assert.equal(canceled.player.recordingClock(),null);assert.equal(canceled.video.plays,1);
  }finally{canceled.player.stop();}
  const states=[],rejected=windowFixture({lineage:true,onState:state=>states.push({state,clock:rejected.player.recordingClock()})});
  try{
    await rejected.player.toggle();rejected.video.play=async()=>{throw Error('Playback blocked');};
    rejected.video.finish(rejected.player.range());await settle();
    assert.equal(rejected.player.recordingClock().state,'stopped');assert.equal(states.at(-1).clock.state,'stopped');
  }finally{rejected.player.stop();}
});

test('a pending Program preparation and stale composition never expose live telemetry',async()=>{
  const ack=deferred(),f=windowFixture({api:()=>ack.promise});
  try{
    const pending=f.player.toggle();assert.equal(f.player.telemetryTarget(),null);ack.resolve(f.ready(f.requests[0]));await pending;assert.ok(f.player.telemetryTarget());
    f.setDocument({...f.getState(),revision:'changed'});assert.equal(f.player.telemetryTarget(),null);
  }finally{f.player.stop();}
});

test('opt-in Program lookahead prepares one next range without changing current playback, telemetry or recording clocks',async()=>{
  const states=[],prefetch=[],f=windowFixture({total:9010,lineage:true,canPrefetch:()=>true,onState:state=>states.push(state),onPrefetch:value=>prefetch.push(value)});
  try{
    await f.player.toggle();await settle();const current=f.player.range(),src=f.video.src,clock=f.player.recordingClock(),telemetry=f.player.telemetryTarget();
    assert.equal(f.requests.length,2);assert.equal(f.player.prefetchState().state,'ready');assert.equal(f.player.prefetchState().range.start_frame,9000);assert.equal(f.video.plays,1);assert.equal(f.video.paused,false);assert.equal(f.player.range(),current);assert.equal(f.video.src,src);assert.deepEqual(f.player.recordingClock(),clock);assert.equal(f.player.telemetryTarget().job_id,telemetry.job_id);assert.deepEqual(states,['stopped','preparing','ready']);
    const copy=f.player.prefetchState();copy.range.revision='forged';assert.equal(f.player.prefetchState().range.revision,'revision');
    f.video.finish(current);await settle();assert.equal(f.requests.length,2);assert.equal(f.video.plays,2);assert.equal(f.player.range().start_frame,9000);assert.match(f.status.textContent,/PREFETCHED/);assert.equal(f.player.telemetryTarget().job_id,'window2');assert.equal(f.player.prefetchState().state,'idle');assert.ok(prefetch.some(value=>value.state==='ready'));assert.ok(f.fetches.some(value=>value.url.includes('/window2?')));assert.equal(f.fetches.some(value=>value.method==='DELETE'),false);
  }finally{f.player.stop();}
});

test('queued next-window preparation is adopted at EOF without a duplicate POST and preserves native recording hold',async()=>{
  const ack=deferred();let count=0;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>true,api:(range,ready)=>++count===1?ready(range):ack.promise});
  try{
    await f.player.toggle();await settle();assert.equal(f.requests.length,2);const current=f.player.range(),oldClock=f.player.recordingClock();f.video.finish(current);await settle();assert.equal(f.player.state(),'preparing');assert.equal(f.requests.length,2);assert.equal(f.player.recordingClock().state,'holding');assert.equal(f.player.recordingClock().sample,Math.round(current.end_frame*48000/30));
    ack.resolve(f.ready(f.requests[1]));await settle();assert.equal(f.player.state(),'ready');assert.equal(f.video.plays,2);assert.equal(f.player.recordingClock().state,'playing');assert.equal(f.player.recordingClock().audio_origin_frame,oldClock.audio_origin_frame);assert.equal(f.player.recordingClock().sample,Math.round(current.end_frame*48000/30));
  }finally{f.player.stop();}
});

test('future polling and ready heartbeats use one bounded timer each and keep native ready TTL alive',async()=>{
  let count=0;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>true,api:(range,ready)=>++count===1?ready(range):{...ready(range),state:'queued'}});
  try{
    await f.player.toggle();await settle();assert.equal(f.player.prefetchState().state,'queued');assert.equal([...f.timers.jobs.values()].filter(value=>value.delay===1000).length,1);assert.equal(f.video.paused,false);
    await f.timers.fireDelay(1000);await settle();assert.equal(f.player.prefetchState().state,'ready');assert.equal([...f.timers.jobs.values()].filter(value=>value.delay===10_000).length,1);
    for(let index=0;index<5;index++){await f.timers.fireDelay(10_000);await settle();assert.equal(f.player.prefetchState().state,'ready');assert.equal([...f.timers.jobs.values()].filter(value=>value.delay===10_000).length,1);}
    assert.equal(f.requests.length,2);assert.equal(f.fetches.filter(value=>value.url.includes('/window2?')).length,6);assert.equal(f.video.plays,1);assert.equal(f.player.telemetryTarget().job_id,'window1');
  }finally{f.player.stop();}assert.equal(f.timers.jobs.size,0);
});

test('pause, stop, source policy, context changes and late speculative ACKs never autoplay or DELETE shared jobs',async()=>{
  for(const action of ['pause','stop','policy','stale']){
    const ack=deferred();let count=0,policy=true;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>policy,api:(range,ready)=>++count===1?ready(range):ack.promise});
    try{
      await f.player.toggle();await settle();const src=f.video.src;
      if(action==='pause')f.player.pauseLocal();else if(action==='stop')f.player.stop();else if(action==='policy'){policy=false;f.player.invalidatePrefetch();}else{f.setDocument({...f.getState(),revision:'changed'});f.player.invalidatePrefetch();}
      assert.equal(f.player.prefetchState().state,'idle');ack.resolve(f.ready(f.requests[1]));await settle();assert.equal(f.video.plays,1);assert.equal(f.video.src,action==='stop'?'':src);assert.equal(f.fetches.some(value=>value.method==='DELETE'),false);assert.equal(f.requests.length,2);
    }finally{f.player.stop();}
  }
});

test('a promoted shared future is never deleted by Stop while its ready acknowledgment or handoff is pending',async()=>{
  for(const phase of ['ack','handoff']){
    const ack=deferred(),tail=deferred();let count=0;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>true,beforeWindowChange:()=>tail.promise,api:(range,ready)=>++count===1?ready(range):phase==='ack'?ack.promise:ready(range)});
    try{
      await f.player.toggle();await settle();f.video.finish(f.player.range());await settle();assert.equal(f.player.state(),'preparing');f.player.stop();ack.resolve(f.ready(f.requests[1]));tail.resolve();await settle();assert.equal(f.video.plays,1);assert.equal(f.player.state(),'stopped');assert.equal(f.fetches.some(value=>value.method==='DELETE'),false);assert.equal(f.timers.jobs.size,0);
    }finally{f.player.stop();}
  }
});

test('a discarded speculative job deduplicated by foreground preparation is still not owned for cancellation',async()=>{
  let count=0,policy=true;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>policy,api:(range,ready)=>ready(range,++count===1?'current':'shared-next')});
  try{
    await f.player.toggle();await settle();assert.equal(f.player.prefetchState().jobId,'shared-next');
    policy=false;f.player.invalidatePrefetch();assert.equal(f.player.prefetchState().state,'idle');
    f.video.waitMetadata=true;f.video.finish(f.player.range());await settle();
    assert.equal(f.requests.length,3);assert.equal(f.player.state(),'preparing');assert.match(f.video.src,/shared-next\/program.mp4/);
    f.player.stop();await settle();assert.equal(f.player.state(),'stopped');assert.equal(f.video.src,'');assert.equal(f.video.plays,1);assert.equal(f.fetches.some(value=>value.method==='DELETE'),false);assert.equal(f.timers.jobs.size,0);
  }finally{f.player.stop();}
});

test('resource failures or changed native FPS/audio origin fail only the future until EOF, without automatic retry',async()=>{
  for(const failure of ['resource','fps','origin']){
    let count=0;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>true,api:(range,ready)=>{if(++count===1)return ready(range);if(failure==='resource')throw Error('PROGRAM_MEMORY_PRESSURE');const value=ready(range);if(failure==='fps')value.program.fps={num:24,den:1};else value.program.audio_origin_frame=1;return value;}});
    try{
      await f.player.toggle();await settle();assert.equal(f.player.prefetchState().state,'failed');assert.equal(f.player.state(),'ready');assert.equal(f.video.paused,false);assert.equal(f.video.plays,1);
      for(let index=0;index<4;index++){f.video.dispatchEvent(new Event('timeupdate'));f.player.invalidatePrefetch();}await settle();assert.equal(f.requests.length,2);
      f.video.finish(f.player.range());await settle();assert.equal(f.player.state(),'failed');assert.equal(f.requests.length,2);assert.equal(f.video.plays,1);assert.match(f.status.textContent,failure==='resource'?/PROGRAM_MEMORY_PRESSURE/:/identity|FPS/);
    }finally{f.player.stop();}
  }
});

test('prefetched readiness still waits for the owned fast-audio tail before replacing the sole video attachment',async()=>{
  const tail=deferred();let hooks=0;const f=windowFixture({total:9010,lineage:true,canPrefetch:()=>true,beforeWindowChange:()=>{hooks++;return tail.promise;}});
  try{
    await f.player.toggle();await settle();assert.equal(hooks,0);const src=f.video.src,old=f.player.range();f.video.finish(old);await settle();assert.equal(hooks,1);assert.equal(f.video.src,src);assert.equal(f.video.plays,1);assert.equal(f.player.recordingClock().state,'holding');
    tail.resolve();await settle();assert.notEqual(f.video.src,src);assert.equal(f.video.plays,2);assert.equal(f.player.range().start_frame,old.end_frame);assert.equal(f.player.recordingClock().state,'playing');assert.equal(f.requests.length,2);
  }finally{f.player.stop();}
});

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

test('explicit Program seek resumes only after verified metadata and seek with a fresh native audio origin',async()=>{
  const f=windowFixture({origin:137,total:30_000,lineage:true,fps:{num:30000,den:1001}});
  try{
    await f.player.toggle();assert.equal(f.player.playing(),true);
    f.video.waitMetadata=true;f.video.waitSeek=true;
    const sought=f.player.seekFrame(12_000);await settle();
    assert.equal(f.player.state(),'preparing');assert.equal(f.player.playing(),true);assert.equal(f.video.paused,true);assert.equal(f.video.plays,1);
    assert.equal(f.requests.at(-1).start_frame,12_000);assert.equal(f.requests.at(-1).audio_origin_frame,12_000);
    f.video.readyState=1;f.video.dispatchEvent(new Event('loadedmetadata'));await settle();
    assert.equal(f.video.plays,1);assert.equal(f.video.currentTime,0);
    f.video.seeking=false;f.video.dispatchEvent(new Event('seeked'));assert.equal(await sought,true);
    assert.equal(f.video.plays,2);assert.equal(f.player.playing(),true);assert.equal(f.player.range().audio_origin_frame,12_000);
    const count=f.requests.length;f.video.waitMetadata=false;f.video.waitSeek=false;
    assert.equal(await f.player.seekFrame(12_000),true);assert.equal(f.requests.length,count,'same-origin cached media must still pass its ready check');
    assert.equal(f.fetches.length,1);assert.equal(f.fetches[0].cache,'no-store');assert.equal(f.video.plays,3);
  }finally{f.player.stop();}
});

test('latest Program seek retains pending resume intent and an obsolete ACK cannot attach or play',async()=>{
  const first=deferred(),second=deferred();let calls=0;
  const f=windowFixture({lineage:true,api:(range,ready)=>++calls===1?ready(range):calls===2?first.promise:second.promise});
  try{
    await f.player.toggle();const old=f.player.seekFrame(100);assert.equal(f.player.playing(),true);
    const latest=f.player.seekFrame(10_000);assert.equal(f.player.playing(),true);
    second.resolve(f.ready(f.requests[2],'latest-seek'));assert.equal(await latest,true);
    const src=f.video.src;first.resolve(f.ready(f.requests[1],'obsolete-seek'));assert.equal(await old,false);
    assert.equal(f.video.src,src);assert.match(src,/latest-seek/);assert.equal(f.video.plays,2);assert.equal(f.player.range().audio_origin_frame,10_000);
  }finally{f.player.stop();}
});

test('backward Program navigation validates the old composition at its own start after the playhead has moved',async()=>{
  const f=windowFixture({origin:500,lineage:true,strictOrigin:true});
  try{
    await f.player.toggle();const resume=f.player.playing(),previous=f.player.range();assert.equal(resume,true);
    f.setPlayhead(12);
    assert.equal(f.getState(undefined,previous.audio_origin_frame),null,'the old DSP origin is invalid at the already-updated playhead');
    assert.equal(f.getState(previous.start_frame,previous.audio_origin_frame).start_frame,500);
    assert.equal(await f.player.seekFrame(12,{resume}),true);
    assert.equal(f.requests.length,2);assert.equal(f.requests[1].start_frame,12);assert.equal(f.requests[1].audio_origin_frame,12);
    assert.equal(f.player.playing(),true);assert.equal(f.video.paused,false);assert.equal(f.video.plays,2);
  }finally{f.player.stop();}
});

test('Program paused and explicit nonresuming seeks attach without playing; EOF never revives old intent',async()=>{
  const f=windowFixture({total:100,lineage:true});
  try{
    assert.equal(f.player.playing(),false);assert.equal(await f.player.seekFrame(20),true);
    assert.equal(f.video.paused,true);assert.equal(f.video.plays,0);assert.equal(f.player.playing(),false);assert.equal(f.timers.jobs.size,1);assert.deepEqual(f.frames,[]);
    await f.player.toggle();assert.equal(f.video.plays,1);assert.equal(await f.player.seekFrame(40,{resume:false}),true);
    assert.equal(f.video.paused,true);assert.equal(f.video.plays,1);assert.equal(f.player.playing(),false);
    await f.player.toggle();f.video.finish(f.player.range());await settle();assert.equal(f.player.playing(),false);
    assert.equal(await f.player.seekFrame(5),true);assert.equal(f.video.paused,true);assert.equal(f.video.plays,2);assert.equal(f.player.range().audio_origin_frame,5);
  }finally{f.player.stop();}
});

test('Stop, newer pause and stale composition revoke a Program seek before a late ACK or media wait',async t=>{
  for(const phase of ['ack','metadata','seek'])for(const action of ['stop','pause','stale','disconnect'])await t.test(`${phase}/${action}`,async()=>{
    const ack=deferred();let calls=0;const f=windowFixture({lineage:true,api:(range,ready)=>++calls===2 && phase==='ack'?ack.promise:ready(range)});
    try{
      await f.player.toggle();f.video.waitMetadata=phase==='metadata';f.video.waitSeek=phase==='seek';
      const sought=f.player.seekFrame(100);await settle();assert.equal(f.player.playing(),true);
      if(action==='stop')f.player.stop();else if(action==='pause')f.player.pauseLocal();else f.setDocument(action==='disconnect'?null:{...f.getState(),revision:'changed'});
      ack.resolve(f.ready(f.requests[1]));f.video.readyState=1;f.video.seeking=false;f.video.dispatchEvent(new Event('loadedmetadata'));f.video.dispatchEvent(new Event('seeked'));
      assert.equal(await sought,false);assert.equal(f.video.plays,1);assert.equal(f.video.paused,true);assert.equal(f.player.playing(),false);
      assert.equal(f.fetches.some(call=>call.method==='DELETE'),false);
    }finally{f.player.stop();}
  });
});

test('Program seek rejects invalid frames and stale captured owners without admitting a new preparation',async()=>{
  const f=windowFixture({total:100,lineage:true});
  try{
    await f.player.toggle();const src=f.video.src,count=f.requests.length;
    for(const frame of [-1,NaN,1.5,100,Number.MAX_SAFE_INTEGER+1])assert.equal(await f.player.seekFrame(frame),false);
    assert.equal(await f.player.seekFrame(10,{resume:'yes'}),false);assert.equal(f.requests.length,count);assert.equal(f.video.src,src);assert.equal(f.player.playing(),true);
    f.setDocument({...f.getState(),revision:'changed'});assert.equal(await f.player.seekFrame(10,{resume:true}),false);
    assert.equal(f.requests.length,count);assert.equal(f.video.paused,true);assert.equal(f.player.playing(),false);
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
  for(const order of ['program-first','fast-first'])for(const action of (order==='program-first'?['continue','user-pause','seek','normal-pause','normal-eof']:['continue','user-pause']))await t.test(`${order}/${action}`,async()=>{
    const userPause=action==='user-pause',normalize=action.startsWith('normal-'),tempo=action==='seek' || normalize?2:8;
    const pauseTasks=[],requests=[],audioRequests=[],buffers=[],frames=[],normalizations=[],terminalReads=[],meter=deferred(),programTimers=fakeTimers(),audioTimers={jobs:new Map(),next:0,setTimeout(callback,delay){const id=++this.next;this.jobs.set(id,{callback,delay});return id;},clearTimeout(id){this.jobs.delete(id);}};
    class Video extends EventTarget{
      movie='';position=0;readyState=1;seeking=false;paused=true;ended=false;duration=.1;volume=1;muted=false;playbackRate=1;plays=0;
      get src(){return this.movie;}set src(value){this.movie=value;this.position=0;this.ended=false;}
      get currentTime(){return this.position;}set currentTime(value){this.position=value;this.seeking=true;this.dispatchEvent(new Event('seeking'));this.seeking=false;}
      getAttribute(){return this.movie;}removeAttribute(){this.movie='';this.ended=false;}load(){}
      pause(){if(this.paused)return;this.paused=true;pauseTasks.push(()=>this.dispatchEvent(new Event('pause')));}
      async play(){if(!this.paused)return;this.paused=false;this.ended=false;this.plays++;this.dispatchEvent(new Event('play'));}
    }
    const video=new Video(),select={value:String(tempo),addEventListener(){}},context={state:'running',currentTime:0,destination:{},async resume(){},createGain:()=>({gain:{value:1,setValueAtTime(){}},connect(){},disconnect(){}}),createMediaElementSource:()=>({connect(){}}),async decodeAudioData(bytes){return {duration:bytes.byteLength/48000/4};},createBufferSource(){const source={stops:0,connect(){},disconnect(){},start(){},stop(){this.stops++;}};buffers.push(source);return source;}};
    let player,transport,playhead=0;
    const getState=(start,origin)=>{const frame=start===undefined?playhead:start;return frame>=6?null:{project_epoch:'epoch',if_generation:'1',timeline_id:'timeline',revision:'revision',width:960,start_frame:frame,end_frame:Math.min(6,frame+3),audio_origin_frame:origin ?? frame};};
    const makeProgram=()=>createProgramPlayer({video,status:{textContent:''},cancel:new EventTarget(),timers:programTimers,getState,isInternalPause:event=>Boolean(transport?.pausing(video,event)),isInternalSeek:()=>Boolean(transport?.correcting(video)),beforeWindowChange:async()=>{if(!await transport.finishWindow(video))throw Error('Audio tail did not finish');},onUserPause:ticket=>{
      if(!normalize)return;
      if(ticket.reason==='ended')playhead=ticket.frame;
      normalizations.push((async()=>{
        if(ticket.reason==='ended')assert.equal(await transport.finishWindow(video),true);
        if(!ticket.isCurrent())return;transport.normal();
        if(ticket.reason==='ended'){player.stop();const current=()=>player.state()==='stopped' && playhead===ticket.frame;terminalReads.push({frame:ticket.frame,current});await meter.promise;}
      })());
    },onState(){},onFrame:frame=>{frames.push(frame);playhead=frame;},fetcher:async url=>Response.json({state:'ready',program:{audio_origin_frame:Number(new URL(url,'http://host').searchParams.get('audio_origin_frame'))}}),api:async(path,range)=>{requests.push(range);return {id:`movie${requests.length}`,state:'ready',program:{...range,fps:{num:30,den:1},height:540}};}});
    const makeFast=()=>createFastTransport({videos:[video],select,status:{textContent:''},getVideo:()=>video,getTarget:()=>{const range=player?.range();return range?{identity:JSON.stringify([range.start_frame,range.end_frame,video.src]),fps:range.fps,origin:Math.round(range.start_frame/30*48000),end:Math.round(range.end_frame/30*48000),url:'/audio',query:{project_epoch:'epoch',audio_origin_frame:range.audio_origin_frame}}:null;},contextFactory:()=>context,timers:audioTimers,frame:()=>1,cancelFrame(){},fetcher:(url,options)=>new Promise(resolve=>audioRequests.push({resolve,body:JSON.parse(options.body),signal:options.signal}))});
    if(order==='program-first'){player=makeProgram();transport=makeFast();}else{transport=makeFast();player=makeProgram();}
    try{
      await player.toggle();await settle();assert.equal(pauseTasks.length,1);assert.equal(video.paused,true);assert.equal(transport.pausing(video),true);
      pauseTasks.shift()();assert.equal(transport.pausing(video),false);assert.equal(transport.pausing(video,new Event('pause')),false);assert.equal(player.state(),'ready');
      video.position=1/30;video.dispatchEvent(new Event('timeupdate'));assert.equal(frames.at(-1),1,'late internal pause must not suspend the current Program frame clock');
      const request=audioRequests[0].body,start=request.window.start_sample,end=request.window.end_sample,headers=new Map([['x-audio-start-sample',String(start)],['x-audio-end-sample',String(end)],['x-audio-tempo',String(tempo)],['x-audio-source-version','a'.repeat(64)],['x-audio-last','true']]);
      audioRequests[0].resolve({ok:true,headers,arrayBuffer:async()=>new ArrayBuffer((end-start)/tempo*4)});await settle();const timer=[...audioTimers.jobs].find(([,job])=>job.delay===50);assert.ok(timer);audioTimers.jobs.delete(timer[0]);timer[1].callback();await settle();assert.equal(video.paused,false);
      if(action==='normal-pause'){
        video.pause();pauseTasks.shift()();await Promise.all(normalizations);
        assert.equal(select.value,'1');assert.equal(video.playbackRate,1);assert.equal(transport.active(),false);assert.equal(buffers[0].stops,1);assert.equal(player.playing(),false);
        await player.toggle();await settle();assert.equal(video.paused,false);assert.equal(video.playbackRate,1);assert.equal(audioRequests.length,1,'normal restart must use the prepared movie audio');return;
      }
      if(action==='normal-eof'){
        const endMovie=()=>{video.position=video.duration;video.ended=true;video.paused=true;video.dispatchEvent(new Event('pause'));video.dispatchEvent(new Event('ended'));};
        endMovie();await settle();assert.equal(select.value,'2');assert.equal(normalizations.length,0);assert.equal(buffers[0].stops,0,'internal handoff must drain its existing native tail');
        buffers[0].onended();await settle();while(pauseTasks.length)pauseTasks.shift()();assert.equal(requests.length,2);assert.equal(requests[1].audio_origin_frame,0);assert.equal(select.value,'2');
        const next=audioRequests[1],from=next.body.window.start_sample,to=next.body.window.end_sample;
        next.resolve({ok:true,headers:new Map([['x-audio-start-sample',String(from)],['x-audio-end-sample',String(to)],['x-audio-tempo','2'],['x-audio-source-version','b'.repeat(64)],['x-audio-last','true']]),arrayBuffer:async()=>new ArrayBuffer((to-from)/2*4)});await settle();
        const startNext=[...audioTimers.jobs].find(([,job])=>job.delay===50);assert.ok(startNext);audioTimers.jobs.delete(startNext[0]);startNext[1].callback();await settle();
        endMovie();await settle();assert.equal(select.value,'2');assert.equal(normalizations.length,1);assert.equal(buffers[1].stops,0,'final reset must wait for the last native buffer');assert.equal(playhead,6);
        const terminalRequests=requests.length,terminalPlays=video.plays;await player.toggle();assert.equal(requests.length,terminalRequests);assert.equal(video.plays,terminalPlays);assert.equal(transport.active(),true,'Play at EOF cannot cancel the pending final tail');
        buffers[1].onended();await settle();assert.equal(select.value,'1');assert.equal(video.playbackRate,1);assert.equal(player.playing(),false);assert.equal(player.state(),'stopped');assert.equal(video.src,'');assert.equal(terminalReads[0].frame,6);assert.equal(terminalReads[0].current(),true);
        await player.toggle();assert.equal(requests.length,terminalRequests);assert.equal(video.plays,terminalPlays,'a pending meter read cannot admit replay of the final frame');
        playhead=0;await player.seekFrame(0,{resume:false});await player.toggle();await settle();assert.equal(video.paused,false);assert.equal(video.playbackRate,1);assert.equal(audioRequests.length,2);assert.equal(terminalReads[0].current(),false);
        meter.resolve();await Promise.all(normalizations);assert.equal(player.playing(),true,'late terminal telemetry cannot stop the new normal-speed playback');return;
      }
      if(action==='seek'){
        const oldTail=buffers[0].onended,resume=player.playing() || transport.active();assert.equal(resume,true);
        transport.stop();player.pauseLocal();assert.equal(buffers[0].stops,1);assert.equal(buffers[0].onended,null);assert.equal(audioRequests[0].signal.aborted,true);
        assert.equal(await player.seekFrame(4,{resume}),true);await settle();
        assert.equal(requests.length,2);assert.equal(requests[1].start_frame,4);assert.equal(requests[1].audio_origin_frame,4);assert.equal(player.playing(),true,'owned fast startup pause retains the seek intent');
        assert.equal(transport.active(),true);assert.equal(video.paused,true);assert.equal(select.value,'2');
        while(pauseTasks.length)pauseTasks.shift()();
        const next=audioRequests[1],from=next.body.window.start_sample,to=next.body.window.end_sample;
        assert.equal(next.body.window.tempo,2);assert.equal(next.body.query.audio_origin_frame,4);assert.equal(from,6400);assert.equal(to,9600);
        next.resolve({ok:true,headers:new Map([['x-audio-start-sample',String(from)],['x-audio-end-sample',String(to)],['x-audio-tempo','2'],['x-audio-source-version','b'.repeat(64)],['x-audio-last','true']]),arrayBuffer:async()=>new ArrayBuffer((to-from)/2*4)});await settle();
        const resumed=[...audioTimers.jobs].find(([,job])=>job.delay===50);assert.ok(resumed);audioTimers.jobs.delete(resumed[0]);resumed[1].callback();await settle();
        oldTail();assert.equal(video.paused,false);assert.equal(video.playbackRate,2);assert.equal(player.playing(),true);assert.equal(transport.active(),true);assert.match(video.src,/movie2/);assert.equal(buffers.length,2);assert.equal(buffers[1].stops,0);return;
      }
      if(userPause){video.pause();await settle();pauseTasks.shift()();assert.equal(transport.active(),false);}
      video.position=video.duration;video.ended=true;video.paused=true;video.dispatchEvent(new Event('pause'));video.dispatchEvent(new Event('ended'));await settle();
      if(userPause)assert.equal(requests.length,1,'an actual user pause must still stop continuation');
      else{assert.equal(requests.length,2);buffers[0].onended();await settle();assert.equal(player.state(),'ready');assert.match(video.src,/movie2/);assert.equal(pauseTasks.length,1);pauseTasks.shift()();assert.equal(player.state(),'ready');}
    }finally{transport.stop();player.stop();while(pauseTasks.length)pauseTasks.shift()();assert.equal(audioTimers.jobs.size,0);assert.equal(programTimers.jobs.size,0);}
  });
});
