import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInput,isRetimeShortcut} from '../js/timeline/input.js';
import {frameToX,RULER,HEADER,hitTest,fadeHandles,retimeHandles,retimeStrips,retimeSpeedLabel,timelineLayout} from '../js/timeline/geometry.js';

function harness({linked=false}={}){
  const clip={id:'9007199254740993',kind:'media',start_frame:20,length_frames:100,linked_group:linked?'linked':null,fade_in:10,fade_out:20,retime:{source_span:200,min_length:2,max_length:20000,pitch_correction:true,speed_percent:199.875}};
  const following={...clip,id:'9007199254740999',start_frame:140,length_frames:80,linked_group:null};
  const tracks=[{id:'v',kind:'video',locked:false,clips:[clip,following],crossings:[]}];
  if(linked)tracks.push({id:'a',kind:'audio',locked:false,clips:[{...structuredClone(clip),id:'9007199254740995'}],crossings:[]});
  let timeline={id:'t',revision:'r',fps:{num:24,den:1},tracks},writable=true,selections=0,dialog=false,rect={left:5,top:8,width:2400,height:300};
  const view={origin:0,scale:240,scrollY:0,selection:[],playhead:80,snap:false,tool:'move',retimeVisible:new Set(tracks.flatMap(track=>track.clips.map(clip=>clip.id))),retimeOverwrite:false,draft:null},handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),commands=[],notices=[],menus=[],captures=new Set(),originalWindow=globalThis.window;
  const document={hidden:false,querySelector:()=>dialog?{}:null,addEventListener:(key,value)=>documentHandlers.set(key,value),removeEventListener:key=>documentHandlers.delete(key)};
  globalThis.window={document,addEventListener:(key,value)=>windowHandlers.set(key,value),removeEventListener:key=>windowHandlers.delete(key)};
  const canvas={style:{},ownerDocument:document,addEventListener:(key,value)=>handlers.set(key,value),removeEventListener:key=>handlers.delete(key),focus(){},getBoundingClientRect:()=>({...rect}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,view,invalidate(){},onSelect:()=>selections++,onSeek(){},onCommand:async operation=>commands.push(operation),onNotice:message=>notices.push(message),onRetimeMenu:target=>menus.push(target),canEdit:()=>writable});
  function event(frame,extra={}){return {clientX:rect.left+frameToX(frame,view,timeline.fps),clientY:rect.top+timelineLayout(timeline,view).trackTop(0)+14,pointerId:1,button:0,buttons:1,preventDefault(){},stopPropagation(){},...extra};}
  return {clip,following,tracks,view,canvas,input,handlers,windowHandlers,documentHandlers,document,commands,notices,menus,event,timeline:()=>timeline,send:(type,frame,extra={})=>handlers.get(type)(event(frame,extra)),captured:id=>captures.has(id),selections:()=>selections,setWritable:value=>writable=value,setDialog:value=>dialog=value,replaceTimeline(){timeline={...timeline,revision:'new'};},moveCanvas(){rect={...rect,left:rect.left+1};},destroy(){input.destroy();globalThis.window=originalWindow;}};
}

test('speed strip menu and per-clip hide are local click actions and endpoint retains priority',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',70);h.send('pointermove',70,{pointerId:2});await h.send('pointerup',70,{pointerId:2,buttons:0});assert.equal(h.captured(1),true);
    await h.send('pointerup',70,{buttons:0});assert.deepEqual(h.menus,[{clip_id:h.clip.id,track_id:'v',returnFocus:h.canvas}]);assert.equal(h.commands.length,0);assert.equal(h.selections(),0);
    h.send('pointerdown',118);await h.send('pointerup',118,{buttons:0});
    assert.equal(h.view.retimeVisible.has(h.clip.id),false);assert.equal(h.view.retimeVisible.has(h.following.id),true);assert.equal(h.commands.length,0);
    assert.equal(hitTest(frameToX(30,h.view,h.timeline().fps),timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view).kind,'fade');
    assert.equal(retimeHandles(h.tracks[0],h.view,h.timeline().fps).length,1);
  }finally{h.destroy();}
});

