import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourcePlayer} from '../js/source.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function settle(){for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));}
class Video extends EventTarget {
  constructor(){super();this.url='';this.position=0;this.paused=true;this.ended=false;this.seeking=false;this.readyState=1;this.error=null;this.waitMetadata=false;this.waitSeek=false;this.plays=0;this.queuePauses=false;this.pauses=[];}
  get src(){return this.url;}
  set src(value){this.url=value;this.position=0;this.ended=false;this.readyState=this.waitMetadata?0:1;}
  get currentTime(){return this.position;}
  set currentTime(value){this.position=value;this.seeking=this.waitSeek;}
  getAttribute(){return this.url;}
  removeAttribute(){this.url='';}
  load(){}
  pause(){if(this.paused)return;this.paused=true;const event=new Event('pause');if(this.queuePauses)this.pauses.push(event);else this.dispatchEvent(event);}
  async play(){this.paused=false;this.ended=false;this.plays++;this.dispatchEvent(new Event('play'));}
  nativeSeek(seconds){this.position=seconds;this.ended=false;this.seeking=true;this.dispatchEvent(new Event('seeking'));}
  finishSeek(){this.seeking=false;this.dispatchEvent(new Event('seeked'));}
}
function harness({api,onStateChange,onReady,fetcher,windowed=true,asset='source.mp4'}={}){
  const video=new Video(),image=new EventTarget(),cancel=new EventTarget(),status={textContent:''},states=[],requests=[],notifications=[],timers=new Map();let timerID=0;
  image.src='';image.removeAttribute=()=>{image.src='';};
  const item={id:'media',name:'Source',duration_frames:5_000,fps:{num:24,den:1},has_video:true,has_audio:true};
  const ready=(body,id=`job${requests.length}`)=>({id,state:'ready',source_asset:asset,project_epoch:body.project_epoch,...(body.window?{source_window:{...body.window,total_frames:item.duration_frames,fps:item.fps,source_version:'file-version'}}:{})});
  const player=createSourcePlayer({video,image,cancel,status,windowed,onStateChange:value=>{states.push(value);onStateChange?.(value);},onReady:value=>{notifications.push(value);onReady?.(value);},
    api:async(path,body)=>{requests.push(body);return api?api(body,ready):ready(body);},fetcher:fetcher || (async()=>{throw Error('Unexpected status request');}),
    setTimer:(callback,delay)=>{const id=++timerID;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id)});
  const finish=()=>{const range=notifications.at(-1).source_window;video.position=(range.end_frame-range.start_frame)/24;video.ended=true;video.pause();video.dispatchEvent(new Event('ended'));};
  return{player,video,image,cancel,status,item,ready,states,requests,notifications,timers,finish,open:(frame=0)=>player.open(item,'epoch','low',frame)};
}

test('hold preserves an EOF preparation and publishes a verified paused window without automatic replay',async()=>{
  const ack=deferred();let h;
  h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
  try{
    await h.open();await h.player.toggle();h.finish();assert.equal(h.player.preparing(),true);assert.equal(h.states.at(-1).reason,'window');
    h.player.hold();assert.equal(h.player.preparing(),true);
    ack.resolve(h.ready(h.requests[1],'next'));await settle();
    assert.equal(h.player.preparing(),false);assert.equal(h.player.current().frame,360);assert.equal(h.video.paused,true);assert.equal(h.video.plays,1);
    assert.equal(h.states.at(-1).state,'ready');assert.equal(h.states.at(-1).reason,'window');
    await h.player.toggle();assert.equal(h.video.plays,2);
  }finally{h.player.dispose();}
});

