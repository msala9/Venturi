import test from "node:test";
import assert from "node:assert/strict";
import {slipFrames,slipIdentity,slipWindows,checkedSlipManifest,checkedSlipWindow,boundedProxy,createSlipView} from "../js/slip.js";
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
  handlers.pointerdown(point(180));handlers.pointermove(point(0));assert.equal(view.draft.target,20);handlers.pointermove(point(1000));assert.equal(view.draft.target,-3);assert.equal(commands.length,0);
  await handlers.pointerup(point(1000));assert.deepEqual(commands,[{kind:"slip",clip_ids:["1","2"],delta_frames:-3}]);
  handlers.pointerdown(point(180));handlers.pointermove(point(190));handlers.keydown({key:"Escape"});await handlers.pointerup(point(190));assert.equal(commands.length,1);
  assert.equal(events.filter((e)=>e.phase==="begin").length,2);assert.ok(events.some((e)=>e.phase==="cancel"));input.destroy();delete globalThis.window;
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
const targetValue=()=>({project_epoch:'epoch',if_generation:'1',timeline_id:'1',revision:'revision',frame:0,clip_id:'1'});
function manifestValue(center=0,far=false){
  return {project_epoch:'epoch',generation:'1',revision:'revision',clip_id:'1',clip_ids:['1','2'],media_id:'2',source_version:'fd:identity',total_frames:100000,locked:false,preview_available:true,fps:{num:24,den:1},min_delta:-1000,max_delta:2000,window_start:center-1,window_end:center+1,frames:[-1,0,1].map(offset=>[center+offset,1000+center+offset,(far?90000:1011)+center+offset])};
}
function slipHarness(options={}){
  class Element extends EventTarget{
    constructor(){super();this.hidden=false;this.disabled=false;this.value='0';this.textContent='';this.readyState=options.deferredMedia?0:1;this.currentTime=0;this.currentSrc='';this.seeking=false;this.src='';this.loads=0;}
    get currentTime(){return this.time??0;}set currentTime(value){this.time=value;if(options.deferredSeek && this.src)this.seeking=true;}
    pause(){}load(){this.loads++;if(!this.src){this.currentSrc='';this.readyState=0;this.currentTime=0;this.seeking=false;}else if(!options.deferredMedia && !this.deferMetadata){this.currentSrc=this.src;this.readyState=1;}}
    cloneNode(){const video=new Element();video.deferMetadata=!!options.deferredStage;stageVideos.push(video);return video;}
    replaceWith(video){const index=videos.indexOf(this);assert.ok(index>=0);videos[index]=video;}
    removeAttribute(name){if(name==='src')this.src='';}reportValidity(){return true;}
    fire(name){this.dispatchEvent(new Event(name));}
  }
  const stageVideos=[],videos=[new Element(),new Element()],labels=[new Element(),new Element()],nodes={output:new Element(),input:new Element(),'[data-slip-apply]':new Element(),'[data-slip-refresh]':new Element(),'[data-slip-close]':new Element()};
  const root={hidden:true,parentElement:{dataset:{}},querySelectorAll:selector=>selector==='video'?videos:labels,querySelector:selector=>nodes[selector]};
  let target=targetValue(),jobCount=0;const calls=[],downloads=[],created=[],revoked=[],commits=[],notices=[],timers=new Map();let timerID=0;
  const api=async(path,body)=>{
    calls.push({path,body});if(options.api)return options.api(path,body);
    if(path.includes('/slip/')){const center=Number(path.match(/\/slip\/(-?\d+)\?/)[1]);return options.manifest?options.manifest(center):manifestValue(center,options.far);}
    const m=options.manifest?options.manifest(0):manifestValue(0,options.far);return {id:`job${++jobCount}`,state:'ready',project_epoch:null,source_asset:'source.mp4',source_window:{...body.window,total_frames:m.total_frames,fps:m.fps,source_version:m.source_version,audio_stream_index:0}};
  };
  const control=createSlipView({root,getTarget:()=>target,api,fetcher:async(url,init)=>{downloads.push({url,init});return options.fetcher?options.fetcher(url,init):new Response(new Uint8Array([1,2,3]));},createURL:blob=>{const url=`blob:slip-${created.length}`;created.push({url,blob});return url;},revokeURL:url=>revoked.push(url),setTimer:(callback,ms)=>{const id=++timerID;timers.set(id,{callback,ms});return id;},clearTimer:id=>timers.delete(id),commit:async operation=>{commits.push(operation);return options.commit?.(operation);},notice:message=>notices.push(message)});
  return {control,root,videos,stageVideos,labels,nodes,calls,downloads,created,revoked,commits,notices,timers,setTarget:value=>target=value,fireTimers(ms){for(const [id,timer] of [...timers])if(timer.ms===ms){timers.delete(id);timer.callback();}}};
}

