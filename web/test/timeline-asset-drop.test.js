import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSET_DRAG_TYPE,nativeAssetDragItems,nativeAssetPlacement} from '../js/timeline/asset-drop.js';
import {createInput,TRANSITION_DRAG_TYPE} from '../js/timeline/input.js';
import {PRESET_DRAG_TYPE} from '../js/timeline/preset-drop.js';
import {HEADER,RULER,frameToX,timelineLayout} from '../js/timeline/geometry.js';

const asset=(id='asset-a',patch={})=>({id,revision:`revision-${id}`,name:`Native ${id}`,archived:false,placement:{project_epoch:'epoch',generation:'7',error:null,items:[{source_in:0,source_out:48,fps:{num:24,den:1},has_video:true,has_audio:true,audio_streams:1,is_image:false,...patch}]}});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness({onDrop}={}){
  let timeline={id:'9007199254740993',revision:'r1',fps:{num:24,den:1},tracks:[{id:'v1',kind:'video',locked:false,clips:[]},{id:'a1',kind:'audio',locked:false,clips:[]},{id:'a2',kind:'audio',locked:false,clips:[]}]};
  const view={scale:120,origin:0,playhead:0,selection:[],tool:'select',snap:false,retimeVisible:new Set(),viewportHeight:400};
  let context={epoch:'epoch',generation:'7',timeline:timeline.id,revision:timeline.revision},modal=false,writable=true,sourceValid=true,items=[asset()],rect={left:10,top:20,width:1500,height:500};
  const handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),commands=[],drops=[],notices=[];
  const document={hidden:false,querySelector:()=>modal?{}:null,addEventListener:(name,fn)=>documentHandlers.set(name,fn),removeEventListener:name=>documentHandlers.delete(name)};
  const oldWindow=globalThis.window;globalThis.window={document,addEventListener:(name,fn)=>windowHandlers.set(name,fn),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={ownerDocument:document,clientWidth:1200,clientHeight:400,style:{},getBoundingClientRect:()=>rect,focus(){},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),hasPointerCapture:()=>false};
  const input=createInput({canvas,getTimeline:()=>timeline,getAssetContext:()=>({...context,clip_ids:[...view.selection]}),getPresetContext:()=>context,view,invalidate(){},onSelect(){},onSeek(){},onCommand:async op=>commands.push(op),onNotice:text=>notices.push(text),canEdit:()=>writable});
  const current=snapshot=>sourceValid && JSON.stringify(snapshot)===JSON.stringify(nativeAssetDragItems(items));
  const start=(callback=(...args)=>{drops.push(args);return onDrop?.(...args);})=>input.assetDnd.start(items,current,callback);
  const event=(frame=30,{track=0,y=timelineLayout(timeline,view,400).trackTop(track)+25,type=ASSET_DRAG_TYPE,payload,...extra}={})=>({clientX:rect.left+frameToX(frame,view,timeline.fps)*rect.width/1200,clientY:rect.top+y*rect.height/400,dataTransfer:{types:[type],getData:()=>payload,dropEffect:'none'},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
  return {input,view,canvas,handlers,windowHandlers,documentHandlers,document,commands,drops,notices,event,start,current,items:()=>items,timeline:()=>timeline,context:()=>context,setItems:value=>items=value,setModal:value=>modal=value,setWritable:value=>writable=value,setSourceValid:value=>sourceValid=value,replaceTimeline(){timeline={...timeline};},moveCanvas(){rect={...rect,left:rect.left+1};},over(payload,frame=30,extra={}){const e=event(frame,{payload,...extra});handlers.get('dragover')(e);return e;},drop:(payload,frame=30,extra={})=>handlers.get('drop')(event(frame,{payload,...extra})),destroy(){input.destroy();globalThis.window=oldWindow;}};
}

test('native asset ghost conforms exact source ranges and concatenates ordered mixed roles without API calls',()=>{
  const h=harness();try{
    h.timeline().fps={num:24000,den:1001};h.setItems([asset('still',{source_out:5,fps:{num:1,den:1},is_image:true,has_audio:false,audio_streams:0}),asset('audio',{source_out:48000,fps:{num:48000,den:1},has_video:false})]);
    h.view.origin=100;
    const payload=h.start(),selection=[...h.view.selection],e=h.over(payload,100);assert.equal(e.prevented,true);assert.equal(e.dataTransfer.dropEffect,'copy');
    const draft=h.view.draft;assert.equal(draft.start_frame,100);assert.equal(draft.length_frames,144);assert.deepEqual(draft.assets.map(item=>item.asset_id),['still','audio']);
    assert.ok(draft.outlines.some(row=>row.track_id==='v1' && row.start_frame===100 && row.length_frames===120));assert.ok(draft.outlines.some(row=>row.track_id==='a1' && row.start_frame===220 && row.length_frames===24));
    assert.deepEqual(h.drops,[]);assert.deepEqual(h.commands,[]);assert.deepEqual(h.view.selection,selection);
    const protectedEvent=h.event(100);protectedEvent.dataTransfer.getData=()=>{throw Error('Hover read protected payload');};h.handlers.get('dragover')(protectedEvent);
  }finally{h.destroy();}
});

test('native default audio lanes, exact hovered video and new pane zones remain distinct',()=>{
  const h=harness();try{
    let payload=h.start();h.over(payload,10,{track:2});assert.deepEqual(h.view.draft.target,{kind:'track',track_id:'a2'});assert.ok(h.view.draft.outlines.some(row=>row.track_id==='a1'));assert.ok(!h.view.draft.outlines.some(row=>row.track_id==='a2'));
    h.input.assetDnd.end();payload=h.start();h.over(payload,10,{y:RULER+2});assert.deepEqual(h.view.draft.target,{kind:'new_video_track'});assert.ok(h.view.draft.outlines.some(row=>row.track_id===null && /New video/.test(row.name)));
    h.input.assetDnd.end();payload=h.start();h.over(payload,10,{y:399});assert.deepEqual(h.view.draft.target,{kind:'new_audio_track'});
    h.timeline().tracks[2].locked=true;h.input.assetDnd.end();payload=h.start();h.over(payload,10,{track:2});assert.match(h.view.draft.error,/locked/);
  }finally{h.destroy();}
});

test('safe overlap, overwrite and locked linked peers are explained before native placement',async()=>{
  const h=harness();try{
    h.timeline().tracks[0].clips=[{id:'video',start_frame:20,length_frames:60,linked_group:'g'}];h.timeline().tracks[1].clips=[{id:'audio',start_frame:20,length_frames:60,linked_group:'g'}];
    let payload=h.start();h.over(payload);assert.match(h.view.draft.error,/overlap/i);await h.drop(payload);assert.equal(h.drops.length,0);
    h.view.retimeOverwrite=true;payload=h.start();h.over(payload);assert.equal(h.view.draft.error,null);assert.equal(h.view.draft.overwrite,true);
    h.input.assetDnd.end();h.timeline().tracks[1].locked=true;payload=h.start();h.over(payload);assert.match(h.view.draft.error,/linked peer is locked/);await h.drop(payload);assert.equal(h.drops.length,0);
  }finally{h.destroy();}
});

test('only trusted opaque tokens drop once at release coordinates and browser dragend preserves accepted preparation',async()=>{
  const pending=deferred(),h=harness({onDrop:()=>pending.promise});try{
    const payload=h.start();assert.equal(JSON.stringify(JSON.parse(payload)).includes('asset-a'),false);h.over(payload,20);
    const dropping=h.drop(payload,90);assert.equal(h.drops.length,1);const [draft,current,signal]=h.drops[0];assert.equal(draft.start_frame,90);assert.equal(current(),true);assert.equal(h.input.navigationIdle(),false);
    h.windowHandlers.get('dragend')();assert.equal(current(),true);assert.equal(signal.aborted,false);assert.equal(h.start(),null);await h.drop(payload,100);assert.equal(h.drops.length,1);
    pending.resolve();await dropping;assert.equal(h.view.draft,null);assert.equal(h.input.navigationIdle(),true);await h.drop(payload);assert.equal(h.drops.length,1);
    const next=h.start();await h.drop(next+' ');assert.equal(h.drops.length,1);
  }finally{h.destroy();}
});

test('metadata, source, epoch, selection, viewport and permission changes cancel pending drops without stale writes',async()=>{
  for(const change of [h=>h.setSourceValid(false),h=>h.context().epoch='new',h=>h.context().generation='8',h=>h.timeline().revision='r2',h=>h.replaceTimeline(),h=>h.view.selection=['peer'],h=>h.view.videoScroll=1,h=>h.view.scale=80,h=>h.view.retimeOverwrite=true,h=>h.moveCanvas(),h=>h.setModal(true),h=>h.setWritable(false)]){
    const pending=deferred(),h=harness({onDrop:()=>pending.promise});try{
      const payload=h.start(),dropping=h.drop(payload);assert.equal(h.drops.length,1);change(h);h.input.checkAssetDrop();assert.equal(h.drops[0][2].aborted,true);assert.equal(h.drops[0][1](),false);assert.equal(h.view.draft,null);pending.resolve();await dropping;assert.deepEqual(h.commands,[]);
    }finally{h.destroy();}
  }
});

test('Escape from Library focus, blur, visibility and disposal abort the exact accepted target owner',async()=>{
  for(const action of ['escape','blur','visibility','destroy']){
    const pending=deferred(),h=harness({onDrop:()=>pending.promise});try{
      const payload=h.start(),dropping=h.drop(payload),signal=h.drops[0][2];
      if(action==='escape')h.windowHandlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});
      else if(action==='blur')h.windowHandlers.get('blur')();else if(action==='visibility'){h.document.hidden=true;h.documentHandlers.get('visibilitychange')();}else h.input.destroy();
      assert.equal(signal.aborted,true,action);pending.resolve();await dropping;assert.deepEqual(h.commands,[]);assert.equal(h.view.draft,null);
    }finally{h.destroy();}
  }
});

