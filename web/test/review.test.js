import test from "node:test";
import assert from "node:assert/strict";
import {comparisonDuration,comparisonLeader,comparisonFrame,createReview,knownTakeMetadata,reviewIdentity,replacementAudioStreams,replacementAudioChange,replacementFrozenPolicy,replacementFrozenChange} from "../js/review.js";

test("review replacement identity ignores transport time but binds the selected native document and clip",()=>{
  const context={query:{project_epoch:"epoch",if_generation:"2",timeline_id:"1",revision:"rev",frame:12,width:640},clip:{id:"9007199254740993"}};
  assert.equal(reviewIdentity(context),reviewIdentity({...context,query:{...context.query,frame:100}}));
  for(const key of ["project_epoch","if_generation","timeline_id","revision"])assert.notEqual(reviewIdentity(context),reviewIdentity({...context,query:{...context.query,[key]:"changed"}}));
  assert.notEqual(reviewIdentity(context),reviewIdentity({...context,clip:{id:"different"}}));assert.equal(reviewIdentity(null),null);
});
test("review displays generation metadata only when supplied and preserves the exact seed string",()=>{
  assert.equal(knownTakeMetadata({name:"take.mp4"}),"Generation metadata not supplied");assert.equal(knownTakeMetadata({shared_origin:{item:{model:"",prompt:null,seed:null}}}),"Generation metadata not supplied");
  assert.equal(knownTakeMetadata({shared_origin:{item:{model:"known model",prompt:"<script>quoted source text</script>",seed:"18446744073709551615"}}}),"Model: known model\nSeed: 18446744073709551615\nPrompt: <script>quoted source text</script>");
});

class Control extends EventTarget {
  constructor(value=""){super();this.value=value;this.disabled=false;this.children=[];this.textContent="";this.checked=true;this.paused=true;this.currentTime=0;this.duration=NaN;this.readyState=1;this.ended=false;this.playCount=0;this.frameCallbacks=new Map();this.nextFrame=0;this.requestedFrames=[];this.canceledFrames=[];}
  replaceChildren(...children){this.children=children;}
  reportValidity(){return true;}
  append(child){this.children.push(child);}
  click(){if(!this.disabled)this.dispatchEvent(new Event("click"));}
  pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
  async play(){this.playCount++;this.ended=false;if(this.paused){this.paused=false;this.dispatchEvent(new Event("play"));}}
  requestVideoFrameCallback(callback){const id=++this.nextFrame;this.frameCallbacks.set(id,callback);this.requestedFrames.push(id);return id;}
  cancelVideoFrameCallback(id){this.canceledFrames.push(id);this.frameCallbacks.delete(id);}
  advance(seconds){this.currentTime=seconds;this.dispatchEvent(new Event('timeupdate'));}
  finish(){this.currentTime=this.duration;this.ended=true;this.pause();this.dispatchEvent(new Event('ended'));}
}
function harness(api,{deferSources=false,windowSeconds=60,deferSeek=()=>null,resetRate=false,endedAtWindowTail=()=>false}={}){
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};globalThis.document={createElement:()=>new Control()};
  const selectors=["form","[data-review-status]","[data-review-apply]","[data-review-plan]","[data-review-changes]","[data-review-refresh]","[data-review-close]","[data-review-play]","[data-review-swap]",'[name="sync"]','[name="listen"]',"[data-review-target]",'[data-review-audio-streams]','[data-review-audio-select]','[data-review-transport-status]','[data-review-frozen-policy]','[data-review-source-in-label]','[data-review-quality]'];
  const nodes=Object.fromEntries(selectors.map(selector=>[selector,new Control()])),root=new Control(),panes=[];root.querySelector=selector=>nodes[selector];root.showModal=()=>{root.open=true;};root.close=()=>{root.open=false;};
  nodes['[data-review-replacement]']=nodes.form;
  for(const name of ["A","B"]){const parts=Object.fromEntries(["select","video","img","output","button","pre",'[data-review-seek]','[data-review-frame]','[data-review-seek-submit]','[data-review-clock]','[data-review-audition-stream]'].map(selector=>[selector,new Control()]));parts[`[name="take${name}"]`]=parts.select;parts['[data-review-source-status]']=parts.output;parts['[data-review-cancel-source]']=parts.button;const pane={querySelector:selector=>parts[selector]};nodes[`[data-review-pane="${name}"]`]=pane;panes.push(parts);}
  nodes.form.elements=Object.fromEntries(Object.entries({source_in:"0",duration:"preserve",links:"replace_linked",attributes:"preserve",audio_streams:"preserve",audio_stream_index:"0",frozen:'reject'}).map(([name,value])=>[name,new Control(value)]));nodes.form.reportValidity=()=>true;
  nodes['[name="listen"]'].value="A";
  const context={query:{project_epoch:"epoch",if_generation:"2",timeline_id:"1",revision:"rev",frame:12,width:640},clip:{id:"1",media_id:"2",name:"old.mp4",start_frame:12,length_frames:72},document:{media:[{id:"2",name:"old.mp4",has_video:true,has_audio:true,duration_frames:72,fps:{num:24,den:1},audio_stream_count:2,content_hash:'old-hash'},{id:"3",name:"new.mp4",has_video:true,has_audio:true,duration_frames:120,fps:{num:24,den:1},audio_stream_count:2,content_hash:'new-hash'}]}},commits=[],loaded=[],ready=new Map();let writable=true;
  const players=[],preparations=[];let active=0,peak=0;
  const sourceFactory=({onReady,onStateChange,cancel,video,windowed})=>{
    assert.equal(windowed,true);const pane=players.length,internalEvents=new WeakSet();let item=null,epoch=null,range=null,preparing=false,sequence=0,job=0,internal=false,audioStreamIndex=0;
    video.addEventListener('pause',event=>{if(internal)internalEvents.add(event);});
    const notify=(state,reason,frame)=>onStateChange({state,reason,frame,item,epoch,sequence,audio_stream_index:audioStreamIndex});
    const hold=()=>{internal=true;try{video.pause();}finally{internal=false;}};
    const publish=(frame,token,reason)=>{
      if(token!==sequence)return;
      const inside=range && frame>=range.start_frame && frame<range.end_frame;
      if(!inside)range={start_frame:frame,end_frame:Math.min(item.duration_frames,frame+Math.max(1,Math.floor(windowSeconds*item.fps.num/item.fps.den))),source_version:`version-${item.id}`,audio_stream_index:audioStreamIndex,job:`job-${pane}-${++job}`};
      video.duration=(range.end_frame-range.start_frame)*item.fps.den/item.fps.num;video.currentTime=(frame-range.start_frame)*item.fps.den/item.fps.num;video.ended=frame===range.end_frame-1 && endedAtWindowTail(pane,frame);
      if(resetRate){video.playbackRate=1;video.dispatchEvent(new Event('ratechange'));}
      preparing=false;notify('ready',reason,frame);if(reason==='open')onReady();
    };
    const player={
      hold,internalPause:event=>internalEvents.has(event),preparing:()=>preparing,
      verifiedSource(){return item && !preparing && item.is_image && video.stillLoaded?{epoch,media_id:item.id,source_version:`version-${item.id}`} : null;},
      current(){if(!range || !item || item.is_image)return null;const local=video.ended?range.end_frame-range.start_frame-1:Math.max(0,Math.floor((video.currentTime+1e-6)*item.fps.num/item.fps.den));return {...range,epoch,media_id:item.id,fps:{...item.fps},frame:Math.min(range.end_frame-1,range.start_frame+local)};},
      reset(){sequence++;hold();preparing=false;range=null;if(item)notify('canceled','reset',0);},
      pause(){hold();if(preparing){sequence++;preparing=false;range=null;notify('canceled','pause',0);}},
      async open(media,value,quality,startFrame,options){assert.ok(Number.isSafeInteger(startFrame) && startFrame>=0);assert.ok(['low','medium','high','original'].includes(quality));audioStreamIndex=options.audioStreamIndex;item=media;epoch=value;range=null;loaded.push(item.id);const token=++sequence;preparing=true;notify('preparing','open',startFrame);hold();cancel.disabled=true;preparations.push({pane,type:'open',frame:startFrame,quality,audio_stream_index:audioStreamIndex});active++;peak=Math.max(peak,active);
        const finish=()=>{active--;if(token!==sequence)return;[video.videoWidth,video.videoHeight]=quality==='original'?[media.width || 1920,media.height || 1080]:{low:[320,180],medium:[640,360],high:[1280,720]}[quality];if(item.is_image){preparing=false;notify('ready','open',0);onReady();}else publish(startFrame,token,'open');};if(deferSources)await new Promise(resolve=>{ready.set(video,()=>{finish();resolve();});});else{ready.set(video,finish);finish();}
      },
      async seekFrame(frame,options){assert.equal(options?.retain,true);const token=++sequence;preparing=true;notify('preparing','seek',frame);hold();preparations.push({pane,type:'seek',frame,audio_stream_index:audioStreamIndex});active++;peak=Math.max(peak,active);try{const wait=deferSeek(pane,frame);if(wait)await wait;if(token!==sequence)return;if(player.failNext){player.failNext=false;preparing=false;range=null;return;}publish(frame,token,'seek');}finally{active--;}}
      ,nativeSeek(frame){const token=++sequence;preparing=true;notify('preparing','native_seek',frame);hold();return ()=>publish(frame,token,'native_seek');}
    };players.push(player);return player;
  };
  const review=createReview({root,getContext:()=>context,canCommit:()=>writable,commit:async operation=>{commits.push(operation);context.query.if_generation="3";review.invalidate();},notice(){},api:(path,body)=>path.startsWith("/review?")?Promise.resolve({items:[],shots:{},project_epoch:"epoch",generation:"2"}):api(path,body),sourceFactory});
  return{review,root,nodes,panes,players,preparations,context,commits,loaded,ready,peak:()=>peak,button:name=>nodes[`[data-review-${name}]`],seek:(pane,frame)=>{panes[pane]['[data-review-frame]'].value=String(frame);panes[pane]['[data-review-seek]'].dispatchEvent(new Event('submit',{cancelable:true}));},setWritable:value=>{writable=value;},submit:()=>nodes.form.dispatchEvent(new Event("submit",{cancelable:true}))};
}
async function settle(){for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));}
const planned={source_version:"version-3",removed_crossings:0,audio_stream_count:2,changes:[{track:"0",clip_id:"1",start_frame:12,previous_length:72,length:60,source_in:0,source_out:75,previous_audio_stream_index:null,audio_stream_index:null}]};

