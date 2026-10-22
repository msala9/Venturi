import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourcePlayer} from '../js/source.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function settle(){for(let n=0;n<6;n++)await new Promise(resolve=>setImmediate(resolve));}
class Video extends EventTarget {
  constructor(){super();this.url='';this.currentTime=0;this.paused=true;this.ended=false;this.seeking=false;this.readyState=1;this.error=null;this.plays=0;}
  get src(){return this.url;}
  set src(value){this.url=value;this.currentTime=0;this.ended=false;}
  getAttribute(){return this.src;}
  removeAttribute(){this.src='';}
  load(){}
  pause(){if(this.paused)return;this.paused=true;this.dispatchEvent(new Event('pause'));}
  async play(){this.paused=false;this.ended=false;this.plays++;this.dispatchEvent(new Event('play'));}
}
function harness({api,fetcher,onStateChange,windowed=true}={}){
  const item={id:'media',name:'Two streams',has_video:true,has_audio:true,audio_stream_count:2,duration_frames:5000,fps:{num:24,den:1}},video=new Video(),image={src:'',removeAttribute(){this.src='';}},cancel=new EventTarget(),status={},requests=[],fetches=[],states=[],notifications=[],timers=new Map();let timerID=0;
  const ready=(body,id=`job-${requests.length}`)=>({id,state:'ready',source_asset:item.is_image?'source.png':'source.mp4',project_epoch:body.project_epoch,...(body.window?{source_window:{...body.window,total_frames:item.duration_frames,fps:{...item.fps},source_version:'same-native-file',...(body.audio_mode==='all'?{audio_mode:'all',audio_stream_index:null}:{audio_stream_index:body.audio_stream_index??0})}}:{})});
  const player=createSourcePlayer({video,image,cancel,status,windowed,api:async(path,body)=>{requests.push(body);return api?api(body,ready):ready(body);},fetcher:async(path,options)=>{fetches.push({path,options});return fetcher?fetcher(path,options):Response.json({...ready(requests.at(-1)),id:notifications.at(-1)?.job});},onStateChange:value=>{states.push(value);onStateChange?.(value);},onReady:value=>notifications.push(value),setTimer:(callback,delay)=>{const id=++timerID;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id)});
  return {player,item,video,image,cancel,status,requests,fetches,states,notifications,timers,ready,open:(audioStreamIndex,frame=0)=>player.open(item,'epoch','low',frame,audioStreamIndex===undefined?undefined:{audioStreamIndex}),
    finish(){const range=notifications.at(-1).source_window;video.currentTime=(range.end_frame-range.start_frame)/24;video.ended=true;video.pause();video.dispatchEvent(new Event('ended'));},
    async heartbeat(){const entry=[...timers].find(([,timer])=>timer.delay===10_000);assert(entry);timers.delete(entry[0]);entry[1].callback();await settle();}};
}

test('selected Source audio survives exact seeks, retained windows, native EOF and retry without changing native file identity',async()=>{
  let fail=false;const h=harness({api:(body,ready)=>{if(fail){fail=false;throw Error('Temporarily busy');}return ready(body);}});
  try{
    await h.open(1);assert.equal(h.requests[0].audio_stream_index,1);assert.equal(h.player.current().audio_stream_index,1);assert.equal(h.notifications[0].audio_stream_index,1);assert.equal(h.notifications[0].source_window.audio_stream_index,1);
    await h.player.seekFrame(12);assert.equal(h.requests.length,1);assert.equal(h.player.current().frame,12);assert.equal(h.player.current().audio_stream_index,1);
    await h.player.seekFrame(2000,{retain:true});assert.equal(h.requests[1].audio_stream_index,1);await h.player.toggle();h.finish();await settle();
    assert.equal(h.player.current().frame,3440);assert.equal(h.player.current().audio_stream_index,1);assert.equal(h.requests[2].audio_stream_index,1);assert.equal(h.player.current().source_version,'same-native-file');
    h.player.hold();fail=true;await h.player.seekFrame(100);assert.equal(h.player.current(),null);await h.player.toggle();assert.equal(h.player.current().frame,100);assert.equal(h.player.current().audio_stream_index,1);assert(h.requests.every(body=>body.audio_stream_index===1));assert(h.states.every(state=>state.audio_stream_index===1));
  }finally{h.player.dispose();}
});

test('default Source calls preserve request compatibility while explicit zero requires a selected-stream descriptor',async()=>{
  for(const explicit of [false,true]){
    const h=harness({api:(body,ready)=>{const value=ready(body);delete value.source_window.audio_stream_index;return value;}});
    try{await h.open(explicit?0:undefined);assert.equal(Object.hasOwn(h.requests[0],'audio_stream_index'),explicit);
      if(explicit){assert.equal(h.player.current(),null);assert.match(h.status.textContent,/audio stream changed/);}else{assert.equal(h.player.current().audio_stream_index,0);await h.heartbeat();assert.equal(h.player.current().audio_stream_index,0);}
    }finally{h.player.dispose();}
  }
});