test('far-separated edges beyond 600 seconds get independent bounded local windows prepared sequentially',async()=>{
  const h=slipHarness({far:true});await h.control.open('1');
  const prepares=h.calls.filter(call=>call.body);assert.equal(prepares.length,2);assert.equal(h.downloads.length,2);assert.equal(h.created.length,2);assert.notEqual(h.videos[0].src,h.videos[1].src);
  for(const [index,prepare] of prepares.entries()){
    const range=prepare.body.window;assert.ok(range.end_frame-range.start_frame<=1440);assert.ok(range.start_frame<=[1000,90000][index]);assert.ok(range.end_frame>[1000,90000][index]);assert.equal(h.videos[index].currentTime,([1000,90000][index]-range.start_frame)/24);assert.equal(h.videos[index].hidden,false);
  }
  assert.ok(h.labels[1].textContent.includes('90000'));h.control.destroy();assert.equal(h.revoked.length,2);
});
test('nearby edges share one bounded job and Blob while pointer drafts cause no HTTP',async()=>{
  const h=slipHarness();await h.control.open('1');assert.equal(h.calls.length,2);assert.equal(h.downloads.length,1);assert.equal(h.videos[0].src,h.videos[1].src);
  for(let i=0;i<20;i++)h.control.draft({phase:'draft',delta:i%2?1:-1});assert.equal(h.calls.length,2);assert.equal(h.downloads.length,1);
  const range=h.calls[1].body.window;assert.equal(h.videos[0].currentTime,(1001-range.start_frame)/24);
  h.nodes['[data-slip-apply]'].fire('click');await settle();assert.deepEqual(h.commits,[{kind:'slip',clip_ids:['1','2'],delta_frames:1}]);assert.equal(h.root.hidden,true);assert.equal(h.revoked.length,1);h.control.destroy();assert.equal(h.revoked.length,1);
});
test('second independent window preparation waits for the first bounded download to settle',async()=>{
  const first=deferred();let downloads=0;const h=slipHarness({far:true,fetcher:async()=>++downloads===1?first.promise:new Response(new Uint8Array([1]))});const opening=h.control.open('1');await settle();
  assert.equal(h.calls.filter(call=>call.body).length,1);first.resolve(new Response(new Uint8Array([1])));await opening;assert.equal(h.calls.filter(call=>call.body).length,2);h.control.destroy();
});
test('fractional native FPS and source-end edges use local frame offsets without speed reconstruction',()=>{
  const m=manifestValue();m.fps={num:30000,den:1001};m.total_frames=200000;m.frames=[[ -1,190000,199998],[0,190001,199999],[1,190002,199999]];
  const ranges=slipWindows(m,0);assert.equal(ranges[1].end_frame,200000);assert.equal(ranges[1].end_frame-ranges[1].start_frame,1798);
  assert.equal((199999-ranges[1].start_frame)*m.fps.den/m.fps.num,1797*1001/30000);assert.notEqual(ranges[0],ranges[1]);
});
test('rational-rate preview seeks each edge relative to its own actual source window',async()=>{
  const m=manifestValue(0,true);m.fps={num:24000,den:1001};const h=slipHarness({manifest:()=>m});await h.control.open('1');
  for(const [index,video] of h.videos.entries()){const range=h.calls[index+1].body.window;assert.equal(video.currentTime,(m.frames[1][index+1]-range.start_frame)*1001/24000);assert.equal(video.hidden,false);}
  h.control.destroy();
});
test('descriptor validation refuses stale file version, FPS, total, epoch, asset kind and incomplete or oversized ranges',()=>{
  const m=manifestValue(),range=slipWindows(m,0)[0],job={id:'job',state:'ready',source_asset:'source.mp4',project_epoch:null,source_window:{...range,total_frames:m.total_frames,source_version:m.source_version,fps:m.fps,audio_stream_index:0}};
  assert.deepEqual(checkedSlipWindow(job,m,range,'epoch').fps,m.fps);
  for(const patch of [{source_version:'old-fd'},{total_frames:99999},{fps:{num:25,den:1}},{start_frame:range.start_frame+1},{end_frame:range.end_frame-1},{start_frame:0,end_frame:2000},{audio_stream_index:1}])assert.throws(()=>checkedSlipWindow({...job,source_window:{...job.source_window,...patch}},m,range,'epoch'));
  for(const patch of [{project_epoch:'other'},{source_asset:'still.png'}])assert.throws(()=>checkedSlipWindow({...job,...patch},m,range,'epoch'));
});
test('native map refuses wrong captured context, malformed linked IDs and nonnative frame rows',()=>{
  const m=manifestValue(),target=targetValue();assert.equal(checkedSlipManifest(m,target,0),m);
  for(const patch of [{project_epoch:'other'},{generation:'2'},{revision:'new'},{clip_id:'3'},{timeline_id:'2'},{clip_ids:['2']},{total_frames:0},{window_end:20},{frames:[[-1,999,1010],[0,1.5,1011],[1,1001,1012]]}])assert.throws(()=>checkedSlipManifest({...m,...patch},target,0));
});
test('closing while prepare is pending never downloads, binds or cancels a shared job',async()=>{
  const pending=deferred();const h=slipHarness({api:async(path)=>path.includes('/slip/')?manifestValue():pending.promise});const opening=h.control.open('1');await settle();h.control.reset();pending.resolve({id:'shared',state:'ready',source_asset:'source.mp4'});await opening;
  assert.equal(h.downloads.length,0);assert.deepEqual(h.created,[]);assert.ok(h.videos.every(video=>!video.src && video.hidden));assert.ok(h.calls.every(call=>!call.path.includes('DELETE')));
});
test('stale project or selection after download cannot publish Blob URLs or video edges',async()=>{
  const pending=deferred(),h=slipHarness({fetcher:()=>pending.promise});const opening=h.control.open('1');await settle();h.setTarget({...targetValue(),if_generation:'2'});pending.resolve(new Response(new Uint8Array([1,2,3])));await opening;
  assert.deepEqual(h.created,[]);assert.ok(h.videos.every(video=>!video.src && video.hidden));assert.match(h.nodes.output.textContent,/STALE/);h.control.destroy();
});
test('selection invalidation immediately detaches displayed edges and revokes shared ownership once',async()=>{
  const h=slipHarness();await h.control.open('1');h.setTarget(null);h.control.invalidate();assert.equal(h.root.hidden,true);assert.ok(h.videos.every(video=>!video.src && video.hidden));assert.equal(h.revoked.length,1);h.control.destroy();assert.equal(h.revoked.length,1);
});
test('failure on second independent window releases the first owned Blob and leaves native numeric Apply available',async()=>{
  let count=0;const h=slipHarness({far:true,fetcher:async()=>{if(++count===2)throw Error('Second window disconnected');return new Response(new Uint8Array([1,2,3]));}});await h.control.open('1',1);
  assert.equal(h.created.length,1);assert.deepEqual(h.revoked,[h.created[0].url]);assert.ok(h.videos.every(video=>!video.src && video.hidden));assert.equal(h.nodes['[data-slip-apply]'].disabled,false);h.control.destroy();assert.equal(h.revoked.length,1);
});
test('numeric input remains local and committed change recenters only outside the local/native map',async()=>{
  const h=slipHarness();await h.control.open('1');h.nodes.input.value='1';h.nodes.input.fire('input');h.nodes.input.fire('change');assert.equal(h.calls.length,2);
  h.nodes.input.value='1500';h.nodes.input.fire('input');assert.equal(h.calls.length,2);assert.match(h.nodes.output.textContent,/SEEKING/);h.nodes.input.fire('change');await settle();
  assert.ok(h.calls[2].path.includes('/slip/1500?'));assert.equal(h.calls[3].body.window.start_frame<=2500,true);h.control.destroy();
});
test('late video events preserve invalid numeric text and cannot re-enable or submit the previous delta',async()=>{
  const h=slipHarness();await h.control.open('1');h.nodes.input.value='1';h.nodes.input.fire('input');
  for(const text of ['', ' ', '-', '1.5', '2001']){
    h.nodes.input.value=text;h.nodes.input.fire('input');
    for(const video of h.videos){video.fire('loadedmetadata');video.fire('seeked');}
    h.control.invalidate();assert.equal(h.nodes.input.value,text);assert.equal(h.nodes['[data-slip-apply]'].disabled,true);assert.match(h.nodes.output.textContent,/Choose an integer/);
    h.nodes.input.fire('change');h.nodes['[data-slip-apply]'].fire('click');assert.equal(h.calls.length,2);assert.equal(h.commits.length,0);
  }
  h.nodes.input.value='-1';h.nodes.input.fire('input');h.videos[0].fire('seeked');assert.equal(h.nodes.input.value,'-1');assert.equal(h.nodes['[data-slip-apply]'].disabled,false);
  h.nodes['[data-slip-apply]'].fire('click');await settle();assert.deepEqual(h.commits,[{kind:'slip',clip_ids:['1','2'],delta_frames:-1}]);h.control.destroy();
});
test('a new pointer draft explicitly replaces an incomplete numeric edit and restores its native delta',async()=>{
  const h=slipHarness();await h.control.open('1');h.nodes.input.value='-';h.nodes.input.fire('input');assert.equal(h.nodes['[data-slip-apply]'].disabled,true);
  h.control.draft({phase:'draft',delta:1});assert.equal(h.nodes.input.value,'1');h.videos[1].fire('seeked');assert.equal(h.nodes.input.value,'1');assert.equal(h.nodes['[data-slip-apply]'].disabled,false);assert.equal(h.calls.length,2);
  h.nodes['[data-slip-apply]'].fire('click');await settle();assert.equal(h.commits.length,1);assert.equal(h.commits[0].delta_frames,1);h.control.destroy();
});
test('numeric committed change also recenters an edge outside its proxy but inside the cached native map',async()=>{
  const m=manifestValue();m.window_start=-1000;m.window_end=2000;m.frames=Array.from({length:3001},(_,index)=>{const delta=index-1000;return [delta,1000+delta,1011+delta];});
  const h=slipHarness({manifest:()=>m});await h.control.open('1');h.nodes.input.value='1000';h.nodes.input.fire('input');assert.equal(h.calls.length,2);assert.match(h.nodes.output.textContent,/outside local windows/);
  h.nodes.input.fire('change');await settle();assert.ok(h.calls[2].path.includes('/slip/1000?'));assert.equal(h.calls.length,4);assert.ok(h.videos.every(video=>!video.hidden));h.control.destroy();
});