function chooseQuality(h,value){const control=h.nodes['[data-review-quality]'];control.value=value;control.dispatchEvent(new Event('change'));}

test('A/B quality reopens serial native windows at independent absolute clocks and audition streams without changing replacement policies',async()=>{
  const h=harness(async()=>planned);for(const media of h.context.document.media)Object.assign(media,{duration_frames:10000,width:3840,height:2160});await h.review.open();
  assert.equal(h.nodes['[data-review-quality]'].value,'low');assert.match(h.panes[0]['[data-review-clock]'].textContent,/Prepared 320 × 180 \(low\).*Original 3840 × 2160/);
  h.nodes['[name="sync"]'].checked=false;audition(h,0,1);await settle();audition(h,1,1);await settle();h.seek(0,1511);await settle();h.seek(1,2041);await settle();
  const fields=h.nodes.form.elements;fields.audio_streams.value='select';fields.audio_stream_index.value='1';fields.attributes.value='reset';fields.frozen.value='unfreeze';h.nodes.form.dispatchEvent(new Event('change'));const settings=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value])),pair=h.panes.map(pane=>pane.select.value),before=h.preparations.length;
  chooseQuality(h,'original');assert.equal(h.button('apply').disabled,true);assert.ok(h.panes.every(pane=>pane.video.paused));await settle();
  assert.deepEqual(h.preparations.slice(before).map(({pane,quality,frame,audio_stream_index})=>({pane,quality,frame,audio_stream_index})),[{pane:0,quality:'original',frame:1511,audio_stream_index:1},{pane:1,quality:'original',frame:2041,audio_stream_index:1}]);
  assert.deepEqual(h.players.map(player=>player.current().frame),[1511,2041]);assert.deepEqual(h.panes.map(pane=>pane.select.value),pair);assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value])),settings);assert.equal(h.peak(),1);assert.match(h.panes[1]['[data-review-clock]'].textContent,/Prepared 3840 × 2160 \(original\).*Original 3840 × 2160/);assert.deepEqual(h.commits,[]);
  h.button('swap').click();await settle();assert.ok(h.preparations.slice(-2).every(value=>value.quality==='original'));h.button('close').click();await h.review.open();assert.equal(h.nodes['[data-review-quality]'].value,'original');assert.ok(h.preparations.slice(-2).every(value=>value.quality==='original'));h.button('close').click();
});

test('quality changes supersede queued preparations and retain the latest requested absolute frames without overlapping workers',async()=>{
  let defer=false,release;const h=harness(async()=>planned,{deferSources:true,deferSeek:()=>defer?new Promise(resolve=>{release=resolve;}):null}),opening=h.review.open();await settle();const obsolete=h.ready.get(h.panes[0].video);
  chooseQuality(h,'medium');chooseQuality(h,'high');assert.equal(h.button('plan').disabled,true);obsolete();await settle();
  assert.deepEqual(h.preparations.map(value=>[value.pane,value.quality]),[[0,'low'],[0,'high']]);h.ready.get(h.panes[0].video)();await settle();h.ready.get(h.panes[1].video)();await opening;await settle();
  assert.deepEqual(h.preparations.map(value=>[value.pane,value.quality]),[[0,'low'],[0,'high'],[1,'high']]);assert.equal(h.peak(),1);
  defer=true;h.nodes['[name="sync"]'].checked=false;h.seek(0,31);await settle();chooseQuality(h,'original');release();await settle();
  assert.equal(h.preparations.at(-1).quality,'original');assert.equal(h.preparations.at(-1).frame,31);h.ready.get(h.panes[0].video)();await settle();h.ready.get(h.panes[1].video)();await settle();assert.equal(h.players[0].current().frame,31);assert.equal(h.peak(),1);h.button('close').click();
});

test('quality changes invalidate late replacement plans and close owns pending quality results',async()=>{
  let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));await h.review.open();h.submit();await settle();chooseQuality(h,'high');await settle();resolve(planned);await settle();assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);assert.deepEqual(h.commits,[]);h.button('close').click();
  const pending=harness(async()=>planned,{deferSources:true}),opening=pending.review.open();await settle();const obsolete=pending.ready.get(pending.panes[0].video);chooseQuality(pending,'original');pending.button('close').click();obsolete();await opening;await settle();assert.equal(pending.root.open,false);assert.ok(pending.players.every(player=>player.current()===null));assert.equal(pending.preparations.length,1);
});

test('failed quality preparation needs explicit retry and never presents stale decoded dimensions as current',async()=>{
  const h=harness(async()=>planned);await h.review.open();let attempts=0;const open=h.players[0].open;h.players[0].open=async(...args)=>{attempts++;if(attempts===1)throw Error('Native quality admission refused');return open(...args);};
  chooseQuality(h,'original');await settle();assert.equal(attempts,1);assert.match(h.panes[0].output.textContent,/Native quality admission refused.*retry/);assert.doesNotMatch(h.panes[0]['[data-review-clock]'].textContent,/Prepared 320/);assert.equal(h.button('play').disabled,true);await settle();assert.equal(attempts,1);
  chooseQuality(h,'invalid');assert.equal(h.nodes['[data-review-quality]'].value,'original');assert.equal(attempts,1);h.context.query.revision='changed';h.review.invalidate();chooseQuality(h,'low');assert.equal(h.nodes['[data-review-quality]'].value,'original');assert.equal(attempts,1);h.button('close').click();
});

