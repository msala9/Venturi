import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT_POOL_DRAG_TYPE,projectPoolItems,projectPoolDragItems,projectPoolOperation,projectPoolRangePlacement,projectPoolTarget} from '../js/project-pool-placement.js';
import {nativeAssetDragItems} from '../js/timeline/asset-drop.js';
import {createInput} from '../js/timeline/input.js';
import {frameToX,timelineLayout} from '../js/timeline/geometry.js';

const context=()=>({project_epoch:'epoch',generation:'7',timeline_id:'1',timeline_revision:'r1'});
const item=(id='2')=>({id,name:`Take ${id}`,content_hash:'123',duration_frames:147,fps:{num:30000,den:1001},has_video:true,has_audio:true,audio_stream_count:2,offline:false});
const timeline=()=>({id:'1',revision:'r1',fps:{num:24000,den:1001},tracks:[{id:'0',kind:'video',locked:false,clips:[]},{id:'1',kind:'audio',locked:false,clips:[]},{id:'2',kind:'audio',locked:false,clips:[]}]});
const view=()=>({scale:120,origin:0,playhead:0,selection:[],tool:'select',snap:false,retimeVisible:new Set(),viewportHeight:400});
const sources=()=>projectPoolItems(context(),[item('9007199254740993'),item('3')]);

test('project pool placement captures ordered full native sources without requiring Source previews or marks',()=>{
  const media=item(),still={...item('4'),is_image:true,duration_frames:0,fps:{num:30000,den:1001}},compound={...item('5'),compound_timeline_id:'7'};
  const list=projectPoolItems({...context(),source_in:10,source_out:20},[compound,still,media]);
  assert.deepEqual(list.map(item=>[item.media_id,item.source_in,item.source_out]),[['5',0,147],['4',0,150],['2',0,147]]);
  assert.equal(Object.hasOwn(list[0],'job_id'),false);assert.equal(Object.hasOwn(list[0],'source_version'),false);
  assert.deepEqual(projectPoolOperation(list,30,{kind:'new_video_track'},true),{kind:'place_project_media',media_ids:['5','4','2'],start_frame:30,target:{kind:'new_video_track'},overwrite:true});
  list[2].fps.num=1;assert.equal(media.fps.num,30000);
  for(const invalid of [{...media,offline:true},{...media,duration_frames:0},{...media,fps:{num:24,den:0}},{...media,audio_stream_count:0}])assert.equal(projectPoolItems(context(),[invalid]),null);
});

test('project media selection supports256 native IDs without raising native Library32-item admission',()=>{
  const media=Array.from({length:256},(_,index)=>item(String(index)));
  assert.equal(projectPoolItems(context(),media).length,256);
  assert.equal(projectPoolItems(context(),[...media,item('256')]),null);
  assert.equal(projectPoolItems(context(),[media[0],media[0]]),null);
  assert.equal(projectPoolItems(context(),media.map(item=>({...item,audio_stream_count:128}))),null,'oversized clip sets are refused before ghost allocation');
  const mixed=sources();mixed[1].generation='8';assert.equal(projectPoolDragItems(mixed),null);
  assert.equal(nativeAssetDragItems(sources()),null,'pool IDs are not native library revisions');
});

test('pool ghosts preserve order and native endpoint conformance across all destination audio lanes',()=>{
  const tl=timeline(),state=view(),point=[frameToX(30,state,tl.fps),timelineLayout(tl,state,400).trackTop(0)+25];
  const draft=projectPoolRangePlacement(tl,state,point,1200,400,sources());
  assert.equal(draft.kind,'project_media_placement');assert.equal(draft.length_frames,236);assert.equal(draft.start_frame,30);
  assert.deepEqual(draft.media_ids,['9007199254740993','3']);assert.deepEqual(draft.outlines.map(row=>[row.track_id,row.start_frame,row.length_frames]),[['0',30,118],['1',30,118],['2',30,118],['0',148,118],['1',148,118],['2',148,118]]);
  const many=projectPoolItems(context(),Array.from({length:33},(_,index)=>({...item(String(index)),duration_frames:1,fps:tl.fps})));
  assert.equal(projectPoolRangePlacement(tl,state,point,1200,400,many).length_frames,33,'generic placement does not silently truncate pool selection to Library32');
  tl.tracks[0].locked=true;assert.match(projectPoolRangePlacement(tl,state,point,1200,400,sources()).error,/locked/);
  assert.deepEqual(projectPoolTarget(tl,sources()),{kind:'track',track_id:'1'});
  assert.deepEqual(projectPoolTarget({...tl,tracks:[]},sources()),{kind:'new_video_track'});
});

