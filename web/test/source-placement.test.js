import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_DRAG_TYPE,sourceDragItems,sourcePlacementItem,sourcePlacementOperation,sourceRangePlacement,createNativeSourceInsertion} from '../js/source-placement.js';
import {nativeAssetDragItems} from '../js/timeline/asset-drop.js';
import {createInput} from '../js/timeline/input.js';
import {frameToX,timelineLayout} from '../js/timeline/geometry.js';

const context=()=>({project_epoch:'epoch',generation:'7',timeline_id:'1',timeline_revision:'r1',source_in:101,source_out:248,verified:{epoch:'epoch',media_id:'2',job:'9',source_version:'native-fd:1:2:300:4:5'},item:{id:'2',name:'Marked take',duration_frames:10000,fps:{num:30000,den:1001},has_video:true,has_audio:true,audio_stream_count:2}});
const media=streams=>sourcePlacementItem(context(),streams);
const timeline=()=>({id:'1',revision:'r1',fps:{num:24000,den:1001},tracks:[{id:'0',kind:'video',locked:false,clips:[]},{id:'1',kind:'audio',locked:false,clips:[]},{id:'2',kind:'audio',locked:false,clips:[]}]});
const view=()=>({scale:120,origin:0,playhead:0,selection:[],tool:'select',snap:false,retimeVisible:new Set(),viewportHeight:400});
function libraryContext(){
  const c=context();c.item={...c.item,id:'native-asset:library-audio',has_video:false,native_asset:{id:'library-audio',revision:'a'.repeat(64),if_generation:'3',source_version:c.verified.source_version}};c.verified.media_id=c.item.id;return c;
}
function harness(){
  const tl=timeline(),state=view(),handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),drops=[],commands=[];
  let source=media('all'),allowed=true,modal=false;
  const doc={hidden:false,querySelector:()=>modal?{}:null,addEventListener:(name,fn)=>documentHandlers.set(name,fn),removeEventListener:name=>documentHandlers.delete(name)};
  const previous=globalThis.window;globalThis.window={document:doc,addEventListener:(name,fn)=>windowHandlers.set(name,fn),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={ownerDocument:doc,clientWidth:1200,clientHeight:400,style:{},getBoundingClientRect:()=>({left:10,top:20,width:1500,height:500}),focus(){},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),hasPointerCapture:()=>false};
  const input=createInput({canvas,getTimeline:()=>tl,getAssetContext:()=>({epoch:'epoch',generation:'7',timeline:'1',revision:'r1'}),view:state,invalidate(){},onSelect(){},onSeek(){},onCommand:op=>commands.push(op),onNotice(){},canEdit:()=>allowed});
  const current=snapshot=>JSON.stringify(snapshot)===JSON.stringify(sourceDragItems([source]));
  const start=callback=>input.sourceDnd.start([source],current,callback??(draft=>drops.push(draft)));
  const event=(payload,frame=30)=>({clientX:10+frameToX(frame,state,tl.fps)*1500/1200,clientY:20+(timelineLayout(tl,state,400).trackTop(0)+25)*500/400,dataTransfer:{types:[SOURCE_DRAG_TYPE],getData:()=>payload,dropEffect:'none'},preventDefault(){this.prevented=true;},stopPropagation(){}});
  return {tl,state,source,input,handlers,windowHandlers,documentHandlers,doc,drops,commands,start,event,setSource:value=>source=value,setAllowed:value=>allowed=value,setModal:value=>modal=value,destroy(){input.destroy();globalThis.window=previous;}};
}

