import test from 'node:test';
import assert from 'node:assert/strict';
import {createKeyframeNavigation,drawKeyframeHead,keyframeNavigationResult,keyframeTimeRange} from '../js/keyframe-navigation.js';
import {renderCurves,createKeyPickSelection,curveGeometry} from '../js/curves.js';
import {renderEventKeys} from '../js/eventkeys.js';
import {renderKeySelection} from '../js/keyselection.js';
import {KEYFRAME_LABEL_WIDTH} from '../js/keyframe-lanes.js';

const detail=()=>({project_epoch:'epoch',generation:'7',timeline_id:'2',revision:'revision',clip_id:'3',timeline_frame:415,source_frame:30,freeze_source_frame:20,video:false,
  keyframe_clock:{source_frame:30,source_in:20,source_out:40,ticks:[{source_frame:20,timeline_frame:400},{source_frame:30,timeline_frame:415},{source_frame:40,timeline_frame:430}]},
  curves:{source_start:20,source_end:39,tracks:[{name:'Position X',target:{kind:'transform',param:'PositionX'},min:-100,max:100,default:0,key_count:2,samples:[[20,0],[30,10],[39,10]],keys:[{source_frame:20,timeline_frame:400,value:0,interpolation:'Linear'},{source_frame:30,timeline_frame:415,value:10,interpolation:'Hold'}]}]},
  event_keys:[{name:'Title',target:{kind:'text'},default:'Title',key_count:2,keys:[{source_frame:20,timeline_frame:400,value:'A',interpolation:'Hold'},{source_frame:30,timeline_frame:415,value:'B',interpolation:'Hold'}]}],
});
const ack=(native,source,timeline)=>({project_epoch:native.project_epoch,generation:native.generation,timeline_id:native.timeline_id,revision:native.revision,clip_id:native.clip_id,source_frame:source,timeline_frame:timeline});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

test('native animation head is independent from picture freeze and source bounds remain separate from edit bounds',()=>{
  const native=detail(),moves=[],ctx={beginPath(){},moveTo:(...point)=>moves.push(point),lineTo(){},stroke(){}};
  const geometry={left:0,plotWidth:100,top:10,plotHeight:50,x:source=>(source-20)*5};
  drawKeyframeHead(ctx,geometry,native);assert.deepEqual(moves,[[50,10]]);
  native.keyframe_clock.source_frame=10;moves.length=0;drawKeyframeHead(ctx,geometry,native);assert.deepEqual(moves,[]);
  assert.deepEqual(keyframeTimeRange(native,native.curves),{source_start:20,source_end:40});assert.equal(native.curves.source_end,39);
  assert.equal(keyframeNavigationResult(ack(native,40,430),native,99),430);
  for(const change of [{generation:'8'},{timeline_id:'other'},{clip_id:'other'},{source_frame:39},{timeline_frame:-1}])assert.throws(()=>keyframeNavigationResult({...ack(native,40,430),...change},native,40));
});

