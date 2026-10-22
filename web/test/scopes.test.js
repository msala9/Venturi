import test from "node:test";
import assert from "node:assert/strict";
import { scopeTarget, scopeURL, matchesScope, createScopes, scopeGraticule } from "../js/scopes.js";
import { createViewer } from "../js/viewer.js";

test("scopes isolate the native first selected video target and retain integer frame identity", () => {
  const document = { capabilities:{scopes:true}, project_epoch:"p:1",generation:"4" };
  const timeline = { id:"2",revision:"r",tracks:[{kind:"video",clips:[{id:"3",start_frame:12,length_frames:24}]},{kind:"audio",clips:[{id:"4",start_frame:12,length_frames:24}]}] };
  const target=scopeTarget(document,timeline,["3","4"],12);
  assert.equal(target.clip,"3");assert.equal(target.frame,12);
  assert.equal(scopeTarget(document,timeline,["4"],12),null);
  assert.equal(scopeTarget(document,timeline,["3"],36),null);
  assert.equal(scopeTarget(document,timeline,["3"],11),null);
  assert.equal(scopeTarget({...document,capabilities:{}},timeline,["3"],12),null);
  const state={...target,first:"Waveform",second:"Parade"};
  const url=new URL(scopeURL(state),"http://localhost");
  assert.equal(url.pathname,"/api/v1/preview/scopes/3/Waveform/Parade");
  assert.equal(url.searchParams.get("frame"),"12");assert.equal(url.searchParams.has("clip"),false);
  assert.equal(url.searchParams.has('selection_key'),false);assert.equal(url.searchParams.has('source_version'),false);
  assert.equal(matchesScope(state,{...state}),true);
  for(const key of ["clip","first","second","revision","if_generation","project_epoch","frame","selection_key","source_version"])
    assert.equal(matchesScope(state,{...state,[key]:"changed"}),false,key);
});

test('native scope primary ordering uses lane then start then full native ClipId, including read-only locked lanes',()=>{
  const document={capabilities:{scopes:true},project_epoch:'e:1',generation:'0',media:[{id:'50',content_hash:'9007199254740993'}]},timeline={id:'2',revision:'r',tracks:[{kind:'audio',clips:[{id:'1',start_frame:0,length_frames:100}]},{kind:'video',locked:true,clips:[{id:'9007199254740993',start_frame:12,length_frames:24,media_id:'50'},{id:'10',start_frame:0,length_frames:48},{id:'2',start_frame:0,length_frames:48}]},{kind:'video',clips:[{id:'3',start_frame:0,length_frames:48}]}]};
  const before=JSON.stringify(timeline),selection=['3','9007199254740993','10','2','1'];
  assert.equal(scopeTarget(document,timeline,selection,12).clip,'2');assert.equal(JSON.stringify(timeline),before);
  assert.equal(scopeTarget(document,timeline,['3','9007199254740993'],0),null,'The first native selected video must contain the playhead; another selected active clip does not replace it');
  const first=scopeTarget(document,timeline,['9007199254740993'],12),withAudio=scopeTarget(document,timeline,['1','9007199254740993'],12);assert.notEqual(first.selection_key,withAudio.selection_key);assert.equal(first.clip,withAudio.clip);
  assert.notEqual(scopeTarget({...document,media:[{id:'50',content_hash:'changed'}]},timeline,['9007199254740993'],12).source_version,first.source_version);
});

