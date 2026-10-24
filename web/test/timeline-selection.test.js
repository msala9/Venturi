import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {timelineClipSelection,retainedTimelineSelection,frameToX,RULER,timelineLayout} from '../js/timeline/geometry.js';
import {createInput,timelineSelectionAction,timelineSelectionFocus} from '../js/timeline/input.js';
import {clampTimelineFrame} from '../js/project-view.js';
import {maskFocusAfterEdit} from '../js/masks.js';

const sourceTimeline=()=>({id:'timeline',revision:'revision',fps:{num:24,den:1},markers:[],gaps:[],transition_defaults:[{kind:'Push',duration:4,direction:'Left',ease:'None',curve:0.5}],tracks:[
  {id:'0',kind:'video',locked:false,clips:[{id:'9',start_frame:0,length_frames:10,linked_group:null,disabled:true,kind:'solid_color'},{id:'2',start_frame:20,length_frames:10,linked_group:'group',freeze_source_frame:1}]},
  {id:'1',kind:'audio',locked:false,muted:true,solo:false,clips:[{id:'3',start_frame:22,length_frames:7,linked_group:'group'}]},
  {id:'2',kind:'audio',locked:true,clips:[{id:'4',start_frame:0,length_frames:40,linked_group:'group'}]},
  {id:'3',kind:'audio',locked:false,solo:true,clips:[{id:'5',start_frame:0,length_frames:10,linked_group:'group'}]},
]});
const focus=(area,{text=false}={})=>({closest:selector=>selector==='#timeline-panel'?(area==='timeline'?{}:null):selector.startsWith('#browser,#inspector')?(['pool','library','presets','keyframes','inspector'].includes(area)?{}:null):selector.startsWith('input,textarea')?(text?{}:null):null});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function harness(options={}){
  const original=globalThis.window,handlers=new Map(),captures=new Set(),commands=[],seeks=[];let timeline=sourceTimeline(),modal=false,navigable=true,editable=false,context={project_epoch:'epoch',generation:'1'},selections=0;
  const document={querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};globalThis.window={document,addEventListener(){},removeEventListener(){}};
  const canvas={ownerDocument:document,style:{},clientWidth:1000,clientHeight:400,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:400}),addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key),focus(){},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const view={selection:[],selectedGap:null,transitionSelection:null,playhead:10,origin:2,scale:240,scrollY:3,snap:false,tool:'move',retimeVisible:new Set(),draft:null,lasso:null};
  const input=createInput({canvas,getTimeline:()=>timeline,getGapContext:()=>context,getPresetContext:()=>({...context,timeline_id:timeline.id,revision:timeline.revision}),view,invalidate(){},onSelect(){selections++;},onSeek:()=>seeks.push(view.playhead),onCommand:async operation=>{commands.push(operation);return options.commit?.(operation);},onNavigationIntent:()=>options.intent?.(),onNotice(){},canNavigate:()=>navigable,canEdit:()=>editable});
  return {input,view,handlers,commands,seeks,captures,get timeline(){return timeline;},selections:()=>selections,setTimeline:value=>timeline=value,setContext:value=>context=value,setModal:value=>modal=value,setNavigable:value=>navigable=value,setEditable:value=>editable=value,pointer(type,frame){return handlers.get(type)({clientX:frameToX(frame,view,timeline.fps),clientY:timelineLayout(timeline,view).trackTop(0)+30,button:0,buttons:1,pointerId:1,preventDefault(){}});},key(event){handlers.get('keydown')(event);},destroy(){input.destroy();globalThis.window=original;}};
}