class Element {
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.style={};this.attributes={};this.listeners=new Map();this.dataset={};this.value='';this.open=false;this.connected=true;this.rect={left:20,top:100,width:300};this.ctxCalls=[];this.selected=false;this.captures=new Set();}
  get isConnected(){return this.connected && this.parentNode?.isConnected!==false;}
  append(...children){for(const child of children){if(typeof child==='object'){child.remove();child.parentNode=this;}this.children.push(child);}}
  remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}
  replaceChildren(...children){this.children.forEach(child=>{if(typeof child==='object')child.parentNode=null;});this.children=[];this.append(...children);}
  get parentElement(){return this.parentNode;}
  get options(){return this.children;}
  get selectedOptions(){return this.children.filter(child=>child.selected);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name] ?? null;}
  addEventListener(type,fn){const list=this.listeners.get(type) || [];list.push(fn);this.listeners.set(type,list);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type) || []).filter(item=>item!==fn));}
  emit(type,values={}){const event={type,pointerId:1,button:0,buttons:1,clientX:20,clientY:110,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...values};for(const fn of this.listeners.get(type) || [])fn(event);return event;}
  getBoundingClientRect(){return {...this.rect,height:Number.parseFloat(this.style.height) || 190};}
  getContext(){return this.context ??= new Proxy({}, {get:(target,key)=>target[key] ?? ((...args)=>this.ctxCalls.push([key,...args]))});}
  reportValidity(){return true;}
  focus(){this.ownerDocument.activeElement=this;}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);this.emit('lostpointercapture',{pointerId:id});}
}
function harness({renderer=null,read,editable=false,keySelection}={}){
  const previous=new Map(['document','window','Option','ResizeObserver','getComputedStyle','devicePixelRatio'].map(key=>[key,globalThis[key]]));
  const document=new Element('document',null);document.ownerDocument=document;document.hidden=false;document.modal=false;document.querySelector=()=>document.modal?{}:null;document.createElement=tag=>new Element(tag,document);document.body=new Element('body',document);document.activeElement=document.body;
  class Observer{observe(){}disconnect(){}}
  const window=new Element('window',document);window.devicePixelRatio=1;window.ResizeObserver=Observer;window.getComputedStyle=()=>({getPropertyValue:()=>''});document.defaultView=window;
  Object.assign(globalThis,{document,window,devicePixelRatio:1,ResizeObserver:Observer,getComputedStyle:window.getComputedStyle,Option:class extends Element{constructor(label,value){super('option',document);this.textContent=label;this.value=value;}}});
  const root=new Element('details',document);root.open=true;const native=detail(),seeks=[],requests=[],notices=[],commands=[];let allowed=true,key=native.curves.tracks[0].keys[1];
  const options={seek:frame=>seeks.push(frame),canNavigate:()=>allowed,navigateSource:(source,options)=>{requests.push({source,...options});return read?read(source,options,native):Promise.resolve(ack(native,source,source===40?430:415));},notice:message=>notices.push(message)};
  const geometry={left:20,plotWidth:260,top:12,plotHeight:100,x:source=>20+(source-20)*13,frame:x=>Math.round(20+(x-20)/13)};
  const control=renderer?renderer(root,native,{...options,disabled:!editable,canInteract:()=>editable && allowed,commit:operation=>commands.push(operation),openState:new Map([['curves',true],['event-keys',true]]),keySelection}):createKeyframeNavigation({root,detail:native,getKey:()=>key,getRange:()=>({source_start:20,source_end:40}),getGeometry:()=>geometry,...options});
  const all=(node=root)=>[node,...node.children.filter(child=>typeof child==='object').flatMap(all)];
  const ruler=()=>all().find(node=>node.className?.includes('keyframe-ruler'));
  const jump=()=>all().find(node=>node.textContent?.startsWith('Go to selected'));
  return {root,native,seeks,requests,notices,commands,document,window,control,ruler,jump,all,setAllowed:value=>allowed=value,setKey:value=>key=value,
    restore(){if(renderer)control.cancel();else control.dispose();for(const [key,value] of previous)globalThis[key]=value;}};
}

test('ruler drafts locally and sends one native mapping read only at release, including exclusive source out',async()=>{
  const h=harness();try{
    const ruler=h.ruler();ruler.emit('pointerdown',{clientX:40});ruler.emit('pointermove',{clientX:170});ruler.emit('pointermove',{clientX:300});assert.equal(h.requests.length,0);assert.equal(h.seeks.length,0);
    ruler.emit('pointerup',{clientX:300,buttons:0});ruler.emit('pointerup',{clientX:300,buttons:0});await settle();
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].source,40);assert.deepEqual(h.seeks,[430]);assert.deepEqual(h.commands,[]);assert.equal(ruler.captures.size,0);
  }finally{h.restore();}
});

test('selected key navigation uses its native timeline frame without a mapping request or edit privilege',()=>{
  const h=harness();try{h.jump().emit('click');assert.deepEqual(h.seeks,[415]);assert.deepEqual(h.requests,[]);h.setAllowed(false);h.jump().emit('click');assert.equal(h.seeks.length,1);}finally{h.restore();}
});

test('pending navigation is single flight and canceled late responses never seek a replacement Inspector',async()=>{
  for(const cause of ['escape','context','detach','modal','geometry','dispose']){
    let resolve;const h=harness({read:()=>new Promise(done=>resolve=done)});
    try{
      const ruler=h.ruler();ruler.emit('pointerdown',{clientX:170});ruler.emit('pointerup',{clientX:170});ruler.emit('pointerdown',{clientX:300});ruler.emit('pointerup',{clientX:300});assert.equal(h.requests.length,1);
      if(cause==='escape')ruler.emit('keydown',{key:'Escape'});
      if(cause==='context')h.setAllowed(false);
      if(cause==='detach')h.root.connected=false;
      if(cause==='modal')h.document.modal=true;
      if(cause==='geometry')ruler.rect.left++;
      if(cause==='dispose')h.control.dispose();else h.control.refresh();
      resolve(ack(h.native,30,415));await settle();assert.deepEqual(h.seeks,[]);assert.deepEqual(h.notices,[]);
      if(!['context','detach','modal','geometry'].includes(cause))assert.equal(h.requests[0].signal.aborted,true);
    }finally{h.restore();}
  }
});

