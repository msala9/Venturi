import test from "node:test";
import assert from "node:assert/strict";
import { detailIdentity, propertyOperation, keyframeOperation,transformPatch,keyPageIndex,transitionSelectionOperation,editingShortcutAllowed,selectionInspectorRows,bindInspectorNumber,bindKeyEditorDelete,renderSelectedAudioGain,createInspectorViewportKeeper } from "../js/inspector.js";

test('nonmodal key editor owns one mixed-key Delete without deleting timeline clips or consuming text edits',()=>{
  const events=new Map(),root={addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:(key,fn)=>{if(events.get(key)===fn)events.delete(key);}};
  let selected=[{target:{kind:'gain'},source_frame:3},{target:{kind:'text'},source_frame:9}],allowed=true,modal=false,removed=0;
  const owner=bindKeyEditorDelete(root,{selection:{get:()=>selected},remove:()=>removed++,canInteract:()=>allowed,documentRef:{querySelector:()=>modal?{}:null}});
  const press=(patch={})=>{const event={key:'Delete',target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...patch};events.get('keydown')?.(event);return event;};
  const event=press();assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(removed,1);
  for(const patch of [{defaultPrevented:true},{repeat:true},{isComposing:true},{ctrlKey:true},{altKey:true},{target:{closest:()=>({})}},{key:'s',ctrlKey:true}]){press(patch);assert.equal(removed,1);}
  modal=true;assert.equal(press().defaultPrevented,undefined);modal=false;allowed=false;assert.equal(press().defaultPrevented,true);assert.equal(removed,1);
  allowed=true;selected=[];assert.equal(press().defaultPrevented,undefined);owner.cancel();press();assert.equal(removed,1);assert.equal(events.size,0);
});

test('global editing shortcuts leave modal, text, media, composing and repeated keys to their current owner',()=>{
  const event={key:'Delete',target:{closest:()=>null},getModifierState:()=>false};assert.equal(editingShortcutAllowed(event),true);
  for(const change of [{defaultPrevented:true},{repeat:true},{isComposing:true},{keyCode:229},{getModifierState:name=>name==='AltGraph'},{target:{closest:()=>({})}}])assert.equal(editingShortcutAllowed({...event,...change}),false);
  assert.equal(editingShortcutAllowed(event,{dialogOpen:true}),false);
  assert.equal(editingShortcutAllowed({...event,repeat:true},{allowRepeat:true}),true);assert.equal(editingShortcutAllowed({...event,repeat:true,isComposing:true},{allowRepeat:true}),false);
});

test('selection summary accepts native own-clock rows only for the complete captured query and selection',()=>{
  const query={project_epoch:'epoch',if_generation:'4',timeline_id:'tl',revision:'revision',frame:370,width:320},clip_ids=['v','a'],rows=[{clip_id:'v',track_id:'0',kind:'video',name:'Video',start_frame:10,length_frames:20,source_frame:90,locked:false},{clip_id:'a',track_id:'1',kind:'audio',name:'Audio',start_frame:20,length_frames:40,source_frame:73,locked:true}],value={query:{...query},rows};
  assert.deepEqual(selectionInspectorRows(value,{query,clip_ids}),rows);
  for(const bad of [{...value,query:{...query,frame:371}},{...value,rows:rows.slice(0,1)},{...value,rows:[rows[0],rows[0]]},{...value,rows:[rows[0],{...rows[1],source_frame:NaN}]}])assert.throws(()=>selectionInspectorRows(bad,{query,clip_ids}));
  assert.equal(rows[0].source_frame,90);
});