test('Source placement requires verified original identity and valid marked roles, independent of audition selection',()=>{
  const c=context();c.verified.audio_mode='selected';c.verified.audio_stream_index=1;
  const item=sourcePlacementItem(c,'audio_only');assert.equal(item.audio_streams,2);assert.equal(item.source_in,101);assert.equal(item.source_out,248);
  const copy=sourceDragItems([item]);copy[0].fps.num=1;assert.equal(item.fps.num,30000);
  for(const change of [c=>c.verified=null,c=>c.verified.epoch='foreign',c=>c.verified.media_id='3',c=>c.source_in=-1,c=>c.source_out=101,c=>c.source_out=10001,c=>c.item.audio_stream_count=129]){const c=context();change(c);assert.equal(sourcePlacementItem(c),null);}
  const silent=context();silent.item.has_audio=false;silent.item.audio_stream_count=0;assert.equal(sourcePlacementItem(silent,'audio_only'),null);assert.ok(sourcePlacementItem(silent,'video_only'));
  assert.equal(nativeAssetDragItems([{id:'a',revision:'r',name:'Marked',placement:{items:[item]}}]),null,'Source ranges never bypass native Library validation');
});

test('Library marked ranges keep native UUID and captured Source generation separate from project IDs and current generation',()=>{
  const c=libraryContext(),item=sourcePlacementItem(c,'audio_only');
  assert.equal(item.source_kind,'native_asset');assert.equal(item.asset_id,'library-audio');assert.equal(item.source_generation,'3');assert.equal(item.generation,'7');assert.equal(Object.hasOwn(item,'media_id'),false);assert.equal(item.audio_streams,2);
  const operation=sourcePlacementOperation(item,30,{kind:'new_audio_track'});
  assert.deepEqual(operation,{kind:'place_native_source',asset_id:'library-audio',revision:'a'.repeat(64),source_generation:'3',source_job_id:'9',source_version:c.verified.source_version,source_in:101,source_out:248,streams:'audio_only',start_frame:30,target:{kind:'new_audio_track'},overwrite:false});
  const tl=timeline(),state=view(),draft=sourceRangePlacement(tl,state,[frameToX(30,state,tl.fps),timelineLayout(tl,state,400).trackTop(1)+25],1200,400,[item]);
  assert.equal(draft.length_frames,117);assert.deepEqual(draft.outlines.map(row=>row.track_id),['1','2']);assert.equal(draft.error,null);
  for(const invalid of [{...item,media_id:'2'},{...item,source_kind:undefined},{...item,revision:'changed'},{...item,asset_id:'../asset'},{...item,source_generation:'-1'}])assert.equal(sourceDragItems([invalid]),null);
  c.item.native_asset.source_version='different';assert.equal(sourcePlacementItem(c),null);
});

test('Library insertion prepares once then sends one atomic marked placement with the ready playback job, not the analysis job',async()=>{
  const c=libraryContext(),operation=sourcePlacementOperation(sourcePlacementItem(c),40,{kind:'new_audio_track'}),calls=[],commands=[],statuses=[];
  let finish;const ready=new Promise(resolve=>finish=resolve),state={project_name:'Owned project',project_epoch:'epoch',generation:'7'};
  const insertion=createNativeSourceInsertion({getContext:()=>state,canCommit:()=>true,onStatus:text=>statuses.push(text),
    api:async(path,body)=>{calls.push({path,body});return ready;},commit:async value=>{commands.push(value);return {changed:true,clip_ids:['30','31']};}});
  const pending=insertion.run(operation,()=>true);
  assert.equal(await insertion.run(operation,()=>true),null);assert.equal(calls.length,1);assert.deepEqual(commands,[]);
  assert.deepEqual(calls[0],{path:'/native-assets/prepare',body:{project_epoch:'epoch',if_generation:'7',action:{kind:'import',asset_id:'library-audio',revision:'a'.repeat(64)}}});
  finish({id:'41',project_epoch:'epoch',generation:'7',kind:'import',state:'ready',result:{asset_id:'library-audio',revision:'a'.repeat(64)}});
  const receipt=await pending;assert.deepEqual(receipt.clip_ids,['30','31']);assert.deepEqual(commands,[{...operation,job_id:'41'}]);assert.equal(commands[0].source_job_id,'9');assert.equal(Object.hasOwn(commands[0],'media_id'),false);assert.match(statuses.at(-1),/marked Library Source inserted/i);
});