test('pointer drafts coalesce missing native maps into one latest recenter while holding the displayed edges',async()=>{
  const h=slipHarness();await h.control.open('1');const old=h.videos.map(video=>video.src);
  for(const delta of [1200,1300,1500])h.control.draft({phase:'draft',clip_id:'1',delta});
  assert.equal(h.calls.length,2);assert.equal([...h.timers.values()].filter(timer=>timer.ms===120).length,1);
  assert.deepEqual(h.videos.map(video=>video.src),old);assert.ok(h.videos.every(video=>!video.hidden));assert.match(h.nodes.output.textContent,/SEEKING.*last verified/);
  h.fireTimers(120);await settle();assert.equal(h.calls.length,4);assert.ok(h.calls[2].path.includes('/slip/1500?'));assert.ok(h.videos.every(video=>!video.hidden));
  assert.notDeepEqual(h.videos.map(video=>video.src),old);assert.equal(h.downloads.length,2);assert.deepEqual(h.revoked,[old[0]]);assert.equal(h.commits.length,0);h.control.destroy();
});

test('a pending recenter admits no second foreground preparation and drains only the latest queued draft',async()=>{
  const pending=deferred();let count=0;const h=slipHarness({fetcher:()=>++count===2?pending.promise:Promise.resolve(new Response(new Uint8Array([1])))});
  await h.control.open('1');h.control.draft({phase:'draft',delta:1200});h.fireTimers(120);await settle();
  assert.equal(h.calls.length,4);h.control.draft({phase:'draft',delta:1500});h.fireTimers(120);h.control.draft({phase:'draft',delta:1800});h.fireTimers(120);
  assert.equal(h.calls.length,4);assert.equal(h.created.length,1);assert.ok(h.videos.every(video=>!video.hidden));
  pending.resolve(new Response(new Uint8Array([2])));await settle();
  const centers=h.calls.filter(call=>call.path.includes('/slip/')).map(call=>Number(call.path.match(/\/slip\/(-?\d+)\?/)[1]));
  assert.deepEqual(centers,[0,1200,1800]);assert.equal(h.created.length,2);assert.equal(h.downloads.length,3);assert.ok(h.labels[0].textContent.includes('2800'));h.control.destroy();
});

