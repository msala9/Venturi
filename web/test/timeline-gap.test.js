import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeGapAt,selectedGap,frameToX,RULER,TRACK,HEADER} from '../js/timeline/geometry.js';
import {createInput,isCloseGapShortcut} from '../js/timeline/input.js';
import {createDraw} from '../js/timeline/draw.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const clip=(id,start,length)=>({id,start_frame:start,length_frames:length,linked_group:null});
const nativeTimeline=()=>({id:'1',revision:'revision',fps:{num:24,den:1},markers:[],gaps:[{track_id:'0',start_frame:0,length_frames:10},{track_id:'0',start_frame:20,length_frames:10},{track_id:'1',start_frame:10,length_frames:20}],tracks:[{id:'0',label:'V1',kind:'video',locked:false,clips:[clip('first',10,10),clip('second',30,10)]},{id:'1',label:'A1',kind:'audio',locked:false,clips:[clip('audio-a',0,10),clip('audio-b',30,10)]}]});
function harness(options={}){
  const original=globalThis.window,handlers=new Map(),captures=new Set(),commands=[],notices=[],seeks=[];
  let timeline=nativeTimeline(),context={project_epoch:'epoch',generation:'1'},modal=false,editable=true;
  const document={querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={document,addEventListener(){},removeEventListener(){}};
  const view={origin:0,scale:240,scrollY:0,playhead:7,selection:[],transitionSelection:null,selectedGap:null,tool:'move',snap:false,draft:null,lasso:null,retimeVisible:new Set()};
  const canvas={ownerDocument:document,style:{},clientWidth:1200,clientHeight:300,getBoundingClientRect:()=>({left:12,top:8,width:1200,height:300}),addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type),focus(){},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,getGapContext:()=>context,view,invalidate(){},onSelect(){},onSeek:final=>seeks.push({frame:view.playhead,final}),canEdit:()=>editable,onCommand:async operation=>{commands.push(operation);return options.commit?.(operation);},onNotice:message=>notices.push(message)});
  const event=(frame,track=0,extra={})=>({clientX:12+frameToX(frame,view,timeline.fps),clientY:8+RULER+track*TRACK+30,button:0,buttons:1,pointerId:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra});
  return {input,view,canvas,handlers,commands,notices,seeks,captures,get timeline(){return timeline;},setTimeline:value=>timeline=value,setContext:value=>context=value,setModal:value=>modal=value,setEditable:value=>editable=value,event,send(type,frame,track=0,extra={}){return handlers.get(type)(event(frame,track,extra));},async click(frame,track=0){this.send('pointerdown',frame,track);await this.send('pointerup',frame,track,{buttons:0});},destroy(){input.destroy();globalThis.window=original;}};
}