test('wrong, omitted and malformed selected-stream descriptors never attach the wrong audio cache',async()=>{
  for(const returned of [0,undefined,'1',-1,2,null]){
    const h=harness({api:(body,ready)=>{const value=ready(body);if(returned===undefined)delete value.source_window.audio_stream_index;else value.source_window.audio_stream_index=returned;return value;}});
    try{await h.open(1);assert.equal(h.player.current(),null);assert.equal(h.video.src,'');assert.equal(h.notifications.length,0);assert.match(h.status.textContent,/audio stream changed/);}finally{h.player.dispose();}
  }
});

test('heartbeat includes selected audio identity even when source version and all window bounds are unchanged',async()=>{
  for(const selected of [0,1]){
    let h;h=harness({fetcher:async()=>{const value=h.ready(h.requests.at(-1),h.notifications.at(-1).job);if(selected===0)delete value.source_window.audio_stream_index;else value.source_window.audio_stream_index=0;return Response.json(value);}});
    try{await h.open(selected);await h.heartbeat();assert.equal(h.player.current(),null);assert.match(h.status.textContent,/Source window changed/);assert.equal(h.video.paused,true);}finally{h.player.dispose();}
  }
});

test('nonzero Source audio selection requires known native bounds and never falls back to the first stream',async()=>{
  for(const changes of [{audio_stream_count:undefined},{audio_stream_count:0},{audio_stream_count:1},{audio_stream_count:'2'},{audio_stream_count:1.5},{has_audio:false},{is_image:true}]){
    const h=harness();Object.assign(h.item,changes);try{await h.open(1);assert.equal(h.requests.length,0);assert.equal(h.player.current(),null);assert.match(h.status.textContent,/available native Source audio stream/);}finally{h.player.dispose();}
  }
  for(const selected of [-1,2,1.5,'1',NaN,0x100000000]){
    const h=harness();try{await h.open(selected);assert.equal(h.requests.length,0);assert.equal(h.player.current(),null);}finally{h.player.dispose();}
  }
});

test('video-only, still and legacy zero-stream calls retain their supported default behavior',async()=>{
  const silent=harness();silent.item.has_audio=false;silent.item.audio_stream_count=0;
  try{await silent.open(0);assert.equal(silent.player.current().audio_stream_index,0);assert.equal(silent.requests[0].audio_stream_index,0);}finally{silent.player.dispose();}
  const still=harness();still.item.is_image=true;
  try{await still.open(0);assert.equal(Object.hasOwn(still.requests[0],'audio_stream_index'),false);assert.equal(still.player.current(),null);assert(still.image.src.endsWith('project_epoch=epoch'));assert.equal(still.notifications[0].audio_stream_index,0);}finally{still.player.dispose();}
  const legacy=harness({windowed:false});try{await legacy.open(1);assert.equal(legacy.requests[0].audio_stream_index,1);assert.equal(Object.hasOwn(legacy.requests[0],'window'),false);assert.equal(legacy.notifications[0].audio_stream_index,1);assert.match(legacy.status.textContent,/audio stream 1/);}finally{legacy.player.dispose();}
});

test('late old stream ACKs and canceled preparations cannot replace the selected stream or autoplay',async()=>{
  for(const cancel of [false,true]){
    const old=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===1?old.promise:ready(body)});
    try{const opening=h.open(1);if(cancel){h.cancel.dispatchEvent(new Event('click'));}else await h.open(0);old.resolve(h.ready(h.requests[0],'obsolete-selected'));await opening;await settle();
      assert.equal(h.video.plays,0);assert.equal(h.notifications.length,cancel?0:1);assert.equal(h.player.current()?.audio_stream_index,cancel?undefined:0);assert(h.fetches.every(request=>request.options?.method!=='DELETE'));
    }finally{h.player.dispose();}
  }
});

test('reentrant stream change from ready state suppresses the obsolete stream publication',async()=>{
  let h,replacement,changed=false;h=harness({onStateChange:value=>{if(value.state==='ready' && value.audio_stream_index===0 && !changed){changed=true;replacement=h.open(1);}}});
  try{await h.open(0);await replacement;assert.equal(h.notifications.length,1);assert.equal(h.notifications[0].audio_stream_index,1);assert.equal(h.player.current().audio_stream_index,1);assert.equal(h.video.plays,0);}finally{h.player.dispose();}
});

for(const windowed of [true,false])test(`${windowed?'bounded':'legacy'} Source reset notification cannot let an older open abort the newer selected stream`,async()=>{
  let h,replacement,armed=false;h=harness({windowed,onStateChange:value=>{if(armed && value.state==='canceled' && value.reason==='reset'){armed=false;replacement=h.open(1);}}});
  try{
    await h.open(0);armed=true;await h.open(0,120);await replacement;
    assert.deepEqual(h.requests.map(body=>body.audio_stream_index),[0,1]);assert.equal(h.notifications.length,2);assert.equal(h.notifications.at(-1).audio_stream_index,1);assert.equal(h.states.at(-1).audio_stream_index,1);assert.equal(h.states.at(-1).state,'ready');assert(h.video.src.includes('/job-2/'));assert.equal(h.video.plays,0);assert.equal(h.player.preparing(),false);if(windowed)assert.equal(h.player.current().audio_stream_index,1);
  }finally{h.player.dispose();}
});

