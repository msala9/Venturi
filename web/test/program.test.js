import test from "node:test";
import assert from "node:assert/strict";
import { createProgramPlayer, sameComposition, containsProgramRange } from "../js/program.js";

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
  const video={src:"",currentTime:0,paused:true,pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){},removeAttribute(){this.src="";},addEventListener(name,callback){events[name]=callback;}};
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",width:960,start_frame:0,end_frame:48};
  const ready=(id)=>({id,state:"ready",program:{start_frame:0,end_frame:48,width:960,height:540,fps:{num:24,den:1}}});
  const player=createProgramPlayer({video,status:{textContent:""},cancel:{addEventListener(){}},getState:()=>current,onFrame(){},onState(){},api:async(path,query)=>{requests.push(query);return ready(`job${requests.length}`);},fetcher:(url)=>{checks.push(url);return new Promise(resolve=>nextCheck=resolve);}});
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
  const video = { src: "", currentTime: 0, paused: true, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {}, removeAttribute() { this.src = ""; }, addEventListener(name, callback) { events[name] = callback; } };
  let state = { project_epoch: "p:1", if_generation: "2", timeline_id: "1", revision: "revision", width: 960, start_frame: 0, end_frame: 48 };
  let stopped=0;
  const cancel={addEventListener:(_,callback)=>events.cancel=callback};
  const player = createProgramPlayer({ video, status: { textContent: "" }, cancel, getState: () => state, onFrame: (frame) => frames.push(frame), onState() {},onStop:()=>stopped++, fetcher:async()=>Response.json({state:"ready"}),api: () => new Promise((resolve) => requests.push(resolve)) });
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