test('Inspector numeric scrubs stay local until final release and restore typed state on Escape, stale ownership or blur',()=>{
  const events={},windowEvents={},commits=[];let allowed=true,captured=false;
  const input={value:'10',min:'-100',max:'100',isConnected:true,disabled:false,addEventListener:(name,handler)=>events[name]=handler,removeEventListener:(name,handler)=>{if(events[name]===handler)delete events[name];},setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;events.lostpointercapture();}},windowRef={addEventListener:(name,handler)=>windowEvents[name]=handler,removeEventListener:name=>delete windowEvents[name]};
  const control=bindInspectorNumber(input,{canInteract:()=>allowed,apply:()=>commits.push(Number(input.value)),windowRef});const point=(x,extra={})=>({button:0,pointerId:1,buttons:1,clientX:x,preventDefault(){},stopPropagation(){},...extra});
  events.pointerdown(point(0));events.pointermove(point(10));assert.equal(input.value,'20');assert.deepEqual(commits,[]);events.pointerup(point(15));assert.deepEqual(commits,[25]);
  for(const cancel of [()=>events.keydown({...point(0),key:'Escape'}),()=>{allowed=false;},()=>windowEvents.blur()]){allowed=true;input.value='12.5';events.pointerdown(point(0));events.pointermove(point(10));cancel();events.pointerup(point(15));assert.equal(input.value,'12.5');}
  assert.deepEqual(commits,[25]);allowed=true;events.pointerdown(point(0));events.pointerup(point(0));assert.deepEqual(commits,[25]);
  events.pointerdown(point(0));events.pointermove(point(10,{shiftKey:true}));events.pointerup(point(10,{shiftKey:true}));assert.equal(commits.at(-1),13.5);control.dispose();assert.equal(windowEvents.blur,undefined);assert.deepEqual(Object.keys(events),[]);
});

const settleInspector=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function selectedLifecycleHarness(t,{commit}={}){
  const oldDocument=globalThis.document,commands=[],notices=[];
  class Surface extends EventTarget{
    constructor(){super();this.listeners=new Map();}
    addEventListener(key,handler){super.addEventListener(key,handler);if(!this.listeners.has(key))this.listeners.set(key,new Set());this.listeners.get(key).add(handler);}
    removeEventListener(key,handler){super.removeEventListener(key,handler);this.listeners.get(key)?.delete(handler);}
    count(){return [...this.listeners.values()].reduce((sum,handlers)=>sum+handlers.size,0);}
  }
  const view=new Surface(),doc={defaultView:view,createElement:tag=>new Element(tag)};
  class Element extends Surface{
    constructor(tag){super();this.tagName=tag;this.children=[];this.ownerDocument=doc;this.isConnected=true;this.disabled=false;this.value='';this.captures=new Set();}
    get value(){return this.textValue ?? '';}set value(value){this.textValue=String(value);}
    append(...nodes){for(const node of nodes){this.children.push(node);if(typeof node==='object')node.parent=this;}}
    setAttribute(name,value){this[name]=String(value);}getAttribute(name){return this[name] ?? null;}reportValidity(){return true;}
    setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);fire(this,'lostpointercapture',{pointerId:id});}
  }
  function fire(node,key,properties={}){const event=new Event(key,{cancelable:true});for(const [name,value] of Object.entries(properties))Object.defineProperty(event,name,{value});node.dispatchEvent(event);}
  globalThis.document=doc;const root=new Element('div'),selection={clip_ids:['audio'],project_epoch:'epoch',generation:'4',timeline_id:'timeline',revision:'revision'},detail={clip_id:'audio',video:false,locked:false,gain:{value:-3,keyframe_info:{on_keyframe:false,previous_frame:null,next_frame:null}}};
  const controls=renderSelectedAudioGain(root,detail,{selection,getSelection:()=>selection,frame:20,getFrame:()=>20,canInteract:()=>true,commit:operation=>{commands.push(operation);return commit?.(operation);},notice:message=>notices.push(message)});
  t.after(()=>{controls.dispose();globalThis.document=oldDocument;});
  const all=node=>[node,...node.children.filter(child=>typeof child==='object').flatMap(all)],input=all(root).find(node=>node['aria-label']==='Selected gain dB');
  return {controls,input,view,commands,notices,fire,apply(value){input.value=String(value);fire(input.parent.parent,'submit');},point(key,x,extra={}){fire(input,key,{button:0,pointerId:1,buttons:1,clientX:x,...extra});}};
}