function harness(){
  const tl=timeline(),state=view(),handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),drops=[];
  let selected=sources(),allowed=true,modal=false;
  const doc={hidden:false,querySelector:()=>modal?{}:null,addEventListener:(name,fn)=>documentHandlers.set(name,fn),removeEventListener:name=>documentHandlers.delete(name)};
  const previous=globalThis.window;globalThis.window={document:doc,addEventListener:(name,fn)=>windowHandlers.set(name,fn),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={ownerDocument:doc,clientWidth:1200,clientHeight:400,style:{},getBoundingClientRect:()=>({left:10,top:20,width:1500,height:500}),focus(){},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),hasPointerCapture:()=>false};
  const input=createInput({canvas,getTimeline:()=>tl,getAssetContext:()=>({epoch:'epoch',generation:'7',timeline:'1',revision:'r1'}),view:state,invalidate(){},onSelect(){},onSeek(){},onCommand:assert.fail,onNotice(){},canEdit:()=>allowed});
  const start=callback=>input.projectPoolDnd.start(selected,items=>JSON.stringify(items)===JSON.stringify(selected),callback??(draft=>drops.push(draft)));
  const event=(payload,frame=30)=>({clientX:10+frameToX(frame,state,tl.fps)*1500/1200,clientY:20+(timelineLayout(tl,state,400).trackTop(0)+25)*500/400,dataTransfer:{types:[PROJECT_POOL_DRAG_TYPE],getData:()=>payload,dropEffect:'none'},preventDefault(){this.prevented=true;},stopPropagation(){}});
  return {tl,state,input,handlers,windowHandlers,documentHandlers,doc,drops,start,event,setSelected:value=>selected=value,setAllowed:value=>allowed=value,setModal:value=>modal=value,destroy(){input.destroy();globalThis.window=previous;}};
}

test('project pool drop uses opaque local ownership, release coordinates and one mutation only',async()=>{
  const h=harness();try{
    const payload=h.start();assert.ok(payload);assert.equal(payload.includes('9007199254740993'),false);
    h.handlers.get('dragover')(h.event(payload,20));assert.equal(h.state.draft.kind,'project_media_placement');assert.deepEqual(h.drops,[]);
    await h.handlers.get('drop')(h.event(payload,90));assert.equal(h.drops.length,1);assert.equal(h.drops[0].start_frame,90);assert.deepEqual(h.drops[0].media_ids,['9007199254740993','3']);assert.equal(h.input.navigationIdle(),true);
    await h.handlers.get('drop')(h.event(payload,100));assert.equal(h.drops.length,1);
  }finally{h.destroy();}
});

test('selection order, native generation, modal, read-only and changed timeline viewport invalidate project media drops',async()=>{
  for(const change of [h=>h.setSelected(sources().reverse()),h=>h.setSelected([{...sources()[0],content_hash:'124'}]),h=>h.tl.revision='changed',h=>h.setModal(true),h=>h.setAllowed(false),h=>h.state.scale=80]){
    const h=harness();try{const payload=h.start();h.handlers.get('dragover')(h.event(payload));change(h);h.input.checkProjectPoolDrop();await h.handlers.get('drop')(h.event(payload));assert.deepEqual(h.drops,[]);assert.equal(h.state.draft,null);}finally{h.destroy();}
  }
});

test('accepted project media placement survives dragend but Escape and visibility revoke the pending owner',async()=>{
  for(const action of ['escape','visibility']){
    let finish;const pending=new Promise(resolve=>finish=resolve),h=harness();try{
      let captured;const payload=h.start((draft,current,signal)=>{captured={current,signal};return pending;}),dropping=h.handlers.get('drop')(h.event(payload));
      h.windowHandlers.get('dragend')();assert.equal(captured.current(),true);
      if(action==='escape')h.windowHandlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});else{h.doc.hidden=true;h.documentHandlers.get('visibilitychange')();}
      assert.equal(captured.signal.aborted,true);finish();await dropping;assert.equal(h.state.draft,null);
    }finally{finish?.();h.destroy();}
  }
});