test('native destination identity errors and failures remain visible without fallback or automatic replay',async()=>{
  for(const read of [(_,__,native)=>Promise.resolve({...ack(native,30,415),revision:'new'}),()=>Promise.reject(Error('native mapping unavailable'))]){
    const h=harness({read});try{h.ruler().emit('pointerdown',{clientX:170});h.ruler().emit('pointerup',{clientX:170});await settle();assert.equal(h.requests.length,1);assert.equal(h.notices.length,1);assert.deepEqual(h.seeks,[]);}finally{h.restore();}
  }
});

test('a newer ruler in the same Inspector cancels the older scalar or typed-value destination',async()=>{
  let resolve;const h=harness({read:()=>new Promise(done=>resolve=done)});let second;
  try{
    const first=h.ruler();first.emit('pointerdown',{clientX:170});first.emit('pointerup',{clientX:170});
    second=createKeyframeNavigation({root:h.root,detail:h.native,getKey:()=>null,getRange:()=>({source_start:20,source_end:40}),getGeometry:()=>({left:20,plotWidth:260,x:source=>20+(source-20)*13,frame:x=>Math.round(20+(x-20)/13)}),canNavigate:()=>true,seek:frame=>h.seeks.push(frame),navigateSource:source=>Promise.resolve(ack(h.native,source,430))});
    const next=h.all().filter(node=>node.className?.includes('keyframe-ruler')).at(-1);
    next.emit('pointerdown',{clientX:300});assert.equal(h.requests[0].signal.aborted,true);next.emit('pointerup',{clientX:300});await settle();assert.deepEqual(h.seeks,[430]);
    resolve(ack(h.native,30,415));await settle();assert.deepEqual(h.seeks,[430]);
  }finally{second?.dispose();h.restore();}
});

test('viewport, capture loss and foreign pointers cancel ruler drafts before any server request',()=>{
  for(const cancel of [(h,ruler)=>ruler.emit('pointercancel'),(h,ruler)=>ruler.emit('lostpointercapture'),h=>h.window.emit('resize'),h=>{h.setAllowed(false);h.control.refresh();}]){
    const h=harness();try{const ruler=h.ruler();ruler.emit('pointerdown',{clientX:170});ruler.emit('pointermove',{pointerId:2,clientX:300});cancel(h,ruler);ruler.emit('pointerup',{clientX:300});assert.deepEqual(h.requests,[]);assert.deepEqual(h.seeks,[]);}finally{h.restore();}
  }
});

test('actual scalar and typed-value editors expose readonly key jumps and native ruler reads while edits remain disabled',async()=>{
  for(const renderer of [renderCurves,renderEventKeys]){
    const h=harness({renderer});try{
      const select=h.all().find(node=>node.getAttribute('aria-label')===(renderer===renderCurves?'Curve keyframe':'Value keyframe'));
      select.value='30';select.emit('change');h.jump().emit('click');assert.deepEqual(h.seeks,[415]);assert.deepEqual(h.requests,[]);
      const ruler=h.ruler();ruler.emit('pointerdown',{clientX:400});ruler.emit('pointerup',{clientX:400});await settle();assert.equal(h.requests.length,1);assert.equal(h.requests[0].source,40);assert.deepEqual(h.seeks,[415,430]);assert.deepEqual(h.commands,[]);
    }finally{h.restore();}
  }
});

test('actual simultaneous lanes activate scalar and typed editors and move their shared marquee in one native command',async()=>{
  const selected=createKeyPickSelection(new Map(),'3');
  const renderer=(root,native,options)=>{
    native.curves.tracks.push({...structuredClone(native.curves.tracks[0]),name:'Position Y',target:{kind:'transform',param:'PositionY'}});
    const scalar=renderCurves(root,native,options),typed=renderEventKeys(root,native,options);
    return {cancel(){typed.cancel();scalar.cancel();}};
  };
  const h=harness({renderer,editable:true,keySelection:selected});
  try{
    const lanes=h.all().find(node=>node.className==='keyframe-lanes-canvas');
    lanes.emit('pointerdown',{clientX:40,clientY:133});
    assert.equal(h.all().find(node=>node.getAttribute('aria-label')==='Curve parameter').value,'1');
    lanes.emit('pointerdown',{clientX:40,clientY:155});
    assert.equal(h.all().find(node=>node.dataset.visualPath==='event-keys').open,true);
    lanes.emit('pointerdown',{clientX:205,clientY:101});lanes.emit('pointermove',{clientX:225,clientY:166});
    assert.equal(h.commands.length,0);lanes.emit('pointerup',{clientX:225,clientY:166});assert.equal(selected.get().length,3);
    lanes.emit('pointerdown',{clientX:219,clientY:155});lanes.emit('pointermove',{clientX:237,clientY:155});assert.equal(h.commands.length,0);
    lanes.emit('pointerup',{clientX:237,clientY:155});await settle();
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].kind,'edit_key_selection');assert.equal(h.commands[0].edit.picks.length,3);
    assert.deepEqual(h.commands[0].edit.action,{kind:'move',delta_source_frames:2});assert.equal(h.requests.length,0);assert.equal(h.seeks.length,0);
  }finally{h.restore();}
});

