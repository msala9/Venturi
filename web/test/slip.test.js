import test from "node:test";
import assert from "node:assert/strict";
import {slipFrames,slipIdentity,boundedProxy,createSlipView} from "../js/slip.js";
import {createInput} from "../js/timeline/input.js";

test("slip frames come from the native source map and reject uncached drafts",()=>{
  const manifest={window_start:-1,window_end:1,frames:[[-1,13,60],[0,15,62],[1,17,64]]};
  assert.deepEqual(slipFrames(manifest,1),[1,17,64]);assert.equal(slipFrames(manifest,2),null);assert.equal(slipFrames(manifest,0.5),null);
  const target={project_epoch:"a",if_generation:"2",timeline_id:"3",revision:"r",clip_id:"9"};
  for(const key of Object.keys(target))assert.notEqual(slipIdentity(target),slipIdentity({...target,[key]:"changed"}));
});

test("Slip timeline gesture clamps linked handles, commits once and cancels without edits",async()=>{
  globalThis.window={addEventListener(){},removeEventListener(){}};
  const handlers={},commands=[],events=[];let captured=false;
  const canvas={addEventListener:(name,fn)=>{handlers[name]=fn;},removeEventListener(){},focus(){},getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;handlers.lostpointercapture();}};
  const timeline={fps:{num:24,den:1},tracks:[{id:"0",kind:"video",locked:false,clips:[{id:"1",start_frame:0,length_frames:12,linked_group:"1",slip_range:[-7,29]}]},{id:"1",kind:"audio",locked:false,clips:[{id:"2",start_frame:0,length_frames:12,linked_group:"1",slip_range:[-3,20]}]}]};
  const view={tool:"slip",origin:0,scale:100,scrollY:0,selection:[],playhead:0,snap:false};
  const input=createInput({canvas,getTimeline:()=>timeline,view,invalidate(){},onSelect(){},onSeek(){},onCommand:async(operation)=>commands.push(operation),onNotice(){},onSlip:(event)=>events.push(event)});
  const point=(x)=>({button:0,pointerId:1,clientX:x,clientY:50,preventDefault(){}});
  handlers.pointerdown(point(180));handlers.pointermove(point(0));assert.equal(view.draft.target,-3);handlers.pointermove(point(1000));assert.equal(view.draft.target,20);assert.equal(commands.length,0);
  await handlers.pointerup(point(1000));assert.deepEqual(commands,[{kind:"slip",clip_ids:["1","2"],delta_frames:20}]);
  handlers.pointerdown(point(180));handlers.pointermove(point(190));handlers.keydown({key:"Escape"});await handlers.pointerup(point(190));assert.equal(commands.length,1);
  assert.equal(events.filter((e)=>e.phase==="begin").length,2);assert.ok(events.some((e)=>e.phase==="cancel"));input.destroy();delete globalThis.window;
});

test("dual source preview uses blob URLs and pointer drafts cause no HTTP requests",async()=>{
  const element=()=>{const events={};return {events,hidden:false,disabled:false,value:"0",textContent:"",readyState:1,currentTime:0,seeking:false,addEventListener:(name,fn)=>{events[name]=fn;},pause(){},load(){},removeAttribute(){},reportValidity:()=>true};};
  const videos=[element(),element()],labels=[element(),element()],nodes={output:element(),input:element(),"[data-slip-apply]":element(),"[data-slip-refresh]":element(),"[data-slip-close]":element()};
  const root={hidden:true,parentElement:{dataset:{}},querySelectorAll:(selector)=>selector==="video"?videos:labels,querySelector:(selector)=>nodes[selector]};
  const target={project_epoch:"epoch",if_generation:"1",timeline_id:"1",revision:"revision",frame:0,clip_id:"1"};let calls=0,commits=0;
  const manifest={project_epoch:"epoch",generation:"1",revision:"revision",clip_id:"1",clip_ids:["1","2"],media_id:"2",source_version:"hash",locked:false,preview_available:true,fps:{num:24,den:1},min_delta:-1,max_delta:1,window_start:-1,window_end:1,frames:[[-1,6,17],[0,7,18],[1,8,19]]};
  const control=createSlipView({root,getTarget:()=>target,commit:async()=>{commits++;},notice(){},api:async(path)=>{calls++;return path.includes("/slip/")?manifest:{state:"ready",id:"job"};},fetcher:async()=>{calls++;return new Response(new Uint8Array([1,2,3]));}});
  await control.open("1");assert.ok(videos.every((video)=>video.src.startsWith("blob:")));assert.equal(calls,3);
  for(let i=0;i<20;i++)control.draft({phase:"draft",delta:i%2?1:-1});assert.equal(calls,3);assert.equal(videos[0].currentTime,8/24);
  await nodes["[data-slip-apply]"].events.click();assert.equal(commits,1);assert.equal(root.hidden,true);control.destroy();
});
test("local Slip proxy download is bounded before and during streaming",async()=>{
  let canceled=false;
  const large=async()=>({ok:true,headers:new Headers({"content-length":String(33*1024*1024)}),body:{cancel:async()=>{canceled=true;}}});
  await assert.rejects(boundedProxy("/proxy",new AbortController().signal,large),/32 MiB/);assert.ok(canceled);
  const small=async()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-length":"3"}});
  const blob=await boundedProxy("/proxy",new AbortController().signal,small);assert.equal(blob.size,3);
  const unbounded=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(33*1024*1024));controller.close();}}));
  await assert.rejects(boundedProxy("/proxy",new AbortController().signal,unbounded),/32 MiB/);
});
