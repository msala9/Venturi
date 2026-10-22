import test from 'node:test';
import assert from 'node:assert/strict';
import {clickTimelineSelection,clipSelectionAnchor,reconcileSelectionAnchor,firstSelectionAnchor,playheadSelectionAnchor,unlockedLinkedSelection,selectedGap,frameToX,RULER,TRACK,timelineLayout} from '../js/timeline/geometry.js';
import {createInput} from '../js/timeline/input.js';

const clip=(id,start,length=10,linked_group=null)=>({id,start_frame:start,length_frames:length,linked_group});
const fixture=()=>({id:'timeline',revision:'r1',fps:{num:24,den:1},markers:[],gaps:[],tracks:[
  {id:'v1',kind:'video',locked:false,clips:[clip('1',0),clip('2',20),clip('3',40,10,'pair'),clip('8',80)]},
  {id:'v2',kind:'video',locked:false,clips:[clip('4',5)]},
  {id:'a1',kind:'audio',locked:false,clips:[clip('5',0),clip('6',40,10,'pair')]},
  {id:'a2',kind:'audio',locked:true,clips:[clip('7',40,10,'pair')]},
]});
const geometry={scale:240,origin:0,scrollY:0};
const select=(timeline,state,id,options={})=>clickTimelineSelection(timeline,state,id,{projectEpoch:'epoch',...options},geometry);

