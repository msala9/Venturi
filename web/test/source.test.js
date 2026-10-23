import test from "node:test";
import assert from "node:assert/strict";
import { createSourcePlayer, sourceAssetURL, sourceSelection, sourceFrameAtTime,sourceMediaPath,sourceMediaQuery } from "../js/source.js";

test("source selection preserves exclusive integer bounds and refuses invalid values before JSON encoding", () => {
  assert.deepEqual(sourceSelection(6,18,48),{source_in:6,source_out:18});
  for (const values of [[-1,18,48],[6,6,48],[6,49,48],[6.5,18,48],[NaN,18,48],[6,Infinity,48]]) assert.throws(()=>sourceSelection(...values));
});

test("Source frame readout and marks retain a requested frame after microsecond clock rounding",()=>{
  for(const fps of [24,25,30,50,60,30000/1001])for(const frame of [1,2,19,147]) {
    assert.equal(sourceFrameAtTime(Math.round(frame/fps*1e6)/1e6,fps),frame);
    assert.equal(sourceFrameAtTime(Math.floor(frame/fps*1e6)/1e6,fps),frame);
  }
  assert.equal(sourceFrameAtTime(.02,30),0);
});

test("still Source uses the original image without playing or stepping a media clock", async () => {
  for (const asset of ["source.png","source.jpg","source.webp"]) {
  let plays = 0;
  const image = { src: "", hidden: true, removeAttribute() { this.src = ""; } };
  const video = { hidden: false, pause() {}, load() {}, removeAttribute() {}, addEventListener() {}, play() { plays++; } };
  const player = createSourcePlayer({ video, image, status: {}, cancel: { addEventListener() {} }, api: async () => ({ id: "still", state: "ready", source_asset: asset }) });
  await player.open({ id: "1", name: "Transparent", is_image: true }, "image:1");
  assert.equal(image.src, sourceAssetURL("1", "still", asset, "image:1"));
  assert.equal(image.hidden, false); assert.equal(video.hidden, true);
  await player.toggle(); player.step(1, 24, 48); assert.equal(plays, 0);
  player.reset(); assert.equal(image.src, ""); assert.equal(image.hidden, true);
  }
});

test("obsolete source preparations cannot select another project's media or autoplay", async () => {
  const pending = [];
  let plays = 0;
  const video = { src: "", paused: true, pause() {}, load() {}, removeAttribute() { this.src = ""; }, addEventListener() {}, play() { plays++; return Promise.resolve(); } };
  const status = { textContent: "" }, cancel = { disabled: false, addEventListener() {} };
  const ready = [];
  const player = createSourcePlayer({ video, status, cancel, onReady: (value) => ready.push(value), api: () => new Promise((resolve) => pending.push(resolve)) });
  const old = player.open({ id: "1", name: "Old" }, "old:1");
  const latest = player.open({ id: "1", name: "New" }, "new:2");
  pending[1]({ state: "ready", id: "new-job" }); await latest;
  pending[0]({ state: "ready", id: "old-job" }); await old;
  assert.equal(video.src, sourceAssetURL("1", "new-job", "source.mp4", "new:2"));
  assert.equal(ready.length, 1);
  assert.equal(plays, 0);
  await player.toggle(); assert.equal(plays, 1);
  video.currentTime = 1.99;
  player.step(1, 24, 48);
  assert.equal(video.currentTime, 47 / 24);
  player.reset(); assert.equal(video.src, "");
  await player.toggle(); assert.equal(plays, 1);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function sourceHarness({asset='source.mp4',api,fetcher,windowed=false}={}){
  let now=0,sequence=0;const timers=new Map(),requests=[],prepared=[],ready=[];
  const setTimer=(callback,delay)=>{assert.ok(delay>0);const id=++sequence;timers.set(id,{callback,delay,at:now+delay});return id;};
  const clearTimer=id=>timers.delete(id);
  class Media extends EventTarget{
    constructor(){super();this.attributes=new Map();this.hidden=false;this.paused=true;this.currentTime=0;this.plays=0;this.pauses=0;this.loads=0;}
    get src(){return this.attributes.get('src') || '';}set src(value){this.attributes.set('src',value);}
    getAttribute(name){return this.attributes.get(name) ?? null;}removeAttribute(name){this.attributes.delete(name);}
    pause(){this.paused=true;this.pauses++;}load(){this.loads++;}async play(){this.paused=false;this.plays++;}
  }
  const video=new Media(),image=new Media(),status={textContent:''},cancel=new EventTarget();cancel.disabled=true;
  const response=(body={id:'job',state:'ready',source_asset:asset},status=200)=>({ok:status>=200 && status<300,status,json:async()=>body});
  const player=createSourcePlayer({video,image,status,cancel,windowed,onReady:value=>ready.push(value),setTimer,clearTimer,api:async(path,body,requestFetch)=>{prepared.push({path,body});return api?api(path,body,requestFetch):{id:'job',state:'ready',source_asset:asset};},fetcher:async(path,options)=>{requests.push({path,options});return fetcher?fetcher(path,options):response();}});
  return {player,video,image,status,cancel,requests,prepared,ready,timers,response,
    open:(item={id:'1',name:'Source'},epoch='epoch:1')=>player.open(item,epoch),
    async advance(milliseconds){now+=milliseconds;const due=[...timers.entries()].filter(([,timer])=>timer.at<=now);for(const [id,timer] of due){if(timers.delete(id))timer.callback();}await settle();},
  };
}

test('paused ready Source pins only its authorized cache job every ten seconds without changing metadata or playback',async()=>{
  const h=sourceHarness();
  try{
    assert.equal(h.timers.size,0);await h.open();const text=h.status.textContent,url=h.video.src,prepared=structuredClone(h.prepared);
    assert.deepEqual(h.prepared[0].body,{project_epoch:'epoch:1',quality:'medium'});assert.equal(h.player.current(),null,'legacy Review players retain their original unwindowed request and clock');
    assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,10_000);assert.equal(h.video.paused,true);
    await h.advance(9999);assert.equal(h.requests.length,0);await h.advance(1);assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].path,'/api/v1/media/1/jobs/job?project_epoch=epoch%3A1');assert.equal(h.requests[0].options.method,undefined);assert.equal(h.requests[0].options.cache,'no-store');assert.equal(h.requests[0].options.signal.aborted,false);
    assert.equal(h.status.textContent,text);assert.equal(h.video.src,url);assert.deepEqual(h.prepared,prepared);assert.equal(h.ready.length,1);assert.equal(h.video.plays,0);
    h.player.pause();await h.advance(10_000);assert.equal(h.requests.length,2);assert.equal(h.timers.size,1);
  }finally{h.player.dispose();}
  assert.equal(h.timers.size,0);
});