test('A/B dimensions distinguish original stills and audio-only sources from prepared video pixels',async()=>{
  const h=harness(async()=>planned);Object.assign(h.context.document.media[0],{is_image:true,width:32,height:18});h.panes[0].img.naturalWidth=32;h.panes[0].img.naturalHeight=18;h.panes[0].video.stillLoaded=true;h.context.document.media[1].has_video=false;
  await h.review.open();chooseQuality(h,'high');await settle();assert.match(h.panes[0]['[data-review-clock]'].textContent,/Original still · 32 × 18/);assert.doesNotMatch(h.panes[0]['[data-review-clock]'].textContent,/Prepared|high/);assert.match(h.panes[1]['[data-review-clock]'].textContent,/Audio-only source/);assert.doesNotMatch(h.panes[1]['[data-review-clock]'].textContent,/Prepared|1280/);h.button('close').click();
});

test('replacement plans and confirmation use the exact B source version displayed by the native window',async()=>{
  const calls=[],h=harness(async(_path,body)=>{calls.push(body);return planned;});await h.review.open();
  h.submit();await settle();assert.equal(calls[0].replacement.source_version,h.players[1].current().source_version);assert.equal(h.button('apply').disabled,false);
  audition(h,1,1);assert.equal(h.button('apply').disabled,true);await settle();assert.equal(h.button('apply').disabled,false);
  h.button('apply').click();await settle();assert.equal(h.commits[0].replacement.source_version,'version-3');
});

test('a divergent native plan version cannot replace the take that was actually displayed',async()=>{
  const h=harness(async()=>({...planned,source_version:'replaced-file'}));await h.review.open();h.submit();await settle();
  assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);assert.match(h.nodes['[data-review-status]'].textContent,/B source changed.*refresh B/);
  h.button('apply').click();await settle();assert.equal(h.commits.length,0);h.button('close').click();
});

test('a changed B attachment without document metadata changes invalidates pending plans and confirmation',async()=>{
  for(const pending of [false,true]){
    let resolve;const h=harness(()=>pending?new Promise(done=>{resolve=done;}):Promise.resolve(planned));await h.review.open();h.submit();await settle();
    const clock=h.players[1].current;h.players[1].current=()=>({...clock(),source_version:'new-inode-same-metadata'});
    if(pending){resolve(planned);await settle();}else h.button('apply').click();
    assert.equal(h.commits.length,0);assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);assert.match(h.nodes['[data-review-status]'].textContent,/refresh B/);h.button('close').click();
  }
});

test('a B reload or dialog close owns late plan responses even when the source file version is unchanged',async()=>{
  for(const close of [false,true]){
    let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));await h.review.open();h.submit();await settle();
    if(close)h.button('close').click();else{audition(h,1,1);await settle();}
    resolve(planned);await settle();assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);assert.equal(h.commits.length,0);if(!close)h.button('close').click();
  }
});

test('still replacement waits for the loaded image FD identity and refuses a changed image binding',async()=>{
  const calls=[],h=harness(async(_path,body)=>{calls.push(body);return planned;});h.context.document.media[1].is_image=true;await h.review.open();
  assert.equal(h.button('plan').disabled,true);h.submit();await settle();assert.equal(calls.length,0);
  h.panes[1].video.stillLoaded=true;h.panes[1].img.dispatchEvent(new Event('load'));assert.equal(h.button('plan').disabled,false);
  h.submit();await settle();assert.equal(calls[0].replacement.source_version,'version-3');assert.equal(h.button('apply').disabled,false);
  h.players[1].verifiedSource=()=>({epoch:'epoch',media_id:'3',source_version:'other-file'});h.button('apply').click();await settle();assert.equal(h.commits.length,0);assert.equal(h.button('apply').disabled,true);assert.match(h.nodes['[data-review-status]'].textContent,/refresh B/);h.button('close').click();
});

test("changing a take discards a late native plan and cannot enable an obsolete confirmation",async()=>{
  let resolvePlan;const h=harness(()=>new Promise(resolve=>{resolvePlan=resolve;}));await h.review.open();assert.deepEqual(h.loaded,["2","3"]);assert.equal(h.button("apply").disabled,true);h.submit();await settle();
  h.panes[1].select.value="2";h.panes[1].select.dispatchEvent(new Event("change"));resolvePlan(planned);await settle();assert.equal(h.button("apply").disabled,true);assert.equal(h.nodes["[data-review-changes]"].children.length,0);h.button("apply").click();await settle();assert.equal(h.commits.length,0);
});
test("a short-take refusal needs explicit policy and confirmation; native refresh during commit remains safe",async()=>{
  const calls=[];const h=harness(async(path,body)=>{calls.push({path,body});if(body.replacement.duration==="preserve")throw Error("The take is too short");return planned;});await h.review.open();h.submit();await settle();assert.match(h.nodes["[data-review-status]"].textContent,/too short/);assert.equal(h.button("apply").disabled,true);assert.equal(h.commits.length,0);
  h.nodes.form.elements.duration.value="shorten";h.nodes.form.dispatchEvent(new Event("change"));h.submit();await settle();assert.equal(h.button("apply").disabled,false);assert.equal(h.nodes["[data-review-changes]"].children.length,1);h.button("apply").click();await settle();assert.equal(h.root.open,false);assert.deepEqual(h.commits,[{kind:"replace_take",replacement:{clip_id:"1",media_id:"3",source_in:0,duration:"shorten",links:"replace_linked",attributes:"preserve",audio_streams:{policy:'preserve'},source_version:"version-3"}}]);assert.equal(calls.length,2);
});
test("stale native documents and read-only ownership cannot confirm a replacement",async()=>{
  const h=harness(async()=>planned);await h.review.open();h.submit();await settle();h.context.query.revision="changed";h.review.invalidate();assert.equal(h.button("apply").disabled,true);h.button("apply").click();await settle();assert.equal(h.commits.length,0);
  await h.review.open();h.setWritable(false);h.submit();await settle();assert.equal(h.button("apply").disabled,true);assert.equal(h.commits.length,0);
});

test("native animation-key merging is visible before confirmation",async()=>{
  const h=harness(async()=>({...planned,merged_keys:2}));await h.review.open();h.submit();await settle();assert.equal(h.commits.length,0);assert.match(h.nodes["[data-review-changes]"].children[1].textContent,/2 animation key.*will merge/);assert.equal(h.button("apply").disabled,false);
});

test("native video mute controls keep the A/B audition choice exclusive",async()=>{
  const h=harness(async()=>planned);await h.review.open();assert.equal(h.panes[0].video.muted,false);assert.equal(h.panes[1].video.muted,true);
  h.panes[1].video.muted=false;h.panes[1].video.dispatchEvent(new Event("volumechange"));assert.equal(h.nodes['[name="listen"]'].value,"B");assert.equal(h.panes[0].video.muted,true);assert.equal(h.panes[1].video.muted,false);
  h.panes[1].video.muted=true;h.panes[1].video.dispatchEvent(new Event("volumechange"));assert.equal(h.nodes['[name="listen"]'].value,"silent");
});

test("linked playback rates follow native controls and independent mode still starts both takes",async()=>{
  const h=harness(async()=>planned);await h.review.open();h.panes[0].video.playbackRate=2;h.panes[0].video.dispatchEvent(new Event("ratechange"));assert.equal(h.panes[1].video.playbackRate,2);
  h.nodes['[name="sync"]'].checked=false;h.panes[1].video.playbackRate=1;h.panes[1].video.dispatchEvent(new Event("ratechange"));assert.equal(h.panes[0].video.playbackRate,2);h.button("play").click();await settle();assert.ok(h.panes.every(pane=>!pane.video.paused));await h.review.open();assert.ok(h.panes.every(pane=>pane.video.playbackRate===1));
});

