import test from 'node:test';
import assert from 'node:assert/strict';
import {EFFECT_DRAG_TYPE,effectDragItem,effectDragItems,effectPlacement,effectPlacementOperation} from '../js/timeline/effect-drop.js';
import {createInput} from '../js/timeline/input.js';
import {frameToX,timelineLayout} from '../js/timeline/geometry.js';

const context={project_epoch:'epoch',generation:'7'};
const generator=(kind='title')=>effectDragItem(context,{kind:'generator',generator:kind});
const filter=(kind='GaussianBlur',preset)=>effectDragItem(context,{kind:'filter',filter:kind,...(preset?{preset}:{})});
const timeline=()=>({id:'1',revision:'r1',fps:{num:30000,den:1001},tracks:[{id:'0',kind:'video',locked:false,clips:[]},{id:'1',kind:'audio',locked:false,clips:[]},{id:'2',kind:'video',locked:false,clips:[]}]});
const view=()=>({scale:120,origin:0,playhead:0,selection:[],tool:'select',snap:false,retimeVisible:new Set(),viewportHeight:400});
const point=(tl,state,track,frame=30)=>[frameToX(frame,state,tl.fps),timelineLayout(tl,state,400).trackTop(track)+25];
function harness(){
  const tl=timeline(),state=view(),handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),drops=[],commands=[];
  let allowed=true,modal=false,current=true;
  const doc={hidden:false,querySelector:()=>modal?{}:null,addEventListener:(name,fn)=>documentHandlers.set(name,fn),removeEventListener:name=>documentHandlers.delete(name)};
  const previous=globalThis.window;globalThis.window={document:doc,addEventListener:(name,fn)=>windowHandlers.set(name,fn),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={ownerDocument:doc,clientWidth:1200,clientHeight:400,style:{},getBoundingClientRect:()=>({left:10,top:20,width:1500,height:500}),focus(){},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),hasPointerCapture:()=>false};
  const input=createInput({canvas,getTimeline:()=>tl,getAssetContext:()=>({...context,timeline:'1',revision:'r1'}),view:state,invalidate(){},onSelect(){},onSeek(){},onCommand:operation=>commands.push(operation),onNotice(){},canEdit:()=>allowed});
  const start=callback=>input.effectDnd.start([generator()],()=>current,callback??(draft=>drops.push(effectPlacementOperation(draft))));
  const event=(payload,frame=30)=>{const [x,y]=point(tl,state,0,frame);return {clientX:10+x*1500/1200,clientY:20+y*500/400,dataTransfer:{types:[EFFECT_DRAG_TYPE],getData:()=>payload,dropEffect:'none'},preventDefault(){this.prevented=true;},stopPropagation(){}};};
  return {tl,state,input,handlers,windowHandlers,documentHandlers,doc,drops,commands,start,event,setAllowed:value=>allowed=value,setModal:value=>modal=value,setCurrent:value=>current=value,destroy(){input.destroy();globalThis.window=previous;}};
}

test('native palette generators use five-second rational lengths and native video destinations',()=>{
  const tl=timeline(),state=view();
  for(const kind of ['title','solid','adjustment']){
    const draft=effectPlacement(tl,state,point(tl,state,1),1200,400,[generator(kind)]);
    assert.equal(draft.length_frames,150);assert.equal(draft.error,null);
    assert.deepEqual(draft.outlines.map(row=>row.track_id),['0'],'audio hover falls back to the first unlocked native video index');
    assert.deepEqual(effectPlacementOperation(draft),{kind:'place_generator',generator:kind,start_frame:30,target:{kind:'track',track_id:'1'},overwrite:false});
  }
  const layout=timelineLayout(tl,state,400),newVideo=effectPlacement(tl,state,[frameToX(30,state,tl.fps),layout.videoPane.top+2],1200,400,[generator()]);
  assert.equal(newVideo.target.kind,'new_video_track');assert.equal(newVideo.error,null);
  const newAudio=effectPlacement(tl,state,[frameToX(30,state,tl.fps),layout.audioPane.bottom-3],1200,400,[generator()]);
  assert.equal(newAudio.target.kind,'new_audio_track');assert.match(newAudio.error,/video/);assert.throws(()=>effectPlacementOperation(newAudio));
});