test('ready Source heartbeat allows one active request and schedules the next ten seconds after completion',async()=>{
  const pending=[];const h=sourceHarness({fetcher:()=>{const request=deferred();pending.push(request);return request.promise;}});
  try{
    await h.open();await h.advance(10_000);assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
    await h.advance(60_000);assert.equal(h.requests.length,1);pending[0].resolve(h.response());await settle();assert.equal(h.timers.size,1);
    await h.advance(9999);assert.equal(h.requests.length,1);await h.advance(1);assert.equal(h.requests.length,2);
    h.player.reset();assert.equal(h.requests[1].options.signal.aborted,true);pending[1].resolve(h.response());await settle();assert.equal(h.timers.size,0);
  }finally{h.player.dispose();}
});

test('missing, stale, changed or unreachable ready cache pauses and detaches Source with a truthful reopen requirement',async t=>{
  for(const failure of ['404','409','network','state','job','asset','epoch','json'])await t.test(failure,async()=>{
    const h=sourceHarness({fetcher:()=>{
      if(failure==='network')throw Error('Disconnected');
      if(failure==='json')return {ok:true,json:async()=>{throw Error('Invalid JSON');}};
      const body={id:'job',state:'ready',source_asset:'source.mp4'};
      if(failure==='state')body.state='running';if(failure==='job')body.id='different';if(failure==='asset')body.source_asset='source.png';if(failure==='epoch')body.project_epoch='another-project';
      return h.response(body,/^\d/.test(failure)?Number(failure):200);
    }});
    try{
      await h.open();await h.player.toggle();assert.equal(h.video.plays,1);await h.advance(10_000);assert.equal(h.video.src,'');assert.equal(h.video.paused,true);assert.match(h.status.textContent,/reopen Source/);assert.equal(h.timers.size,0);assert.equal(h.cancel.disabled,true);
      await h.player.toggle();const time=h.video.currentTime;h.player.step(1,24,48);assert.equal(h.video.plays,1);assert.equal(h.video.currentTime,time);await h.advance(30_000);assert.equal(h.requests.length,1);assert.ok(h.requests.every(request=>request.options.method!=='DELETE'));
    }finally{h.player.dispose();}
  });
});

test('displayed original stills retain the same heartbeat without acquiring a video clock',async()=>{
  const h=sourceHarness({asset:'source.png'});
  try{
    await h.open({id:'1',name:'Original',is_image:true});const url=h.image.src;assert.equal(h.video.hidden,true);await h.advance(10_000);assert.equal(h.requests.length,1);assert.equal(h.image.src,url);assert.equal(h.image.hidden,false);assert.equal(h.timers.size,1);
    await h.player.toggle();h.player.step(1,24,48);assert.equal(h.video.plays,0);
    h.image.dispatchEvent(new Event('error'));assert.equal(h.image.src,'');assert.match(h.status.textContent,/reopen Source/);assert.equal(h.timers.size,0);
  }finally{h.player.dispose();}
});

test('verified still identity belongs to the loaded current image and disappears on detach or reset',async()=>{
  const h=sourceHarness({asset:'source.png',api:()=>({id:'still',state:'ready',source_asset:'source.png',source_version:'pinned-original'})});
  try{
    await h.open({id:'image',name:'Original',is_image:true});assert.equal(h.player.verifiedSource(),null);
    h.image.complete=true;h.image.naturalWidth=64;h.image.dispatchEvent(new Event('load'));
    assert.deepEqual(h.player.verifiedSource(),{epoch:'epoch:1',media_id:'image',job:'still',source_version:'pinned-original'});assert.equal(h.player.current(),null);
    h.image.src='/unowned-image.png';assert.equal(h.player.verifiedSource(),null);
    h.player.reset();assert.equal(h.player.verifiedSource(),null);assert.equal(h.image.src,'');
  }finally{h.player.dispose();}
});

test('still FD identity cannot change between prepare and polling or in a ready heartbeat',async()=>{
  for(const pending of [false,true]){
    const h=sourceHarness({asset:'source.png',api:()=>({id:'still',state:pending?'queued':'ready',source_asset:'source.png',source_version:'original'}),fetcher:async()=>h.response({id:'still',state:'ready',source_asset:'source.png',source_version:'different'})});
    try{
      const opening=h.open({id:'image',name:'Original',is_image:true});await settle();if(pending){await h.advance(300);await opening;}else{await opening;h.image.complete=true;h.image.naturalWidth=64;assert(h.player.verifiedSource());await h.advance(10_000);}
      assert.equal(h.player.verifiedSource(),null);assert.equal(h.image.src,'');assert.match(h.status.textContent,/Source identity changed.*reopen Source/);assert.equal(h.ready.length,pending?0:1);assert.ok(h.requests.every(value=>value.options.method!=='DELETE'));
    }finally{h.player.dispose();}
  }
});