test('selected Inspector blur cancellation restores owned drafts and permits a later edit on the same mounted selection',async t=>{
  const h=selectedLifecycleHarness(t);let canceled=0,disposed=0;h.controls.own({cancel(){canceled++;},dispose(){disposed++;}});
  h.point('pointerdown',0);h.point('pointermove',10);assert.equal(h.input.value,'7');assert.deepEqual(h.commands,[]);
  h.controls.cancel();h.fire(h.view,'blur');h.point('pointerup',15,{buttons:0});await settleInspector();
  assert.equal(h.input.value,'-3');assert.equal(h.input.captures.size,0);assert.equal(h.controls.available(),true);assert.equal(canceled,1);assert.equal(disposed,0);assert.deepEqual(h.commands,[]);
  h.point('pointerdown',0);h.point('pointerup',5,{buttons:0});await settleInspector();assert.deepEqual(h.commands.map(command=>command.edit),[{action:'gain',value:2}]);
  h.controls.dispose();h.controls.dispose();assert.equal(disposed,1);assert.equal(h.controls.available(),false);assert.equal(h.view.count(),0);assert.equal(h.input.disabled,true);
  h.apply(9);h.point('pointerdown',0);h.point('pointerup',10,{buttons:0});await settleInspector();assert.equal(h.commands.length,1);
});

test('canceling before dispatch abandons only that queued edit and does not leave the mounted Inspector waiting',async t=>{
  const h=selectedLifecycleHarness(t);h.apply(4);h.controls.cancel();await settleInspector();assert.deepEqual(h.commands,[]);assert.equal(h.controls.available(),true);assert.deepEqual(h.notices,[]);
  h.apply(5);await settleInspector();assert.deepEqual(h.commands.map(command=>command.edit),[{action:'gain',value:5}]);assert.equal(h.controls.available(),true);
});

test('canceling an already dispatched edit retains its pending and unknown-outcome safeguards',async t=>{
  let reject;const h=selectedLifecycleHarness(t,{commit:()=>new Promise((_,fail)=>{reject=fail;})});h.apply(4);await settleInspector();assert.equal(h.commands.length,1);h.controls.cancel();h.apply(5);assert.equal(h.controls.available(),false);assert.equal(h.commands.length,1);
  reject(Object.assign(Error('Confirm the native write outcome before editing'),{code:'OUTCOME_UNKNOWN'}));await settleInspector();h.controls.cancel();h.apply(6);await settleInspector();assert.equal(h.commands.length,1);assert.equal(h.controls.available(),false);assert.match(h.notices.at(-1),/outcome/);
});

function viewportHarness(){
  class Surface extends EventTarget{
    constructor(){super();this.handlers=new Map();}
    addEventListener(key,handler,options){super.addEventListener(key,handler,options);if(!this.handlers.has(key))this.handlers.set(key,new Set());this.handlers.get(key).add(handler);}
    removeEventListener(key,handler,options){super.removeEventListener(key,handler,options);this.handlers.get(key)?.delete(handler);}
    count(){return [...this.handlers.values()].reduce((sum,handlers)=>sum+handlers.size,0);}
  }
  const doc=new Surface(),view=new Surface(),frames=new Map();let context='epoch/timeline/audio/Audio/clip9',frameId=0,observer;
  doc.body={isConnected:true};doc.activeElement=doc.body;doc.querySelector=()=>doc.dialog?{}:null;
  const root={ownerDocument:doc,children:[],isConnected:true,clientHeight:200,scrollHeight:200,getBoundingClientRect:()=>({top:100,bottom:300,height:200}),querySelectorAll(){return this.children;},contains(node){return this.children.includes(node);},get scrollTop(){return this.top ?? 0;},set scrollTop(value){this.top=Math.max(0,Math.min(this.scrollHeight-this.clientHeight,value));}};
  class Observer{
    constructor(callback){this.callback=callback;observer=this;}observe(){this.connected=true;}disconnect(){this.connected=false;}emit(){if(this.connected)this.callback();}
  }
  function fire(target,type,properties={}){const event=new Event(type,{cancelable:true});for(const [name,value] of Object.entries(properties))Object.defineProperty(event,name,{value});target.dispatchEvent(event);}
  function node(label,at,{disabled=false}={}){return {tagName:'INPUT',type:'number',id:'',label,at,disabled,focuses:0,get isConnected(){return root.contains(this);},getAttribute(name){return name==='aria-label'?this.label:null;},getClientRects(){return this.isConnected?[this.getBoundingClientRect()]:[];},getBoundingClientRect(){const top=100+this.at-root.scrollTop;return {top,bottom:top+24,height:24};},focus(options){this.focuses++;this.focusOptions=options;doc.activeElement=this;fire(doc,'focusin',{target:this});},closest(){return null;}};}
  const keeper=createInspectorViewportKeeper(root,{getContext:()=>context,documentRef:doc,windowRef:view,Observer,requestFrame:callback=>{const id=++frameId;frames.set(id,callback);return id;},cancelFrame:id=>frames.delete(id)});
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();};
  keeper.contextChanged();
  return {root,doc,view,keeper,frames,fire,node,flush,get observer(){return observer;},mutate:()=>observer.emit(),replace(nodes,height){if(root.contains(doc.activeElement))doc.activeElement=doc.body;root.children=nodes;root.scrollHeight=height;root.scrollTop=root.scrollTop;observer.emit();},focus(target){doc.activeElement=target;fire(doc,'focusin',{target});},context(value){context=value;},dispose(){keeper.dispose();}};
}