test('Library preparation cancels changed marks, contexts or explicit cancellation before dispatch; unknown writes never replay',async()=>{
  for(const change of ['marks','epoch','cancel','unknown']){
    const c=libraryContext(),operation=sourcePlacementOperation(sourcePlacementItem(c),0,{kind:'new_audio_track'}),calls=[],commands=[];
    let finish,current=true;const ready=new Promise(resolve=>finish=resolve),state={project_name:'Owned',project_epoch:'epoch',generation:'7'};
    const insertion=createNativeSourceInsertion({getContext:()=>state,canCommit:()=>true,
      api:async(path,body,options)=>{calls.push({path,body,options});return path==='/native-assets/prepare'?ready:{};},
      commit:async value=>{commands.push(value);throw Error('outcome unknown');}});
    const pending=insertion.run(operation,()=>current);
    if(change==='marks')current=false;else if(change==='epoch')state.project_epoch='other';else if(change==='cancel')insertion.cancel();
    finish({id:'41',project_epoch:'epoch',generation:'7',kind:'import',state:'ready',result:{asset_id:'library-audio',revision:'a'.repeat(64)}});
    if(change==='unknown')await assert.rejects(pending,/outcome unknown/);else assert.equal(await pending,null);
    assert.equal(commands.length,change==='unknown'?1:0);assert.equal(calls.filter(call=>call.path==='/native-assets/prepare').length,1);
    assert.equal(calls.filter(call=>call.options?.method==='DELETE').length,change==='unknown'?0:1);
  }
});

test('Source ghosts conform marked endpoints and filter video/audio roles before native target and stream resolution',()=>{
  const tl=timeline(),state=view(),point=[frameToX(30,state,tl.fps),timelineLayout(tl,state,400).trackTop(0)+25];
  for(const [role,lanes] of [['all',['0','1','2']],['video_only',['0']],['audio_only',['1','2']]]){
    const draft=sourceRangePlacement(tl,state,point,1200,400,[media(role)]);assert.equal(draft.length_frames,117,'round(out*rate) - round(in*rate), not round((out-in)*rate)');assert.equal(draft.start_frame,30);assert.deepEqual(draft.outlines.map(row=>row.track_id),lanes);assert.equal(draft.error,null);
  }
  const short={...media('video_only'),source_in:2,source_out:3};assert.equal(sourceRangePlacement(tl,state,point,1200,400,[short]),null,'zero conformed span cannot create a valid native project clip');
  tl.tracks[0].locked=true;assert.match(sourceRangePlacement(tl,state,point,1200,400,[media('audio_only')]).error,/locked/);
});

test('Source endpoint subtraction retains exact duration above the Number integer precision limit',()=>{
  const tl=timeline(),state=view();tl.fps={num:999999999,den:1};
  const item={...media('video_only'),fps:{num:1,den:1},source_in:900000000,source_out:900000001,total_frames:1000000000};
  const point=[frameToX(0,state,tl.fps),timelineLayout(tl,state,400).trackTop(0)+25];
  assert.equal(sourceRangePlacement(tl,state,point,1200,400,[item]).length_frames,999999999);
});

test('Source safe placement rejects overlap and locked linked peers; explicit overwrite remains a captured policy',()=>{
  const tl=timeline(),state=view(),point=[frameToX(30,state,tl.fps),timelineLayout(tl,state,400).trackTop(0)+25];
  tl.tracks[0].clips=[{id:'10',start_frame:30,length_frames:20,linked_group:'5'}];tl.tracks[1].clips=[{id:'11',start_frame:30,length_frames:20,linked_group:'5'}];
  assert.match(sourceRangePlacement(tl,state,point,1200,400,[media('video_only')]).error,/overlap/i);state.retimeOverwrite=true;
  assert.equal(sourceRangePlacement(tl,state,point,1200,400,[media('video_only')]).error,null);
  tl.tracks[1].locked=true;assert.match(sourceRangePlacement(tl,state,point,1200,400,[media('video_only')]).error,/linked peer is locked/);
  const operation=sourcePlacementOperation(media('video_only'),30,{kind:'new_video_track'},true);assert.deepEqual(operation,{kind:'place_source',media_id:'2',job_id:'9',source_version:'native-fd:1:2:300:4:5',source_in:101,source_out:248,streams:'video_only',start_frame:30,target:{kind:'new_video_track'},overwrite:true});
});