function scopeHarness(t,{playing=true,decode=async()=>{},guides=false}={}){
  const listeners=()=>{const handlers=new Map();return {addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);},emit:name=>handlers.get(name)?.()};};
  const image={hidden:true,src:'',decode,classList:{add(){},remove(){}}},status={textContent:''},empty={hidden:false},context={textContent:''},button=listeners(),selects=[{value:'Waveform',...listeners()},{value:'Parade',...listeners()}];
  const guideCalls=[],guide=guides?{hidden:true,getContext:()=>new Proxy({}, {get:(target,key)=>target[key] ?? ((...args)=>guideCalls.push([key,...args]))})}:null;
  image.naturalWidth=1024;image.naturalHeight=256;image.getBoundingClientRect=()=>({width:800,height:180});
  let scopeWidth=800,resize;const stage=guides?{dataset:{},getBoundingClientRect:()=>stage.dataset.scopeSlots==='1'?{width:Math.min(scopeWidth,360),height:Math.min(scopeWidth,360)/2}:{width:scopeWidth,height:180}}:null;
  for(const select of selects)select.parentElement={hidden:false};
  const panel={hidden:false,clientWidth:scopeWidth,ownerDocument:guides?{defaultView:{devicePixelRatio:1,getComputedStyle:()=>({paddingLeft:'0',paddingRight:'0'}),ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}}}}:null,querySelector:selector=>({'img':image,'output':status,'p':empty,'[data-scope-context]':context,'button':button,'[data-scope-guides]':guide,'.scope-stage':stage})[selector],querySelectorAll:()=>selects};
  let clock=0,current={project_epoch:'p:1',if_generation:'0',timeline_id:'1',revision:'r',frame:0,width:960,clip:'3',selection_key:'["3"]',source_version:'source:1'},timerId=0;
  const requests=[],timers=new Map();t.mock.method(globalThis,'fetch',(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})));
  const scopes=createScopes({panel,getTarget:()=>current,isPlaying:()=>playing,now:()=>clock,timers:{setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)}});
  const advance=ms=>{clock+=ms;const pending=[];for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);pending.push(timer.fn());}return Promise.all(pending);};
  return {scopes,panel,image,status,context,button,selects,requests,timers,guide,guideCalls,stage,resize:()=>resize?.(),setWidth:value=>{scopeWidth=value;panel.clientWidth=value;},advance,current:()=>current,setTarget:value=>current=value,setFrame:frame=>current={...current,frame},setPlaying:value=>playing=value};
}
const png=()=>new Response(new Blob(['native PNG'],{type:'image/png'}));

test('Live scopes are single-flight at four starts per second and coalesce advancing clocks without discarding their completed native frame',async t=>{
  const h=scopeHarness(t);try{
    const first=h.scopes.onPlaybackFrame();assert.equal(h.requests.length,1);h.advance(50);h.setFrame(4);h.scopes.onPlaybackFrame();h.advance(50);h.setFrame(8);h.scopes.onPlaybackFrame();assert.equal(h.requests.length,1);
    h.requests[0].resolve(png());await first;assert.equal(h.image.hidden,false);assert.equal(h.status.textContent,'LIVE · native frame 0');assert.match(h.context.textContent,/timeline frame 0/);assert.match(h.context.textContent,/playhead 8/);assert.equal(h.timers.size,1);
    h.setFrame(10);h.advance(149);assert.equal(h.requests.length,1);const second=h.advance(1);assert.equal(h.requests.length,2);assert.equal(new URL(h.requests[1].url,'http://localhost').searchParams.get('frame'),'10');
    h.requests[1].resolve(png());await second;assert.equal(h.status.textContent,'LIVE · native frame 10');h.advance(300);h.scopes.onPlaybackFrame();assert.equal(h.requests.length,2,'A repeated presented frame needs no new native scope render');
  }finally{h.scopes.destroy();}
});

test('a ready composition can reveal Color scopes before play without starting a stopped native render',async t=>{
  const h=scopeHarness(t,{playing:false});try{
    h.scopes.setVisible(false);h.scopes.setVisible(true,{defer:true});assert.equal(h.panel.hidden,false);assert.equal(h.requests.length,0);assert.equal(h.timers.size,0);assert.match(h.status.textContent,/READY/);
    h.setPlaying(true);const first=h.scopes.onPlaybackFrame();assert.equal(h.requests.length,1);h.requests[0].resolve(png());await first;assert.equal(h.status.textContent,'LIVE · native frame 0');
  }finally{h.scopes.destroy();}
});

test('GPU busy pauses automatic Live scopes until an explicit retry without a lock wait or retry loop',async t=>{
  const h=scopeHarness(t);try{
    const first=h.scopes.onPlaybackFrame();h.requests[0].resolve(Response.json({error:{code:'GPU_BUSY'}},{status:409}));await first;assert.match(h.status.textContent,/GPU_BUSY.*Live paused/);
    for(let frame=1;frame<5;frame++){h.setFrame(frame);h.advance(300);h.scopes.onPlaybackFrame();}assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
    const retry=h.scopes.refresh();assert.equal(h.requests.length,2);h.requests[1].resolve(png());await retry;assert.equal(h.status.textContent,'LIVE · native frame 4');
  }finally{h.scopes.destroy();}
});

