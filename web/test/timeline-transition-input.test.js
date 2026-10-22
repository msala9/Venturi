import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInput} from '../js/timeline/input.js';
import {frameToX,RULER,TRACK,transitionHandles,timelineLayout} from '../js/timeline/geometry.js';

function fixture(crossing=false){
  const transition={kind:'Push',duration:20,direction:'Up',ease:'InOut',curve:0.375};
  const left={id:'9007199254740993',kind:'media',start_frame:20,length_frames:100,fade_in:10,fade_out:10,linked_group:null,trim_limits:{start:[20,119],end:[21,120]},transition_in:{...transition,duration:10},transition_out:crossing?null:{...transition}};
  const right={id:'9007199254740995',kind:'media',start_frame:120,length_frames:80,fade_in:10,fade_out:10,linked_group:null,trim_limits:{start:[120,199],end:[121,200]}};
  const track={id:'v1',kind:'video',locked:false,clips:[left,right],crossings:crossing?[{left_clip:left.id,right_clip:right.id,start_frame:110,end_frame:130,kind:transition.kind,transition:{...transition}}]:[]};
  return {timeline:{id:'t1',revision:'r1',fps:{num:24,den:1},tracks:[track]},view:{scale:240,origin:0,scrollY:0,selection:[],snap:false,playhead:0,tool:'select'},left,right,transition};
}
function harness(crossing=false){
  const state=fixture(crossing),canvasHandlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),commands=[],notices=[],captures=new Set();
  let timeline=state.timeline,writable=true,selections=0,dialog=false,rect={left:5,top:8,width:2200,height:300};const originalWindow=globalThis.window;
  const document={hidden:false,querySelector:()=>dialog?{}:null,addEventListener:(name,callback)=>documentHandlers.set(name,callback),removeEventListener:name=>documentHandlers.delete(name)};
  globalThis.window={document,addEventListener:(name,callback)=>windowHandlers.set(name,callback),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={ownerDocument:document,style:{},addEventListener:(name,callback)=>canvasHandlers.set(name,callback),removeEventListener:name=>canvasHandlers.delete(name),focus(){},getBoundingClientRect:()=>({...rect}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);canvasHandlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,view:state.view,invalidate(){},onSelect:()=>selections++,onSeek(){},onCommand:async operation=>commands.push(operation),onNotice:message=>notices.push(message),canEdit:()=>writable});
  function event(frame,extra={}){return {clientX:rect.left+frameToX(frame,state.view,timeline.fps),clientY:rect.top+timelineLayout(timeline,state.view).trackTop(0)+TRACK-14,pointerId:1,button:0,buttons:1,preventDefault(){},stopPropagation(){},...extra};}
  return {...state,input,commands,notices,canvasHandlers,windowHandlers,documentHandlers,document,canvas,event,send:(name,frame,extra={})=>canvasHandlers.get(name)(event(frame,extra)),captured:id=>captures.has(id),selected:()=>selections,setWritable:value=>writable=value,setDialog:value=>dialog=value,
    replaceTimeline(){timeline={...timeline,revision:'r2'};},changeRect(){rect={...rect,left:rect.left+1};},destroy(){input.destroy();globalThis.window=originalWindow;}};
}

test('edge transition duration drags preserve every native field and send only on owner release',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',30);assert.equal(h.captured(1),true);assert.equal(h.selected(),0);
    for(let frame=31;frame<=37;frame++)h.send('pointermove',frame);
    assert.equal(h.commands.length,0);assert.equal(h.view.draft.duration,17);assert.equal(h.left.transition_in.duration,10);
    h.send('pointermove',60,{pointerId:2});await h.send('pointerup',60,{pointerId:2,buttons:0});h.canvasHandlers.get('pointercancel')({pointerId:2});
    assert.equal(h.commands.length,0);assert.equal(h.captured(1),true);
    await h.send('pointerup',39,{buttons:0});
    assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:h.left.id,slot:'in',transition:{...h.left.transition_in,duration:19}}]);
    assert.equal(h.captured(1),false);assert.equal(h.view.draft,null);assert.deepEqual(h.view.selection,[]);
  }finally{h.destroy();}
});

test('crossing handles draft both native window ends and commit through the left clip',async()=>{
  for(const side of ['left','right']){
    const h=harness(true);
    try{
      const initial=side==='left'?110:130,target=side==='left'?107.5:132.5;
      h.send('pointerdown',initial);h.send('pointermove',target);
      assert.equal(h.commands.length,0);assert.equal(h.view.draft.duration,25);assert.deepEqual([h.view.draft.start_frame,h.view.draft.end_frame],[107,132]);assert.equal(h.view.draft.handles.length,2);
      await h.send('pointerup',target,{buttons:0});
      assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:h.left.id,slot:'cut_after',transition:{...h.transition,duration:25}}]);
    }finally{h.destroy();}
  }
});

test('authoritative release coordinates apply without a delivered move event and clamp native bounds',async()=>{
  for(const [crossing,start,end,slot,duration] of [[false,30,1000,'in',100],[false,100,1000,'out',1],[true,110,-1000,'cut_after',160]]){
    const h=harness(crossing);
    try{
      h.send('pointerdown',start);await h.send('pointerup',end,{buttons:0});assert.equal(h.commands.length,1);assert.equal(h.commands[0].slot,slot);assert.equal(h.commands[0].transition.duration,duration);
    }finally{h.destroy();}
  }
});

