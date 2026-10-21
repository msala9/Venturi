import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInput,TRANSITION_DRAG_TYPE} from '../js/timeline/input.js';
import {createDraw} from '../js/timeline/draw.js';
import {frameToX,RULER,TRACK,transitionPlacement} from '../js/timeline/geometry.js';

function harness({crossing=false,occupied=false,commit}={}){
  const transition={kind:'Push',duration:20,direction:'Up',ease:'InOut',curve:0.375};
  const clip=(id,start_frame,length_frames)=>({id,kind:'media',start_frame,length_frames,linked_group:null,fade_in:0,fade_out:0});
  const source=clip('9007199254740993',20,100),neighbor=clip('9007199254740995',120,80),target=clip('9007199254740997',240,60);
  if(!crossing)source.transition_in=structuredClone(transition);
  if(occupied)target.transition_in={...transition,kind:'CrossDissolve',duration:10,ease:'None'};
  const track={id:'v1',kind:'video',locked:false,clips:[source,neighbor,target],crossings:crossing?[{left_clip:source.id,right_clip:neighbor.id,start_frame:110,end_frame:130,kind:transition.kind,transition:structuredClone(transition)}]:[]};
  let timeline={id:'t',revision:'r1',fps:{num:24,den:1},tracks:[track],transition_defaults:[{...transition,duration:11,direction:'Right'},{kind:'CrossDissolve',duration:11,direction:'Right',ease:'None',curve:0.5},{kind:'SmoothCut',duration:4,direction:'Right',ease:'None',curve:0.5}]},writable=true,rect={left:5,top:8,width:4000,height:300},selections=0;
  const view={scale:240,origin:0,scrollY:0,selection:[neighbor.id],snap:true,playhead:0,tool:'select',transitionReplace:false,transitionSelection:null},handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),commands=[],notices=[],selected=[],captures=new Set(),priorWindow=globalThis.window;
  const document={hidden:false,addEventListener:(name,fn)=>documentHandlers.set(name,fn),removeEventListener:name=>documentHandlers.delete(name)};
  globalThis.window={document,addEventListener:(name,fn)=>windowHandlers.set(name,fn),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={style:{},ownerDocument:document,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),focus(){},getBoundingClientRect:()=>({...rect}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,view,invalidate(){},onSelect:()=>selections++,onTransitionSelect:value=>selected.push(structuredClone(value)),onSeek(){},onCommand:async operation=>{commands.push(operation);return commit?.(operation);},onNotice:message=>notices.push(message),canEdit:()=>writable});
  const event=(frame,extra={})=>({clientX:rect.left+frameToX(frame,view,timeline.fps),clientY:rect.top+RULER+TRACK-14,pointerId:1,button:0,buttons:1,preventDefault(){this.prevented=true;},stopPropagation(){},...extra});
  const transfer=(kind,types=[TRANSITION_DRAG_TYPE])=>({types,dropEffect:'none',getData(type){assert.equal(type,TRANSITION_DRAG_TYPE);return kind;}});
  return {source,neighbor,target,track,transition,view,input,canvas,handlers,windowHandlers,documentHandlers,document,commands,notices,selected,event,transfer,timeline:()=>timeline,selections:()=>selections,captured:id=>captures.has(id),send:(name,frame,extra={})=>handlers.get(name)(event(frame,extra)),setWritable:value=>writable=value,replaceTimeline(){timeline={...timeline,revision:'r2'};},moveCanvas(){rect={...rect,left:rect.left+1};},destroy(){input.destroy();globalThis.window=priorWindow;}};
}

test('clicking either crossing body selects its canonical transition without clip selection or server mutation',async()=>{
  for(const [crossing,frame,slot] of [[false,22,'in'],[true,118,'cut_after'],[true,122,'cut_after']]){
    const h=harness({crossing});
    try{
      h.send('pointerdown',frame);assert.equal(h.captured(1),true);assert.equal(h.selections(),0);await h.send('pointerup',frame,{buttons:0});
      assert.deepEqual(h.view.transitionSelection,{track_id:'v1',clip_id:h.source.id,slot});assert.deepEqual(h.view.selection,[]);assert.deepEqual(h.selected,[h.view.transitionSelection]);assert.deepEqual(h.commands,[]);assert.equal(h.captured(1),false);
    }finally{h.destroy();}
  }
});

