import test from "node:test";
import assert from "node:assert/strict";
import {createMeterReader,createPlaybackMeterReader,createPeakEnvelope} from "../js/audio-meters.js";

const query={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:960};
const reading={frame:0,samples:4096,sample_rate:48000,channels:[]};
test("native meter requests are single-flight and canceled/obsolete replies cannot replace current readings",async()=>{
  let current={query,insert:null};const requests=[],values=[],states=[];
  const reader=createMeterReader({getTarget:()=>current,onRead:value=>values.push(value),onStatus:message=>states.push(message),fetcher:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))});
  const old=reader.refresh();await reader.refresh();assert.equal(requests.length,1);
  reader.invalidate();current={query:{...query,revision:"next",frame:24},insert:{channel:"1",index:0}};
  const latest=reader.refresh();assert.equal(requests[0].options.signal.aborted,true);
  requests[1].resolve(Response.json({...reading,frame:24}));await latest;
  requests[0].resolve(Response.json(reading));await old;
  assert.deepEqual(values.map(value=>value.frame),[24]);
  assert.match(states.at(-1),/85 ms window · Program frame 24/);
  assert.equal(requests[1].url,"/api/v1/preview/audio/meters");
  assert.deepEqual(JSON.parse(requests[1].options.body),current);
});

test("meter errors and changed documents remain visible without changing the editing model",async()=>{
  let current={query,insert:null},mode="busy",pending;
  const values=[],states=[];
  const reader=createMeterReader({getTarget:()=>current,onRead:value=>values.push(value),onStatus:message=>states.push(message),fetcher:()=>mode==="busy"?Promise.resolve(Response.json({error:{code:"AUDIO_BUSY"}},{status:409})):new Promise(resolve=>pending=resolve)});
  await reader.refresh();assert.equal(states.at(-1),"AUDIO_BUSY");assert.equal(values.length,0);
  mode="pending";const old=reader.refresh();current={query:{...query,if_generation:"1"},insert:null};pending(Response.json(reading));await old;assert.equal(values.length,0);
  const snapshot=JSON.stringify(current);const next=reader.refresh();current.query={...current.query,frame:1};pending(Response.json(reading));await next;
  assert.equal(values.length,1,"Advancing playback may show the explicitly labeled native reading frame");
  assert.equal(JSON.parse(snapshot).query.frame,0);assert.equal(current.query.frame,1);
  current=null;await reader.refresh();assert.equal(states.at(-1),"Select a native Program timeline");
});

const program={project_epoch:'p:1',if_generation:'0',timeline_id:'1',revision:'r',start_frame:0,end_frame:240,width:960,audio_origin_frame:0};
const frequencies=Array.from({length:128},(_,index)=>20*Math.pow(1000,index/127));
function playbackHarness({count=20,peak=()=>.1,insert=null,unavailable=false,fetcher}={}){
  let clock=0;const state={query,insert,channels:[{id:'master',label:'Master',effects:[]}],playback:{job_id:'job-1',query:{...program},sample:4096,playing:true}},calls=[],values=[],statuses=[],clears=[];
  const bin=index=>({start_sample:index*4096,end_sample:(index+1)*4096,channels:[{channel:'master',peak:[peak(index),peak(index)]}],master_spectrum_db:Array(128).fill(-20),master_peak_hz:1000,insert:insert&&!unavailable?{...insert,kind:'MultibandCompressor',before_db:Array(128).fill(-15),after_db:Array(128).fill(-20),band_level:[index,0,0],reduction_db:[index===2?12:1,0,0]}:null});
  const page=url=>{const args=new URL(url,'http://localhost').searchParams,from=Number(args.get('from_bin')),limit=Number(args.get('limit')),end=Math.min(count,from+limit);return {job_id:state.playback.job_id,query:{...state.playback.query},state:'available',sample_rate:48000,bin_frames:4096,start_sample:0,end_sample:count*4096,first_bin_sample:0,bin_count:count,from_bin:from,next_bin:end<count?end:null,bins:Array.from({length:end-from},(_,index)=>bin(from+index)),spectrum_hz:frequencies,inserts_available:!unavailable,inserts_error:unavailable?'More than four native insert taps; use static Read':null};};
  const reader=createPlaybackMeterReader({getTarget:()=>state,now:()=>clock,onRead:value=>values.push(value),onStatus:status=>statuses.push(status),onClear:()=>clears.push(true),fetcher:(url,options)=>{calls.push({url,options});return fetcher?fetcher(url,options,page):Promise.resolve(Response.json(page(url)));}});
  return {state,calls,values,statuses,clears,reader,page,setClock:value=>clock=value};
}