test('replacement stream selection is explicit, zero-based and bounded by native B metadata',()=>{
  assert.deepEqual(replacementAudioStreams('preserve','',null),{policy:'preserve'});
  assert.deepEqual(replacementAudioStreams('select','0',2),{policy:'select',index:0});assert.deepEqual(replacementAudioStreams('select','1',2),{policy:'select',index:1});
  for(const [policy,index,count] of [['select','',2],['select','2',2],['select','-1',2],['select','0.5',2],['select','1e0',2],['select','0',0],['select','0',undefined],['select','0',NaN],['select','0','2'],['unknown','0',2]])assert.throws(()=>replacementAudioStreams(policy,index,count));
  assert.equal(replacementAudioChange({previous_audio_stream_index:null,audio_stream_index:null},2,{policy:'preserve'}),'');
  assert.match(replacementAudioChange({previous_audio_stream_index:1,audio_stream_index:0},2,{policy:'select',index:0}),/Audio stream 1 → 0 \(zero-based\)/);
  for(const change of [{previous_audio_stream_index:1,audio_stream_index:0},{previous_audio_stream_index:null,audio_stream_index:0},{previous_audio_stream_index:0,audio_stream_index:2}])assert.throws(()=>replacementAudioChange(change,2,{policy:'preserve'}));
});

test('default stream preservation keeps different linked indices visible in the native plan',async()=>{
  const calls=[],audio=index=>({...planned.changes[0],track:String(index+1),clip_id:`audio-${index}`,previous_audio_stream_index:index,audio_stream_index:index});
  const h=harness(async(_path,body)=>{calls.push(body);return {...planned,changes:[...planned.changes,audio(0),audio(1)]};});await h.review.open();
  assert.equal(h.nodes.form.elements.audio_streams.value,'preserve');assert.equal(h.nodes.form.elements.audio_stream_index.disabled,true);
  assert.match(h.nodes['[data-review-audio-streams]'].textContent,/B has 2 audio stream/);h.submit();await settle();
  assert.deepEqual(calls[0].replacement.audio_streams,{policy:'preserve'});
  const rows=h.nodes['[data-review-changes]'].children;assert.doesNotMatch(rows[0].textContent,/Audio stream/);assert.match(rows[1].textContent,/Audio stream 0 → 0/);assert.match(rows[2].textContent,/Audio stream 1 → 1/);assert.equal(h.button('apply').disabled,false);
});

test('explicit replacement stream choice is confirmed atomically without changing A/B audition',async()=>{
  const calls=[],h=harness(async(_path,body)=>{calls.push(body);return {...planned,changes:[{...planned.changes[0],track:'1',previous_audio_stream_index:0,audio_stream_index:1}]};});await h.review.open();
  const fields=h.nodes.form.elements;fields.audio_streams.value='select';fields.audio_stream_index.value='1';h.nodes.form.dispatchEvent(new Event('change'));
  assert.equal(fields.audio_stream_index.disabled,false);assert.equal(fields.audio_stream_index.max,'1');assert.equal(h.panes[0].video.muted,false);assert.equal(h.panes[1].video.muted,true);
  h.submit();await settle();assert.deepEqual(calls[0].replacement.audio_streams,{policy:'select',index:1});assert.match(h.nodes['[data-review-changes]'].children[0].textContent,/Audio stream 0 → 1/);
  h.button('apply').click();await settle();assert.deepEqual(h.commits[0].replacement.audio_streams,{policy:'select',index:1});assert.equal(h.commits.length,1);
});

test('B changes, swaps and review refresh reset explicit stream choices to preservation',async()=>{
  const h=harness(async()=>planned);await h.review.open();const fields=h.nodes.form.elements;
  const select=()=>{fields.audio_streams.value='select';fields.audio_stream_index.value='1';h.nodes.form.dispatchEvent(new Event('change'));};
  select();h.panes[1].select.value='2';h.panes[1].select.dispatchEvent(new Event('change'));await settle();assert.equal(fields.audio_streams.value,'preserve');assert.equal(fields.audio_stream_index.value,'0');assert.equal(fields.audio_stream_index.disabled,true);
  select();h.button('swap').click();await settle();assert.equal(fields.audio_streams.value,'preserve');assert.equal(fields.audio_stream_index.disabled,true);
  select();await h.review.open();assert.equal(fields.audio_streams.value,'preserve');assert.equal(fields.audio_stream_index.value,'0');assert.equal(h.button('apply').disabled,true);
});

test('stream choice changes discard late native plans before confirmation',async()=>{
  let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));await h.review.open();h.submit();await settle();
  h.nodes.form.elements.audio_streams.value='select';h.nodes.form.elements.audio_stream_index.value='1';h.nodes.form.dispatchEvent(new Event('change'));resolve(planned);await settle();
  assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);assert.equal(h.commits.length,0);
});

test('missing, zero or malformed native counts never enable automatic selected-stream plans',async()=>{
  for(const count of [undefined,0,-1,'2',NaN]){
    let calls=0;const h=harness(async()=>{calls++;return planned;});h.context.document.media[1].audio_stream_count=count;await h.review.open();
    assert.equal(h.nodes['[data-review-audio-select]'].disabled,true);assert.equal(h.nodes.form.elements.audio_stream_index.disabled,true);
    h.nodes.form.elements.audio_streams.value='select';h.nodes.form.elements.audio_stream_index.value='0';h.nodes.form.dispatchEvent(new Event('change'));h.submit();await settle();assert.equal(calls,0);assert.equal(h.button('apply').disabled,true);
  }
});

test('changed B stream metadata or changed unannounced settings invalidate confirmation',async()=>{
  for(const change of ['count','hash','policy','index']){
    const h=harness(async()=>planned);await h.review.open();h.submit();await settle();assert.equal(h.button('apply').disabled,false);
    if(change==='count')h.context.document.media[1].audio_stream_count=1;
    if(change==='hash')h.context.document.media[1].content_hash='relinked';
    if(change==='policy')h.nodes.form.elements.audio_streams.value='select';
    if(change==='index')h.nodes.form.elements.audio_stream_index.value='1';
    h.button('apply').click();await settle();assert.equal(h.commits.length,0,change);assert.equal(h.button('apply').disabled,true,change);assert.match(h.nodes['[data-review-status]'].textContent,/changed/,change);
  }
});

test('inconsistent native stream counts or partial Audio mappings cannot enable confirmation',async()=>{
  for(const result of [{...planned,audio_stream_count:1},{...planned,changes:[{...planned.changes[0],previous_audio_stream_index:1,audio_stream_index:0}]},{...planned,changes:[{...planned.changes[0],previous_audio_stream_index:null,audio_stream_index:0}]}]){
    const h=harness(async()=>result);await h.review.open();h.submit();await settle();assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);assert.equal(h.commits.length,0);
  }
});

test('comparison leadership uses exact longest native duration, stable A ties and no proxy or playback-rate guesses',()=>{
  const pane=(frames,num=24,den=1)=>({ready:true,media:{duration_frames:frames,fps:{num,den},has_video:true},video:{duration:1,playbackRate:1}});
  const a=pane(48),b=pane(144);a.video.duration=1000;b.video.duration=.1;a.video.playbackRate=100;b.video.playbackRate=.1;
  assert.equal(comparisonLeader([a,b]),b);assert.equal(comparisonDuration(b.media),6);
  b.media.duration_frames=48;assert.equal(comparisonLeader([a,b]),a);
  a.media={...a.media,duration_frames:24_000,fps:{num:24_000,den:1001}};b.media={...b.media,duration_frames:30_000,fps:{num:30_000,den:1001}};
  assert.equal(comparisonLeader([a,b]),a);b.ready=false;assert.equal(comparisonLeader([a,b]),a);
  a.media.is_image=true;assert.equal(comparisonLeader([a,b]),null);a.media.is_image=false;a.media.fps.den=0;assert.equal(comparisonLeader([a,b]),null);
  for(const changed of [{duration_frames:0},{duration_frames:1.5},{duration_frames:Infinity},{fps:{num:NaN,den:1}},{fps:{num:24,den:-1}},{fps:null}])assert.equal(comparisonDuration({...pane(48).media,...changed}),null);
});