test('read-only writer can inspect a transition by click while Alt copy and ordinary body moves stay disabled',async()=>{
  const h=harness();
  try{
    h.setWritable(false);h.send('pointerdown',22);await h.send('pointerup',22,{buttons:0});assert.deepEqual(h.view.transitionSelection,{track_id:'v1',clip_id:h.source.id,slot:'in'});assert.equal(h.selected.length,1);
    h.send('pointerdown',22,{altKey:true});h.send('pointermove',241,{altKey:true});await h.send('pointerup',241,{buttons:0});assert.equal(h.captured(1),false);
    h.send('pointerdown',22);h.send('pointermove',12);await h.send('pointerup',11,{buttons:0});assert.equal(h.captured(1),false);assert.equal(h.selections(),0);assert.equal(h.selected.length,1);assert.deepEqual(h.commands,[]);assert.equal(h.input.transitionDnd.start('Push'),false);
  }finally{h.destroy();}
});

test('Alt body copy preserves the complete native payload with one owner-release commit and no pointer-move request',async()=>{
  const h=harness();
  try{
    const source=structuredClone(h.source);h.send('pointerdown',22,{altKey:true});h.send('pointermove',241,{altKey:true});assert.equal(h.view.draft.kind,'transition_placement');assert.deepEqual(h.commands,[]);
    h.send('pointermove',260,{pointerId:2,altKey:true});await h.send('pointerup',260,{pointerId:2,altKey:true,buttons:0});h.handlers.get('pointercancel')({pointerId:2});assert.equal(h.captured(1),true);
    await h.send('pointerup',242,{buttons:0,altKey:false});assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:h.target.id,slot:'in',transition:h.transition}]);assert.deepEqual(h.source,source);assert.equal(h.captured(1),false);assert.equal(h.view.draft,null);
  }finally{h.destroy();}
});

test('unmodified transition-body drag uses the existing safe clip move and native edge trim instead of a copy',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',22);h.send('pointermove',12);assert.deepEqual(h.commands,[]);assert.equal(h.view.draft.kind,'move');assert.equal(h.selections(),1);
    await h.send('pointerup',5,{pointerId:2,buttons:0});assert.equal(h.captured(1),true);await h.send('pointerup',11,{buttons:0});
    assert.deepEqual(h.commands,[{kind:'safe_move',moves:[{clip_id:h.source.id,to_track:'v1',to_start_frame:9}]}]);assert.equal(h.view.transitionSelection,null);assert.equal(h.captured(1),false);
    h.send('pointerdown',20.2);await h.send('pointerup',21.2,{buttons:0});assert.deepEqual(h.commands[1],{kind:'trim',clip_id:h.source.id,edge:'start',frame:21});
  }finally{h.destroy();}
});

test('unmodified body drag retains safe overlap rejection and skips returned or cancelled clip drafts',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',22);h.send('pointermove',12);await h.send('pointerup',22,{buttons:0});assert.deepEqual(h.commands,[]);
    h.send('pointerdown',22);await h.send('pointerup',24,{buttons:0});assert.deepEqual(h.commands,[]);assert.match(h.notices.at(-1),/Overlap/);
    h.send('pointerdown',22);h.send('pointermove',12);h.view.snap=false;await h.send('pointerup',11,{buttons:0});assert.deepEqual(h.commands,[]);assert.equal(h.captured(1),false);
  }finally{h.destroy();}
});

test('crossing duplication resolves source from either half and target from authoritative release coordinates',async()=>{
  const h=harness({crossing:true});
  try{
    const next={...h.target,id:'next',start_frame:300,length_frames:50};h.track.clips.push(next);
    h.send('pointerdown',122,{altKey:true});h.send('pointermove',241,{altKey:true});await h.send('pointerup',299,{buttons:0});
    assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:h.target.id,slot:'cut_after',transition:h.transition}]);
  }finally{h.destroy();}
});