test('speed strip controls cancel on movement, wrong release region and changed session',async()=>{
  for(const change of ['move','release','revision','viewport','readonly','escape','capture','wheel']){
    const h=harness();try{
      h.send('pointerdown',70);
      if(change==='move')h.send('pointermove',71);
      if(change==='revision')h.replaceTimeline();
      if(change==='viewport')h.moveCanvas();
      if(change==='readonly')h.setWritable(false);
      if(change==='escape')h.handlers.get('keydown')({key:'Escape'});
      if(change==='capture')h.handlers.get('lostpointercapture')({pointerId:1});
      if(change==='wheel')h.handlers.get('wheel')({...h.event(70),deltaY:1});
      await h.send('pointerup',change==='release'?118:70,{buttons:0});
      assert.equal(h.menus.length,0,change);assert.equal(h.commands.length,0,change);assert.equal(h.captured(1),false,change);
    }finally{h.destroy();}
  }
});

test('speed strip keyboard menu is scoped to selected visible unlocked media and idle canvas',()=>{
  const h=harness();try{
    h.view.selection=[h.clip.id];const key={key:'F10',shiftKey:true,preventDefault(){},stopPropagation(){}};
    h.handlers.get('keydown')(key);assert.equal(h.menus.length,1);assert.equal(h.menus[0].clip_id,h.clip.id);
    h.view.retimeVisible.delete(h.clip.id);h.handlers.get('keydown')(key);assert.equal(h.menus.length,1);
    h.view.retimeVisible.add(h.clip.id);h.setWritable(false);h.handlers.get('keydown')(key);assert.equal(h.menus.length,1);
    h.setWritable(true);h.handlers.get('keydown')({...key,repeat:true});h.handlers.get('keydown')({...key,target:{closest:()=>({})}});assert.equal(h.menus.length,1);
    h.handlers.get('keydown')({key:'ContextMenu',preventDefault(){},stopPropagation(){}});assert.equal(h.menus.length,2);assert.equal(h.commands.length,0);
  }finally{h.destroy();}
});

test('visible locked speed strips expose no preset, close or endpoint action',async()=>{
  const h=harness();try{
    h.tracks[0].locked=true;h.view.selection=[h.clip.id];
    const [strip]=retimeStrips(h.tracks[0],h.view,h.timeline().fps,2400);assert.equal(strip.interactive,false);
    for(const frame of [70,118,120]){h.send('pointerdown',frame);await h.send('pointerup',frame,{buttons:0});}
    h.handlers.get('keydown')({key:'F10',shiftKey:true,preventDefault(){},stopPropagation(){}});
    assert.equal(h.view.retimeVisible.has(h.clip.id),true);assert.equal(h.menus.length,0);assert.equal(h.commands.length,0);
  }finally{h.destroy();}
});

test('speed strip geometry centers controls in the visible region and preserves narrow endpoints',()=>{
  const h=harness();try{
    h.view.origin=70;const [strip]=retimeStrips(h.tracks[0],h.view,h.timeline().fps,500);
    assert.equal(strip.visibleLeft,HEADER);assert.equal(strip.visibleRight,500);assert(strip.menu.left>=HEADER);assert(strip.menu.right<=500);assert(strip.close.right<=500);
    const middle=(strip.menu.left+strip.menu.right)/2;assert.equal(hitTest(middle,timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view,500).kind,'retime_menu');
    h.view.origin=0;h.view.scale=6;
    const narrow=retimeStrips(h.tracks[0],h.view,h.timeline().fps,500)[0];assert.equal(narrow.close,null);
    assert.equal(hitTest(narrow.right,timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view,500).kind,'retime');
    assert.equal(retimeSpeedLabel(199.875),'199.88%');assert.equal(retimeSpeedLabel(100.004),'100%');assert.equal(retimeSpeedLabel(undefined),'Speed unavailable');
  }finally{h.destroy();}
});

test('tiny clips preserve trim hits while clipped speed strips restore visible fade hit targets',()=>{
  const h=harness();try{
    h.view.scale=3;
    assert.equal(retimeStrips(h.tracks[0],h.view,h.timeline().fps,500).length,0);
    assert.equal(fadeHandles(h.clip,h.view,h.timeline().fps).length,0);
    const narrow=hitTest(frameToX(30,h.view,h.timeline().fps),timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view,500);
    assert.equal(narrow.kind,'trim_start');assert.equal(narrow.clip.id,h.clip.id);
    h.view.scale=240;h.view.origin=119;h.clip.fade_out=1;
    assert.equal(retimeStrips(h.tracks[0],h.view,h.timeline().fps,300).length,0);
    const sliver=hitTest(HEADER+5,timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view,300);
    assert.equal(sliver.kind,'fade');assert.equal(sliver.clip.id,h.clip.id);assert.equal(sliver.edge,'out');
  }finally{h.destroy();}
});