test('a naturally ending shorter A or B holds its final picture while the longest source continues to its own end',async()=>{
  for(const shortIndex of [0,1]){
    const h=harness(async()=>planned);h.context.document.media[shortIndex].duration_frames=48;h.context.document.media[1-shortIndex].duration_frames=144;
    await h.review.open();h.button('play').click();await settle();
    const short=h.panes[shortIndex].video,long=h.panes[1-shortIndex].video;
    assert.equal(short.paused,false);assert.equal(long.paused,false);assert.equal(short.frameCallbacks.size,0);assert.equal(long.frameCallbacks.size,1);
    short.finish();assert.equal(short.ended,true);assert.equal(short.paused,true);await settle();assert.equal(long.paused,false);
    long.advance(4);await settle();assert.equal(long.currentTime,4);assert.equal(long.paused,false);assert.equal(short.paused,true);assert.equal(h.players[shortIndex].current().frame,47);
    long.finish();assert.equal(long.ended,true);assert.equal(long.paused,true);assert.equal(short.paused,true);assert.equal(long.frameCallbacks.size,0);
    h.button('close').click();
  }
});

test('equal native durations keep A as leader despite proxy lengths and playback-rate changes',async()=>{
  const h=harness(async()=>planned);h.context.document.media[1].duration_frames=72;await h.review.open();
  h.panes[0].video.duration=.25;h.panes[1].video.duration=100;h.panes[1].video.playbackRate=4;h.panes[1].video.dispatchEvent(new Event('ratechange'));
  h.button('play').click();await settle();assert.equal(h.panes[0].video.frameCallbacks.size,1);assert.equal(h.panes[1].video.frameCallbacks.size,0);
  h.panes[0].video.playbackRate=.25;h.panes[0].video.dispatchEvent(new Event('ratechange'));
  assert.equal(h.panes[1].video.playbackRate,.25);assert.equal(h.panes[0].video.frameCallbacks.size,1);assert.equal(h.panes[1].video.frameCallbacks.size,0);
  h.button('close').click();
});

test('still, unready and invalid native timing never start an invalid comparison leader',async()=>{
  const pending=harness(async()=>planned,{deferSources:true}),opening=pending.review.open();await settle();assert.equal(pending.button('play').disabled,true);
  pending.ready.get(pending.panes[0].video)();await settle();assert.equal(pending.button('play').disabled,true);pending.ready.get(pending.panes[1].video)();await opening;assert.equal(pending.button('play').disabled,false);assert.equal(pending.peak(),1);pending.button('close').click();
  const h=harness(async()=>planned);h.context.document.media[0].is_image=true;h.context.document.media[1].fps.den=0;await h.review.open();
  assert.equal(h.button('play').disabled,true);assert.match(h.panes[1].output.textContent,/invalid native source timing/);h.button('play').click();await settle();assert.equal(h.panes[0].video.playCount,0);assert.equal(h.panes[1].video.playCount,0);
  h.context.document.media[0].is_image=false;await h.review.open();h.button('play').click();await settle();assert.equal(h.panes[0].video.paused,false);assert.equal(h.panes[1].video.paused,true);assert.equal(h.panes[1].video.playCount,0);h.button('close').click();
});

test('canceled frame callbacks after swap, reopen or close cannot clear a newer schedule or align obsolete panes',async()=>{
  for(const action of ['swap','reopen','close']){
    const h=harness(async()=>planned);await h.review.open();h.button('play').click();await settle();
    const oldOwner=h.panes[1].video,oldId=[...oldOwner.frameCallbacks.keys()][0],obsolete=oldOwner.frameCallbacks.get(oldId);
    if(action==='swap'){h.button('swap').click();await settle();}
    else {if(action==='close')h.button('close').click();await h.review.open();}
    assert(oldOwner.canceledFrames.includes(oldId));h.button('play').click();await settle();
    const owner=h.panes[action==='swap'?0:1].video,follower=h.panes[action==='swap'?1:0].video;
    const activeId=[...owner.frameCallbacks.keys()][0],active=owner.frameCallbacks.get(activeId),requests=owner.requestedFrames.length;
    owner.currentTime=1.25;follower.currentTime=.25;obsolete();
    assert.equal(follower.currentTime,.25,action);assert.equal(owner.frameCallbacks.get(activeId),active,action);assert.equal(owner.requestedFrames.length,requests,action);
    owner.frameCallbacks.delete(activeId);active();await settle();assert.equal(follower.currentTime,1.25,action);assert.equal(owner.frameCallbacks.size,1,action);assert.equal(owner.requestedFrames.length,requests+1,action);
    h.button('close').click();
  }
});