test('no movement, returned handles and read-only attempts never create a transition Undo',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',30);await h.send('pointerup',30,{buttons:0});
    h.send('pointerdown',30);h.send('pointermove',37);await h.send('pointerup',30,{buttons:0});
    h.setWritable(false);h.send('pointerdown',30);h.send('pointermove',37);await h.send('pointerup',37,{buttons:0});
    assert.deepEqual(h.commands,[]);assert.equal(h.captured(1),false);
  }finally{h.destroy();}
});

test('transition drafts cancel on owner loss, stale timeline/view/tool and editing capability changes',async()=>{
  for(const change of ['escape','pointercancel','capture','blur','resize','scroll','visibility','readonly','revision','lock','scale','origin','scrollY','tool','selection','rect','wheel','destroy']){
    const h=harness();
    try{
      h.send('pointerdown',30);h.send('pointermove',37);
      if(change==='escape')h.canvasHandlers.get('keydown')({key:'Escape'});
      else if(change==='pointercancel')h.canvasHandlers.get('pointercancel')({pointerId:1});
      else if(change==='capture')h.canvasHandlers.get('lostpointercapture')({pointerId:1});
      else if(['blur','resize','scroll'].includes(change))h.windowHandlers.get(change)();
      else if(change==='visibility'){h.document.hidden=true;h.documentHandlers.get('visibilitychange')();}
      else if(change==='readonly')h.setWritable(false);
      else if(change==='revision')h.replaceTimeline();
      else if(change==='lock')h.timeline.tracks[0].locked=true;
      else if(change==='scale')h.view.scale*=2;
      else if(change==='origin')h.view.origin=5;
      else if(change==='scrollY')h.view.scrollY=1;
      else if(change==='tool')h.view.tool='slip';
      else if(change==='selection')h.view.selection=[h.left.id];
      else if(change==='rect')h.changeRect();
      else if(change==='wheel')h.canvasHandlers.get('wheel')(h.event(37,{deltaX:0,deltaY:1}));
      else if(change==='destroy'){h.input.destroy();assert.equal(h.captured(1),false);continue;}
      await h.send('pointerup',39,{buttons:0});assert.deepEqual(h.commands,[],change);assert.equal(h.captured(1),false,change);assert.equal(h.view.draft,null,change);
    }finally{h.destroy();}
  }
});

test('open dialogs block transition capture and cancel existing duration drafts before move or release',async()=>{
  for(const phase of ['before_begin','before_move','before_release']){
    const h=harness();try{
      if(phase==='before_begin')h.setDialog(true);else{h.send('pointerdown',30);h.send('pointermove',37);assert.equal(h.captured(1),true);assert.equal(h.view.draft.duration,17);h.setDialog(true);}
      if(phase==='before_begin')h.send('pointerdown',30);if(phase!=='before_release')h.send('pointermove',38);await h.send('pointerup',39,{buttons:0});
      assert.deepEqual(h.commands,[],phase);assert.equal(h.captured(1),false,phase);assert.equal(h.view.draft??null,null,phase);assert.equal(h.left.transition_in.duration,10,phase);
      h.setDialog(false);h.send('pointerdown',30);h.send('pointermove',37);await h.send('pointerup',39,{buttons:0});
      assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:h.left.id,slot:'in',transition:{...h.left.transition_in,duration:19}}]);assert.equal(h.captured(1),false);assert.equal(h.view.draft,null);
    }finally{h.destroy();}
  }
});

test('Alt keeps transition handle priority and pans blank time; fade, Slip and bottom trim remain independent',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',30,{altKey:true});h.send('pointermove',37,{altKey:true});await h.send('pointerup',37,{altKey:true,buttons:0});assert.equal(h.commands[0].kind,'set_transition');assert.equal(h.commands[0].transition.duration,17);
    h.send('pointerdown',240,{altKey:true});h.send('pointermove',247,{altKey:true});await h.send('pointerup',247,{altKey:true,buttons:0});assert.equal(h.commands.length,1);
    h.view.origin=0;h.send('pointerdown',30,{clientY:8+timelineLayout(h.timeline,h.view).trackTop(0)+14});h.send('pointermove',35,{clientY:8+timelineLayout(h.timeline,h.view).trackTop(0)+14});await h.send('pointerup',35,{clientY:8+timelineLayout(h.timeline,h.view).trackTop(0)+14,buttons:0});assert.equal(h.commands[1].kind,'set_properties');assert.equal(h.commands[1].patch.fade_in,15);
    h.view.tool='slip';assert.deepEqual(transitionHandles(h.timeline.tracks[0],h.view,h.timeline.fps),[]);
    h.view.tool='select';h.send('pointerdown',20,{clientY:8+timelineLayout(h.timeline,h.view).trackTop(0)+TRACK-3});h.send('pointermove',21,{clientY:8+timelineLayout(h.timeline,h.view).trackTop(0)+TRACK-3});await h.send('pointerup',21,{clientY:8+timelineLayout(h.timeline,h.view).trackTop(0)+TRACK-3,buttons:0});assert.deepEqual(h.commands[2],{kind:'trim_group',clip_id:h.left.id,clip_ids:[h.left.id],edge:'start',frame:21,overwrite:false});
  }finally{h.destroy();}
});