test('Live scope responses reject stale project, generation, timeline, selection and source owners',async t=>{
  const h=scopeHarness(t);try{
    for(const [key,value] of [['project_epoch','other:1'],['if_generation','1'],['timeline_id','2'],['revision','next'],['selection_key','["3","4"]'],['source_version','source:2']]){
      const current=h.current(),first=h.scopes.onPlaybackFrame(),request=h.requests.at(-1);h.setTarget({...current,[key]:value});request.resolve(png());await first;assert.equal(h.image.hidden,true,key);assert.doesNotMatch(h.status.textContent,/^LIVE/);h.scopes.invalidate('CONTEXT CHANGED');h.advance(250);
    }
  }finally{h.scopes.destroy();}
});

test('a native scope PNG still decoding cannot attach after selection changes',async t=>{
  let decoded,markStarted;const started=new Promise(resolve=>markStarted=resolve);const h=scopeHarness(t,{decode:()=>new Promise(resolve=>{decoded=resolve;markStarted();})});try{
    const first=h.scopes.onPlaybackFrame();h.requests[0].resolve(png());await started;assert.equal(typeof decoded,'function');h.setTarget({...h.current(),selection_key:'["3","4"]'});decoded();await first;assert.equal(h.image.hidden,true);assert.doesNotMatch(h.status.textContent,/^LIVE/);
  }finally{h.scopes.destroy();}
});

test('pause, hidden panels and explicit invalidation cancel pending scope ownership and scheduled work',async t=>{
  const h=scopeHarness(t);try{
    const first=h.scopes.onPlaybackFrame();h.setFrame(4);h.requests[0].resolve(png());await first;assert.equal(h.timers.size,1);h.setPlaying(false);h.advance(250);assert.equal(h.requests.length,1);
    h.setPlaying(true);const second=h.scopes.onPlaybackFrame();assert.equal(h.requests.length,2);h.scopes.setVisible(false);assert.equal(h.requests[1].options.signal.aborted,true);h.requests[1].resolve(png());await second;assert.equal(h.timers.size,0);h.advance(500);h.scopes.onPlaybackFrame();assert.equal(h.requests.length,2);
  }finally{h.scopes.destroy();}
});

test('stopped scope reads keep exact frame matching and never schedule background work',async t=>{
  const h=scopeHarness(t,{playing:false});try{
    const first=h.scopes.refresh();h.setFrame(1);h.requests[0].resolve(png());await first;assert.equal(h.image.hidden,true);
    const second=h.scopes.refresh();h.requests[1].resolve(png());await second;assert.equal(h.status.textContent,'CURRENT');assert.match(h.context.textContent,/timeline frame 1/);assert.equal(h.timers.size,0);h.scopes.onPlaybackFrame();assert.equal(h.requests.length,2);
  }finally{h.scopes.destroy();}
});

test('changing scope kind coalesces a new native request while retaining the Live start budget',async t=>{
  const h=scopeHarness(t);try{
    const first=h.scopes.onPlaybackFrame();h.selects[0].value='Histogram';h.selects[0].emit('change');assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.signal.aborted,true);h.requests[0].resolve(png());await first;
    h.advance(249);assert.equal(h.requests.length,1);const second=h.advance(1);assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/\/Histogram\/Parade\?/);h.requests[1].resolve(png());await second;assert.equal(h.status.textContent,'LIVE · native frame 0');
  }finally{h.scopes.destroy();}
});

test("an obsolete scope response cannot become current after selection changes",async(t)=>{
  const pending=[];t.mock.method(globalThis,"fetch",()=>new Promise((resolve)=>pending.push(resolve)));
  let current={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:960,clip:"3",first:"Waveform",second:"Parade"};
  const image={hidden:true,src:"",decode:async()=>{},classList:{add(){},remove(){}}},status={textContent:""};
  const viewer=createViewer({image,status,empty:{hidden:false},getState:()=>current,matches:matchesScope,endpoint:scopeURL});
  const first=viewer.seek();current={...current,clip:"5"};const second=viewer.seek();
  pending[1](new Response(new Blob(["new"],{type:"image/png"})));await second;
  const url=image.src;pending[0](new Response(new Blob(["old"],{type:"image/png"})));await first;
  assert.equal(image.src,url);assert.equal(status.textContent,"CURRENT");viewer.destroy();
});