function gate(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

test('absolute comparison frame mapping floors mixed native rates and clamps to the exact final frame',()=>{
  const media={duration_frames:36_000,fps:{num:30_000,den:1001}};
  assert.equal(comparisonFrame(14_401,{num:24,den:1},media),17_983);
  assert.equal(comparisonFrame(17_983,{num:30_000,den:1001},{duration_frames:24_000,fps:{num:24,den:1}}),14_400);
  assert.equal(comparisonFrame(99_999,{num:24,den:1},{duration_frames:48,fps:{num:24,den:1}}),47);
  assert.throws(()=>comparisonFrame(-1,{num:24,den:1},media));assert.throws(()=>comparisonFrame(1,{num:0,den:1},media));
});

test('full-source absolute seeks beyond 600 seconds use verified window clocks and serialize preparations',async()=>{
  const h=harness(async()=>planned);h.context.document.media[0].duration_frames=24_000;h.context.document.media[1].duration_frames=36_000;h.context.document.media[1].fps={num:30_000,den:1001};await h.review.open();
  h.seek(0,14_401);await settle();
  assert.equal(h.players[0].current().frame,14_401);assert.equal(h.players[1].current().frame,17_983);
  assert.equal(h.players[0].current().start_frame,14_401);assert.equal(h.players[1].current().start_frame,17_983);
  assert.match(h.panes[0]['[data-review-clock]'].textContent,/frame 14401.*24\/1 fps.*window \[14401, 15841\)/);
  assert.match(h.panes[1]['[data-review-clock]'].textContent,/frame 17983.*30000\/1001 fps/);
  assert.equal(h.peak(),1);assert(h.panes.every(pane=>pane.video.paused));assert(h.panes.every(pane=>pane.video.playCount===0));h.button('close').click();
});

test('one or simultaneous window EOFs freeze, prepare serially and resume exactly at the next absolute frames',async()=>{
  const h=harness(async()=>planned,{windowSeconds:2});h.context.document.media[0].duration_frames=240;h.context.document.media[1].duration_frames=360;await h.review.open();h.seek(0,47);await settle();h.button('play').click();await settle();
  h.panes[0].video.finish();assert(h.panes.every(pane=>pane.video.paused));await settle();
  assert.equal(h.players[0].current().frame,48);assert.equal(h.players[1].current().frame,48);assert(h.panes.every(pane=>!pane.video.paused));
  h.panes[1].video.finish();h.panes[0].video.finish();await settle();
  assert.equal(h.players[0].current().frame,96);assert.equal(h.players[1].current().frame,96);assert(h.panes.every(pane=>!pane.video.paused));assert.equal(h.peak(),1);
  const count=h.preparations.length;h.panes[0].video.dispatchEvent(new Event('ended'));await settle();assert.equal(h.preparations.length,count);assert.equal(h.players[0].current().frame,96);h.button('close').click();
});

test('pause, close, swap, reopen and changed context prevent late boundary preparation from autoplaying',async()=>{
  for(const action of ['pause','close','swap','reopen','context']){
    const pending=gate();const h=harness(async()=>planned,{windowSeconds:2,deferSeek:(pane,frame)=>pane===0 && frame===48?pending.promise:null});h.context.document.media[0].duration_frames=240;h.context.document.media[1].duration_frames=360;await h.review.open();h.button('play').click();await settle();h.panes[0].video.finish();await settle();assert.equal(h.players[0].preparing(),true);assert(h.panes.every(pane=>pane.video.paused));
    let reopen;
    if(action==='pause')h.button('play').click();else if(action==='context'){h.context.query.revision='changed';h.review.invalidate();}else if(action==='reopen')reopen=h.review.open();else h.button(action).click();
    pending.resolve();if(reopen)await reopen;await settle();assert(h.panes.every(pane=>pane.video.paused),action);assert(h.panes.every(pane=>pane.video.frameCallbacks.size===0),action);assert.equal(h.peak(),1,action);if(h.root.open)h.button('close').click();
  }
});

test('independent playback leaves its peer running while one window prepares and preserves native rates on attachment',async()=>{
  const pending=gate(),h=harness(async()=>planned,{windowSeconds:2,resetRate:true,deferSeek:(pane,frame)=>pane===0 && frame===48?pending.promise:null});h.context.document.media[0].duration_frames=240;h.context.document.media[1].duration_frames=360;await h.review.open();
  h.nodes['[name="sync"]'].checked=false;h.nodes['[name="sync"]'].dispatchEvent(new Event('change'));h.panes[0].video.playbackRate=2;h.panes[0].video.dispatchEvent(new Event('ratechange'));h.panes[1].video.playbackRate=.5;h.panes[1].video.dispatchEvent(new Event('ratechange'));
  h.button('play').click();await settle();h.panes[0].video.finish();await settle();assert.equal(h.panes[0].video.paused,true);assert.equal(h.panes[1].video.paused,false);pending.resolve();await settle();
  assert.equal(h.players[0].current().frame,48);assert.equal(h.players[1].current().frame,0);assert.equal(h.panes[0].video.playbackRate,2);assert.equal(h.panes[1].video.playbackRate,.5);assert(h.panes.every(pane=>!pane.video.paused));h.button('close').click();
});

test('native play waits for the second synchronized source to verify and never elects the shorter ready source',async()=>{
  const h=harness(async()=>planned,{deferSources:true}),opening=h.review.open();await settle();h.ready.get(h.panes[0].video)();await settle();await h.panes[0].video.play();await settle();
  assert.equal(h.panes[0].video.paused,true);assert.match(h.nodes['[data-review-transport-status]'].textContent,/wait for both/);
  h.ready.get(h.panes[1].video)();await opening;h.button('play').click();await settle();assert.equal(h.panes[0].video.frameCallbacks.size,0);assert.equal(h.panes[1].video.frameCallbacks.size,1);assert.equal(h.peak(),1);h.button('close').click();
});

test('a controlled absolute seek supersedes an unfinished native local-window seek without a second coordinator',async()=>{
  const h=harness(async()=>planned);await h.review.open();h.button('play').click();await settle();const oldReady=h.players[0].nativeSeek(12);assert(h.panes.every(pane=>pane.video.paused));
  h.seek(0,24);await settle();oldReady();await settle();assert.equal(h.players[0].current().frame,24);assert.equal(h.players[1].current().frame,24);assert.equal(h.preparations.filter(value=>value.type==='seek' && value.frame===24).length,2);assert(h.panes.every(pane=>pane.video.paused));h.button('close').click();
});

test('a swallowed seek failure and a rejected pane play pause the comparison without a half-playing peer',async()=>{
  const h=harness(async()=>planned);await h.review.open();h.players[1].failNext=true;h.seek(0,24);await settle();assert(h.panes.every(pane=>pane.video.paused));assert.match(h.nodes['[data-review-transport-status]'].textContent,/did not verify/);
  await h.review.open();h.panes[1].video.play=async()=>{throw Error('Playback blocked');};h.button('play').click();await settle();assert(h.panes.every(pane=>pane.video.paused));assert.match(h.nodes['[data-review-transport-status]'].textContent,/Playback blocked/);h.button('close').click();
});

test('a boundary queued during deferred pane play is drained before releasing the new windows',async()=>{
  const delayed=gate(),h=harness(async()=>planned,{windowSeconds:2});h.context.document.media[0].duration_frames=240;h.context.document.media[1].duration_frames=360;await h.review.open();
  const video=h.panes[1].video,play=video.play.bind(video);let once=true;video.play=async()=>{if(once){once=false;await delayed.promise;}return play();};
  h.button('play').click();await settle();assert.equal(h.panes[0].video.paused,false);h.panes[0].video.finish();delayed.resolve();await settle();
  assert.equal(h.players[0].current().frame,48);assert.equal(h.players[1].current().frame,48);assert(h.panes.every(pane=>!pane.video.paused));assert.equal(h.peak(),1);h.button('close').click();
});

test('late play completion after Pause cannot restart either pane',async()=>{
  const delayed=gate(),h=harness(async()=>planned);await h.review.open();const video=h.panes[1].video,play=video.play.bind(video);video.play=async()=>{await delayed.promise;return play();};
  h.button('play').click();await settle();assert.equal(h.panes[0].video.paused,false);h.button('play').click();delayed.resolve();await settle();
  assert(h.panes.every(pane=>pane.video.paused));assert(h.panes.every(pane=>pane.video.frameCallbacks.size===0));h.button('close').click();
});

test('delayed native play events while paused cannot restart comparison or leave an owned play unaccounted',async()=>{
  for(const deferredOwnedEvent of [false,true]){
    const h=harness(async()=>planned);await h.review.open();const video=h.panes[0].video,nativePlay=video.play.bind(video);let pending=deferredOwnedEvent;
    video.play=async()=>{if(!pending)return nativePlay();pending=false;video.playCount++;video.ended=false;video.paused=false;};
    h.button('play').click();await settle();h.button('play').click();const requests=h.preparations.length,plays=h.panes.map(pane=>pane.video.playCount);
    video.dispatchEvent(new Event('play'));await settle();assert(h.panes.every(pane=>pane.video.paused));assert.deepEqual(h.panes.map(pane=>pane.video.playCount),plays);assert.equal(h.preparations.length,requests);assert(h.panes.every(pane=>pane.video.frameCallbacks.size===0));
    await video.play();await settle();assert(h.panes.every(pane=>!pane.video.paused));h.button('close').click();
  }
});

test('delayed native pause events while playing cannot stop the current comparison owner',async()=>{
  const h=harness(async()=>planned);await h.review.open();h.button('play').click();await settle();const owner=h.panes[1].video,callback=[...owner.frameCallbacks.keys()][0],requests=h.preparations.length;
  h.panes[0].video.dispatchEvent(new Event('pause'));await settle();assert(h.panes.every(pane=>!pane.video.paused));assert.deepEqual([...owner.frameCallbacks.keys()],[callback]);assert.equal(h.preparations.length,requests);
  h.panes[0].video.pause();await settle();assert(h.panes.every(pane=>pane.video.paused));assert.equal(owner.frameCallbacks.size,0);h.button('close').click();
});

test('a follower already ended at its final decoded window frame waits for the running leader without replaying its proxy',async()=>{
  const h=harness(async()=>planned,{windowSeconds:2,endedAtWindowTail:pane=>pane===0});await h.review.open();h.seek(1,47);await settle();
  const follower=h.panes[0].video,leader=h.panes[1].video;assert.equal(follower.ended,true);assert(follower.currentTime<follower.duration);const plays=follower.playCount;
  h.button('play').click();await settle();assert.equal(follower.playCount,plays);assert.equal(follower.paused,true);assert.equal(leader.paused,false);assert.equal(h.players[0].current().frame,47);assert.equal(h.players[1].current().frame,47);
  leader.finish();await settle();assert.equal(h.players[0].current().frame,48);assert.equal(h.players[1].current().frame,48);assert(h.panes.every(pane=>!pane.video.paused));assert.equal(h.peak(),1);h.button('close').click();
});

test('an already-ended leader or independent origin advances its local window before playback instead of restarting the old proxy',async()=>{
  for(const synchronized of [true,false]){
    const pane=synchronized?1:0,h=harness(async()=>planned,{windowSeconds:2,endedAtWindowTail:index=>index===pane});await h.review.open();
    if(!synchronized){h.nodes['[name="sync"]'].checked=false;h.nodes['[name="sync"]'].dispatchEvent(new Event('change'));}
    h.seek(pane,47);await settle();const video=h.panes[pane].video,play=video.play.bind(video),playedFrames=[];video.play=async()=>{assert.equal(video.ended,false);playedFrames.push(h.players[pane].current().frame);return play();};assert.equal(video.ended,true);assert(video.currentTime<video.duration);
    h.button('play').click();await settle();assert.equal(h.players[pane].current().frame,48);assert.deepEqual(playedFrames,[48]);assert.equal(video.paused,false);assert.equal(h.players[1-pane].current().frame,synchronized?48:0);assert.equal(h.peak(),1);h.button('close').click();
  }
});

test('a still becoming ready does not block or restart its verified playable peer',async()=>{
  const h=harness(async()=>planned,{deferSources:true});h.context.document.media[1].is_image=true;
  const opening=h.review.open();await settle();h.ready.get(h.panes[0].video)();await settle();await h.panes[0].video.play();await settle();assert.equal(h.panes[0].video.paused,false);
  const plays=h.panes[0].video.playCount;h.ready.get(h.panes[1].video)();await opening;await settle();assert.equal(h.panes[0].video.paused,false);assert.equal(h.panes[0].video.playCount,plays);assert.equal(h.panes[1].video.playCount,0);assert.equal(h.panes[1]['[data-review-seek-submit]'].disabled,true);h.button('close').click();
});

function audition(h,pane,index){const select=h.panes[pane]['[data-review-audition-stream]'];select.value=String(index);select.dispatchEvent(new Event('change'));}

test('A and B audition streams are independent native choices and preserve replacement policy and confirmation',async()=>{
  const h=harness(async()=>planned);await h.review.open();
  for(const pane of h.panes){const select=pane['[data-review-audition-stream]'];assert.equal(select.value,'0');assert.equal(select.disabled,false);assert.deepEqual(select.children.map(option=>option.value),['0','1']);}
  h.submit();await settle();assert.equal(h.button('apply').disabled,false);audition(h,0,1);await settle();assert.equal(h.players[0].current().audio_stream_index,1);assert.equal(h.players[1].current().audio_stream_index,0);assert.equal(h.button('apply').disabled,false);
  assert.equal(h.nodes.form.elements.audio_streams.value,'preserve');assert.equal(h.nodes.form.elements.audio_stream_index.value,'0');assert.match(h.panes[0]['[data-review-clock]'].textContent,/audition audio stream 1/);
  audition(h,1,1);await settle();assert.equal(h.players[1].current().audio_stream_index,1);assert.equal(h.panes[0].video.muted,false);assert.equal(h.panes[1].video.muted,true);assert.equal(h.commits.length,0);assert.equal(h.peak(),1);h.button('close').click();
});

test('changing audition pauses both panes and persists the chosen stream through absolute source navigation',async()=>{
  const h=harness(async()=>planned);await h.review.open();h.button('play').click();await settle();audition(h,1,1);assert(h.panes.every(pane=>pane.video.paused));await settle();assert.equal(h.players[1].current().audio_stream_index,1);
  h.seek(1,24);await settle();assert.equal(h.players[1].current().audio_stream_index,1);assert.equal(h.players[0].current().audio_stream_index,0);assert.equal(h.preparations.at(-2).audio_stream_index,1);assert(h.panes.every(pane=>pane.video.paused));assert.equal(h.commits.length,0);h.button('close').click();
});

test('take changes, swaps and review refresh reset only the required audition selections to zero',async()=>{
  const h=harness(async()=>planned);await h.review.open();audition(h,0,1);await settle();audition(h,1,1);await settle();
  h.panes[0].select.value='3';h.panes[0].select.dispatchEvent(new Event('change'));await settle();assert.equal(h.panes[0]['[data-review-audition-stream]'].value,'0');assert.equal(h.panes[1]['[data-review-audition-stream]'].value,'1');
  h.button('swap').click();await settle();assert(h.panes.every(pane=>pane['[data-review-audition-stream]'].value==='0'));audition(h,0,1);await settle();await h.review.open();assert(h.panes.every(pane=>pane['[data-review-audition-stream]'].value==='0'));assert(h.players.every(player=>player.current().audio_stream_index===0));h.button('close').click();
});

test('still, silent and unknown native audio metadata disable audition choices without guessing a nonzero stream',async()=>{
  for(const metadata of [{is_image:true},{has_audio:false,audio_stream_count:0},{audio_stream_count:undefined},{audio_stream_count:'2'},{audio_stream_count:-1},{audio_stream_count:1025}]){
    const h=harness(async()=>planned);Object.assign(h.context.document.media[0],metadata);await h.review.open();const select=h.panes[0]['[data-review-audition-stream]'],requests=h.preparations.length;assert.equal(select.disabled,true);assert.equal(select.value,'0');audition(h,0,1);await settle();assert.equal(h.preparations.length,requests);assert.equal(select.value,'0');assert.equal(h.commits.length,0);h.button('close').click();
  }
});

test('changed native stream counts invalidate either pane audition and replacement confirmation',async()=>{
  for(const pane of [0,1]){
    const h=harness(async()=>planned);await h.review.open();audition(h,pane,1);await settle();h.submit();await settle();assert.equal(h.button('apply').disabled,false);h.context.document.media[pane].audio_stream_count=1;h.review.invalidate();
    assert.equal(h.panes[pane]['[data-review-audition-stream]'].disabled,true);assert.equal(h.button('play').disabled,true);assert.equal(h.button('apply').disabled,true);assert(h.panes.every(value=>value.video.paused));h.button('close').click();
  }
});

test('late old audition attachment cannot replace a newer selection or restart playback after close',async()=>{
  for(const close of [false,true]){
    const h=harness(async()=>planned,{deferSources:true}),opening=h.review.open();await settle();h.ready.get(h.panes[0].video)();await settle();h.ready.get(h.panes[1].video)();await opening;
    audition(h,0,1);await settle();const obsolete=h.ready.get(h.panes[0].video);if(close)h.button('close').click();else audition(h,0,0);obsolete();await settle();
    if(close){assert.equal(h.players[0].current(),null);assert.equal(h.root.open,false);}else{h.ready.get(h.panes[0].video)();await settle();assert.equal(h.players[0].current().audio_stream_index,0);assert.equal(h.panes[0]['[data-review-audition-stream]'].value,'0');}
    assert(h.panes.every(pane=>pane.video.paused));assert(h.panes.every(pane=>pane.video.playCount===0));assert.equal(h.peak(),1);assert.equal(h.commits.length,0);if(!close)h.button('close').click();
  }
});

test('a same-version cache clock for another audition stream cannot become a playable comparison source',async()=>{
  const h=harness(async()=>planned);await h.review.open();audition(h,0,1);await settle();const current=h.players[0].current;h.players[0].current=()=>({...current(),audio_stream_index:0});h.panes[0].video.dispatchEvent(new Event('timeupdate'));h.button('play').click();await settle();
  assert.match(h.panes[0]['[data-review-clock]'].textContent,/clock unavailable/);assert(h.panes.every(pane=>pane.video.paused));assert(h.panes.every(pane=>pane.video.playCount===0));h.button('close').click();
});

function frozenChoice(h,value){h.nodes.form.elements.frozen.value=value;h.nodes.form.dispatchEvent(new Event('change'));}
const freezeRow=(before,after,extra={})=>({...planned.changes[0],previous_freeze_source_frame:before,freeze_source_frame:after,...extra});

test('frozen policy defaults omit legacy request bytes and exact native plan labels distinguish held frames from animation source clocks',()=>{
  assert.deepEqual(replacementFrozenPolicy('reject'),{});assert.deepEqual(replacementFrozenPolicy('hold_source_in'),{frozen:'hold_source_in'});assert.deepEqual(replacementFrozenPolicy('unfreeze'),{frozen:'unfreeze'});assert.throws(()=>replacementFrozenPolicy('preserve_old_frame'));
  assert.equal(replacementFrozenChange(planned.changes[0],'reject',0),'');assert.match(replacementFrozenChange(freezeRow(0,3,{length:72,source_out:5000}),'hold_source_in',3),/held frame 0 \(silent\) → held B frame 3 \(silent, full timeline duration preserved\)/);
  assert.match(replacementFrozenChange(freezeRow(7,null),'unfreeze',3),/held frame 7 \(silent\) → moving/);assert.match(replacementFrozenChange(freezeRow(null,null),'hold_source_in',3),/moving → moving/);
  for(const [row,policy] of [[freezeRow(7,8,{length:72}),'hold_source_in'],[freezeRow(7,3),'hold_source_in'],[freezeRow(7,null,{length:72}),'hold_source_in'],[freezeRow(null,3),'hold_source_in'],[freezeRow(7,7),'unfreeze'],[freezeRow(7,7),'reject'],[freezeRow('7',3),'hold_source_in'],[planned.changes[0],'unfreeze']])assert.throws(()=>replacementFrozenChange(row,policy,3));
});

test('a frozen target requires explicit choice and Hold Source In confirms every held frame, full duration and silence',async()=>{
  const calls=[],rows=[freezeRow(0,3,{length:72,source_in:3,source_out:5000}),freezeRow(11,3,{clip_id:'linked-audio',track:'audio',previous_length:100,length:100,source_in:900,source_out:5900,previous_audio_stream_index:1,audio_stream_index:1})];
  const h=harness(async(_path,body)=>{calls.push(body);return {...planned,changes:rows};});h.context.clip.freeze_source_frame=0;await h.review.open();assert.equal(h.nodes.form.elements.frozen.value,'reject');assert.equal(h.button('plan').disabled,true);h.submit();await settle();assert.equal(calls.length,0);assert.match(h.nodes['[data-review-frozen-policy]'].textContent,/frame 0 \(silent\)/);
  frozenChoice(h,'hold_source_in');h.nodes.form.elements.source_in.value='3';h.nodes.form.dispatchEvent(new Event('input'));assert.equal(h.button('plan').disabled,false);assert.match(h.nodes['[data-review-source-in-label]'].textContent,/held frame for every frozen clip/);h.submit();await settle();assert.equal(calls[0].replacement.frozen,'hold_source_in');assert.equal(calls[0].replacement.source_in,3);assert.equal(h.button('apply').disabled,false);
  const labels=h.nodes['[data-review-changes]'].children.map(row=>row.textContent);assert.match(labels[0],/animation source clock \[3, 5000\).*held B frame 3/);assert.match(labels[1],/held frame 11 \(silent\) → held B frame 3/);assert.match(labels[1],/100 → 100 timeline frames/);assert.equal(h.commits.length,0);
  h.button('apply').click();await settle();assert.equal(h.commits.length,1);assert.equal(h.commits[0].replacement.frozen,'hold_source_in');assert.equal(h.commits[0].replacement.source_in,3);assert.equal(h.commits[0].replacement.source_version,'version-3');
});

test('Unfreeze preserves explicit short-take refusal until Shorten is chosen and confirms the native moving result',async()=>{
  const calls=[],h=harness(async(_path,body)=>{calls.push(body);if(body.replacement.duration==='preserve')throw Error('TAKE_TOO_SHORT · choose Shorten explicitly');return {...planned,changes:[freezeRow(12,null)]};});h.context.clip.freeze_source_frame=12;await h.review.open();frozenChoice(h,'unfreeze');h.submit();await settle();assert.equal(h.button('apply').disabled,true);assert.match(h.nodes['[data-review-status]'].textContent,/TAKE_TOO_SHORT/);assert.equal(h.commits.length,0);
  h.nodes.form.elements.duration.value='shorten';h.nodes.form.dispatchEvent(new Event('change'));h.submit();await settle();assert.equal(calls[1].replacement.frozen,'unfreeze');assert.equal(calls[1].replacement.duration,'shorten');assert.match(h.nodes['[data-review-changes]'].children[0].textContent,/held frame 12 \(silent\) → moving/);assert.equal(h.button('apply').disabled,false);h.button('apply').click();await settle();assert.equal(h.commits[0].replacement.frozen,'unfreeze');assert.equal(h.commits[0].replacement.duration,'shorten');
});

test('frozen policy edits invalidate late or already-confirmable plans and malformed native freeze mappings cannot apply',async()=>{
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));h.context.clip.freeze_source_frame=7;await h.review.open();frozenChoice(h,'hold_source_in');h.submit();await settle();frozenChoice(h,'unfreeze');finish({...planned,changes:[freezeRow(7,0,{length:72})]});await settle();assert.equal(h.button('apply').disabled,true);assert.equal(h.nodes['[data-review-changes]'].children.length,0);h.button('close').click();
  const confirmed=harness(async()=>({...planned,changes:[freezeRow(7,0,{length:72})]}));confirmed.context.clip.freeze_source_frame=7;await confirmed.review.open();frozenChoice(confirmed,'hold_source_in');confirmed.submit();await settle();assert.equal(confirmed.button('apply').disabled,false);confirmed.nodes.form.elements.frozen.value='unfreeze';confirmed.button('apply').click();await settle();assert.equal(confirmed.commits.length,0);assert.equal(confirmed.button('apply').disabled,true);confirmed.button('close').click();
  for(const change of [freezeRow(7,1,{length:72}),freezeRow(7,0),freezeRow(null,0,{length:72})]){
    const invalid=harness(async()=>({...planned,changes:[change]}));invalid.context.clip.freeze_source_frame=7;await invalid.review.open();frozenChoice(invalid,'hold_source_in');invalid.submit();await settle();assert.equal(invalid.button('apply').disabled,true);assert.match(invalid.nodes['[data-review-status]'].textContent,/freeze plan is inconsistent/);assert.equal(invalid.commits.length,0);invalid.button('close').click();
  }
});