test('native all-selection covers unlocked lanes including muted, disabled, frozen and generator clips in native ID order',()=>{
  const timeline=sourceTimeline(),before=JSON.stringify(timeline);assert.deepEqual(timelineClipSelection(timeline),['2','9','3','5']);assert.equal(JSON.stringify(timeline),before);
});
test('from-playhead includes under/future clips, excludes exact-end and never expands prior-ended or locked linked peers',()=>{
  const timeline=sourceTimeline();assert.deepEqual(timelineClipSelection(timeline,10),['2','3']);assert.deepEqual(timelineClipSelection(timeline,29),['2']);assert.deepEqual(timelineClipSelection(timeline,30),[]);assert.deepEqual(timelineClipSelection(timeline,0),['2','9','3','5']);
});
test('selection IDs remain opaque and numeric native ordering retains u64 precision without changing source arrays',()=>{
  const timeline=sourceTimeline();timeline.tracks=[{locked:false,clips:[{id:'18446744073709551615'},{id:'9007199254740993'},{id:'2'}]},{locked:false,clips:[{id:'fixture-z'},{id:'fixture-a'},{id:'10'}]}];const before=JSON.stringify(timeline);
  assert.deepEqual(timelineClipSelection(timeline),['2','9007199254740993','18446744073709551615','fixture-z','fixture-a','10']);assert.equal(JSON.stringify(timeline),before);
});
test('empty or entirely locked timelines return an empty view selection and invalid playhead input is refused',()=>{
  assert.deepEqual(timelineClipSelection(null),[]);assert.deepEqual(timelineClipSelection({tracks:[]}),[]);const timeline=sourceTimeline();timeline.tracks.forEach(track=>track.locked=true);assert.deepEqual(timelineClipSelection(timeline),[]);
  for(const frame of [-1,NaN,Infinity,1.5,'10'])assert.deepEqual(timelineClipSelection(sourceTimeline(),frame),[]);
});
test('readonly selection APIs clear gap and transition without seeking, commands, viewport changes or native mutation',()=>{
  const h=harness();try{const before=JSON.stringify(h.timeline),position={playhead:h.view.playhead,origin:h.view.origin,scale:h.view.scale,scrollY:h.view.scrollY};h.view.selectedGap={track_id:'0'};h.view.transitionSelection={slot:'in'};
    assert.equal(h.input.selectTimelineClips('all'),true);assert.deepEqual(h.view.selection,['2','9','3','5']);assert.equal(h.view.selectedGap,null);assert.equal(h.view.transitionSelection,null);assert.equal(h.input.selectTimelineClips('from_playhead'),true);assert.deepEqual(h.view.selection,['2','3']);assert.equal(h.selections(),2);
    assert.deepEqual({playhead:h.view.playhead,origin:h.view.origin,scale:h.view.scale,scrollY:h.view.scrollY},position);assert.equal(JSON.stringify(h.timeline),before);assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
  }finally{h.destroy();}
});
test('valid selection action clears old selection even when native result is empty, without extending linked groups',()=>{
  const h=harness();try{h.view.selection=['4'];h.view.playhead=30;assert.equal(h.input.selectTimelineClips('from_playhead'),true);assert.deepEqual(h.view.selection,[]);h.view.playhead=10;assert.equal(h.input.selectTimelineClips('from_playhead'),true);assert.deepEqual(h.view.selection,['2','3']);assert.equal(h.view.selection.includes('4'),false);assert.equal(h.view.selection.includes('5'),false);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('Ctrl+A scope is exact timeline focus, while native Alt+Y remains global outside typing',()=>{
  for(const area of ['timeline','pool','library','presets','keyframes','inspector','body']){
    const target=focus(area),timelineFocused=timelineSelectionFocus(target);assert.equal(timelineFocused,area==='timeline');assert.equal(timelineSelectionAction({key:'a',ctrlKey:true,target},{timelineFocused}),area==='timeline'?'all':null);assert.equal(timelineSelectionAction({key:'y',altKey:true,target},{timelineFocused}),'from_playhead');
  }
  assert.equal(timelineSelectionAction({key:'A',metaKey:true,target:focus('timeline')},{timelineFocused:true}),'all');
});
test('native selection shortcuts refuse text controls, modals, IME, repeats, prevented events and AltGraph',()=>{
  for(const base of [{key:'a',ctrlKey:true},{key:'y',altKey:true}]){
    for(const flag of ['defaultPrevented','repeat','isComposing','shiftKey'])assert.equal(timelineSelectionAction({...base,[flag]:true},{timelineFocused:true}),null);
    assert.equal(timelineSelectionAction({...base,target:focus('timeline',{text:true})},{timelineFocused:true}),null);assert.equal(timelineSelectionAction({...base,keyCode:229},{timelineFocused:true}),null);assert.equal(timelineSelectionAction({...base,getModifierState:()=>true},{timelineFocused:true}),null);assert.equal(timelineSelectionAction(base,{timelineFocused:true,dialogOpen:true}),null);
  }
  for(const event of [{key:'a',ctrlKey:true,altKey:true},{key:'a',ctrlKey:true,metaKey:true},{key:'y',altKey:true,ctrlKey:true},{key:'y',altKey:true,metaKey:true},{key:'a'}])assert.equal(timelineSelectionAction(event,{timelineFocused:true}),null);
});
test('Canvas and document dispatch handle the same Ctrl+A event once and preserve native selection order',()=>{
  const h=harness();try{const event={key:'a',ctrlKey:true,target:focus('timeline'),preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};h.key(event);assert.equal(event.defaultPrevented,true);assert.equal(h.selections(),1);assert.equal(h.input.handleSelectionKey(event,{timelineFocused:true}),false);assert.deepEqual(h.view.selection,['2','9','3','5']);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('global Alt+Y can select timeline clips from media focus without stealing Ctrl+A from that panel',()=>{
  const h=harness();try{h.view.selection=['9'];const target=focus('pool');assert.equal(h.input.handleSelectionKey({key:'a',ctrlKey:true,target},{timelineFocused:false}),false);assert.deepEqual(h.view.selection,['9']);assert.equal(h.input.handleSelectionKey({key:'y',altKey:true,target,preventDefault(){},stopPropagation(){}},{timelineFocused:false}),true);assert.deepEqual(h.view.selection,['2','3']);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('canNavigate, modal, active gesture, standalone draft and unresolved native edit block timeline selection',async()=>{
  for(const mode of ['navigate','modal','gesture','draft','lasso']){
    const h=harness();try{h.view.selection=['9'];if(mode==='navigate')h.setNavigable(false);if(mode==='modal')h.setModal(true);if(mode==='gesture')h.pointer('pointerdown',25);if(mode==='draft')h.view.draft={kind:'move'};if(mode==='lasso')h.view.lasso={x:0};const before=[...h.view.selection];assert.equal(h.input.selectTimelineClips('all'),false);assert.deepEqual(h.view.selection,before);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
  const pending=deferred(),h=harness({commit:()=>pending.promise});try{h.setEditable(true);h.view.selection=['9'];const applying=h.input.rippleDelete();assert.equal(h.commands.length,1);assert.equal(h.input.selectTimelineClips('all'),false);pending.resolve();await applying;}finally{pending.resolve();h.destroy();}
});
test('preset and transition drag ownership blocks selection without canceling or committing those gestures',()=>{
  const h=harness();try{h.setEditable(true);const payload=h.input.presetDnd.start({id:'preset',revision:'revision',name:'Look',video:true,audio:false},()=>true);assert.equal(typeof payload,'string');assert.equal(h.input.selectTimelineClips('all'),false);h.input.presetDnd.end();assert.equal(h.input.transitionDnd.start('Push'),true);assert.equal(h.input.selectTimelineClips('from_playhead'),false);h.input.transitionDnd.end();assert.equal(h.input.selectTimelineClips('all'),true);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
test('reentrant context, timeline or playhead changes refuse the captured selection before publication',()=>{
  for(const mode of ['context','timeline','playhead']){
    let h;h=harness({intent:()=>{if(mode==='context')h.setContext({project_epoch:'new',generation:'1'});if(mode==='timeline')h.setTimeline({...h.timeline,revision:'new'});if(mode==='playhead')h.view.playhead=30;}});try{h.view.selection=['9'];assert.equal(h.input.selectTimelineClips('all'),false);assert.deepEqual(h.view.selection,['9']);assert.equal(h.selections(),0);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
});
test('invalid selection mode or playhead never clears a valid existing selection',()=>{
  const h=harness();try{h.view.selection=['9'];assert.equal(h.input.selectTimelineClips('unknown'),false);h.view.playhead=NaN;assert.equal(h.input.selectTimelineClips('from_playhead'),false);assert.deepEqual(h.view.selection,['9']);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});

test('native refresh retains only existing unlocked selected IDs on the same timeline, while default installation resets',()=>{
  const timeline=sourceTimeline(),ids=['9','missing','3','locked'];timeline.tracks.push({id:'locked-track',locked:true,clips:[{id:'locked'}]});
  assert.deepEqual(retainedTimelineSelection(timeline,timeline.id,ids),['9','3']);
  assert.deepEqual(ids,['9','missing','3','locked']);
  assert.deepEqual(retainedTimelineSelection(timeline,'another-timeline',ids),[]);
  assert.deepEqual(retainedTimelineSelection(timeline,null,ids),[]);
  assert.deepEqual(retainedTimelineSelection(timeline,timeline.id,[]),[]);
  timeline.tracks[1].locked=true;assert.deepEqual(retainedTimelineSelection(timeline,timeline.id,['3']),[]);
});

test('the actual native refresh installation lets Mask ACK restore its picker without overriding newer user context or choice',async()=>{
  const source=readFileSync(new URL('../js/main.js',import.meta.url),'utf8');
  const install=source.slice(source.indexOf('function installTimeline('),source.indexOf('$("demo-button").addEventListener'));
  const track=source.slice(source.indexOf('function trackViewerSelection('),source.indexOf('function syncViewerMasks('));
  const commit=source.slice(source.indexOf('async function commitMask('),source.indexOf('transformOverlay=createViewerTransformOverlay'));
  for(const change of ['none','frame','selection','project','timeline','choice']){
    let api;const nodes=new Map(),makeNode=()=>({dataset:{},textContent:'',setAttribute(){},addEventListener(){},append(){},replaceChildren(){}});
    const state={view:{selection:['12'],playhead:0},timeline:{id:'1',revision:'old',fps:{num:24,den:1},tracks:[{id:'0',label:'V1',locked:false,clips:[{id:'12',start_frame:0,length_frames:100},{id:'other',start_frame:0,length_frames:100}]}]},documentState:{project_epoch:'epoch'},maskChoice:{scope:'epoch:1:12',revision:'old',index:1},maskSelectionIdentity:null,maskSelectionSequence:0,
      maskScope:context=>context?`${context.project_epoch}:${context.timeline_id}:${context.clip_id}`:null,maskFocusAfterEdit,retainedTimelineSelection,clampTimelineFrame,
      currentViewerContext:()=>({project_epoch:state.documentState.project_epoch,timeline_id:state.timeline.id,revision:state.timeline.revision,clip_id:'12',detail:{masks:{items:[{},{},{}]}}}),
      programArrowHold:null,retimeMenu:null,audioMeters:null,exportPanel:null,viewerZoom:null,canvasTimeline:{cancel(){},invalidate(){}},maskOverlay:{setEnabled(){throw Error('An existing handle edit must not switch overlay mode');},invalidate(){}},
      syncProgramMarks(){},updatePlayAvailability(){},selected:()=>api.trackViewerSelection(),updateTime:()=>{api.trackViewerSelection();state.maskChoice=null;},syncViewerMasks(){},selectedTransition:()=>null,nativeGapAt:()=>null,
      document:{createElement:makeNode},$:id=>{if(!nodes.has(id))nodes.set(id,makeNode());return nodes.get(id);},
      commit:async()=>{
        if(change==='frame')state.view.playhead=12;
        if(change==='selection')state.view.selection=['other'];
        if(change==='project')state.documentState.project_epoch='new-epoch';
        api.trackViewerSelection();const next={...state.timeline,id:change==='timeline'?'2':'1',revision:'new'};
        api.installTimeline(next,{selection:[...state.view.selection],selectionTimeline:'1'});
        if(change==='choice'){state.maskSelectionSequence++;state.maskChoice={scope:'epoch:1:12',revision:'new',index:2};}
        return {status:'applied'};
      }};
    api=runInNewContext(`${install}\n${track}\n${commit}\n({installTimeline,trackViewerSelection,commitMask})`,state);api.trackViewerSelection();const sequence=state.maskSelectionSequence;
    assert.equal((await api.commitMask({kind:'edit_viewer_mask',clip_id:'12',index:1,parameters:[{param:'Width',value:1031}]})).status,'applied');
    if(change==='none'){assert.equal(state.maskSelectionSequence,sequence);assert.equal(state.maskChoice.index,1);assert.equal(state.maskChoice.revision,'new');assert.deepEqual(Array.from(state.view.selection),['12']);}
    else if(change==='choice')assert.equal(state.maskChoice.index,2);
    else assert.equal(state.maskChoice,null,change);
  }
});
