import test from "node:test";
import assert from "node:assert/strict";
import { createSourcePlayer, sourceAssetURL, sourceSelection, sourceFrameAtTime } from "../js/source.js";

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
function sourceHarness({asset='source.mp4',api,fetcher}={}){
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
  const player=createSourcePlayer({video,image,status,cancel,onReady:value=>ready.push(value),setTimer,clearTimer,api:async(path,body,requestFetch)=>{prepared.push({path,body});return api?api(path,body,requestFetch):{id:'job',state:'ready',source_asset:asset};},fetcher:async(path,options)=>{requests.push({path,options});return fetcher?fetcher(path,options):response();}});
  return {player,video,image,status,cancel,requests,prepared,ready,timers,response,
    open:(item={id:'1',name:'Source'},epoch='epoch:1')=>player.open(item,epoch),
    async advance(milliseconds){now+=milliseconds;const due=[...timers.entries()].filter(([,timer])=>timer.at<=now);for(const [id,timer] of due){if(timers.delete(id))timer.callback();}await settle();},
  };
}

test('paused ready Source pins only its authorized cache job every ten seconds without changing metadata or playback',async()=>{
  const h=sourceHarness();
  try{
    assert.equal(h.timers.size,0);await h.open();const text=h.status.textContent,url=h.video.src,prepared=structuredClone(h.prepared);
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