test('gap hits consume only authoritative native intervals: leading/internal, exclusive end and no trailing gap',()=>{
  const timeline=nativeTimeline();assert.equal(nativeGapAt(timeline,'0',0),timeline.gaps[0]);assert.equal(nativeGapAt(timeline,'0',25),timeline.gaps[1]);
  for(const frame of [10,15,30,40,999,-1,1.5])assert.equal(nativeGapAt(timeline,'0',frame),null);
  const without={...timeline,gaps:[]};assert.equal(nativeGapAt(without,'0',25),null,'The browser must not reconstruct gaps from clips');timeline.tracks[0].locked=true;assert.equal(nativeGapAt(timeline,'0',25),null);
});
test('malformed gap metadata is never selected or converted into an edit',()=>{
  const timeline=nativeTimeline();for(const gap of [null,{track_id:'0',start_frame:-1,length_frames:10},{track_id:'0',start_frame:0,length_frames:0},{track_id:'0',start_frame:0,length_frames:1.5},{track_id:'0',start_frame:0,length_frames:1000000001}]){timeline.gaps=[gap];assert.equal(nativeGapAt(timeline,'0',1),null);}
});
test('clicking an empty native gap clears clip selection and records the captured click without issuing a command',async()=>{
  const h=harness();try{h.view.selection=['first'];h.send('pointerdown',25);assert.equal(h.view.selectedGap,null);assert.equal(h.commands.length,0);await h.send('pointerup',25,0,{buttons:0});assert.deepEqual(h.view.selection,[]);assert.equal(h.view.selectedGap.track_id,'0');assert.equal(h.view.selectedGap.frame,25);assert.equal(h.view.selectedGap.start_frame,20);assert.equal(h.view.selectedGap.length_frames,10);assert.equal(h.view.playhead,7);assert.equal(h.captures.size,0);assert.equal(h.input.canCloseGap(),true);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('Close selected gap submits one native track/frame command and prevents concurrent replay',async()=>{
  const pending=deferred(),h=harness({commit:()=>pending.promise});try{await h.click(25);const closing=h.input.closeGap();assert.deepEqual(h.commands,[{kind:'close_gap',track:'0',frame:25}]);assert.equal(h.input.canCloseGap(),false);assert.equal(await h.input.closeGap(),false);pending.resolve();assert.equal(await closing,true);assert.equal(h.view.selectedGap,null);assert.equal(h.commands.length,1);}finally{pending.resolve();h.destroy();}
});
test('accessible gap selection uses the same native state and close action without requiring Canvas pointer input',async()=>{
  const h=harness();try{h.view.selection=['first'];assert.equal(h.input.selectGap('0',20),true);assert.deepEqual(h.view.selection,[]);assert.equal(h.view.selectedGap.start_frame,20);assert.equal(h.input.canCloseGap(),true);assert.deepEqual(h.commands,[]);await h.input.closeGap();assert.deepEqual(h.commands,[{kind:'close_gap',track:'0',frame:20}]);assert.equal(h.input.selectGap('0',45),false);h.setModal(true);assert.equal(h.input.selectGap('0',20),false);assert.equal(h.view.selectedGap,null);}finally{h.destroy();}
});
test('leading gap uses the actual clicked frame and the requested audio lane is preserved',async()=>{
  const h=harness();try{await h.click(3);await h.input.closeGap();await h.click(22,1);await h.input.closeGap();assert.deepEqual(h.commands,[{kind:'close_gap',track:'0',frame:3},{kind:'close_gap',track:'1',frame:22}]);}finally{h.destroy();}
});
test('a real marquee drag from a gap keeps existing clip selection behavior and never selects the gap',async()=>{
  const h=harness();try{h.send('pointerdown',25);h.send('pointermove',35);await h.send('pointerup',35,0,{buttons:0});assert.equal(h.view.selectedGap,null);assert.deepEqual(h.view.selection,['second']);assert.equal(h.commands.length,0);assert.equal(await h.input.closeGap(),false);}finally{h.destroy();}
});
test('subthreshold pointer jitter still selects a gap; a mismatched pointer cannot finish its capture',async()=>{
  const h=harness();try{h.send('pointerdown',25);await h.send('pointerup',25,0,{pointerId:2,buttons:0});assert.equal(h.captures.size,1);h.send('pointermove',25.1);await h.send('pointerup',25.1,0,{buttons:0});assert.equal(h.view.selectedGap.frame,25);assert.equal(h.captures.size,0);}finally{h.destroy();}
});
test('empty trailing area and locked native gaps leave no closable selection or server command',async()=>{
  const h=harness();try{await h.click(45);assert.equal(h.view.selectedGap,null);h.timeline.tracks[0].locked=true;await h.click(25);assert.equal(h.view.selectedGap,null);assert.equal(await h.input.closeGap(),false);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('gap capture is canceled by changed timeline, revision, session context, viewport or modal before release',async()=>{
  for(const change of [h=>h.setTimeline({...h.timeline}),h=>h.timeline.revision='changed',h=>h.setContext({project_epoch:'other',generation:'1'}),h=>h.setContext({project_epoch:'epoch',generation:'2'}),h=>h.view.origin=1,h=>h.setModal(true)]){
    const h=harness();try{h.send('pointerdown',25);change(h);await h.send('pointerup',25,0,{buttons:0});assert.equal(h.view.selectedGap,null);assert.deepEqual(h.commands,[]);assert.equal(h.captures.size,0);}finally{h.destroy();}
  }
});
test('a stale selected interval is refused after revision, epoch, lock, selected clips or native interval changes',async()=>{
  for(const change of [h=>h.timeline.revision='changed',h=>h.setContext({project_epoch:'other',generation:'1'}),h=>h.setContext({project_epoch:'epoch',generation:'2'}),h=>h.timeline.tracks[0].locked=true,h=>h.view.selection=['first'],h=>h.timeline.gaps[1].length_frames=9]){
    const h=harness();try{await h.click(25);change(h);assert.equal(await h.input.closeGap(),false);assert.equal(h.view.selectedGap,null);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
});
test('Escape and timeline cancellation clear a gap without a write; an ordinary later click still commits once',async()=>{
  const h=harness();try{await h.click(25);const event={key:'Escape',preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};h.handlers.get('keydown')(event);assert.equal(event.defaultPrevented,true);assert.equal(h.view.selectedGap,null);await h.click(25);h.input.cancel();assert.equal(h.view.selectedGap,null);await h.click(25);await h.input.closeGap();assert.equal(h.commands.length,1);}finally{h.destroy();}
});
test('Escape also cancels an accessible gap selection when focus remains on its native button',()=>{
  const h=harness();try{h.input.selectGap('0',20);assert.equal(h.input.handleGapKey({key:'Escape',target:{closest:()=>null},preventDefault(){},stopPropagation(){}}),true);assert.equal(h.view.selectedGap,null);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('read-only, modal, gesture and pending edit guards prevent gap commands without changing native project data',async()=>{
  const h=harness();try{await h.click(25);h.setEditable(false);assert.equal(h.input.canCloseGap(),false);assert.equal(await h.input.closeGap(),false);h.setEditable(true);h.setModal(true);assert.equal(await h.input.closeGap(),false);h.setModal(false);h.send('pointerdown',25);assert.equal(await h.input.closeGap(),false);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('native ISO shortcut is scoped away from text, dialogs, modifiers, IME and repeats',()=>{
  const event={code:'IntlBackslash',key:'<'};assert.equal(isCloseGapShortcut(event),true);assert.equal(isCloseGapShortcut({...event,code:'Comma'}),false);
  for(const flag of ['defaultPrevented','repeat','isComposing','ctrlKey','metaKey','altKey','shiftKey'])assert.equal(isCloseGapShortcut({...event,[flag]:true}),false);
  assert.equal(isCloseGapShortcut({...event,getModifierState:()=>true}),false);assert.equal(isCloseGapShortcut({...event,target:{closest:()=>({})}}),false);assert.equal(isCloseGapShortcut(event,{dialogOpen:true}),false);
});
test('keyboard and accessible-button dispatch share one captured native command and reject text focus',async()=>{
  const h=harness();try{await h.click(25);assert.equal(h.input.handleGapKey({code:'IntlBackslash',target:{closest:()=>({})}}),false);assert.equal(h.input.handleGapKey({code:'IntlBackslash',preventDefault(){this.defaultPrevented=true;},stopPropagation(){}}),true);await Promise.resolve();await Promise.resolve();assert.deepEqual(h.commands,[{kind:'close_gap',track:'0',frame:25}]);assert.equal(h.input.handleGapKey({code:'IntlBackslash'}),false);}finally{h.destroy();}
});
test('IntlBackslash with selected clips routes the existing native ripple delete, while no selection is a no-op',async()=>{
  const h=harness();try{h.view.selection=['first'];assert.equal(h.input.handleGapKey({code:'IntlBackslash',preventDefault(){},stopPropagation(){}}),true);await Promise.resolve();await Promise.resolve();assert.deepEqual(h.commands,[{kind:'delete',clip_ids:['first'],ripple:true}]);assert.deepEqual(h.view.selection,[]);assert.equal(h.input.handleGapKey({code:'IntlBackslash'}),false);assert.equal(await h.input.rippleDelete(),false);assert.equal(h.commands.length,1);}finally{h.destroy();}
});
test('clip ripple uses the same modal, read-only, stale selection, gesture and single-flight guards',async()=>{
  for(const mode of ['modal','readonly','missing','gesture']){
    const h=harness();try{h.view.selection=['first'];if(mode==='modal')h.setModal(true);if(mode==='readonly')h.setEditable(false);if(mode==='missing')h.view.selection=['deleted'];if(mode==='gesture'){h.send('pointerdown',25);h.view.selection=['first'];}assert.equal(await h.input.rippleDelete(),false);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
  const pending=deferred(),h=harness({commit:()=>pending.promise});try{h.view.selection=['first'];const applying=h.input.rippleDelete();assert.equal(await h.input.rippleDelete(),false);assert.equal(h.commands.length,1);pending.resolve();await applying;}finally{pending.resolve();h.destroy();}
});
test('an unrelated locked lane does not suppress native ripple-delete authority',async()=>{
  const h=harness();try{h.timeline.tracks[1].locked=true;h.view.selection=['first'];assert.equal(await h.input.rippleDelete(),true);assert.deepEqual(h.commands,[{kind:'delete',clip_ids:['first'],ripple:true}]);assert.deepEqual(h.notices,[]);}finally{h.destroy();}
});
test('a locked selected clip or linked selected peer refuses ripple-delete before submission',async()=>{
  for(const linked of [false,true]){
    const h=harness();try{h.view.selection=['first'];if(linked){h.timeline.tracks[0].clips[0].linked_group='group';h.timeline.tracks[1].clips[0].linked_group='group';h.timeline.tracks[1].locked=true;}else h.timeline.tracks[0].locked=true;assert.equal(await h.input.rippleDelete(),false);assert.deepEqual(h.commands,[]);assert.match(h.notices[0],/selected clips and their linked tracks/);}finally{h.destroy();}
  }
});
test('native clip ripple follow includes an earlier linked peer and waits for the refreshed native landing',async()=>{
  const pending=deferred(),h=harness({commit:()=>pending.promise});try{
    h.timeline.gaps=[];h.timeline.tracks[0].clips[0].linked_group='group';h.timeline.tracks[1].clips[0].linked_group='group';h.timeline.tracks[0].clips[1].start_frame=20;h.timeline.tracks[1].clips[1].start_frame=20;h.view.selection=['first'];const applying=h.input.rippleDelete();assert.deepEqual(h.seeks,[]);
    h.setTimeline({...h.timeline,revision:'new',tracks:[{...h.timeline.tracks[0],clips:[clip('second',0,10)]},{...h.timeline.tracks[1],clips:[clip('audio-b',0,10)]}]});h.setContext({project_epoch:'epoch',generation:'2'});h.view.selection=[];pending.resolve({project_epoch:'epoch',generation:'2'});await applying;assert.equal(h.view.playhead,0);assert.deepEqual(h.seeks,[{frame:0,final:true}]);assert.deepEqual(h.commands,[{kind:'delete',clip_ids:['first'],ripple:true}]);
  }finally{pending.resolve();h.destroy();}
});
test('rejected or unknown gap outcome does not repeat or silently retain an actionable selection',async()=>{
  const h=harness({commit:async()=>{throw Object.assign(Error('Command outcome unknown'),{code:'OUTCOME_UNKNOWN'});}});try{await h.click(25);assert.equal(await h.input.closeGap(),false);assert.equal(h.view.selectedGap,null);assert.equal(h.notices.length,1);assert.equal(await h.input.closeGap(),false);assert.equal(h.commands.length,1);}finally{h.destroy();}
});
test('successful native landing moves the playhead only after ACK, including a landing on a locked track',async()=>{
  const pending=deferred(),h=harness({commit:()=>pending.promise});try{await h.click(25);const closing=h.input.closeGap();assert.equal(h.view.playhead,7);assert.deepEqual(h.seeks,[]);
    h.setTimeline({...h.timeline,revision:'new',gaps:[],tracks:[{...h.timeline.tracks[0],clips:[]},{...h.timeline.tracks[1],locked:true,clips:[clip('landed',20,10)]}]});h.setContext({project_epoch:'epoch',generation:'2'});pending.resolve({project_epoch:'epoch'});assert.equal(await closing,true);assert.equal(h.view.playhead,20);assert.deepEqual(h.seeks,[{frame:20,final:true}]);assert.equal(h.view.origin,0);
  }finally{pending.resolve();h.destroy();}
});
test('no native landing, changed project or timeline, changed user playhead or failed ACK never follows the old gap',async()=>{
  for(const mode of ['no-landing','project','timeline','playhead','selection','stale-generation','error']){
    const pending=deferred(),h=harness({commit:()=>pending.promise});try{await h.click(25);const closing=h.input.closeGap();const after={...h.timeline,revision:'new',gaps:[],tracks:[{...h.timeline.tracks[0],clips:[clip('landed',20,10)]},h.timeline.tracks[1]]};
      if(mode==='no-landing')after.tracks[0].clips=[clip('elsewhere',22,10)];if(mode==='timeline')after.id='2';h.setTimeline(after);h.setContext({project_epoch:mode==='project'?'new-epoch':'epoch',generation:'2'});if(mode==='playhead')h.view.playhead=99;if(mode==='selection')h.view.selection=['landed'];
      if(mode==='error')pending.reject(Error('Reply lost'));else pending.resolve({project_epoch:'epoch',generation:mode==='stale-generation'?'1':'2'});await closing;assert.deepEqual(h.seeks,[]);assert.equal(h.view.playhead,mode==='playhead'?99:7);
    }finally{pending.resolve();h.destroy();}
  }
});
test('a successfully closed offscreen accessible gap reveals its native landing with a local viewport update',async()=>{
  let h;h=harness({commit:async()=>{h.setTimeline({...h.timeline,revision:'new',gaps:[],tracks:[{...h.timeline.tracks[0],clips:[clip('landed',1000,10)]},h.timeline.tracks[1]]});h.setContext({project_epoch:'epoch',generation:'2'});return {project_epoch:'epoch'};}});
  try{h.timeline.gaps=[{track_id:'0',start_frame:1000,length_frames:10}];assert.equal(h.input.selectGap('0',1000),true);await h.input.closeGap();assert.equal(h.view.playhead,1000);assert.ok(h.view.origin>0);assert.ok(frameToX(1000,h.view,h.timeline.fps)>=HEADER && frameToX(1000,h.view,h.timeline.fps)<1200);assert.deepEqual(h.seeks,[{frame:1000,final:true}]);assert.equal(h.commands.length,1);}finally{h.destroy();}
});
test('gap highlight follows native frames, viewport scroll and DPR while stale revisions stop painting it',()=>{
  const original={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,devicePixelRatio:globalThis.devicePixelRatio,ResizeObserver:globalThis.ResizeObserver,requestAnimationFrame:globalThis.requestAnimationFrame};
  let callback;const strokes=[],ctx={setTransform(){},fillRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},fillText(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},strokeRect(...args){strokes.push({args,color:this.strokeStyle});}};
  globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:name=>name});globalThis.devicePixelRatio=2;globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.requestAnimationFrame=fn=>{callback=fn;};
  try{
    const timeline=nativeTimeline(),view={origin:5,scale:240,scrollY:TRACK/2,selection:[],transitionSelection:null,selectedGap:{...timeline.gaps[1],timeline_id:'1',revision:'revision',frame:25},retimeVisible:new Set()};
    const canvas={clientWidth:1000,clientHeight:200,width:0,height:0,getContext:()=>ctx},draw=createDraw(canvas,()=>timeline,view);callback();assert.equal(canvas.width,2000);assert.equal(canvas.height,400);
    const left=frameToX(20,view,timeline.fps),right=frameToX(30,view,timeline.fps);assert.ok(strokes.some(stroke=>stroke.color==='--primary' && JSON.stringify(stroke.args)===JSON.stringify([left+1,RULER-TRACK/2+7,right-left-2,TRACK-14])));
    strokes.length=0;timeline.revision='new';draw.invalidate();callback();assert.equal(strokes.some(stroke=>stroke.color==='--primary'),false);draw.destroy();assert.equal(selectedGap(timeline,view),null);assert.ok(left>=HEADER);
  }finally{Object.assign(globalThis,original);}
});