test('hold during an exact seek preserves its waiter while explicit pause cancels and suppresses late ready',async()=>{
  const h=harness();try{
    await h.open();h.video.waitSeek=true;const seek=h.player.seekFrame(12);await settle();
    assert.equal(h.player.preparing(),true);h.player.hold();assert.equal(h.player.preparing(),true);
    h.video.finishSeek();await seek;assert.equal(h.player.current().frame,12);assert.equal(h.states.at(-1).reason,'seek');assert.equal(h.video.paused,true);
    const next=h.player.seekFrame(24);await settle();const sequence=h.states.at(-1).sequence;
    h.player.pause();assert.equal(h.states.at(-1).state,'canceled');assert.equal(h.states.at(-1).reason,'pause');assert.equal(h.player.preparing(),false);
    h.video.finishSeek();await next;
    assert.equal(h.player.current(),null);assert.ok(!h.states.some(value=>value.sequence===sequence && value.state==='ready'));
  }finally{h.player.dispose();}
});

test('ordinary Source playback resumes only after the latest exact seek, while frame stepping stays paused',async()=>{
  const h=harness();try{
    await h.open(137);await h.player.toggle();h.video.waitSeek=true;
    const first=h.player.seekFrame(147,{resume:h.player.playing()});await settle();assert.equal(h.video.paused,true);assert.equal(h.video.plays,1);assert.equal(h.player.playing(),true);
    const latest=h.player.seekFrame(161,{resume:h.player.playing()});await settle();assert.equal(h.player.current(),null);assert.equal(h.video.plays,1);
    h.video.finishSeek();await Promise.all([first,latest]);assert.equal(h.player.current().frame,161);assert.equal(h.video.paused,false);assert.equal(h.video.plays,2);assert.equal(h.requests.length,1);
    h.video.waitSeek=false;await h.player.step(1);assert.equal(h.player.current().frame,162);assert.equal(h.video.paused,true);assert.equal(h.player.playing(),false);assert.equal(h.video.plays,2);
    await h.player.seekFrame(163,{resume:true});assert.equal(h.video.paused,true);assert.equal(h.video.plays,2,'resume cannot manufacture an intent from a paused Source');
  }finally{h.player.dispose();}
});

test('a Source seek across windows retains native lineage and never overrides a later pause, step, replacement or changed source',async t=>{
  for(const outcome of ['ready','pause','hold','step','reset','replacement','version','cancel'])await t.test(outcome,async()=>{
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
    try{
      await h.open();await h.player.toggle();const seeking=h.player.seekFrame(3000,{resume:h.player.playing()});await settle();
      assert.equal(h.video.paused,true);assert.equal(h.video.plays,1);assert.equal(h.player.playing(),true);
      if(outcome==='pause')h.player.pause();if(outcome==='hold')h.player.hold();if(outcome==='step')h.player.step(1);if(outcome==='reset')h.player.reset();if(outcome==='cancel')h.cancel.dispatchEvent(new Event('click'));
      if(outcome==='replacement')await h.player.open({...h.item,id:'other'},'other-epoch','medium',17);
      const job=h.ready(h.requests[1],'seek-next');if(outcome==='version')job.source_window.source_version='changed-file';ack.resolve(job);await seeking;
      assert.equal(h.video.plays,outcome==='ready'?2:1);assert.equal(h.video.paused,outcome!=='ready');
      if(['ready','hold'].includes(outcome)){assert.equal(h.player.current().frame,3000);assert.equal(h.player.current().source_version,'file-version');}
      else if(outcome==='replacement'){assert.equal(h.player.current().media_id,'other');assert.equal(h.player.current().epoch,'other-epoch');assert.equal(h.player.current().frame,17);}
      else assert.equal(h.player.current(),null);
      if(outcome==='version')assert.match(h.status.textContent,/changed/);
    }finally{h.player.dispose();}
  });
});

test('a queued latest seek keeps its original 1x intent while a previous window is preparing',async()=>{
  const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
  try{
    await h.open();await h.player.toggle();const old=h.player.seekFrame(3000,{resume:h.player.playing()});await settle();
    assert.equal(h.player.playing(),true);await h.player.seekFrame(4000,{resume:h.player.playing()});
    assert.equal(h.player.current().frame,4000);assert.equal(h.video.plays,2);const src=h.video.src;
    ack.resolve(h.ready(h.requests[1],'obsolete-seek'));await old;assert.equal(h.video.src,src);assert.equal(h.player.current().frame,4000);assert.equal(h.video.plays,2);
  }finally{h.player.dispose();}
});