test('native scope guides retain percentage scales, parade divisions and histogram quarters without measuring pixels',()=>{
  const rect={x:10,y:20,width:512,height:256},wave=scopeGraticule('Waveform',rect),parade=scopeGraticule('Parade',rect),histogram=scopeGraticule('Histogram',rect);
  assert.deepEqual(wave.labels.map(label=>label.text),['0','25','50','75','100']);assert.deepEqual(wave.lines.map(line=>line.y1),[276,212,148,84,20]);
  assert.equal(parade.lines.length,7);assert.equal(parade.lines[5].x1,10+512/3);assert.equal(parade.lines[6].x1,10+1024/3);
  assert.deepEqual(histogram.lines.map(line=>line.x1),[138,266,394]);assert.equal(histogram.labels.length,0);
  assert.deepEqual(scopeGraticule('Unknown',rect),{lines:[],labels:[],circles:[],targets:[]});
});

test('native vectorscope guides use the square Cb/Cr extent, skin line and all six 75 percent targets',()=>{
  const guide=scopeGraticule('Vectorscope',{x:0,y:0,width:512,height:256});
  assert.deepEqual(guide.circles,[{x:256,y:128,radius:128}]);assert.equal(guide.lines.length,3);assert.equal(guide.targets.length,6);
  assert.deepEqual(guide.labels.map(label=>label.text),['R','Mg','B','Cy','G','Yl']);
  assert.ok(Math.abs(guide.targets[0].y-32)<.0001);assert.ok(Math.abs(guide.targets[2].x-352)<.0001);
  assert.ok(guide.lines[2].x2<256 && guide.lines[2].y2<128);assert.ok(Math.abs(Math.atan2(128-guide.lines[2].y2,guide.lines[2].x2-256)*180/Math.PI-123)<1e-10);
  for(const [first,second] of [[0,3],[1,4],[2,5]]){assert.ok(Math.abs(guide.targets[first].x+guide.targets[second].x-512)<.0001);assert.ok(Math.abs(guide.targets[first].y+guide.targets[second].y-256)<.0001);}
});

test('actual scope overlay follows only the verified native PNG and its contained two-slot image geometry',async t=>{
  const h=scopeHarness(t,{playing:false,guides:true});
  try{
    const pending=h.scopes.refresh();assert.equal(h.guide.hidden,true);h.requests[0].resolve(png());await pending;
    assert.equal(h.requests.length,1);assert.equal(h.guide.hidden,false);assert.equal(h.guide.width,800);assert.equal(h.guide.height,180);
    assert.deepEqual(h.guideCalls.filter(call=>call[0]==='rect').map(call=>call.slice(1)),[[40,0,360,180],[400,0,360,180]]);
    assert.ok(h.guideCalls.some(call=>call[0]==='moveTo' && call[1]===520));assert.ok(h.guideCalls.some(call=>call[0]==='moveTo' && call[1]===640));
    assert.equal(h.guideCalls.some(call=>call[0]==='getImageData'),false);
    h.scopes.invalidate();assert.equal(h.guide.hidden,true);assert.equal(h.image.hidden,false);
  }finally{h.scopes.destroy();}
});

test('narrow scopes crop the first native slot uniformly, retain the second preference and resize without another render',async t=>{
  const h=scopeHarness(t,{playing:false,guides:true});
  try{
    h.setWidth(400);h.selects[1].value='Vectorscope';const pending=h.scopes.refresh();h.requests[0].resolve(png());await pending;
    assert.equal(h.stage.dataset.scopeSlots,'1');assert.equal(h.selects[1].parentElement.hidden,true);assert.equal(h.selects[1].value,'Vectorscope');
    assert.equal(h.guide.width,360);assert.equal(h.guide.height,180);assert.deepEqual(h.guideCalls.filter(call=>call[0]==='rect').map(call=>call.slice(1)),[[0,0,360,180]]);
    h.guideCalls.length=0;h.setWidth(800);h.resize();
    assert.equal(h.stage.dataset.scopeSlots,'2');assert.equal(h.selects[1].parentElement.hidden,false);assert.equal(h.selects[1].value,'Vectorscope');assert.equal(h.requests.length,1);
    assert.equal(h.guideCalls.filter(call=>call[0]==='arc').length,1);assert.equal(h.guide.width,800);assert.equal(h.guide.height,180);
  }finally{h.scopes.destroy();}
});