test('live meters read only prepared native pages and never invoke the static DSP route',async()=>{
  const h=playbackHarness();await h.reader.refresh();assert.equal(h.values.length,1);assert.equal(h.values[0].end_sample,4096);assert.equal(h.values[0].telemetry,true);assert.equal(h.values[0].spectrum_hz.length,128);
  assert.equal(h.calls.length,1);const url=new URL(h.calls[0].url,'http://localhost');assert.equal(url.pathname,'/api/v1/preview/program/job-1/meters');assert.equal(url.searchParams.get('audio_origin_frame'),'0');assert.equal(url.searchParams.get('limit'),'16');assert.equal(h.calls[0].options.cache,'no-store');
  h.state.playback.query={...h.state.playback.query,audio_origin_frame:1};await h.reader.refresh();assert.equal(h.calls.length,2);assert.ok(h.clears.length>=2);h.reader.invalidate();
});

test('a late attached clock jumps directly to its completed bin instead of replaying the whole window',async()=>{
  const h=playbackHarness({count:1000});h.state.playback.sample=4096*900;await h.reader.refresh();assert.equal(h.calls.length,2);assert.equal(new URL(h.calls[1].url,'http://localhost').searchParams.get('from_bin'),'899');assert.equal(h.values[0].end_sample,4096*900);h.reader.invalidate();
});

test('skipped completed bins retain short peaks, clipping and native compressor reduction',async()=>{
  const h=playbackHarness({insert:{channel:'master',index:0},peak:index=>index===2?2:.1});await h.reader.refresh();h.state.playback.sample=4096*4;await h.reader.refresh();const result=h.values.at(-1);
  assert.equal(result.end_sample,4096*4);assert.equal(result.channels[0].peak[0],2);assert.equal(result.channels[0].clipped[0],true);assert.equal(result.insert.reduction_db[0],12);assert.equal(result.insert.band_level[0],3);assert.equal(result.insert.after_db.length,128);h.reader.invalidate();
});

test('native-style decay and one-second held peaks continue while paused without fetching or replaying bins',async()=>{
  const h=playbackHarness({peak:()=>1.2});await h.reader.refresh();h.state.playback.playing=false;h.setClock(500);await h.reader.refresh();assert.equal(h.calls.length,1);let channel=h.values.at(-1).channels[0];assert.ok(channel.peak[0]<1.2);assert.equal(channel.hold_db[0],20*Math.log10(1.2));assert.equal(channel.clipped[0],true);
  h.setClock(1500);await h.reader.refresh();channel=h.values.at(-1).channels[0];assert.equal(channel.clipped[0],false);assert.ok(channel.hold_db[0]<20*Math.log10(1.2));
  const envelope=createPeakEnvelope({now:()=>0});assert.equal(envelope.read([{channel:'master',peak:[0,0]}])[0].db[0],null);envelope.clear();assert.deepEqual(envelope.read(),[]);h.reader.invalidate();
});

test('seek, new job, cancellation and late pages cannot publish previous Program telemetry',async()=>{
  const pending=[];const h=playbackHarness({fetcher:(url,options,page)=>new Promise(resolve=>pending.push({options,resolve:()=>resolve(Response.json(page(url)))}))});
  const old=h.reader.refresh();await h.reader.refresh();assert.equal(h.calls.length,1);h.reader.invalidate();h.state.playback.job_id='job-2';const latest=h.reader.refresh();assert.equal(pending[0].options.signal.aborted,true);pending[1].resolve();await latest;pending[0].resolve();await old;assert.equal(h.values.length,1);assert.ok(h.calls[1].url.includes('/job-2/'));
  h.state.playback.sample=1;const seeking=h.reader.refresh();pending[2].resolve();await seeking;assert.equal(h.values.length,1,'Backward seek clears the old reading until another native bin completes');h.reader.invalidate();
});