test('placement refuses occupied transitions without explicit replacement, preserves its opt-in and skips identical copies',async()=>{
  for(const replace of [false,true]){
    const h=harness({occupied:true});
    try{
      h.view.transitionReplace=replace;h.send('pointerdown',22,{altKey:true});h.send('pointermove',241,{altKey:true});assert.equal(h.view.draft.replacement,true);await h.send('pointerup',241,{buttons:0});
      assert.equal(h.commands.length,replace?1:0);if(!replace)assert.match(h.notices[0],/Replace explicitly/);
    }finally{h.destroy();}
  }
  const h=harness();
  try{h.send('pointerdown',22,{altKey:true});await h.send('pointerup',21,{buttons:0});assert.deepEqual(h.commands,[]);assert.deepEqual(h.notices,[]);}finally{h.destroy();}
});

test('copy drafts cancel on identity, source geometry, writer, view and capture changes without submitting',async()=>{
  for(const change of ['revision','source','source-length','source-lock','destination-lock','readonly','replace','snap','selection','transition-selection','tool','scale','origin','scrollY','rect','escape','capture','cancel','blur','resize','scroll','visibility']){
    const h=harness();
    try{
      h.send('pointerdown',22,{altKey:true});h.send('pointermove',241,{altKey:true});
      if(change==='revision')h.replaceTimeline();else if(change==='source')h.source.transition_in.curve=0.7;else if(change==='source-length')h.source.length_frames=99;else if(change==='source-lock' || change==='destination-lock')h.track.locked=true;
      else if(change==='readonly')h.setWritable(false);else if(change==='replace')h.view.transitionReplace=true;else if(change==='snap')h.view.snap=false;else if(change==='selection')h.view.selection=[];else if(change==='transition-selection')h.view.transitionSelection={track_id:'v1',clip_id:h.target.id,slot:'out'};else if(change==='tool')h.view.tool='slip';else if(change==='scale')h.view.scale*=2;else if(change==='origin')h.view.origin=1;else if(change==='scrollY')h.view.scrollY=1;else if(change==='rect')h.moveCanvas();
      else if(change==='escape')h.handlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});else if(change==='capture')h.handlers.get('lostpointercapture')({pointerId:1});else if(change==='cancel')h.handlers.get('pointercancel')({pointerId:1});else if(change==='visibility'){h.document.hidden=true;h.documentHandlers.get('visibilitychange')();}else h.windowHandlers.get(change)();
      await h.send('pointerup',241,{buttons:0});assert.deepEqual(h.commands,[],change);assert.equal(h.captured(1),false,change);assert.equal(h.view.draft,null,change);
    }finally{h.destroy();}
  }
});

test('Effects creation requires trusted catalog start; protected dragover never reads data or sends a request',async()=>{
  const h=harness();
  try{
    const forged=h.event(241,{dataTransfer:h.transfer('Push')});await h.handlers.get('drop')(forged);assert.deepEqual(h.commands,[]);assert.equal(forged.prevented,undefined);
    assert.equal(h.input.transitionDnd.start('unknown'),false);assert.equal(h.input.transitionDnd.start('SmoothCut'),true);
    const protectedTransfer=h.transfer('SmoothCut');protectedTransfer.getData=()=>{throw Error('Protected drag data was read');};const over=h.event(241,{dataTransfer:protectedTransfer});h.handlers.get('dragover')(over);
    assert.equal(over.prevented,true);assert.equal(protectedTransfer.dropEffect,'copy');assert.deepEqual(h.commands,[]);assert.equal(h.view.draft.duration,4);
    await h.handlers.get('drop')(h.event(241,{dataTransfer:h.transfer('SmoothCut')}));assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:h.target.id,slot:'in',transition:h.timeline().transition_defaults[2]}]);assert.equal(h.view.draft,null);
    await h.handlers.get('drop')(h.event(241,{dataTransfer:h.transfer('SmoothCut')}));assert.equal(h.commands.length,1);
  }finally{h.destroy();}
});

test('Effects drops reject spoofed kinds, stale catalogs, changed context and read-only state',async()=>{
  for(const change of ['kind','catalog','revision','readonly','replace','rect','end','escape','leave']){
    const h=harness();
    try{
      assert.equal(h.input.transitionDnd.start('Push'),true);h.handlers.get('dragover')(h.event(241,{dataTransfer:h.transfer('Push')}));
      if(change==='catalog')h.timeline().transition_defaults[0].duration=12;else if(change==='revision')h.replaceTimeline();else if(change==='readonly')h.setWritable(false);else if(change==='replace')h.view.transitionReplace=true;else if(change==='rect')h.moveCanvas();else if(change==='end')h.input.transitionDnd.end();else if(change==='escape')h.handlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});else if(change==='leave'){h.handlers.get('dragleave')({relatedTarget:null});assert.equal(h.view.draft,null);h.input.transitionDnd.end();}
      await h.handlers.get('drop')(h.event(241,{dataTransfer:h.transfer(change==='kind'?'SmoothCut':'Push')}));assert.deepEqual(h.commands,[],change);assert.equal(h.view.draft,null,change);
    }finally{h.destroy();}
  }
});