test('late old still ACKs cannot expose an identity after a newer image, reset or cancellation',async()=>{
  for(const end of [null,'reset','cancel']){
    const old=deferred();let count=0;const h=sourceHarness({asset:'source.png',api:()=>++count===1?old.promise:{id:'new',state:'ready',source_asset:'source.png',source_version:'new-file'}});
    try{
      const opening=h.open({id:'old',name:'Old',is_image:true});await h.open({id:'new',name:'New',is_image:true},'epoch:2');h.image.complete=true;h.image.naturalWidth=64;
      const expected={epoch:'epoch:2',media_id:'new',job:'new',source_version:'new-file'};assert.deepEqual(h.player.verifiedSource(),expected);
      if(end==='reset')h.player.reset();if(end==='cancel')h.cancel.dispatchEvent(new Event('click'));old.resolve({id:'old',state:'ready',source_asset:'source.png',source_version:'old-file'});await opening;
      h.image.dispatchEvent(new Event('load'));assert.deepEqual(h.player.verifiedSource(),end?null:expected);assert.equal(h.ready.length,1);
    }finally{h.player.dispose();}
  }
});

test('old heartbeat fetch and JSON completions cannot clear a newer epoch, job or source URL',async t=>{
  for(const stage of ['fetch','json'])await t.test(stage,async()=>{
    const pending=deferred();let count=0;const h=sourceHarness({api:()=>({id:++count===1?'old-job':'new-job',state:'ready',source_asset:'source.mp4'}),fetcher:()=>stage==='fetch'?pending.promise:{ok:true,json:()=>pending.promise}});
    try{
      await h.open({id:'1',name:'Old'},'old:1');await h.advance(10_000);const oldSignal=h.requests[0].options.signal;
      await h.open({id:'2',name:'New'},'new:2');const url=h.video.src,text=h.status.textContent;assert.equal(oldSignal.aborted,true);
      pending.resolve(stage==='fetch'?h.response({id:'wrong',state:'failed'},404):{id:'wrong',state:'failed',source_asset:'source.png'});await settle();
      assert.equal(h.video.src,url);assert.equal(url,sourceAssetURL('2','new-job','source.mp4','new:2'));assert.equal(h.status.textContent,text);assert.equal(h.timers.size,1);assert.equal(h.ready.length,2);assert.ok(h.requests.every(request=>request.options.method!=='DELETE'));
    }finally{h.player.dispose();}
  });
});

test('a heartbeat bound to an old asset URL cannot detach or control a replacement attachment',async()=>{
  const pending=deferred(),h=sourceHarness({fetcher:()=>pending.promise});
  try{
    await h.open();await h.advance(10_000);h.video.src='/replacement.mp4';const text=h.status.textContent;pending.resolve(h.response({},404));await settle();
    assert.equal(h.video.src,'/replacement.mp4');assert.equal(h.status.textContent,text);assert.equal(h.timers.size,0);await h.player.toggle();assert.equal(h.video.plays,0);
  }finally{h.player.dispose();}
});

test('stale prepare ACKs only detach locally because pending and ready jobs may be shared',async()=>{
  const pending=[];const h=sourceHarness({api:()=>{const request=deferred();pending.push(request);return request.promise;}});
  try{
    const old=h.open({id:'1',name:'Old'},'old:1');assert.equal(h.timers.size,0);const latest=h.open({id:'2',name:'New'},'new:2');assert.equal(h.timers.size,0);
    pending[1].resolve({id:'new-job',state:'ready',source_asset:'source.mp4'});await latest;
    pending[0].resolve({id:'shared-pending',state:'queued',source_asset:'source.mp4'});await old;assert.equal(h.requests.length,0);assert.equal(h.ready.length,1);assert.equal(h.timers.size,1);
    const obsolete=h.open({id:'3',name:'Obsolete'},'old:3');h.player.reset();pending[2].resolve({id:'shared-ready',state:'ready',source_asset:'source.mp4'});await obsolete;assert.equal(h.requests.length,0);assert.equal(h.video.src,'');assert.equal(h.timers.size,0);
  }finally{h.player.dispose();}
});

test('preparation has no ready heartbeat; explicit Cancel alone uses the legacy pending-job DELETE',async()=>{
  const h=sourceHarness({api:()=>({id:'pending-job',state:'queued',source_asset:'source.mp4',frames:0})});
  try{
    const opening=h.open();await settle();assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,300);assert.equal(h.requests.length,0);
    h.cancel.dispatchEvent(new Event('click'));await opening;await settle();assert.equal(h.timers.size,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.method,'DELETE');assert.match(h.requests[0].path,/pending-job/);assert.equal(h.status.textContent,'Source preparation canceled');
    const count=h.requests.length;h.player.reset();await h.advance(30_000);assert.equal(h.requests.length,count);
  }finally{h.player.dispose();}
});

test('an obsolete preparation delay cannot resume against the new Source job path',async()=>{
  let prepares=0;const h=sourceHarness({api:()=>({id:++prepares===1?'old-pending':'new-ready',state:prepares===1?'queued':'ready',source_asset:'source.mp4',frames:0})});
  try{
    const old=h.open({id:'1',name:'Old'},'old:1');await settle();const [id,timer]=[...h.timers.entries()][0];assert.equal(timer.delay,300);
    h.timers.delete(id);timer.callback();const latest=h.open({id:'2',name:'New'},'new:2');await old;await latest;
    assert.equal(h.requests.length,0);assert.equal(h.video.src,sourceAssetURL('2','new-ready','source.mp4','new:2'));assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,10_000);
  }finally{h.player.dispose();}
});

test('decode failure, reset and disposal abort the active heartbeat and ignore its late completion',async t=>{
  for(const action of ['error','reset','dispose'])await t.test(action,async()=>{
    const pending=deferred(),h=sourceHarness({fetcher:()=>pending.promise});
    try{
      await h.open();await h.advance(10_000);if(action==='error')h.video.dispatchEvent(new Event('error'));else h.player[action]();
      const text=h.status.textContent;assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.video.src,'');assert.equal(h.timers.size,0);
      pending.resolve(h.response());await settle();assert.equal(h.status.textContent,text);assert.equal(h.timers.size,0);await h.player.toggle();assert.equal(h.video.plays,0);
      if(action==='dispose'){await h.open();h.cancel.dispatchEvent(new Event('click'));assert.equal(h.prepared.length,1);assert.equal(h.requests.length,1);}
    }finally{h.player.dispose();}
  });
});