test('invalid or foreign telemetry fails visibly once per binding without an independent render fallback',async()=>{
  for(const corrupt of [page=>page.job_id='foreign',page=>page.query.audio_origin_frame=9,page=>page.bins[0].channels=[],page=>page.bins[0].master_spectrum_db=[-20],page=>page.first_bin_sample=100]){
    const h=playbackHarness({fetcher:(url,options,make)=>{const page=make(url);corrupt(page);return Promise.resolve(Response.json(page));}});await h.reader.refresh();assert.equal(h.values.length,0);assert.match(h.statuses.at(-1),/Telemetry unavailable/);await h.reader.refresh();assert.equal(h.calls.length,1);assert.ok(h.calls.every(call=>call.url.includes('/program/')));h.reader.invalidate();
  }
});

test('unavailable insert taps preserve all channel and master playback peaks with an explicit notice',async()=>{
  const h=playbackHarness({insert:{channel:'master',index:0},unavailable:true,peak:()=>.8});await h.reader.refresh();assert.equal(h.values[0].channels[0].peak[0],.8);assert.equal(h.values[0].insert,null);assert.equal(h.values[0].inserts_available,false);assert.match(h.statuses.at(-1),/More than four/);h.reader.invalidate();
});

test('catch-up reads are bounded per tick and later ticks merge every skipped native peak',async()=>{
  const h=playbackHarness({count:100,peak:index=>index===90?3:.1});await h.reader.refresh();h.state.playback.sample=4096*100;const before=h.calls.length;await h.reader.refresh();assert.ok(h.calls.length-before<=4);assert.ok(h.values.at(-1).end_sample<4096*100);await h.reader.refresh();assert.equal(h.values.at(-1).end_sample,4096*100);assert.equal(h.values.at(-1).channels[0].peak[0],3);assert.ok(h.calls.every(call=>Number(new URL(call.url,'http://localhost').searchParams.get('limit'))<=16));h.reader.invalidate();
});

test('a short terminal Program publishes its completed native tail once even when the captured player is paused',async()=>{
  const h=playbackHarness({count:1,peak:()=>1.5,fetcher:(url,options,make)=>{const page=make(url);page.end_sample=1000;page.bins[0].end_sample=1000;return Promise.resolve(Response.json(page));}});
  h.state.playback.sample=1000;h.state.playback.playing=false;await h.reader.refresh();assert.equal(h.calls.length,0);
  assert.equal(await h.reader.finishPlayback({...h.state.playback}),true);assert.equal(h.calls.length,1);assert.equal(h.values.at(-1).end_sample,1000);assert.equal(h.values.at(-1).channels[0].clipped[0],true);assert.ok(h.calls[0].url.includes('/program/job-1/meters'));
  const calls=h.calls.length;await h.reader.refresh();assert.equal(h.calls.length,calls);h.reader.invalidate();
});

test('terminal reads suppress late owners and long backlogs read only a bounded final tail',async()=>{
  let resolve,owned=true;const late=playbackHarness({count:1,fetcher:(url,options,make)=>new Promise(done=>resolve=()=>done(Response.json(make(url))))});late.state.playback.sample=4096;late.state.playback.playing=false;
  const pending=late.reader.finishPlayback({...late.state.playback},()=>owned);owned=false;resolve();assert.equal(await pending,false);assert.equal(late.values.length,0);assert.deepEqual(late.statuses,[]);late.reader.invalidate();
  const h=playbackHarness({count:100});await h.reader.refresh();const before=h.calls.length;h.state.playback.sample=100*4096;h.state.playback.playing=false;
  assert.equal(await h.reader.finishPlayback({...h.state.playback}),true);assert.ok(h.calls.length-before<=4);assert.equal(h.values.at(-1).end_sample,100*4096);assert.equal(h.values.at(-1).tail_only,true);h.reader.invalidate();
});