test('Inspector viewport survives clamped busy rebuilds and delayed lazy hydration using the same native control anchor',()=>{
  const h=viewportHarness();try{
    const old=h.node('A1 low threshold',1600);h.replace([old],2400);h.root.scrollTop=1500;h.focus(old);old.disabled=true;h.doc.activeElement=h.doc.body;h.keeper.capture();
    h.replace([],200);h.flush();assert.equal(h.root.scrollTop,0);h.keeper.capture();h.replace([],200);h.flush();assert.equal(h.frames.size,0);
    const fresh=h.node('A1 low threshold',1800,{disabled:true});h.replace([fresh],2600);h.flush();assert.equal(h.root.scrollTop,1700);assert.equal(fresh.focuses,0);
    fresh.disabled=false;h.mutate();h.flush();assert.equal(h.root.scrollTop,1700);assert.equal(h.doc.activeElement,fresh);assert.deepEqual(fresh.focusOptions,{preventScroll:true});
    fresh.at=2100;h.root.scrollHeight=2900;h.mutate();h.flush();assert.equal(h.root.scrollTop,2000);assert.equal(fresh.focuses,1);assert.equal(fresh.getBoundingClientRect().top-h.root.getBoundingClientRect().top,100);assert.equal(h.frames.size,0);
  }finally{h.dispose();}
});

test('Inspector viewport uses remembered scroll when the anchor is not yet present and resets for a different context',()=>{
  const h=viewportHarness();try{
    h.root.scrollHeight=2000;h.root.scrollTop=1200;h.keeper.capture();h.replace([],200);h.flush();assert.equal(h.root.scrollTop,0);
    h.root.scrollHeight=2200;h.mutate();h.flush();assert.equal(h.root.scrollTop,1200);
    h.context('epoch/timeline/video/Color/clip10');h.mutate();h.flush();assert.equal(h.root.scrollTop,0);assert.equal(h.observer.connected,false);assert.equal(h.frames.size,0);
    h.root.scrollTop=400;h.keeper.capture();h.root.scrollHeight=2500;h.mutate();h.flush();assert.equal(h.root.scrollTop,400);
  }finally{h.dispose();}
});

test('Inspector restoration yields to user wheel, pointer or keyboard navigation and never steals outside or dialog focus',()=>{
  for(const interrupt of [h=>h.fire(h.doc,'wheel'),h=>h.fire(h.doc,'pointerdown',{target:h.doc.body}),h=>h.fire(h.doc,'keydown',{key:'Tab'}),h=>h.focus({isConnected:true}),h=>{h.doc.dialog=true;}]){
    const h=viewportHarness();try{
      const old=h.node('A1 ratio',1300);h.replace([old],2000);h.root.scrollTop=1200;h.focus(old);h.keeper.capture();h.replace([],200);interrupt(h);
      const fresh=h.node('A1 ratio',1500);h.replace([fresh],2400);h.flush();assert.equal(fresh.focuses,0);assert.equal(h.root.scrollTop,0);assert.equal(h.observer.connected,false);
    }finally{h.dispose();}
  }
});

test('Inspector viewport disposal cancels queued frames and removes its scoped listeners and observer',()=>{
  const h=viewportHarness();h.root.scrollHeight=2000;h.root.scrollTop=800;h.keeper.capture();assert.equal(h.frames.size,1);h.dispose();h.dispose();h.replace([h.node('Later control',900)],2000);h.flush();assert.equal(h.root.scrollTop,800);assert.equal(h.frames.size,0);assert.equal(h.observer.connected,false);assert.equal(h.doc.count(),0);assert.equal(h.view.count(),0);
});