function windowHarness({fps={num:30_000,den:1001},total=10_000,api,fetcher,beforeWindowChange,isInternalSeek,isInternalPause,canPrefetch,onPrefetch}={}){
  class Video extends EventTarget{
    url='';position=0;paused=true;ended=false;readyState=1;seeking=false;plays=0;error=null;waitMetadata=false;waitSeek=false;fastPause=false;deferPauses=false;pauseEvents=[];clampTime=Infinity;
    get src(){return this.url;}set src(value){this.url=value;this.ended=false;this.position=0;this.readyState=this.waitMetadata?0:1;}
    get currentTime(){return this.position;}set currentTime(value){this.position=Math.min(value,this.clampTime);this.seeking=this.waitSeek;this.dispatchEvent(new Event('seeking'));}
    userSeek(value){this.position=value;this.ended=false;this.seeking=true;this.dispatchEvent(new Event('seeking'));}
    getAttribute(){return this.url;}removeAttribute(){this.url='';this.ended=false;}load(){}
    pause(){const wasPlaying=!this.paused;this.paused=true;if(!wasPlaying)return;const fire=()=>this.dispatchEvent(new Event('pause'));if(this.deferPauses)this.pauseEvents.push(fire);else fire();}
    async play(){this.paused=false;this.ended=false;this.plays++;this.dispatchEvent(new Event('play'));if(this.fastPause)this.pause();}
  }
  const video=new Video(),status={textContent:''},requests=[],fetches=[],notifications=[],timers=new Map();let timerID=0;
  const item={id:'m',name:'Long source',duration_frames:total,fps},version='1:2:300:4:5';
  const ready=(body,id=`job${requests.length}`)=>({id,state:'ready',source_asset:'source.mp4',project_epoch:body.project_epoch,source_window:{...body.window,total_frames:total,fps:{...fps},source_version:version}});
  const player=createSourcePlayer({video,status,windowed:true,cancel:new EventTarget(),beforeWindowChange,isInternalSeek,isInternalPause,canPrefetch,onPrefetch,onReady:value=>notifications.push(value),setTimer:(callback,delay)=>{const id=++timerID;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id),api:async(path,body)=>{requests.push(body);return api?api(body,ready):ready(body);},fetcher:async(path,options)=>{fetches.push({path,options});if(fetcher)return fetcher(path,options);return Response.json({...ready({project_epoch:'epoch',window:notifications.at(-1)?.source_window}),id:notifications.at(-1)?.job});}});
  const finish=()=>{const c=player.current(),range=notifications.at(-1).source_window;video.position=(range.end_frame-range.start_frame)*fps.den/fps.num;video.ended=true;video.pause();video.dispatchEvent(new Event('ended'));return c;};
  return {player,video,status,item,version,requests,fetches,notifications,timers,ready,finish,open:(start=0)=>player.open(item,'epoch','medium',start)};
}

const libraryItem=(version='pinned-library-source')=>({id:'native-asset:asset-a:revision:7',name:'Library raw file',is_image:true,native_asset:{id:'asset-a',revision:'a'.repeat(64),if_generation:'7',source_version:version}});

test('Library Source URLs keep their read-only catalog generation and FD identity out of project-media routes',()=>{
  const item=libraryItem(),query={project_epoch:'epoch',if_generation:'7',revision:'a'.repeat(64),source_version:'pinned-library-source'};
  assert.equal(sourceMediaPath(item,'/prepare',{absolute:false}),'/native-assets/items/asset-a/source/prepare');
  assert.equal(sourceMediaPath(item,'/audio/window'),'/api/v1/native-assets/items/asset-a/source/audio/window');
  assert.equal(sourceMediaPath(item,'/audio.wav'),'/api/v1/native-assets/items/asset-a/source/audio.wav');
  assert.deepEqual(sourceMediaQuery(item,'epoch'),query);
  assert.equal(sourceAssetURL(item,'ready','source.png','epoch'),`/api/v1/native-assets/items/asset-a/source/jobs/ready/source.png?${new URLSearchParams(query)}`);
  assert.equal(sourceMediaPath('10','/prepare',{absolute:false}),'/media/10/prepare');
  assert.deepEqual(sourceMediaQuery({id:'10'},'epoch'),{project_epoch:'epoch'});
  for(const patch of [{id:'../outside'},{revision:'unknown'},{if_generation:'7.5'},{source_version:''}])assert.throws(()=>sourceMediaPath({...item,native_asset:{...item.native_asset,...patch}}));
});

test('opening a Library still uses ordinary Source preparation and heartbeat without project import or native library edits',async()=>{
  const item=libraryItem(),h=sourceHarness({asset:'source.png',api:()=>({id:'library-still',state:'ready',source_asset:'source.png',source_version:item.native_asset.source_version}),fetcher:()=>h.response({id:'library-still',state:'ready',source_asset:'source.png',source_version:item.native_asset.source_version})});
  try{
    await h.open(item,'epoch');
    assert.deepEqual(h.prepared,[{path:'/native-assets/items/asset-a/source/prepare',body:{...sourceMediaQuery(item,'epoch'),quality:'medium'}}]);
    assert.equal(h.image.src,sourceAssetURL(item,'library-still','source.png','epoch'));
    h.image.complete=true;h.image.naturalWidth=16;
    assert.deepEqual(h.player.verifiedSource(),{epoch:'epoch',media_id:item.id,job:'library-still',source_version:item.native_asset.source_version});
    await h.advance(10_000);
    assert.equal(h.requests[0].path,`${sourceMediaPath(item,'/jobs/library-still')}?${new URLSearchParams(sourceMediaQuery(item,'epoch'))}`);
    assert.equal(h.prepared.length,1);assert.equal(h.video.plays,0);
  }finally{h.player.dispose();}
});