function harness(){
  const original=globalThis.window,handlers=new Map(),captures=new Set(),commands=[],seeks=[],notices=[];
  let timeline=fixture(),context={project_epoch:'epoch',generation:'1'},modal=false,navigable=true,editable=true,selected=0,published=null;
  const document={querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={document,addEventListener(){},removeEventListener(){}};
  const canvas={ownerDocument:document,style:{},getBoundingClientRect:()=>({left:0,top:0,width:1400,height:400}),addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),focus(){},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const view={...geometry,playhead:17,selection:[],selectionAnchor:null,selectedGap:null,transitionSelection:null,tool:'move',snap:false,retimeVisible:new Set(),draft:null,lasso:null};
  const publish=()=>{selected++;published=structuredClone({ids:view.selection,anchor:view.selectionAnchor,gap:view.selectedGap,transition:view.transitionSelection});};
  const input=createInput({canvas,getTimeline:()=>timeline,getGapContext:()=>context,getPresetContext:()=>({...context,timeline_id:timeline.id,revision:timeline.revision}),view,invalidate(){},onSelect:publish,onTransitionSelect:publish,onSeek:()=>seeks.push(view.playhead),onCommand:async operation=>commands.push(operation),onNotice:message=>notices.push(message),canNavigate:()=>navigable,canEdit:()=>editable});
  const event=(frame,track=0,extra={})=>({clientX:frameToX(frame,view,timeline.fps),clientY:timelineLayout(timeline,view).trackTop(track)+30,button:0,buttons:1,pointerId:1,preventDefault(){},...extra});
  return {input,view,commands,seeks,notices,captures,selected:()=>selected,published:()=>published,get timeline(){return timeline;},setTimeline:value=>timeline=value,setContext:value=>context=value,setModal:value=>modal=value,setNavigable:value=>navigable=value,setEditable:value=>editable=value,send:(type,frame,track=0,extra={})=>handlers.get(type)(event(frame,track,extra)),key:event=>handlers.get('keydown')(event),async click(frame,track=0,extra={}){this.send('pointerdown',frame,track,extra);await this.send('pointerup',frame,track,{...extra,buttons:0});},destroy(){input.destroy();globalThis.window=original;}};
}

test('plain click replaces the previous selection, while repeated Shift replaces its range and keeps the original anchor',()=>{
  const timeline=fixture(),before=structuredClone(timeline);
  let state=select(timeline,{ids:['8'],anchor:null},'1');assert.deepEqual(state.ids,['1']);assert.equal(state.anchor.clip_id,'1');
  state=select(timeline,state,'3',{shift:true});assert.deepEqual(state.ids,['1','2','3','6']);assert.equal(state.anchor.clip_id,'1');
  state=select(timeline,state,'2',{shift:true});assert.deepEqual(state.ids,['1','2']);assert.equal(state.anchor.clip_id,'1');assert.deepEqual(timeline,before);
});

test('Shift takes precedence over Toggle, uses the whole clicked clip and excludes unrelated previous selection',()=>{
  const timeline=fixture(),anchor=clipSelectionAnchor(timeline,'1','epoch');
  const result=select(timeline,{ids:['8'],anchor},'2',{shift:true,toggle:true});
  assert.deepEqual(result.ids,['1','2']);assert.deepEqual(result.anchor,anchor);
  const missing=select(timeline,{ids:['8'],anchor:null},'3',{shift:true});assert.deepEqual(missing.ids,['3','6']);assert.equal(missing.anchor.clip_id,'3');
});

test('Ctrl/Meta toggles the clicked key before unlocked linked expansion, retaining the native linked-group behavior',()=>{
  const timeline=fixture();let state=select(timeline,{ids:[],anchor:null},'3');assert.deepEqual(state.ids,['3','6']);
  state=select(timeline,state,'3',{toggle:true});assert.deepEqual(state.ids,['3','6']);assert.equal(state.anchor.clip_id,'3');
  state=select(timeline,{ids:['1'],anchor:null},'1',{toggle:true});assert.deepEqual(state.ids,[]);assert.equal(state.anchor.clip_id,'1');
  assert.equal(select(timeline,state,'7'),null);assert.deepEqual(unlockedLinkedSelection(timeline,['3','7']),['3','6']);
});

test('range rows follow reversed native video lanes without reordering native track identities',()=>{
  const timeline=fixture(),state={ids:['1'],anchor:clipSelectionAnchor(timeline,'1','epoch')};
  assert.deepEqual(select(timeline,state,'5',{shift:true}).ids,['1','5']);
  assert.deepEqual(select(timeline,{ids:['4'],anchor:clipSelectionAnchor(timeline,'4','epoch')},'5',{shift:true}).ids,['1','4','5']);
  assert.deepEqual(timeline.tracks.map(track=>track.id),['v1','v2','a1','a2']);
});

test('whole-clip two-pixel minimum and touching rectangle boundaries are included without frame rounding',()=>{
  const timeline=fixture();timeline.tracks=[{id:'v',kind:'video',locked:false,clips:[clip('1',0,1),clip('2',10,1),clip('3',30,1),clip('4',31,1)]}];
  const result=clickTimelineSelection(timeline,{ids:['1'],anchor:clipSelectionAnchor(timeline,'1','epoch')},'2',{shift:true,projectEpoch:'epoch'},{scale:2.4});
  assert.deepEqual(result.ids,['1','2','3']);
});

test('anchor survives same-timeline revision/viewport changes but not project, timeline, deletion, movement to another lane or lock',()=>{
  const timeline=fixture(),anchor=clipSelectionAnchor(timeline,'2','epoch');
  assert.deepEqual(reconcileSelectionAnchor({...timeline,revision:'r2'},anchor,'epoch'),anchor);
  assert.equal(reconcileSelectionAnchor(timeline,anchor,'other'),null);assert.equal(reconcileSelectionAnchor({...timeline,id:'other'},anchor,'epoch'),null);
  for(const change of [value=>value.tracks[0].locked=true,value=>value.tracks[0].clips=value.tracks[0].clips.filter(item=>item.id!=='2'),value=>{value.tracks[1].clips.push(value.tracks[0].clips.splice(1,1)[0]);}]){const value=structuredClone(timeline);change(value);assert.equal(reconcileSelectionAnchor(value,anchor,'epoch'),null);}
  assert.equal(select(timeline,{ids:[],anchor:{...anchor,project_epoch:'other'}},'3',{shift:true}).anchor.clip_id,'3');
});

test('bulk/paste anchors use native ClipKey order, while playhead anchor is the active video even when a linked audio ID sorts first',()=>{
  const timeline=fixture();timeline.tracks[0].clips=[clip('9',0,50,'pair'),clip('2',60)];timeline.tracks[1].clips=[];timeline.tracks[2].clips=[clip('1',0,50,'pair')];
  assert.equal(firstSelectionAnchor(timeline,['9','2','1'],'epoch').clip_id,'2');
  assert.equal(playheadSelectionAnchor(timeline,10,'epoch').clip_id,'9');
  timeline.tracks[0].locked=true;assert.equal(playheadSelectionAnchor(timeline,10,'epoch'),null);
});

test('accessible API and Canvas Shift/Meta paths publish the same selection, anchor and stable viewport without native commands',async()=>{
  const a=harness(),b=harness();try{
    const before={playhead:a.view.playhead,origin:a.view.origin,scale:a.view.scale,scrollY:a.view.scrollY};
    a.input.selectClip('1');a.input.selectClip('3',{shiftKey:true,ctrlKey:true});
    await b.click(5);await b.click(45,0,{shiftKey:true,ctrlKey:true});
    assert.deepEqual(a.view.selection,b.view.selection);assert.deepEqual(a.view.selectionAnchor,b.view.selectionAnchor);
    a.input.selectClip('1',{metaKey:true});await b.click(5,0,{metaKey:true});assert.deepEqual(a.view.selection,b.view.selection);assert.deepEqual(a.view.selectionAnchor,b.view.selectionAnchor);
    assert.deepEqual({playhead:a.view.playhead,origin:a.view.origin,scale:a.view.scale,scrollY:a.view.scrollY},before);assert.deepEqual([...a.commands,...b.commands,...a.seeks,...b.seeks],[]);
  }finally{b.destroy();a.destroy();}
});

test('plain click collapses an existing multi-selection only on release; dragging a selected member preserves the group',async()=>{
  const h=harness();try{
    h.input.selectTimelineClips('all');const all=[...h.view.selection];h.send('pointerdown',5);assert.deepEqual(h.view.selection,all);await h.send('pointerup',5,0,{buttons:0});assert.deepEqual(h.view.selection,['1']);assert.deepEqual(h.commands,[]);
    h.view.selection=['1','2'];h.view.selectionAnchor=clipSelectionAnchor(h.timeline,'2','epoch');h.send('pointerdown',5);const reads=h.selected();h.send('pointermove',6);assert.deepEqual(h.view.selection,['1','2']);assert.equal(h.view.selectionAnchor.clip_id,'1');assert.equal(h.selected(),reads,'Pointer drafts must not trigger inspector reads');assert.deepEqual(h.commands,[]);
    await h.send('pointerup',6,0,{buttons:0});assert.equal(h.commands.length,1);assert.equal(h.commands[0].kind,'safe_move');assert.deepEqual(h.commands[0].moves.map(move=>move.clip_id),['1','2']);assert.equal(h.captures.size,0);
  }finally{h.destroy();}
});

test('Escape/pointercancel restore a pending modified click, and subsequent ordinary click remains selection-only',async()=>{
  for(const cancel of [h=>h.key({key:'Escape',preventDefault(){},stopPropagation(){}}),h=>h.send('pointercancel',25)]){
    const h=harness();try{h.input.selectClip('1');const anchor=structuredClone(h.view.selectionAnchor);h.send('pointerdown',25,0,{shiftKey:true});assert.deepEqual(h.view.selection,['1','2']);cancel(h);assert.deepEqual(h.view.selection,['1']);assert.deepEqual(h.view.selectionAnchor,anchor);assert.equal(h.captures.size,0);assert.equal(h.view.draft,null);await h.click(25);assert.deepEqual(h.view.selection,['2']);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
});

test('modal, busy/navigation and read-only states guard click ownership while read-only view selection stays available',async()=>{
  const h=harness();try{h.setEditable(false);assert.equal(h.input.selectClip('1'),true);await h.click(25);assert.deepEqual(h.view.selection,['2']);
    h.setModal(true);assert.equal(h.input.selectClip('3',{shiftKey:true}),false);h.setModal(false);h.setNavigable(false);assert.equal(h.input.selectClip('3'),false);await h.click(45);assert.deepEqual(h.view.selection,['2']);
    h.setNavigable(true);h.send('pointerdown',25);h.send('pointermove',26);await h.send('pointerup',26,0,{buttons:0});assert.deepEqual(h.commands,[]);assert.equal(h.captures.size,0);
  }finally{h.destroy();}
});

test('captured clicks and drags refuse modal, epoch/generation, timeline/revision, viewport and selection changes before release',async()=>{
  for(const change of [h=>h.setModal(true),h=>h.setContext({project_epoch:'other',generation:'1'}),h=>h.setContext({project_epoch:'epoch',generation:'2'}),h=>h.setTimeline({...h.timeline}),h=>h.timeline.revision='r2',h=>h.view.origin=1,h=>h.view.selection=['8']]){
    const h=harness();try{h.input.selectClip('1');h.send('pointerdown',25,0,{shiftKey:true});change(h);await h.send('pointerup',25,0,{buttons:0});assert.deepEqual(h.commands,[]);assert.equal(h.view.draft,null);assert.equal(h.captures.size,0);}finally{h.destroy();}
  }
});

test('mismatched pointer release cannot complete a click; a later correct release applies it exactly once',async()=>{
  const h=harness();try{h.send('pointerdown',25);await h.send('pointerup',25,0,{pointerId:2,buttons:0});assert.equal(h.captures.size,1);await h.send('pointerup',25,0,{buttons:0});assert.equal(h.captures.size,0);assert.deepEqual(h.view.selection,['2']);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});

test('locked linked peers stay out of view selection but retain native edit preflight refusal',async()=>{
  const h=harness();try{h.input.selectClip('3');assert.deepEqual(h.view.selection,['3','6']);h.send('pointerdown',45);h.send('pointermove',46);await h.send('pointerup',46,0,{buttons:0});assert.deepEqual(h.commands,[]);assert.equal(h.view.draft,null);assert.equal(h.captures.size,0);assert.match(h.notices[0],/linked/);}finally{h.destroy();}
});

test('bulk, blank, gap and transition selection lifecycle never revives an obsolete anchor',async()=>{
  const h=harness();try{
    h.input.selectTimelineClips('all');assert.equal(h.view.selectionAnchor.clip_id,'1');h.view.playhead=50;h.input.selectTimelineClips('from_playhead');assert.equal(h.view.selectionAnchor.clip_id,'8');
    await h.click(100);assert.deepEqual(h.view.selection,[]);assert.equal(h.view.selectionAnchor,null);
    h.input.selectClip('1');h.timeline.gaps=[{track_id:'v1',start_frame:10,length_frames:10}];assert.equal(h.input.selectGap('v1',15),true);assert.equal(h.view.selectionAnchor,null);
    h.view.selectionAnchor=clipSelectionAnchor(h.timeline,'1','epoch');h.setContext({project_epoch:'new',generation:'1'});assert.equal(h.input.checkSelectionAnchor(),null);
  }finally{h.destroy();}
});

test('marquee replaces even with Ctrl and anchors its first raw hit before expanding linked peers',async()=>{
  const h=harness();try{h.input.selectClip('8');const before=structuredClone(h.view.selectionAnchor),reads=h.selected();h.send('pointerdown',35,0,{ctrlKey:true});h.send('pointermove',48);assert.deepEqual(h.view.selection,['8']);assert.deepEqual(h.view.selectionAnchor,before);assert.equal(h.selected(),reads);await h.send('pointerup',48,0,{ctrlKey:true,buttons:0});assert.deepEqual(h.view.selection,['3','6']);assert.equal(h.view.selectionAnchor.clip_id,'3');assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});

test('canceled Plain and Ctrl marquee preserve the previous selection and anchor without publishing pointer drafts',()=>{
  for(const ctrlKey of [false,true])for(const abort of [h=>h.key({key:'Escape',preventDefault(){},stopPropagation(){}}),h=>h.send('pointercancel',48)]){
    const h=harness();try{h.input.selectClip('1');h.input.selectClip('2',{ctrlKey:true});const before=structuredClone(h.published()),reads=h.selected();h.send('pointerdown',35,0,{ctrlKey});h.send('pointermove',48);assert.deepEqual(h.view.selection,before.ids);assert.deepEqual(h.view.selectionAnchor,before.anchor);assert.equal(h.selected(),reads);abort(h);assert.deepEqual(h.view.selection,before.ids);assert.deepEqual(h.view.selectionAnchor,before.anchor);assert.deepEqual(h.published(),before);assert.equal(h.selected(),reads);assert.equal(h.captures.size,0);assert.equal(h.view.lasso,null);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
});

test('blank click clears previous selection only at release, while external selection changes cancel its owned marquee',async()=>{
  const h=harness();try{h.input.selectClip('1');const reads=h.selected();h.send('pointerdown',100);assert.deepEqual(h.view.selection,['1']);assert.equal(h.view.selectionAnchor.clip_id,'1');assert.equal(h.selected(),reads);await h.send('pointerup',100,0,{buttons:0});assert.deepEqual(h.view.selection,[]);assert.equal(h.view.selectionAnchor,null);assert.equal(h.selected(),reads+1);
    h.input.selectClip('1');h.send('pointerdown',35);h.view.selection=['8'];h.view.selectionAnchor=clipSelectionAnchor(h.timeline,'8','epoch');h.send('pointermove',48);await h.send('pointerup',48,0,{buttons:0});assert.deepEqual(h.view.selection,['8']);assert.equal(h.view.selectionAnchor.clip_id,'8');assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('Escape restores the original native gap or transition after a pending clip click replaced it',()=>{
  for(const type of ['gap','transition']){
    const h=harness();try{
      if(type==='gap'){h.timeline.gaps=[{track_id:'v1',start_frame:10,length_frames:10}];h.input.selectGap('v1',15);}
      else{h.timeline.tracks[0].clips[0].kind='media';h.timeline.tracks[0].clips[0].transition_in={kind:'Push',duration:3,direction:'Left',ease:'None',curve:0.5};h.view.transitionSelection={track_id:'v1',clip_id:'1',slot:'in'};}
      const before=structuredClone({ids:h.view.selection,anchor:h.view.selectionAnchor,gap:h.view.selectedGap,transition:h.view.transitionSelection});
      h.send('pointerdown',25);assert.deepEqual(h.view.selection,['2']);assert.equal(h.view.selectedGap,null);assert.equal(h.view.transitionSelection,null);const reads=h.selected();h.key({key:'Escape',preventDefault(){},stopPropagation(){}});
      assert.deepEqual({ids:h.view.selection,anchor:h.view.selectionAnchor,gap:h.view.selectedGap,transition:h.view.transitionSelection},before);assert.deepEqual(h.published(),before);assert.equal(h.selected(),reads+1);assert.equal(h.captures.size,0);assert.deepEqual(h.commands,[]);
    }finally{h.destroy();}
  }
});

test('rollback does not resurrect a changed native gap or transition',()=>{
  for(const type of ['gap','transition']){
    const h=harness();try{
      if(type==='gap'){h.timeline.gaps=[{track_id:'v1',start_frame:10,length_frames:10}];h.input.selectGap('v1',15);}
      else{h.timeline.tracks[0].clips[0].kind='media';h.timeline.tracks[0].clips[0].transition_in={kind:'Push',duration:3,direction:'Left',ease:'None',curve:0.5};h.view.transitionSelection={track_id:'v1',clip_id:'1',slot:'in'};}
      h.send('pointerdown',25);if(type==='gap')h.timeline.gaps=[];else h.timeline.tracks[0].clips[0].transition_in=null;h.input.cancel();assert.equal(h.view.selectedGap,null);assert.equal(h.view.transitionSelection,null);assert.deepEqual(h.view.selection,[]);assert.deepEqual(h.commands,[]);
    }finally{h.destroy();}
  }
});

test('viewport abort and read-only Shift-drag refusal publish exactly one rollback to the Inspector/accessibility proxy',()=>{
  for(const mode of ['viewport','readonly']){
    const h=harness();try{h.input.selectClip('1');const before=structuredClone(h.published());if(mode==='readonly')h.setEditable(false);h.send('pointerdown',25,0,{shiftKey:true});assert.deepEqual(h.published().ids,['1','2']);const reads=h.selected();if(mode==='viewport')h.view.origin=1;h.send('pointermove',26);assert.deepEqual(h.view.selection,before.ids);assert.deepEqual(h.view.selectionAnchor,before.anchor);assert.deepEqual(h.published(),before);assert.equal(h.selected(),reads+1);h.send('pointermove',27);assert.equal(h.selected(),reads+1);assert.equal(h.captures.size,0);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
});

test('an obsolete pending clip release cannot clear a new external native gap or notify over its selection owner',async()=>{
  const h=harness();try{
    h.timeline.gaps=[{track_id:'v1',start_frame:10,length_frames:10}];h.input.selectGap('v1',15);const externalGap=structuredClone(h.view.selectedGap);
    h.input.selectClip('1');h.send('pointerdown',25,0,{shiftKey:true});assert.deepEqual(h.view.selection,['1','2']);
    h.view.selection=[];h.view.selectionAnchor=null;h.view.transitionSelection=null;h.view.selectedGap=externalGap;
    assert.ok(selectedGap(h.timeline,h.view));const before=structuredClone({ids:h.view.selection,anchor:h.view.selectionAnchor,gap:h.view.selectedGap,transition:h.view.transitionSelection}),reads=h.selected(),published=structuredClone(h.published());
    await h.send('pointerup',25,0,{buttons:0});
    assert.deepEqual({ids:h.view.selection,anchor:h.view.selectionAnchor,gap:h.view.selectedGap,transition:h.view.transitionSelection},before);assert.ok(selectedGap(h.timeline,h.view));assert.equal(h.selected(),reads);assert.deepEqual(h.published(),published);assert.equal(h.captures.size,0);assert.equal(h.view.draft,null);assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
  }finally{h.destroy();}
});

test('same-timeline snapshot refresh/viewport restore retain a valid manual anchor and reconcile deleted or locked targets',()=>{
  const h=harness();try{h.input.selectClip('1');h.input.selectClip('3',{shiftKey:true});const viewport=structuredClone({selection:h.view.selection,selectionAnchor:h.view.selectionAnchor});h.input.cancel();h.setTimeline({...structuredClone(h.timeline),revision:'r2'});h.setContext({project_epoch:'epoch',generation:'2'});h.view.selection=[...viewport.selection];h.view.selectionAnchor=reconcileSelectionAnchor(h.timeline,viewport.selectionAnchor,'epoch');assert.equal(h.input.checkSelectionAnchor().clip_id,'1');h.input.selectClip('2',{shiftKey:true});assert.deepEqual(h.view.selection,['1','2']);h.timeline.tracks[0].locked=true;assert.equal(h.input.checkSelectionAnchor(),null);}finally{h.destroy();}
});