test('selected transition edits preserve native fields and canonical cut anchor without mutating the snapshot',()=>{
  const target={track_id:'0',clip_id:'9007199254740993',slot:'cut_after',max:48,transition:{kind:'Push',duration:13,direction:'Up',ease:'InOut',curve:0.625}},before=structuredClone(target);
  assert.deepEqual(transitionSelectionOperation(target,{duration:17}),{kind:'set_transition',clip_id:target.clip_id,slot:'cut_after',transition:{...target.transition,duration:17}});
  assert.deepEqual(target,before);assert.equal(transitionSelectionOperation(target,{}),null);assert.equal(transitionSelectionOperation(target,{duration:13,curve:0.625}),null);
  assert.deepEqual(transitionSelectionOperation(target,null),{kind:'set_transition',clip_id:target.clip_id,slot:'cut_after',transition:null});
});

test('selected transition inspector refuses malformed edits before a command is produced',()=>{
  const target={clip_id:'3',slot:'in',max:20,transition:{kind:'SmoothCut',duration:5,direction:'Right',ease:'None',curve:0.5}};
  for(const patch of [{duration:0},{duration:21},{duration:1.5},{curve:NaN},{curve:1.01},{direction:'Diagonal'},{ease:'Invalid'},{kind:'Push'}])assert.throws(()=>transitionSelectionOperation(target,patch));
  assert.throws(()=>transitionSelectionOperation(null,{}));assert.deepEqual(transitionSelectionOperation(target,{ease:'Out',curve:0.75}).transition,{...target.transition,ease:'Out',curve:0.75});
});

test("native key pages validate bounds and distinguish otherwise identical inspector requests",()=>{
  assert.equal(keyPageIndex("10",10),9);
  for(const value of ["",0,11,1.5,Infinity,"bad"])assert.throws(()=>keyPageIndex(value,10));
  assert.notEqual(detailIdentity({clip:"1",key_page:0}),detailIdentity({clip:"1",key_page:1}));
});

test("linked zoom defaults and playhead keys use one existing atomic native request",()=>{
  assert.deepEqual(transformPatch("ZoomX",1.5,true),{transform:[{param:"ZoomX",value:1.5},{param:"ZoomY",value:1.5}]});
  assert.deepEqual(transformPatch("PositionX",10,true),{transform:[{param:"PositionX",value:10}]});
  const request=keyframeOperation("4",{kind:"transform",param:"ZoomY"},48,1.7,"Hold",true);assert.equal(request.kind,"set_keyframes");
  assert.deepEqual(request.edits.map(edit=>edit.target.param),["ZoomY","ZoomX"]);assert.ok(request.edits.every(edit=>edit.timeline_frame===48 && edit.value===1.7 && edit.interpolation==="Hold"));
  assert.ok(keyframeOperation("4",{kind:"transform",param:"ZoomX"},48,null,"Linear",true).edits.every(edit=>edit.value===null));
  assert.equal(keyframeOperation("4",{kind:"transform",param:"Opacity"},48,50,"Hold",true).kind,"set_keyframe");
});

test("inspector reads are isolated by project, revision, selection and playhead", () => {
  const state = { project_epoch: "e:1", generation: "2", timeline: "1", revision: "r", clip: "17", frame: 24 };
  for (const key of Object.keys(state)) assert.notEqual(detailIdentity(state), detailIdentity({ ...state, [key]: "changed" }));
  assert.equal(detailIdentity(null), null);
});
test("property and keyframe commands retain native parameter names and integer timeline frames", () => {
  assert.deepEqual(propertyOperation("17", { blend: "ColorDodge" }), { kind: "set_properties", clip_id: "17", patch: { blend: "ColorDodge" } });
  const operation = keyframeOperation("17", { kind: "transform", param: "PositionX" }, 108, 35, "EaseInOut");
  assert.equal(operation.edit.timeline_frame, 108); assert.equal(operation.edit.value,35);
  assert.equal(keyframeOperation("17", {kind:"gain"}, 24, null).edit.value, null);
  for (const frame of [-1, 1.5, NaN, Infinity]) assert.throws(() => keyframeOperation("17", {kind:"gain"}, frame, 0));
});