test('Library Source windows retain raw-file authority across seek and EOF while stale preparation cannot attach another asset',async()=>{
  const h=windowHarness({fps:{num:24,den:1},total:1450});h.item.native_asset=libraryItem(h.version).native_asset;
  try{
    await h.open();assert.deepEqual(h.requests[0],{...sourceMediaQuery(h.item,'epoch'),quality:'medium',window:{start_frame:0,end_frame:1440}});
    assert.ok(h.video.src.startsWith('/api/v1/native-assets/items/asset-a/source/jobs/'));
    await h.player.toggle();h.finish();await settle();
    assert.equal(h.player.current().frame,1440);assert.equal(h.requests.length,2);assert.deepEqual(h.requests[1],{...sourceMediaQuery(h.item,'epoch'),quality:'medium',window:{start_frame:1440,end_frame:1450}});
    await h.player.seekFrame(17);assert.equal(h.player.current().frame,17);assert.equal(h.requests[2].source_version,h.version);
  }finally{h.player.dispose();}
  const ack=deferred(),old=libraryItem(),next=libraryItem('new-file'),still=sourceHarness({asset:'source.png',api:(_path,body)=>body.source_version===old.native_asset.source_version?ack.promise:{id:'new',state:'ready',source_asset:'source.png',source_version:'new-file'}});
  try{
    const pending=still.open(old,'epoch');await still.open(next,'epoch');
    const url=still.image.src;ack.resolve({id:'old',state:'ready',source_asset:'source.png',source_version:old.native_asset.source_version});await pending;
    assert.equal(still.image.src,url);assert.equal(still.ready.length,1);assert.ok(!url.includes('/old/'));
  }finally{still.player.dispose();}
});

test('windowed Source opens paused at an absolute fractional-fps origin and seeks/steps across exclusive boundaries',async()=>{
  const h=windowHarness();try{
    assert.equal(h.player.current(),null);await h.open(137);const span=Math.floor(60*30_000/1001);
    assert.deepEqual(h.requests[0],{project_epoch:'epoch',quality:'medium',window:{start_frame:137,end_frame:137+span}});
    assert.deepEqual(h.player.current(),{epoch:'epoch',media_id:'m',job:'job1',fps:h.item.fps,start_frame:137,end_frame:137+span,frame:137,source_version:h.version,audio_mode:'selected',audio_stream_index:0});assert.equal(h.video.plays,0);
    await h.player.seekFrame(147);assert.equal(h.requests.length,1);assert.equal(h.player.current().frame,147);assert.equal(h.video.currentTime,10*1001/30_000);
    await h.player.seekFrame(137+span-1);await h.player.step(1,1,1);assert.equal(h.requests.length,2);assert.equal(h.player.current().frame,137+span);assert.equal(h.video.currentTime,0);assert.equal(h.video.paused,true);
    await assert.rejects(h.player.seekFrame(10_000));await assert.rejects(h.player.seekFrame(-1));assert.equal(h.requests.length,2);
    await h.player.seekFrame(9999);assert.equal(h.requests.at(-1).window.end_frame,10_000);await h.player.step(1);assert.equal(h.player.current().frame,9999);assert.equal(h.requests.length,3);
    assert.equal(h.notifications[0].source_window.source_version,h.version);
  }finally{h.player.dispose();}
});

test('Source EOF continues three bounded foreground windows with a final short tail and no prefetch',async()=>{
  const span=Math.floor(60*30_000/1001),h=windowHarness({total:2*span+17});try{
    await h.open();assert.equal(h.requests.length,1);await h.player.toggle();
    for(const start of [span,2*span]){
      h.finish();assert.match(h.status.textContent,/Paused.*next/);h.video.dispatchEvent(new Event('ended'));await settle();
      assert.equal(h.player.current().frame,start);assert.equal(h.requests.at(-1).window.start_frame,start);assert.equal(h.video.paused,false);
      h.video.dispatchEvent(new Event('ended'));await settle();assert.equal(h.requests.length,start===span?2:3);
    }
    h.finish();await settle();assert.equal(h.requests.length,3);assert.equal(h.player.current().frame,2*span+16);assert.match(h.status.textContent,/End of Source/);
    h.video.dispatchEvent(new Event('ended'));await settle();assert.equal(h.requests.length,3);
  }finally{h.player.dispose();}
});

test('Play at full Source EOF rewinds to absolute frame zero instead of replaying the last local window',async()=>{
  const h=windowHarness({fps:{num:24,den:1},total:1450});try{
    await h.open(1440);await h.player.toggle();h.finish();await settle();assert.equal(h.player.current().frame,1449);assert.match(h.status.textContent,/End of Source/);
    await h.player.toggle();assert.equal(h.player.current().frame,0);assert.equal(h.player.current().start_frame,0);assert.equal(h.requests.at(-1).window.start_frame,0);assert.equal(h.player.current().source_version,h.version);assert.equal(h.video.plays,2);assert.equal(h.video.paused,false);
  }finally{h.player.dispose();}
});

test('a canceled or superseded full-Source rewind cannot autoplay a late first-window acknowledgment',async()=>{
  for(const action of ['pause','reset','replace']){
    const ack=deferred();let count=0;const h=windowHarness({fps:{num:24,den:1},total:1450,api:(body,ready)=>++count===2?ack.promise:ready(body)});try{
      await h.open(1449);const replay=h.player.toggle();await settle();assert.equal(h.requests[1].window.start_frame,0);
      if(action==='pause')h.player.pause();else if(action==='reset')h.player.reset();else await h.open(100);
      ack.resolve(h.ready(h.requests[1],'late-rewind'));await replay;assert.equal(h.video.plays,0);assert.equal(h.video.paused,true);assert.ok(!h.video.src.includes('late-rewind'));
    }finally{h.player.dispose();}
  }
});

test('Source keeps the old absolute clock through fast-tail drain then waits for metadata and verified seek',async()=>{
  const tail=deferred(),h=windowHarness({beforeWindowChange:()=>tail.promise});try{
    await h.open(137);await h.player.toggle();const url=h.video.src,old=h.player.current();h.video.waitMetadata=true;h.video.waitSeek=true;h.finish();await settle();
    assert.equal(h.video.src,url);assert.equal(h.player.current().end_frame,old.end_frame);
    tail.resolve();await settle();assert.notEqual(h.video.src,url);assert.equal(h.player.current(),null);assert.equal(h.video.plays,1);
    h.video.dispatchEvent(new Event('error'));assert.notEqual(h.video.src,'','queued old MediaError-null event cannot reject the new metadata wait');
    h.video.readyState=1;h.video.dispatchEvent(new Event('loadedmetadata'));await settle();assert.equal(h.player.current(),null);assert.equal(h.video.plays,1);
    h.video.seeking=false;h.video.dispatchEvent(new Event('seeked'));await settle();assert.equal(h.player.current().frame,old.end_frame);assert.equal(h.video.plays,2);
  }finally{h.player.dispose();}
});

