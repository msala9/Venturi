import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fadeHandles,fadeDraft,frameToX,hitTest,RULER,clipSelectionAnchor} from '../js/timeline/geometry.js';
import {createInput} from '../js/timeline/input.js';

function fixture(){
  const clip={id:'9007199254740993',start_frame:20,length_frames:100,fade_in:10,fade_out:20,linked_group:'pair'};
  const timeline={id:'t1',revision:'r1',fps:{num:24,den:1},tracks:[{id:'v1',kind:'video',clips:[clip]},{id:'a1',kind:'audio',clips:[{...clip,id:'9007199254740995'}]}]};
  const view={scale:240,origin:0,scrollY:0,selection:[],snap:false,playhead:0,tool:'select'};
  return {clip,timeline,view};
}
function inputFixture(){
  const fixtureState=fixture(),handlers=new Map(),commands=[],notices=[];let captured=false,writable=true,timeline=fixtureState.timeline;
  globalThis.window={addEventListener(){},removeEventListener(){}};
  const canvas={addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0}),focus(){},setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
  const input=createInput({canvas,getTimeline:()=>timeline,view:fixtureState.view,invalidate(){},onSelect(){},onSeek(){},onCommand:async operation=>commands.push(operation),onNotice:message=>notices.push(message),canEdit:()=>writable});
  const event=(frame,y=RULER+14)=>({clientX:frameToX(frame,fixtureState.view,fixtureState.timeline.fps),clientY:y,button:0,pointerId:1,preventDefault(){}});
  return {...fixtureState,handlers,commands,notices,event,input,captured:()=>captured,writable:value=>writable=value,replaceTimeline:()=>timeline={...timeline,revision:'r2'},destroy(){input.destroy();delete globalThis.window;}};
}

test('fade handles occupy the top band and leave trim and slip hit targets intact',()=>{
  const {timeline,clip,view}=fixture();
  for(const [frame,edge] of [[30,'in'],[100,'out']])assert.equal(hitTest(frameToX(frame,view,timeline.fps),RULER+14,timeline,view).edge,edge);
  assert.equal(hitTest(frameToX(20,view,timeline.fps)+2,RULER+30,timeline,view).kind,'trim_start');
  assert.equal(hitTest(frameToX(30,view,timeline.fps),RULER+30,timeline,view).kind,'move');
  assert.equal(hitTest(frameToX(30,view,timeline.fps),RULER+14,timeline,{...view,tool:'slip'}).kind,'move');
  timeline.tracks[0].locked=true;assert.notEqual(hitTest(frameToX(30,view,timeline.fps),RULER+14,timeline,view).kind,'fade');
  assert.deepEqual(fadeHandles({...clip,length_frames:1},view,timeline.fps),[]);
  assert.deepEqual(fadeHandles({...clip,fade_in:undefined},view,timeline.fps),[]);
  const zero=fadeHandles({...clip,fade_in:0,fade_out:0},view,timeline.fps);assert.equal(zero[0].x,zero[0].left+4);assert.equal(zero[1].x,zero[1].right-4);
});

test('fade drafts retain string IDs, integer frames and independent full-length bounds',()=>{
  const {clip}=fixture();
  assert.deepEqual(fadeDraft(clip,'in',7),{kind:'fade',clip_id:clip.id,edge:'in',frames:17,original:10});
  assert.equal(fadeDraft(clip,'out',7).frames,13);
  for(const edge of ['in','out']){assert.equal(fadeDraft(clip,edge,edge==='in'?-1000:1000).frames,0);assert.equal(fadeDraft(clip,edge,edge==='in'?1000:-1000).frames,100);}
  assert.equal(clip.fade_in,10);assert.equal(clip.fade_out,20);
});

test('video and audio fade drags commit one local native property edit only at release',async()=>{
  const s=inputFixture();
  try{
    s.view.selection=['9007199254740995'];s.view.selectionAnchor=clipSelectionAnchor(s.timeline,'9007199254740995');const anchor=structuredClone(s.view.selectionAnchor);
    s.handlers.get('pointerdown')(s.event(30));assert.equal(s.captured(),true);
    s.handlers.get('pointermove')(s.event(37));assert.equal(s.commands.length,0);assert.equal(s.view.draft.frames,17);assert.equal(s.clip.fade_in,10);
    assert.deepEqual(s.view.selection,['9007199254740995']);assert.deepEqual(s.view.selectionAnchor,anchor);
    await s.handlers.get('pointerup')(s.event(37));
    assert.deepEqual(s.commands,[{kind:'set_properties',clip_id:s.clip.id,patch:{fade_in:17}}]);assert.equal(s.view.draft,null);
    s.handlers.get('pointerdown')(s.event(100,RULER+62+14));s.handlers.get('pointermove')(s.event(105,RULER+62+14));await s.handlers.get('pointerup')(s.event(105,RULER+62+14));
    assert.deepEqual(s.commands[1],{kind:'set_properties',clip_id:'9007199254740995',patch:{fade_out:15}});
  }finally{s.destroy();}
});

test('Escape, pointer cancellation, capture loss and session changes discard fade drafts',async()=>{
  for(const cancellation of ['escape','pointercancel','lostpointercapture','read-only','revision']){
    const s=inputFixture();
    try{
      s.handlers.get('pointerdown')(s.event(30));s.handlers.get('pointermove')(s.event(37));
      if(cancellation==='escape')s.handlers.get('keydown')({key:'Escape'});
      else if(cancellation==='read-only')s.writable(false);
      else if(cancellation==='revision')s.replaceTimeline();
      else s.handlers.get(cancellation)();
      await s.handlers.get('pointerup')(s.event(37));assert.equal(s.commands.length,0,cancellation);assert.equal(s.view.draft,null);assert.equal(s.captured(),false,cancellation);
    }finally{s.destroy();}
  }
});

test('a returned handle, an unchanged click and read-only editing never create an Undo',async()=>{
  const s=inputFixture();
  try{
    s.handlers.get('pointerdown')(s.event(30));await s.handlers.get('pointerup')(s.event(30));
    s.handlers.get('pointerdown')(s.event(30));s.handlers.get('pointermove')(s.event(37));s.handlers.get('pointermove')(s.event(30));await s.handlers.get('pointerup')(s.event(30));
    s.writable(false);s.handlers.get('pointerdown')(s.event(30));s.handlers.get('pointermove')(s.event(37));await s.handlers.get('pointerup')(s.event(37));assert.equal(s.commands.length,0);
  }finally{s.destroy();}
});