test('take changes, swap, refresh and changed target freeze reset the explicit frozen policy safely',async()=>{
  const h=harness(async()=>({...planned,changes:[freezeRow(null,null)]}));await h.review.open();frozenChoice(h,'hold_source_in');h.panes[1].select.value='2';h.panes[1].select.dispatchEvent(new Event('change'));await settle();assert.equal(h.nodes.form.elements.frozen.value,'reject');
  frozenChoice(h,'unfreeze');h.button('swap').click();await settle();assert.equal(h.nodes.form.elements.frozen.value,'reject');frozenChoice(h,'hold_source_in');await h.review.open();assert.equal(h.nodes.form.elements.frozen.value,'reject');h.submit();await settle();assert.equal(h.button('apply').disabled,false);
  h.context.clip.freeze_source_frame=0;h.review.invalidate();assert.equal(h.nodes.form.elements.frozen.value,'reject');assert.equal(h.button('apply').disabled,true);assert.equal(h.commits.length,0);h.button('close').click();
});

test('compound targets show an explicit empty A choice and cannot replace an unrelated ordinary source',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return planned;});h.context.document.media.push({id:'compound',name:'Nested timeline',compound_timeline_id:'nested'});h.context.clip={...h.context.clip,kind:'media',media_id:'compound',name:'Nested timeline'};
  await h.review.open();assert.equal(h.panes[0].select.value,'');assert.deepEqual(h.loaded,['2']);assert.match(h.nodes['[data-review-target]'].textContent,/Unsupported replacement target.*Compound targets/);assert.match(h.panes[0].output.textContent,/Compound targets.*choose a comparison source explicitly/);assert.equal(h.button('plan').disabled,true);h.submit();await settle();assert.equal(calls,0);
  h.panes[0].select.value='3';h.panes[0].select.dispatchEvent(new Event('change'));await settle();assert.equal(h.players[0].current().media_id,'3');assert.equal(h.button('plan').disabled,true);assert.equal(h.button('apply').disabled,true);h.submit();await settle();assert.equal(calls,0);assert.equal(h.commits.length,0);h.button('close').click();
});

test('an unannounced compound conversion invalidates confirmation even when the target ID and revision stay unchanged',async()=>{
  const h=harness(async()=>planned);await h.review.open();h.submit();await settle();assert.equal(h.button('apply').disabled,false);h.context.document.media[0].compound_timeline_id='nested';h.button('apply').click();await settle();assert.equal(h.commits.length,0);assert.equal(h.button('apply').disabled,true);h.button('close').click();
});