test('windowed Source rejects malformed or changed authoritative metadata instead of deriving a proxy origin',async t=>{
  for(const key of ['missing','start','end','total','fps','version','long'])await t.test(key,async()=>{
    const h=windowHarness({api:(body,ready)=>{const job=ready(body),w=job.source_window;if(key==='missing')delete job.source_window;if(key==='start')w.start_frame++;if(key==='end')w.end_frame--;if(key==='total')w.total_frames++;if(key==='fps')w.fps.den=0;if(key==='version')w.source_version='';if(key==='long')w.end_frame+=100;return job;}});
    try{await h.open(137);assert.equal(h.player.current(),null);assert.equal(h.video.src,'');assert.equal(h.video.plays,0);assert.match(h.status.textContent,/invalid|changed/);}finally{h.player.dispose();}
  });
  let count=0;const h=windowHarness({api:(body,ready)=>{const job=ready(body);if(++count>1)job.source_window.source_version='different';return job;}});
  try{await h.open();await h.player.toggle();h.finish();await settle();assert.equal(h.player.current(),null);assert.equal(h.video.plays,1);assert.match(h.status.textContent,/changed/);}finally{h.player.dispose();}
});

test('pause, native seek, reset and replacement open invalidate Source continuation ACKs without DELETE',async t=>{
  for(const action of ['pause','native-pause','seek','reset','replace'])await t.test(action,async()=>{
    const ack=deferred();let count=0;const h=windowHarness({api:(body,ready)=>++count===2?ack.promise:ready(body)});
    try{
      await h.open();await h.player.toggle();h.finish();await settle();const pending=h.requests[1];
      if(action==='pause')h.player.pause();if(action==='native-pause'){h.video.ended=false;h.video.dispatchEvent(new Event('pause'));}if(action==='seek')h.video.userSeek(1);if(action==='reset')h.player.reset();if(action==='replace')await h.player.open({...h.item,id:'other'},'new-epoch');
      const src=h.video.src;ack.resolve(h.ready(pending,'obsolete-shared'));await settle();assert.equal(h.video.src,src);assert.equal(h.video.plays,1);assert.ok(h.fetches.every(call=>call.options.method!=='DELETE'));
      if(action==='pause' || action==='native-pause' || action==='seek'){assert.match(h.status.textContent,/press Play/);await h.player.toggle();assert.equal(h.video.plays,2,'one user Play retries canceled preparation');}
    }finally{h.player.dispose();}
  });
});

test('Source window heartbeat verifies exact range/version and obsolete heartbeat cannot detach a later window',async()=>{
  const response=deferred(),h=windowHarness({fetcher:()=>response.promise});try{
    await h.open();const timer=[...h.timers.entries()].find(([,v])=>v.delay===10_000);h.timers.delete(timer[0]);timer[1].callback();await settle();
    await h.player.seekFrame(3000);const url=h.video.src;response.resolve(Response.json({id:'wrong',state:'failed'}));await settle();assert.equal(h.video.src,url);assert.equal(h.player.current().frame,3000);assert.equal(h.timers.size,1);
  }finally{h.player.dispose();}
  const changed=windowHarness({fetcher:()=>Response.json({id:'job1',state:'ready',source_asset:'source.mp4',source_window:{start_frame:0,end_frame:1798,total_frames:10_000,fps:{num:30_000,den:1001},source_version:'changed'}})});
  try{await changed.open();const timer=[...changed.timers.entries()][0];changed.timers.delete(timer[0]);timer[1].callback();await settle();assert.equal(changed.player.current(),null);assert.match(changed.status.textContent,/changed/);}finally{changed.player.dispose();}
});

test('Source fast startup pauses and internal seek corrections retain intent; user seeks and pauses revoke it',async()=>{
  let correcting=false;const h=windowHarness({isInternalSeek:()=>correcting,beforeWindowChange:()=>h.video.pause()});try{
    await h.open();h.video.fastPause=true;await h.player.toggle();correcting=true;h.video.userSeek(1);assert.equal(h.player.current().frame,29);h.video.seeking=false;correcting=false;h.finish();await settle();assert.equal(h.requests.length,2);assert.equal(h.video.plays,2);
  }finally{h.player.dispose();}
  for(const action of ['pause','seek']){
    const f=windowHarness();try{await f.open();await f.player.toggle();if(action==='pause')f.video.pause();else{f.video.userSeek(1);f.video.seeking=false;f.video.dispatchEvent(new Event('seeked'));}f.finish();await settle();assert.equal(f.requests.length,1);}finally{f.player.dispose();}
  }
});

test('a delayed own pause from replacing a playing Source cannot cancel the next metadata wait',async()=>{
  const h=windowHarness();try{
    await h.open();await h.player.toggle();h.video.deferPauses=true;h.video.waitMetadata=true;
    const next=h.player.open({...h.item,id:'replacement'},'next-epoch','high',137);await settle();assert.equal(h.player.preparing(),true);assert.equal(h.player.current(),null);
    assert.equal(h.video.pauseEvents.length,1);h.video.pauseEvents.shift()();assert.equal(h.player.preparing(),true);
    h.video.readyState=1;h.video.dispatchEvent(new Event('loadedmetadata'));await next;assert.equal(h.player.current().epoch,'next-epoch');assert.equal(h.player.current().frame,137);assert.equal(h.video.plays,1);
  }finally{h.player.dispose();}
});