test('palette ghosts retain overlap policy, snapping, locks and track capacity',()=>{
  const tl=timeline(),state=view();tl.tracks[0].clips=[{id:'10',start_frame:30,length_frames:20}];
  assert.match(effectPlacement(tl,state,point(tl,state,0),1200,400,[generator()]).error,/overlap/);
  state.retimeOverwrite=true;assert.equal(effectPlacement(tl,state,point(tl,state,0),1200,400,[generator()]).error,null);
  tl.tracks[1].locked=true;assert.match(effectPlacement(tl,state,point(tl,state,1),1200,400,[generator()]).error,/locked/);
  state.snap=true;state.retimeOverwrite=false;
  const snap=effectPlacement(tl,state,point(tl,state,2,51),1200,400,[generator()]);assert.equal(snap.start_frame,50);
  tl.tracks.push(...Array.from({length:125},(_,index)=>({id:String(index+3),kind:'video',locked:false,clips:[]})));
  state.videoScroll=timelineLayout(tl,state,400).videoMaxScroll;
  const layout=timelineLayout(tl,state,400),full=effectPlacement(tl,state,[frameToX(30,state,tl.fps),layout.videoPane.top+2],1200,400,[generator()]);
  assert.match(full.error,/track limit/);
});

test('filter drops target the pointer clip without expanding selection and serialize the native monochrome entry',()=>{
  const tl=timeline(),state=view();state.selection=['10','11'];
  tl.tracks[0].clips=[{id:'10',start_frame:0,length_frames:150,linked_group:'5'}];
  tl.tracks[2].clips=[{id:'11',start_frame:0,length_frames:150,linked_group:'5'}];
  const draft=effectPlacement(tl,state,point(tl,state,2),1200,400,[filter('ColorCorrection','BlackAndWhite')]);
  assert.deepEqual(effectPlacementOperation(draft),{kind:'apply_palette_filter',clip_id:'11',filter:'ColorCorrection',preset:'BlackAndWhite'});
  assert.equal(effectPlacement(tl,state,point(tl,state,2,200),1200,400,[filter()]),null);
  tl.tracks[2].locked=true;assert.match(effectPlacement(tl,state,point(tl,state,2),1200,400,[filter()]).error,/locked/);
  tl.tracks[1].clips=[{id:'12',start_frame:0,length_frames:150}];assert.match(effectPlacement(tl,state,point(tl,state,1),1200,400,[filter()]).error,/video/);
  assert.equal(effectDragItems([generator(),filter()]),null);assert.equal(effectDragItem(context,{kind:'filter',filter:'Exposure',preset:'BlackAndWhite'}),null);
});

test('actual timeline effect drop uses an opaque owner and release coordinates, dispatching only once',async()=>{
  const h=harness();try{
    const payload=h.start();assert.ok(payload);assert.equal(payload.includes('title'),false);
    const over=h.event(payload,20);h.handlers.get('dragover')(over);assert.equal(over.prevented,true);assert.equal(h.state.draft.kind,'effect_generator_placement');assert.deepEqual(h.commands,[]);assert.deepEqual(h.drops,[]);
    await h.handlers.get('drop')(h.event(payload,90));assert.equal(h.drops.length,1);assert.equal(h.drops[0].start_frame,90);assert.equal(h.input.navigationIdle(),true);
    await h.handlers.get('drop')(h.event(payload,100));assert.equal(h.drops.length,1);
  }finally{h.destroy();}
});

test('changed palette ownership, revision, modal, viewport and readonly state cancel without dispatch',async()=>{
  for(const change of [h=>h.setCurrent(false),h=>h.tl.revision='r2',h=>h.setModal(true),h=>h.setAllowed(false),h=>h.state.scale=80,h=>h.doc.hidden=true]){
    const h=harness();try{const payload=h.start();h.handlers.get('dragover')(h.event(payload));change(h);h.input.checkEffectDrop();await h.handlers.get('drop')(h.event(payload));assert.deepEqual(h.drops,[]);assert.equal(h.state.draft,null);}finally{h.destroy();}
  }
});

test('accepted effect commit survives dragend while Escape cancels its exact pending owner',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve),h=harness();try{
    let captured;const payload=h.start((draft,current,signal)=>{captured={current,signal};return pending;}),dropping=h.handlers.get('drop')(h.event(payload));
    h.windowHandlers.get('dragend')();assert.equal(captured.current(),true);assert.equal(captured.signal.aborted,false);
    h.windowHandlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});
    assert.equal(captured.signal.aborted,true);assert.equal(captured.current(),false);finish();await dropping;assert.equal(h.state.draft,null);assert.deepEqual(h.commands,[]);
  }finally{finish?.();h.destroy();}
});
