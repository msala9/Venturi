import test from "node:test";
import assert from "node:assert/strict";
import { createProgramPlayer, sameComposition, containsProgramRange } from "../js/program.js";

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