test('a superseded native job settles before the newest pointer draft is admitted',async()=>{
  let prepared=0,running;
  const h=slipHarness({api:async(path,body)=>{
    if(path.includes('/slip/'))return manifestValue(Number(path.match(/\/slip\/(-?\d+)\?/)[1]));
    if(body){const job={id:`serial-${++prepared}`,state:'ready',source_asset:'source.mp4',source_window:{...body.window,total_frames:100000,fps:{num:24,den:1},source_version:'fd:identity'}};if(prepared===2){running=job;return {...job,state:'running'};}return job;}
    return running;
  }});
  await h.control.open('1');h.control.draft({phase:'draft',delta:1200});h.fireTimers(120);await settle();assert.equal(prepared,2);
  h.control.draft({phase:'draft',delta:1800});h.fireTimers(120);await settle();assert.equal(prepared,2);assert.equal(h.downloads.length,1);
  h.fireTimers(300);await settle();assert.equal(prepared,3);assert.equal(h.downloads.length,2);assert.ok(h.labels[0].textContent.includes('2800'));assert.equal(h.calls.filter(call=>call.path.includes('/jobs/')).length,1);h.control.destroy();
});

test('recentering a native map reuses the existing bounded Blob when its edge frames still fit',async()=>{
  const h=slipHarness();await h.control.open('1');const old=h.videos.map(video=>video.src);
  h.control.draft({phase:'draft',delta:2});assert.equal(h.calls.length,2);h.fireTimers(120);await settle();
  assert.equal(h.calls.length,3);assert.ok(h.calls[2].path.includes('/slip/2?'));assert.equal(h.downloads.length,1);assert.deepEqual(h.videos.map(video=>video.src),old);assert.deepEqual(h.revoked,[]);
  assert.match(h.nodes.output.textContent,/DRAFT.*\+2/);h.control.destroy();
});