test('invalid/offline metadata, oversized sets, foreign MIME and reentrant sources never prepare',async()=>{
  const h=harness();try{
    for(const items of [[],Array.from({length:33},(_,i)=>asset(`asset-${i}`)),[asset(),asset()],[{...asset(),archived:true}],[{...asset(),placement:{items:[],error:'Offline'}}],[asset('bad',{source_out:0})],[asset('bad',{fps:{num:0,den:1}})]]){h.setItems(items);assert.equal(h.start(),null);}
    h.setItems([asset()]);h.context().generation='8';assert.equal(h.start(),null);h.context().generation='7';h.items()[0].placement.project_epoch='foreign';assert.equal(h.start(),null);h.setItems([asset()]);assert.equal(h.input.assetDnd.start(h.items(),()=>Promise.resolve(true),()=>{}),null);
    let mutate=false;const payload=h.input.assetDnd.start(h.items(),()=>{if(mutate)h.view.selection=['changed'];return true;},()=>assert.fail('Reentrant stale drop'));mutate=true;await h.drop(payload);assert.equal(h.view.draft,null);
    const next=h.start();h.over(next,30,{type:PRESET_DRAG_TYPE});h.over(next,30,{type:TRANSITION_DRAG_TYPE});assert.equal(h.view.draft,null);assert.deepEqual(h.drops,[]);
    const outside=nativeAssetPlacement(h.timeline(),h.view,[HEADER-1,100],1200,400,h.items());assert.equal(outside,null);
  }finally{h.destroy();}
});