test('actual scalar, value and cross-parameter editors share additive selection and one native grabbed-value drag',async()=>{
  const state=new Map(),selected=createKeyPickSelection(state,'3'),scalar={kind:'transform',param:'PositionX'},text={kind:'text'};selected.set([{target:scalar,source_frame:20},{target:scalar,source_frame:30},{target:text,source_frame:30}]);
  const h=harness({renderer:renderCurves,editable:true,keySelection:selected});let events,list;
  try{
    const options={disabled:false,canInteract:()=>true,commit:operation=>h.commands.push(operation),notice:message=>h.notices.push(message),openState:new Map([['event-keys',true],['all-keys',true]]),keySelection:selected};
    events=renderEventKeys(h.root,h.native,options);list=renderKeySelection(h.root,h.native,options);
    const eventCanvas=h.all().find(node=>node.className==='curve-graph event-key-graph'),pickList=h.all().find(node=>node.getAttribute('aria-label')==='Keys across parameters');
    eventCanvas.emit('pointerdown',{clientX:40,clientY:134,ctrlKey:true});eventCanvas.emit('pointerup',{clientX:40,clientY:134,ctrlKey:true});
    assert.equal(selected.get().length,4);assert.equal(pickList.selectedOptions.length,4);assert.deepEqual(h.commands,[]);
    const before=selected.get(),canvas=h.all().find(node=>node.className==='curve-graph'),g=curveGeometry(h.native.curves.tracks[0],{source_start:20,source_end:40},300,190,null,KEYFRAME_LABEL_WIDTH),x=canvas.rect.left+g.x(20),y=canvas.rect.top+g.y(0);
    canvas.emit('pointerdown',{clientX:x+1,clientY:y+2,shiftKey:true});canvas.emit('pointermove',{clientX:x+10,clientY:y-10,shiftKey:true});assert.deepEqual(h.commands,[]);
    canvas.emit('pointerup',{clientX:x+25,clientY:y-20,shiftKey:true});await settle();
    const delta=g.frame(g.x(20)+24)-20;assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0],{kind:'edit_key_selection',clip_id:'3',edit:{picks:before,link_zoom:false,action:{kind:'drag',delta_source_frames:delta,grabbed:{target:scalar,source_frame:20,value:g.value(g.y(0)-20)}}}});
    assert.deepEqual(selected.get(),before.map(pick=>({...pick,source_frame:pick.source_frame+delta})));assert.deepEqual(h.notices,[]);
  }finally{events?.cancel();list?.cancel();h.restore();}
});

test('actual scalar drag rejects changed cross-parameter selection and current editing permission before release',async()=>{
  for(const stale of ['selection','permission']){
    const selected=createKeyPickSelection(new Map(),'3'),scalar={kind:'transform',param:'PositionX'};selected.set([{target:scalar,source_frame:20}]);const h=harness({renderer:renderCurves,editable:true,keySelection:selected});
    try{const canvas=h.all().find(node=>node.className==='curve-graph'),g=curveGeometry(h.native.curves.tracks[0],{source_start:20,source_end:40},300,190,null,KEYFRAME_LABEL_WIDTH),x=canvas.rect.left+g.x(20),y=canvas.rect.top+g.y(0);canvas.emit('pointerdown',{clientX:x,clientY:y});canvas.emit('pointermove',{clientX:x+15,clientY:y-10});if(stale==='selection')selected.select({target:{kind:'text'},source_frame:30},true);else h.setAllowed(false);canvas.emit('pointerup',{clientX:x+25,clientY:y-20});await settle();assert.deepEqual(h.commands,[]);assert.equal(canvas.captures.size,0);}finally{h.restore();}
  }
});