test('Effects drop recalculates its final edge, shows blocked center drops and prevents concurrent retries',async()=>{
  let release;const h=harness({commit:()=>new Promise(resolve=>{release=resolve;})});
  try{
    h.input.transitionDnd.start('Push');h.handlers.get('dragover')(h.event(270,{dataTransfer:h.transfer('Push')}));assert.match(h.view.draft.error,/40 pixels/);
    const dropped=h.handlers.get('drop')(h.event(299,{dataTransfer:h.transfer('Push')}));assert.equal(h.commands.length,1);assert.equal(h.commands[0].slot,'out');assert.equal(h.input.transitionDnd.start('Push'),false);
    await h.handlers.get('drop')(h.event(241,{dataTransfer:h.transfer('Push')}));assert.equal(h.commands.length,1);release();await dropped;assert.equal(h.view.draft,null);
  }finally{h.destroy();}
});

test('Alt transition handles retain duration priority while Alt outside transition bodies remains pan',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',40,{altKey:true});await h.send('pointerup',45,{altKey:true,buttons:0});assert.equal(h.commands.length,1);assert.equal(h.commands[0].transition.duration,25);
    h.send('pointerdown',70,{altKey:true});await h.send('pointerup',80,{altKey:true,buttons:0});assert.equal(h.commands.length,1);
  }finally{h.destroy();}
});

test('idle Escape clears only the local transition selection, while active Escape retains its source selection',async()=>{
  const h=harness();
  try{
    h.send('pointerdown',22);await h.send('pointerup',22,{buttons:0});const source=structuredClone(h.view.transitionSelection);
    h.send('pointerdown',22,{altKey:true});h.send('pointermove',241,{altKey:true});h.handlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});assert.deepEqual(h.view.transitionSelection,source);assert.deepEqual(h.commands,[]);
    h.handlers.get('keydown')({key:'Escape',target:{closest:()=>({})},preventDefault(){throw Error('Text Escape was consumed');}});assert.deepEqual(h.view.transitionSelection,source);
    h.handlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(h.view.transitionSelection,null);assert.equal(h.selected.at(-1),null);assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('draw shows blocked and explicit replacement ghost cues without a renderer or network',()=>{
  const h=harness({occupied:true}),previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,devicePixelRatio:globalThis.devicePixelRatio,requestAnimationFrame:globalThis.requestAnimationFrame,ResizeObserver:globalThis.ResizeObserver},frames=[],calls=[];
  let draw;
  try{
    globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:name=>name});globalThis.devicePixelRatio=1;globalThis.requestAnimationFrame=fn=>frames.push(fn);globalThis.ResizeObserver=class{observe(){}disconnect(){}};
    const context=new Proxy({},{get:(_,method)=>(...args)=>calls.push({method,args})}),canvas={clientWidth:4000,clientHeight:300,getContext:()=>context};
    h.view.draft=transitionPlacement(h.timeline(),h.view,[frameToX(241,h.view,h.timeline().fps),RULER+30],h.transition);draw=createDraw(canvas,h.timeline,h.view);frames.shift()();
    assert.ok(calls.some(call=>call.method==='fillText' && /Transition blocked.*Replace explicitly/.test(call.args[0])));
    h.view.transitionReplace=true;h.view.draft=transitionPlacement(h.timeline(),h.view,[frameToX(241,h.view,h.timeline().fps),RULER+30],h.transition,{replace:true});draw.invalidate();frames.shift()();assert.ok(calls.some(call=>call.method==='fillText' && /REPLACE enabled.*Undo restores/.test(call.args[0])));assert.deepEqual(h.commands,[]);
  }finally{draw?.destroy();Object.assign(globalThis,previous);h.destroy();}
});