test('Main Source all-stream identity survives verified seeks, bounded EOF and retry without changing Review defaults',async()=>{
  let fail=false;const h=harness({api:(body,ready)=>{if(fail){fail=false;throw Error('Source memory pressure');}return ready(body);}});
  try{
    await h.player.open(h.item,'epoch','low',0,{audioMode:'all'});
    assert.equal(h.requests[0].audio_mode,'all');assert.equal(h.player.current().audio_mode,'all');assert.equal(h.player.current().audio_stream_index,null);assert.match(h.status.textContent,/all audio streams/);
    await h.player.seekFrame(12);assert.equal(h.requests.length,1);assert.equal(h.states.at(-1).audio_mode,'all');
    await h.player.seekFrame(2000,{retain:true});await h.player.toggle();h.finish();await settle();
    assert.equal(h.player.current().frame,3440);assert(h.requests.every(body=>body.audio_mode==='all'));assert(h.notifications.every(value=>value.audio_mode==='all' && value.audio_stream_index===null));
    h.player.hold();fail=true;await h.player.seekFrame(100);assert.equal(h.player.current(),null);assert.equal(h.player.preparing(),false);await h.player.toggle();assert.equal(h.player.current().audio_mode,'all');assert.equal(h.player.current().frame,100);
    await h.open(1);assert.equal(Object.hasOwn(h.requests.at(-1),'audio_mode'),false);assert.equal(h.player.current().audio_mode,'selected');assert.equal(h.player.current().audio_stream_index,1);
  }finally{h.player.dispose();}
});

test('all-stream windows require exact native mode and null ordinal before attachment or heartbeat reuse',async()=>{
  for(const patch of [{audio_mode:'selected',audio_stream_index:0},{audio_mode:undefined},{audio_stream_index:0},{audio_stream_index:undefined}]){
    const h=harness({api:(body,ready)=>{const value=ready(body);Object.assign(value.source_window,patch);return value;}});
    try{await h.player.open(h.item,'epoch','low',0,{audioMode:'all'});assert.equal(h.player.current(),null);assert.equal(h.video.src,'');assert.equal(h.notifications.length,0);assert.match(h.status.textContent,/audio stream changed/);}finally{h.player.dispose();}
  }
  const h=harness({fetcher:()=>{const value=h.ready(h.requests.at(-1),h.notifications.at(-1).job);value.source_window.audio_mode='selected';value.source_window.audio_stream_index=0;return Response.json(value);}});
  try{await h.player.open(h.item,'epoch','low',0,{audioMode:'all'});await h.heartbeat();assert.equal(h.player.current(),null);assert.equal(h.video.paused,true);assert.match(h.status.textContent,/Source window changed/);}finally{h.player.dispose();}
});

test('ambiguous all-stream selections fail before enqueue while silent videos and original stills retain native handling',async()=>{
  for(const options of [{audioMode:'all',audioStreamIndex:1},{audioMode:'mixed'},{audioMode:'ALL'},{audioMode:null}]){
    const h=harness();try{await h.player.open(h.item,'epoch','low',0,options);assert.equal(h.requests.length,0);assert.equal(h.player.current(),null);}finally{h.player.dispose();}
  }
  const silent=harness();silent.item.has_audio=false;silent.item.audio_stream_count=0;
  try{await silent.player.open(silent.item,'epoch','low',0,{audioMode:'all'});assert.equal(silent.player.current().audio_mode,'all');assert.equal(silent.player.current().audio_stream_index,null);}finally{silent.player.dispose();}
  const still=harness();still.item.is_image=true;still.item.has_audio=false;
  try{await still.player.open(still.item,'epoch','low',0,{audioMode:'all'});assert.equal(Object.hasOwn(still.requests[0],'audio_mode'),false);assert.equal(Object.hasOwn(still.requests[0],'audio_stream_index'),false);assert.equal(still.notifications[0].audio_mode,'selected');assert.equal(still.player.current(),null);}finally{still.player.dispose();}
});

test('late all-stream or selected-stream ACKs cannot attach over a newer audio mode',async()=>{
  for(const oldMode of ['all','selected']){
    const ack=deferred();let h;h=harness({api:(body,ready)=>h.requests.length===1?ack.promise:ready(body)});
    try{
      const old=h.player.open(h.item,'epoch','low',0,{audioMode:oldMode,audioStreamIndex:0});
      await h.player.open(h.item,'epoch','low',0,{audioMode:oldMode==='all'?'selected':'all'});ack.resolve(h.ready(h.requests[0],'obsolete-mode'));await old;
      assert.equal(h.notifications.length,1);assert.equal(h.player.current().audio_mode,oldMode==='all'?'selected':'all');assert.equal(h.video.plays,0);assert(h.fetches.every(request=>request.options?.method!=='DELETE'));
    }finally{h.player.dispose();}
  }
});