test('native pause or seek during Source metadata/seek preparation cancels truthfully and one Play retries',async t=>{
  for(const phase of ['metadata','seek'])for(const action of ['pause','seek'])await t.test(`${phase}-${action}`,async()=>{
    const h=windowHarness();try{
      h.video.waitMetadata=phase==='metadata';h.video.waitSeek=phase==='seek';const opening=h.open();await settle();assert.equal(h.player.preparing(),true);
      if(action==='pause')h.video.dispatchEvent(new Event('pause'));else h.video.userSeek(1);
      await opening;assert.equal(h.player.preparing(),false);assert.equal(h.player.current(),null);assert.match(h.status.textContent,/press Play/);
      h.video.readyState=1;h.video.seeking=false;h.video.dispatchEvent(new Event('loadedmetadata'));h.video.dispatchEvent(new Event('seeked'));await settle();assert.equal(h.video.plays,0);
      h.video.waitMetadata=false;h.video.waitSeek=false;await h.player.toggle();assert.equal(h.video.plays,1);assert.equal(h.player.current().frame,0);
    }finally{h.player.dispose();}
  });
});

test('windowed main Source still opens original images through the unchanged legacy payload and has no range clock',async()=>{
  const h=sourceHarness({asset:'source.png',windowed:true});try{
    await h.open({id:'1',name:'Original',is_image:true});assert.deepEqual(h.prepared[0].body,{project_epoch:'epoch:1',quality:'medium'});
    assert.equal(h.player.current(),null);await h.player.toggle();h.player.step(1,24,48);assert.equal(h.video.plays,0);assert.equal(h.image.hidden,false);
  }finally{h.player.dispose();}
});

test('a queued fast-transport-owned pause retains Source intent after the play microtask has completed',async()=>{
  let owned=false;const h=windowHarness({isInternalPause:()=>owned});try{
    await h.open();await h.player.toggle();h.video.deferPauses=true;owned=true;h.video.pause();await settle();
    h.video.pauseEvents.shift()();owned=false;h.finish();await settle();assert.equal(h.requests.length,2);assert.equal(h.video.plays,2);
  }finally{h.player.dispose();}
});

test('Source refuses a browser-clamped seek rather than publishing a verified wrong absolute frame',async()=>{
  const h=windowHarness({total:1000,api:(body,ready)=>{const job=ready(body);job.source_window.start_frame=0;return job;}});try{
    h.video.clampTime=0;await h.open(137);assert.equal(h.player.current(),null);assert.match(h.status.textContent,/requested absolute frame/);assert.equal(h.video.plays,0);
    h.video.clampTime=Infinity;await h.open();h.video.clampTime=0;await h.player.seekFrame(37);assert.equal(h.player.current(),null);assert.match(h.status.textContent,/requested absolute frame/);
  }finally{h.player.dispose();}
});


test('AAC container padding at Source EOF retains the final native frame and continues at its exclusive boundary',async()=>{
  const h=windowHarness({fps:{num:120,den:1}});try{
    await h.open(137);await h.player.toggle();const first=h.player.current();
    h.video.position=(first.end_frame-first.start_frame)/120+0.02;h.video.ended=true;h.video.pause();
    assert.equal(h.player.current().frame,first.end_frame-1);
    h.video.dispatchEvent(new Event('ended'));await settle();
    assert.equal(h.requests.length,2);assert.equal(h.player.current().frame,first.end_frame);assert.equal(h.video.plays,2);
    h.video.position=(h.player.current().end_frame-h.player.current().start_frame)/120+0.02;h.video.ended=true;h.video.pause();
    assert.equal(h.player.current().frame,h.item.duration_frames-1);
    h.video.dispatchEvent(new Event('ended'));await settle();assert.equal(h.requests.length,2);assert.match(h.status.textContent,/End of Source/);
  }finally{h.player.dispose();}
});

function lookaheadHarness({api,fetcher,total=3000,beforeWindowChange}={}){
  const jobs=new Map(),announcements=[];let allowed=true;
  const h=windowHarness({fps:{num:24,den:1},total,beforeWindowChange,canPrefetch:()=>allowed,onPrefetch:value=>announcements.push(value),
    api:(body,ready)=>{const job=ready(body);jobs.set(job.id,job);return api?api(body,job,jobs):job;},
    fetcher:(path,options)=>fetcher?fetcher(path,options,jobs):Response.json(jobs.get(/\/jobs\/([^?]+)/.exec(path)[1])),
  });
  return {...h,jobs,announcements,setAllowed(value){allowed=value;h.player.invalidatePrefetch();},
    async tick(delay){const entry=[...h.timers].find(([,timer])=>timer.delay===delay);assert.ok(entry,`missing ${delay}ms timer`);h.timers.delete(entry[0]);entry[1].callback();await settle();},
  };
}

test('Source prepares only one adjacent window while current video, absolute clock and placement identity stay attached',async()=>{
  const h=lookaheadHarness();try{
    await h.open(137);assert.equal(h.requests.length,1);const source=h.video.src,identity=h.player.verifiedSource(),position=h.player.current();
    await h.player.toggle();await settle();assert.equal(h.requests.length,2);assert.equal(h.player.prefetchState().state,'ready');
    assert.deepEqual(h.requests[1],{project_epoch:'epoch',quality:'medium',window:{start_frame:1577,end_frame:3000}});
    assert.equal(h.video.src,source);assert.deepEqual(h.player.verifiedSource(),identity);assert.deepEqual(h.player.current(),position);assert.equal(h.video.paused,false);assert.equal(h.player.preparing(),false);assert.equal(h.notifications.length,1);
    for(let n=0;n<10;n++)h.video.dispatchEvent(new Event('timeupdate'));await settle();assert.equal(h.requests.length,2);
    h.finish();h.video.dispatchEvent(new Event('ended'));await settle();
    assert.equal(h.requests.length,2,'promotion reuses the prepared job');assert.equal(h.player.current().frame,1577);assert.equal(h.player.current().job,'job2');assert.equal(h.video.plays,2);assert.equal(h.player.prefetchState().state,'idle');
    h.finish();await settle();assert.match(h.status.textContent,/End of Source/);assert.equal(h.requests.length,2);
  }finally{h.player.dispose();}assert.equal(h.timers.size,0);
});