test('speed pointer drafts stay local and owner release submits exact native endpoint only',async()=>{
  const h=harness();
  try{
    const original=structuredClone(h.clip);h.send('pointerdown',120);assert.equal(h.captured(1),true);assert.equal(h.selections(),0);
    h.send('pointermove',125);h.send('pointermove',130);assert.equal(h.commands.length,0);assert.equal(h.view.draft.length_frames,110);assert.deepEqual(h.clip,original);
    h.send('pointermove',180,{pointerId:2});await h.send('pointerup',180,{pointerId:2,buttons:0});h.handlers.get('pointercancel')({pointerId:2});assert.equal(h.captured(1),true);
    await h.send('pointerup',135,{buttons:0});
    assert.deepEqual(h.commands,[{kind:'retime_clip',clip_id:h.clip.id,end_frame:135,overwrite:false}]);assert.equal(h.captured(1),false);assert.equal(h.view.draft,null);assert.deepEqual(h.clip,original);
  }finally{h.destroy();}
});

test('open dialogs block speed endpoint capture and cancel captured drafts without preventing the next edit',async()=>{
  for(const phase of ['before_begin','before_move','before_release']){
    const h=harness();try{
      if(phase==='before_begin')h.setDialog(true);else{h.send('pointerdown',120);h.send('pointermove',130);assert.equal(h.captured(1),true);assert.equal(h.view.draft.length_frames,110);h.setDialog(true);}
      if(phase==='before_begin')h.send('pointerdown',120);if(phase!=='before_release')h.send('pointermove',132);await h.send('pointerup',135,{buttons:0});
      assert.deepEqual(h.commands,[],phase);assert.equal(h.captured(1),false,phase);assert.equal(h.view.draft,null,phase);assert.equal(h.clip.length_frames,100,phase);
      h.setDialog(false);h.send('pointerdown',120);await h.send('pointerup',135,{buttons:0});
      assert.deepEqual(h.commands,[{kind:'retime_clip',clip_id:h.clip.id,end_frame:135,overwrite:false}]);assert.equal(h.captured(1),false);assert.equal(h.view.draft,null);
    }finally{h.destroy();}
  }
});

test('native length bounds and snapped integer endpoints apply even without a move event',async()=>{
  for(const [target,expected] of [[-100,22],[30000,20020]]){
    const h=harness();
    try{
      h.view.retimeOverwrite=true;h.send('pointerdown',120);await h.send('pointerup',target,{buttons:0});assert.equal(h.commands[0].end_frame,expected);assert.equal(h.commands[0].overwrite,true);
    }finally{h.destroy();}
  }
  const h=harness();
  try{h.view.scale=24;h.view.snap=true;h.send('pointerdown',120);await h.send('pointerup',134,{buttons:0});assert.equal(h.commands[0].end_frame,140);assert.ok(Number.isSafeInteger(h.commands[0].end_frame));}finally{h.destroy();}
});

test('overlap defaults to refusal and explicit overwrite requires a fresh opt-in gesture',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',120);h.send('pointermove',150);assert.match(h.view.draft.error,/Overlap/);await h.send('pointerup',150,{buttons:0});assert.deepEqual(h.commands,[]);assert.ok(h.notices.some(message=>message.includes('Overlap')));
    h.view.retimeOverwrite=true;h.send('pointerdown',120);await h.send('pointerup',150,{buttons:0});assert.deepEqual(h.commands,[{kind:'retime_clip',clip_id:h.clip.id,end_frame:150,overwrite:true}]);
  }finally{h.destroy();}
  const linked=harness({linked:true});
  try{
    linked.send('pointerdown',120);linked.send('pointermove',150);assert.equal(linked.view.draft.validation_pending,true);assert.equal(linked.view.draft.changes.length,1);assert.match(linked.view.draft.error,/Overlap/);
    await linked.send('pointerup',150,{buttons:0});assert.deepEqual(linked.commands,[]);
    linked.send('pointerdown',120);linked.send('pointermove',130);assert.equal(linked.view.draft.validation_pending,true);assert.equal(linked.view.draft.error,null);await linked.send('pointerup',130,{buttons:0});
    assert.deepEqual(linked.commands,[{kind:'retime_clip',clip_id:linked.clip.id,end_frame:130,overwrite:false}]);
    linked.view.retimeOverwrite=true;linked.send('pointerdown',120);await linked.send('pointerup',150,{buttons:0});assert.deepEqual(linked.commands[1],{kind:'retime_clip',clip_id:linked.clip.id,end_frame:150,overwrite:true});
    linked.tracks[1].locked=true;linked.send('pointerdown',120);await linked.send('pointerup',130,{buttons:0});assert.equal(linked.commands.length,2);assert.ok(linked.notices.some(message=>message.includes('locked')));
  }finally{linked.destroy();}
});