test('replacement video seeks are staged until native src and local time verify, retaining the last visible frames',async()=>{
  const h=slipHarness({deferredStage:true});await h.control.open('1');const shown=[...h.videos],old=shown[0].src;
  h.control.draft({phase:'draft',delta:1500});h.fireTimers(120);await settle();assert.equal(h.stageVideos.length,2);assert.deepEqual(h.videos,shown);assert.ok(shown.every(video=>!video.hidden));
  for(const video of h.stageVideos){video.currentSrc=old;video.readyState=1;video.fire('loadedmetadata');video.fire('seeked');}
  assert.deepEqual(h.videos,shown);assert.equal(h.revoked.length,0);
  for(const video of h.stageVideos){video.currentSrc=video.src;video.fire('loadedmetadata');video.fire('seeked');}await settle();
  assert.ok(h.videos.every((video,index)=>video!==shown[index] && !video.hidden));assert.ok(shown.every(video=>!video.src && video.hidden));assert.deepEqual(h.revoked,[old]);h.control.destroy();
});

test('canceling a debounced or staged pointer draft releases all local owners without late publication or shared-job DELETE',async()=>{
  const h=slipHarness({deferredStage:true});await h.control.open('1');h.control.draft({phase:'draft',delta:1200});h.control.draft({phase:'cancel'});h.fireTimers(120);assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);
  await h.control.open('1');h.control.draft({phase:'draft',delta:1500});h.fireTimers(120);await settle();const stages=[...h.stageVideos];assert.equal(stages.length,2);
  h.control.reset();for(const video of stages){video.currentSrc=video.src;video.readyState=1;video.fire('loadedmetadata');video.fire('seeked');}await settle();
  assert.ok(h.videos.every(video=>!video.src && video.hidden));assert.ok(stages.every(video=>!video.src && video.hidden));assert.equal(h.timers.size,0);assert.equal(h.revoked.length,h.created.length);assert.equal(new Set(h.revoked).size,h.revoked.length);assert.ok(h.calls.every(call=>!call.path.includes('DELETE')));h.control.destroy();
});
test('old loadedmetadata and seeked events cannot show a replacement source before matching src/time are ready',async()=>{
  const h=slipHarness({deferredMedia:true,deferredSeek:true});const first=h.control.open('1');await settle();h.control.reset();await first;
  const fresh=h.control.open('1');await settle();assert.equal(h.created.length,2);
  for(const video of h.videos){video.currentSrc=h.created[0].url;video.readyState=1;video.currentTime=0;video.fire('loadedmetadata');video.fire('seeked');assert.equal(video.hidden,true);}
  for(const video of h.videos){video.currentSrc=video.src;video.fire('loadedmetadata');video.fire('seeked');assert.equal(video.hidden,true);video.seeking=false;video.fire('seeked');}await fresh;
  assert.ok(h.videos.every(video=>!video.hidden));assert.equal(h.timers.size,0);h.control.destroy();assert.equal(h.revoked.length,2);assert.ok(h.videos.every(video=>!video.src));
});
test('malformed ready descriptor fails before any proxy download or Blob publication',async()=>{
  const h=slipHarness({api:async(path,body)=>path.includes('/slip/')?manifestValue():{id:'wrong-version',state:'ready',source_asset:'source.mp4',source_window:{...body.window,fps:{num:24,den:1},total_frames:100000,source_version:'another-file'}}});await h.control.open('1');
  assert.equal(h.downloads.length,0);assert.equal(h.created.length,0);assert.match(h.nodes.output.textContent,/changed or is invalid/);h.control.destroy();
});
test('media seek timeout releases every owned URL and detaches both source bindings',async()=>{
  const h=slipHarness({deferredMedia:true,far:true}),opening=h.control.open('1');await settle();assert.equal(h.created.length,2);
  [...h.timers.values()].find(timer=>timer.ms===10000).callback();await opening;assert.equal(h.timers.size,0);assert.equal(h.revoked.length,2);assert.ok(h.videos.every(video=>!video.src && video.hidden));h.control.destroy();assert.equal(h.revoked.length,2);
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