test('native video seeks resume ordinary playback only after verification and explicit Pause still cancels',async t=>{
  for(const outcome of ['resume','paused','fast','pause','native-play','mismatch'])await t.test(outcome,async()=>{
    const h=harness();try{
      await h.open(137);if(outcome!=='paused')await h.player.toggle();if(outcome==='fast')h.video.playbackRate=2;
      h.video.nativeSeek(1);assert.equal(h.player.current(),null);assert.equal(h.video.paused,true);
      if(outcome==='resume'){h.video.nativeSeek(2);assert.equal(h.player.playing(),true);}
      if(outcome==='pause')await h.player.toggle();if(outcome==='native-play')await h.video.play();if(outcome==='mismatch')h.video.position=2;
      h.video.finishSeek();await settle();assert.equal(h.video.paused,outcome!=='resume');
      assert.equal(h.video.plays,outcome==='paused'?0:['resume','native-play'].includes(outcome)?2:1);
      if(outcome==='resume'){assert.equal(h.player.current().frame,185);h.video.finishSeek();await settle();assert.equal(h.video.plays,2,'a late duplicate seeked event cannot restart playback');}
      if(['pause','native-play','mismatch'].includes(outcome))assert.equal(h.player.current(),null);
    }finally{h.player.dispose();}
  });
});

test('quality reopen retains the displayed source, absolute frame and verified identity, including Library authority',async()=>{
  for(const library of [false,true]){
    const h=harness();if(library)h.item.native_asset={id:'asset-a',revision:'a'.repeat(64),if_generation:'7',source_version:'file-version'};
    try{
      await h.open(137);await h.player.seekFrame(161);await h.player.toggle();const source=h.player.current();
      await h.player.reopen('high');assert.equal(h.player.current().media_id,source.media_id);assert.equal(h.player.current().epoch,source.epoch);assert.equal(h.player.current().frame,161);assert.equal(h.player.current().source_version,source.source_version);
      assert.equal(h.requests.at(-1).quality,'high');assert.deepEqual(h.requests.at(-1).window,{start_frame:161,end_frame:521});assert.equal(h.video.paused,false);assert.equal(h.video.plays,2);
      if(library){assert.equal(h.requests.at(-1).revision,'a'.repeat(64));assert.equal(h.requests.at(-1).if_generation,'7');assert.equal(h.requests.at(-1).source_version,'file-version');assert.match(h.video.src,/native-assets\/items\/asset-a\/source\/jobs/);}
    }finally{h.player.dispose();}
  }
});

test('quality reopen cannot attach a changed original or autoplay after explicit cancellation',async()=>{
  for(const outcome of ['version','pause','replacement']){
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
    try{
      await h.open(137);await h.player.toggle();const reopening=h.player.reopen('high');await settle();
      if(outcome==='pause')h.player.pause();if(outcome==='replacement')await h.player.open({...h.item,id:'pool-b'},'epoch','medium',0);
      const job=h.ready(h.requests[1],'late-quality');if(outcome==='version')job.source_window.source_version='different';ack.resolve(job);await reopening;
      assert.equal(h.video.plays,1);assert.equal(h.video.paused,true);assert.ok(!h.video.src.includes('late-quality'));
      if(outcome==='replacement')assert.equal(h.player.current().media_id,'pool-b');else assert.equal(h.player.current(),null);
    }finally{h.player.dispose();}
  }
});