test('Source drop uses an opaque local token and release coordinates, with one callback and no hover mutation',async()=>{
  const h=harness();try{
    const payload=h.start();assert.ok(payload);assert.equal(payload.includes('native-fd'),false);const over=h.event(payload,20);h.handlers.get('dragover')(over);assert.equal(over.prevented,true);assert.equal(h.state.draft.kind,'source_media_placement');assert.deepEqual(h.drops,[]);assert.deepEqual(h.commands,[]);
    await h.handlers.get('drop')(h.event(payload,90));assert.equal(h.drops.length,1);assert.equal(h.drops[0].start_frame,90);assert.equal(h.drops[0].source.source_in,101);assert.equal(h.input.navigationIdle(),true);
    await h.handlers.get('drop')(h.event(payload,100));assert.equal(h.drops.length,1);
  }finally{h.destroy();}
});

test('Library Source range drags use the same guarded local ghost without masquerading as project Media or whole-asset placement',async()=>{
  const h=harness();
  try{
    const source=sourcePlacementItem(libraryContext(),'audio_only');h.setSource(source);
    const payload=h.start();h.handlers.get('dragover')(h.event(payload,20));
    assert.equal(h.state.draft.kind,'source_media_placement');assert.equal(h.state.draft.source.source_kind,'native_asset');assert.equal(h.state.draft.length_frames,117);assert.deepEqual(h.commands,[]);
    await h.handlers.get('drop')(h.event(payload,90));assert.equal(h.drops.length,1);assert.equal(h.drops[0].source.asset_id,'library-audio');assert.equal(h.drops[0].source.source_in,101);assert.equal(h.drops[0].source.source_out,248);
    await h.handlers.get('drop')(h.event(payload,100));assert.equal(h.drops.length,1);
  }finally{h.destroy();}
});

test('changed marks, streams, native Source version, modal and permission cancel Source ghosts before mutation',async()=>{
  for(const change of [h=>h.setSource({...h.source,source_in:102}),h=>h.setSource({...h.source,streams:'audio_only'}),h=>h.setSource({...h.source,source_version:'changed'}),h=>h.setSource({...h.source,job_id:'10'}),h=>h.setModal(true),h=>h.setAllowed(false),h=>h.state.scale=80]){
    const h=harness();try{const payload=h.start();h.handlers.get('dragover')(h.event(payload));change(h);h.input.checkSourceDrop();await h.handlers.get('drop')(h.event(payload));assert.deepEqual(h.drops,[]);assert.equal(h.state.draft,null);}finally{h.destroy();}
  }
});

test('accepted Source preparation survives dragend while Escape or lost visibility abort its exact owner',async()=>{
  for(const action of ['escape','visibility']){
    let finish;const pending=new Promise(resolve=>finish=resolve),h=harness();try{
      let captured;const payload=h.start((draft,current,signal)=>{captured={current,signal};return pending;}),dropping=h.handlers.get('drop')(h.event(payload));
      h.windowHandlers.get('dragend')();assert.equal(captured.current(),true);assert.equal(captured.signal.aborted,false);
      if(action==='escape')h.windowHandlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});else{h.doc.hidden=true;h.documentHandlers.get('visibilitychange')();}
      assert.equal(captured.signal.aborted,true);finish();await dropping;assert.deepEqual(h.commands,[]);assert.equal(h.state.draft,null);
    }finally{finish?.();h.destroy();}
  }
});