test('pending Source lookahead promotes its existing observer, waits honestly at EOF and starts no duplicate job',async()=>{
  const h=lookaheadHarness({api:(body,job)=>{if(body.window.start_frame>0)job.state='queued';return job;}});try{
    await h.open();await h.player.toggle();await settle();assert.equal(h.player.prefetchState().state,'queued');const source=h.video.src;
    h.finish();await settle();assert.match(h.status.textContent,/Paused.*next/);assert.equal(h.video.src,source);assert.equal(h.video.paused,true);assert.equal(h.player.preparing(),true);assert.equal(h.requests.length,2);
    h.jobs.get('job2').state='ready';await h.tick(1_000);await settle();assert.equal(h.player.current().frame,1440);assert.equal(h.video.plays,2);assert.equal(h.requests.length,3,'only the next adjacent tail is now prepared');
  }finally{h.player.dispose();}
});

test('Source lookahead preserves explicit selected or all stream identity across final verification and promotion',async()=>{
  for(const mode of ['selected','all']){
    const h=lookaheadHarness({total:2880,api:(body,job)=>{job.source_window.audio_mode=body.audio_mode;job.source_window.audio_stream_index=body.audio_mode==='all'?null:body.audio_stream_index;return job;}});
    h.item.has_audio=true;h.item.audio_stream_count=2;try{
      await h.player.open(h.item,'epoch','high',0,mode==='all'?{audioMode:'all'}:{audioMode:'selected',audioStreamIndex:1});
      await h.player.toggle();await settle();assert.equal(h.requests[1].audio_mode,mode);assert.equal(h.requests[1].quality,'high');if(mode==='selected')assert.equal(h.requests[1].audio_stream_index,1);
      h.finish();await settle();assert.equal(h.player.current().audio_mode,mode);assert.equal(h.player.current().audio_stream_index,mode==='all'?null:1);assert.equal(h.player.current().source_version,h.version);assert.equal(h.requests.length,2);
    }finally{h.player.dispose();}
  }
});

test('Source ready lookahead keeps its TTL alive and rechecks exact native identity immediately before attachment',async()=>{
  for(const change of ['version','audio','job','range','state','missing']){
    const h=lookaheadHarness({total:2880});try{
      await h.open();await h.player.toggle();await settle();const source=h.video.src;
      await h.tick(10_000);await h.tick(10_000);assert.equal(h.player.prefetchState().state,'ready');assert.equal(h.video.src,source);
      const job=h.jobs.get('job2');if(change==='version')job.source_window.source_version='replaced';if(change==='audio')job.source_window.audio_stream_index=1;if(change==='job')job.id='different';if(change==='range')job.source_window.start_frame--;if(change==='state')job.state='failed';if(change==='missing')h.jobs.delete('job2');
      h.finish();await settle();assert.equal(h.video.paused,true);assert.equal(h.video.plays,1);assert.match(h.status.textContent,/reopen Source|press Play/);assert.equal(h.player.current(),null);assert.equal(h.requests.length,2);
    }finally{h.player.dispose();}
  }
});

test('failed speculative Source work leaves the current movie playing without retries; failure at EOF requires one manual Play',async()=>{
  const h=lookaheadHarness({total:2880,api:(body,job)=>{if(body.window.start_frame>0 && job.id==='job2')throw Error('CACHE_FULL');return job;}});try{
    await h.open();await h.player.toggle();await settle();assert.equal(h.player.prefetchState().state,'failed');assert.equal(h.video.paused,false);assert.equal(h.player.current().frame,0);
    for(let n=0;n<10;n++)h.video.dispatchEvent(new Event('timeupdate'));assert.equal(h.requests.length,2);
    h.finish();await settle();assert.equal(h.video.paused,true);assert.match(h.status.textContent,/CACHE_FULL/);assert.equal(h.video.plays,1);
    await h.player.toggle();assert.equal(h.requests.length,3);assert.equal(h.player.current().frame,1440);assert.equal(h.video.plays,2);
  }finally{h.player.dispose();}
});

test('pause, seek, hold, reset, hidden policy and disposal revoke Source speculative ownership without shared job DELETE',async()=>{
  for(const action of ['pause','native-pause','seek','native-seek','hold','reset','hidden','dispose']){
    const ack=deferred(),h=lookaheadHarness({api:(body,job)=>body.window.start_frame>0?ack.promise:job});try{
      await h.open();await h.player.toggle();await settle();const prepared=h.requests.length,source=h.video.src;
      if(action==='pause')h.player.pause();if(action==='native-pause')h.video.pause();if(action==='seek')await h.player.seekFrame(12);if(action==='native-seek')h.video.userSeek(1);if(action==='hold')h.player.hold();if(action==='reset')h.player.reset();if(action==='hidden')h.setAllowed(false);if(action==='dispose')h.player.dispose();
      const after=h.video.src;ack.resolve(h.jobs.get('job2'));await settle();assert.equal(h.video.src,after);assert.equal(h.player.prefetchState().state,'idle');assert.equal(h.requests.length,prepared);assert.equal(h.video.plays,1);assert.ok(h.fetches.every(call=>call.options.method!=='DELETE'));
      if(action==='hidden')assert.equal(h.video.src,source);
    }finally{h.player.dispose();}assert.equal(h.timers.size,0);
  }
});

test('Source promotion retains the old window through fast-tail drain and rejects late handoff after user pause',async()=>{
  for(const cancel of [false,true]){
    const tail=deferred(),h=lookaheadHarness({total:2880,beforeWindowChange:()=>tail.promise});try{
      await h.open();await h.player.toggle();await settle();const source=h.video.src,position=h.player.current();h.finish();await settle();assert.equal(h.video.src,source);assert.equal(h.player.current().end_frame,position.end_frame);
      if(cancel)h.player.pause();tail.resolve();await settle();assert.equal(h.video.plays,cancel?1:2);assert.equal(h.player.current()?.frame,cancel?undefined:1440);assert.ok(h.fetches.every(call=>call.options.method!=='DELETE'));
    }finally{h.player.dispose();}
  }
});