test('preparing notification precedes network access and reentrant ready reset suppresses obsolete onReady',async()=>{
  let h;const order=[];
  h=harness({api:(body,ready)=>{order.push('network');return ready(body);},onStateChange:value=>{order.push(value.state);if(value.state==='ready')h.player.reset();}});
  try{await h.open();assert.deepEqual(order,['preparing','network','ready','canceled']);assert.equal(h.notifications.length,0);assert.equal(h.player.current(),null);assert.equal(h.player.preparing(),false);}finally{h.player.dispose();}
});

test('reentrant preparing reset prevents dispatch and obsolete source ACKs cannot emit ready or error',async()=>{
  let h;h=harness({onStateChange:value=>{if(value.state==='preparing')h.player.reset();}});
  try{await h.open();assert.equal(h.requests.length,0);assert.deepEqual(h.states.map(value=>value.state),['preparing','canceled']);}finally{h.player.dispose();}
  const old=deferred();let f;f=harness({api:(body,ready)=>f.requests.length===1?old.promise:ready(body)});
  try{
    const opening=f.open();await f.player.open({...f.item,id:'replacement'},'new-epoch','low');
    const stateCount=f.states.length;old.resolve(f.ready(f.requests[0],'obsolete'));await opening;
    assert.equal(f.states.length,stateCount);assert.equal(f.states.at(-1).item.id,'replacement');assert.equal(f.states.at(-1).epoch,'new-epoch');
  }finally{f.player.dispose();}
});

test('legacy movies and original stills report ready and failed preparation reports the active source',async()=>{
  for(const [windowed,asset,is_image] of [[false,'source.mp4',false],[true,'source.png',true]]){
    const h=harness({windowed,asset});try{
      await h.player.open({...h.item,is_image},'epoch','low');
      assert.deepEqual(h.states.map(value=>value.state),['preparing','ready']);assert.equal(h.states.at(-1).reason,'open');assert.equal(h.states.at(-1).frame,0);assert.equal(h.player.preparing(),false);
    }finally{h.player.dispose();}
  }
  const h=harness({api:async()=>{throw Error('Preparation refused');}});try{
    await h.open();assert.deepEqual(h.states.map(value=>value.state),['preparing','error']);assert.match(h.states.at(-1).error,/Preparation refused/);assert.equal(h.states.at(-1).item.id,h.item.id);assert.equal(h.player.preparing(),false);
  }finally{h.player.dispose();}
});

test('native seek exposes a pending clock then a settled absolute frame and reset cancels its state',async()=>{
  const h=harness();try{
    await h.open(137);h.video.nativeSeek(1);
    assert.equal(h.states.at(-1).state,'preparing');assert.equal(h.states.at(-1).reason,'native_seek');assert.equal(h.player.preparing(),true);assert.equal(h.player.current(),null);
    h.video.finishSeek();assert.equal(h.states.at(-1).state,'ready');assert.equal(h.states.at(-1).frame,161);assert.equal(h.player.current().frame,161);assert.equal(h.player.preparing(),false);
    h.video.nativeSeek(2);h.player.reset();assert.equal(h.states.at(-1).state,'canceled');assert.equal(h.player.preparing(),false);h.video.finishSeek();assert.equal(h.states.at(-1).state,'canceled');
  }finally{h.player.dispose();}
});

test('internal pause events remain recognizable after asynchronous delivery and actual user pauses stay external',async()=>{
  const h=harness();try{
    await h.open();await h.player.toggle();h.video.queuePauses=true;
    const seen=[];h.video.addEventListener('pause',event=>seen.push(h.player.internalPause(event)));
    h.player.hold();assert.equal(h.video.pauses.length,1);const own=h.video.pauses.shift();h.video.dispatchEvent(own);assert.deepEqual(seen,[true]);assert.equal(h.player.internalPause(own),true);
    await h.player.toggle();await settle();h.video.pause();const user=h.video.pauses.shift();h.video.dispatchEvent(user);assert.deepEqual(seen,[true,false]);assert.equal(h.player.internalPause(user),false);
  }finally{h.player.dispose();}
});