test('mode, overwrite, snap, tool, selection and viewport changes invalidate speed drafts',async()=>{
  for(const change of ['mode','visible','overwrite','snap','tool','selection','scale','origin','scrollY','rect','revision','lock','readonly','escape','pointercancel','capture','blur','resize','visibility']){
    const h=harness();
    try{
      h.send('pointerdown',120);h.send('pointermove',130);
      if(change==='mode')h.view.retimeVisible.clear();
      else if(change==='visible')h.view.retimeVisible.add('other-timeline-clip');
      else if(change==='overwrite')h.view.retimeOverwrite=true;
      else if(change==='snap')h.view.snap=true;
      else if(change==='tool')h.view.tool='slip';
      else if(change==='selection')h.view.selection=[h.clip.id];
      else if(change==='scale')h.view.scale*=2;
      else if(change==='origin')h.view.origin=1;
      else if(change==='scrollY')h.view.scrollY=1;
      else if(change==='rect')h.moveCanvas();
      else if(change==='revision')h.replaceTimeline();
      else if(change==='lock')h.tracks[0].locked=true;
      else if(change==='readonly')h.setWritable(false);
      else if(change==='escape')h.handlers.get('keydown')({key:'Escape'});
      else if(change==='pointercancel')h.handlers.get('pointercancel')({pointerId:1});
      else if(change==='capture')h.handlers.get('lostpointercapture')({pointerId:1});
      else if(change==='visibility'){h.document.hidden=true;h.documentHandlers.get('visibilitychange')();}
      else h.windowHandlers.get(change)();
      await h.send('pointerup',135,{buttons:0});assert.deepEqual(h.commands,[],change);assert.equal(h.captured(1),false,change);
    }finally{h.destroy();}
  }
});

test('unchanged, returned and read-only speed handles create no command; other tools retain their hit regions',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',120);await h.send('pointerup',120,{buttons:0});
    h.send('pointerdown',120);h.send('pointermove',130);await h.send('pointerup',120,{buttons:0});assert.deepEqual(h.commands,[]);
    h.setWritable(false);h.send('pointerdown',120);await h.send('pointerup',130,{buttons:0});assert.deepEqual(h.commands,[]);h.setWritable(true);
    const x=frameToX(120,h.view,h.timeline().fps);assert.equal(hitTest(x,timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view).kind,'retime');assert.equal(hitTest(x,timelineLayout(h.timeline(),h.view).trackTop(0)+40,h.timeline(),h.view).kind,'trim_end');
    h.view.retimeVisible.clear();assert.equal(retimeHandles(h.tracks[0],h.view,h.timeline().fps).length,0);assert.equal(hitTest(frameToX(30,h.view,h.timeline().fps),timelineLayout(h.timeline(),h.view).trackTop(0)+14,h.timeline(),h.view).kind,'fade');
    h.view.retimeVisible.add(h.clip.id);h.view.tool='slip';assert.equal(retimeHandles(h.tracks[0],h.view,h.timeline().fps).length,0);
  }finally{h.destroy();}
});

test('Ctrl/Cmd+R speed mode is scoped away from native text/media targets and every open dialog',()=>{
  const event={key:'r',ctrlKey:true,metaKey:false,target:{closest:()=>null}};
  assert.equal(isRetimeShortcut(event),true);assert.equal(isRetimeShortcut({...event,key:'R',ctrlKey:false,metaKey:true}),true);
  for(const field of ['altKey','shiftKey','repeat','isComposing','defaultPrevented'])assert.equal(isRetimeShortcut({...event,[field]:true}),false,field);
  assert.equal(isRetimeShortcut({...event,ctrlKey:false}),false);assert.equal(isRetimeShortcut({...event,metaKey:true}),false);assert.equal(isRetimeShortcut({...event,key:'s'}),false);
  assert.equal(isRetimeShortcut({...event,target:{closest:()=>({})}}),false);assert.equal(isRetimeShortcut(event,{dialogOpen:true}),false);
});