test('heartbeat failures notify error for the active binding without leaving a current window',async()=>{
  const h=harness({fetcher:async()=>Response.json({id:'wrong',state:'ready',source_asset:'source.mp4'})});try{
    await h.open();const entry=[...h.timers.entries()].find(([,value])=>value.delay===10_000);h.timers.delete(entry[0]);entry[1].callback();await settle();
    assert.equal(h.states.at(-1).state,'error');assert.match(h.states.at(-1).error,/changed/);assert.equal(h.player.current(),null);assert.equal(h.player.preparing(),false);
  }finally{h.player.dispose();}
});


test('retained cross-window seeks hold the old verified picture until paused publication and failures never replay',async t=>{
  await t.test('ready',async()=>{
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
    try{
      await h.open(137);await h.player.toggle();const url=h.video.src,old=h.player.current();
      const seeking=h.player.seekFrame(3000,{retain:true});
      assert.equal(h.player.preparing(),true);assert.equal(h.video.src,url);assert.deepEqual(h.player.current(),old);assert.equal(h.video.paused,true);
      assert.equal(h.states.at(-1).state,'preparing');assert.equal(h.states.at(-1).reason,'seek');
      h.player.hold();assert.equal(h.player.preparing(),true);
      ack.resolve(h.ready(h.requests[1],'retained-next'));await seeking;
      assert.notEqual(h.video.src,url);assert.equal(h.player.current().frame,3000);assert.equal(h.player.preparing(),false);assert.equal(h.video.paused,true);assert.equal(h.video.plays,1);
      assert.equal(h.states.at(-1).state,'ready');assert.equal(h.states.at(-1).reason,'seek');
    }finally{h.player.dispose();}
  });
  for(const outcome of ['failed','canceled'])await t.test(outcome,async()=>{
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
    try{
      await h.open();await h.player.toggle();const url=h.video.src;
      const seeking=h.player.seekFrame(3000,{retain:true});assert.equal(h.video.src,url);
      if(outcome==='canceled')h.player.pause();
      ack.resolve(outcome==='failed'?{...h.ready(h.requests[1]),state:'failed',error:'SOURCE_CACHE_FULL'}:h.ready(h.requests[1]));
      await seeking;assert.equal(h.player.current(),null);assert.equal(h.player.preparing(),false);assert.equal(h.video.paused,true);assert.equal(h.video.plays,1);
      assert.equal(h.states.at(-1).state,outcome==='failed'?'error':'canceled');
    }finally{h.player.dispose();}
  });
  await t.test('default remains detached',async()=>{
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
    try{
      await h.open();const seeking=h.player.seekFrame(3000);assert.equal(h.video.src,'');assert.equal(h.player.current(),null);
      ack.resolve(h.ready(h.requests[1]));await seeking;assert.equal(h.player.current().frame,3000);assert.equal(h.video.plays,0);
    }finally{h.player.dispose();}
  });
});


test('retained manual boundary seeks keep the old picture but use fifteen seconds, unlike an owned natural advance',async()=>{
  for(const advance of [false,true]){
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===2?ack.promise:ready(body)});
    try{
      await h.open();assert.deepEqual(h.requests[0].window,{start_frame:0,end_frame:360});const url=h.video.src,old=h.player.current();
      const moving=h.player.seekFrame(360,{retain:true,...(advance?{advance:true}:{})});await settle();
      assert.equal(h.video.src,url);assert.equal(h.player.current().job,old.job);assert.equal(h.player.current().source_version,old.source_version);assert.equal(h.video.paused,true);
      assert.deepEqual(h.requests[1].window,{start_frame:360,end_frame:advance?1800:720});
      ack.resolve(h.ready(h.requests[1],'boundary-next'));await moving;
      assert.equal(h.player.current().frame,360);assert.equal(h.player.current().source_version,old.source_version);assert.equal(h.video.paused,true);assert.equal(h.video.plays,0);
    }finally{h.player.dispose();}
  }
});
