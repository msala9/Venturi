import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createViewerMaskOverlay} from '../js/viewer-mask-overlay.js';
import {viewerMaskGeometry} from '../js/viewer-mask.js';

function fixture(path=false){
  const values={ZoomX:1,ZoomY:1,PositionX:0,PositionY:0,Rotation:0,AnchorX:0,AnchorY:0,CropLeft:0,CropTop:0,CropRight:0,CropBottom:0};
  const mask={index:0,shape:path?'Path':'Rectangle',enabled:true,parameters:Object.entries({CenterX:0,CenterY:0,Width:400,Height:300,Rotation:0}).map(([param,value])=>({param,value,default:value,key_count:0,min:['Width','Height'].includes(param)?1:-100000,max:100000})),evaluated_path:{points:[[-100,-100],[100,-100],[0,100]].map(point=>({point,in_handle:[-25,0],out_handle:[25,0]}))},path_keyframes:0};
  return {project_epoch:'epoch',if_generation:'1',timeline_id:'1',revision:'r',frame:24,clip_id:'9007199254740993',mask_index:0,preview_current:true,timeline_size:[1920,1080],detail:{clip_id:'9007199254740993',timeline_frame:24,source_frame:24,source_size:[1920,1080],video:true,locked:false,flip:[false,false],transform:Object.entries(values).map(([param,value])=>({param,value,min:param.startsWith('Zoom')?Math.fround(0.01):-1000000,max:param.startsWith('Zoom')?20:1000000})),masks:{items:[mask]}}};
}
function emit(target,type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});target.dispatchEvent(event);return event;}
function harness(path=false,{commit}={}){
  const frames=new Map(),observers=[],commands=[],notices=[];let sequence=0,context=fixture(path),writable=true,dialog=false;
  const window=new EventTarget(),document=new EventTarget();document.defaultView=window;document.hidden=false;document.body={};document.activeElement=document.body;document.querySelector=()=>dialog?{}:null;window.devicePixelRatio=1.5;window.getComputedStyle=()=>({getPropertyValue:()=>''});
  window.requestAnimationFrame=callback=>{const id=++sequence;frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
  class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  window.MutationObserver=window.ResizeObserver=Observer;
  class Element extends EventTarget{
    constructor(){super();this.ownerDocument=document;this.style={};this.attributes=new Map();this.children=[];this.captures=new Set();this.hidden=false;this.textContent='';this.rect={left:0,top:0,width:1000,height:1000};this.calls=[];}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name) ?? null;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    getBoundingClientRect(){return {...this.rect};}getContext(){return new Proxy({},{get:(_,method)=>(...args)=>this.calls.push({method,args})});}
    focus(){document.activeElement=this;}
    setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);emit(this,'lostpointercapture',{pointerId:id});}
  }
  document.createElement=()=>new Element();const screen=new Element(),image=new Element(),toggle=new Element(),penToggle=new Element();
  const overlay=createViewerMaskOverlay({screen,image,toggle,penToggle,getContext:()=>context,getPenContext:()=>context,canCommit:()=>writable,commit:async operation=>{commands.push(operation);return commit?commit(operation):{command_id:'ack'};},notice:message=>notices.push(message)});
  const [canvas,status]=screen.children;
  return {overlay,screen,image,toggle,penToggle,canvas,status,window,document,commands,notices,observers,context:()=>context,setContext:value=>context=value,setWritable:value=>writable=value,setDialog:value=>dialog=value,pending:()=>frames.size,
    flush(){const batch=[...frames.values()];frames.clear();for(const callback of batch)callback();},enable(){overlay.setEnabled(true);this.flush();},
    pointer(type,properties={}){return emit(canvas,type,{pointerId:1,button:0,buttons:1,isPrimary:true,clientX:500,clientY:500,shiftKey:false,altKey:false,...properties});}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('mask overlays start off, coalesce invalidation and cap high-DPI backing pixels',()=>{
  const h=harness();
  try{
    h.flush();assert.equal(h.overlay.enabled(),false);assert.equal(h.canvas.hidden,true);assert.equal(h.pending(),0);
    h.window.devicePixelRatio=3;h.screen.rect=h.canvas.rect=h.image.rect={left:0,top:0,width:5000,height:3000};h.enable();
    assert.equal(h.toggle.getAttribute('aria-pressed'),'true');assert.ok(h.canvas.width*h.canvas.height<=4_194_304);
    for(let index=0;index<100;index++)h.overlay.invalidate();assert.equal(h.pending(),1);h.flush();assert.equal(h.pending(),0);
    h.overlay.setEnabled(false);h.flush();assert.equal(h.canvas.hidden,true);assert.equal(h.pending(),0);
  }finally{h.overlay.dispose();}
  assert.equal(h.screen.children.length,0);assert.ok(h.observers.every(observer=>observer.disconnected));
});

test('only owner release sends one native mask edit after local pointer moves',async()=>{
  const h=harness();
  try{
    h.enable();h.pointer('pointerdown');assert.equal(h.canvas.hasPointerCapture(1),true);
    for(let index=1;index<=30;index++)h.pointer('pointermove',{clientX:500+index});assert.equal(h.commands.length,0);assert.equal(h.pending(),1);
    h.pointer('pointerup',{pointerId:2,clientX:600});assert.equal(h.commands.length,0);assert.equal(h.canvas.hasPointerCapture(1),true);
    h.pointer('pointerup',{clientX:530});await settle();assert.equal(h.commands.length,1);assert.equal(h.commands[0].kind,'edit_viewer_mask');assert.equal(h.commands[0].index,0);assert.equal(h.commands[0].timeline_frame,24);
    assert.equal(h.canvas.hasPointerCapture(1),false);h.flush();assert.equal(h.pending(),0);
  }finally{h.overlay.dispose();}
});

test('mask selection, frame, mode and cancellation changes discard captured drafts',async()=>{
  for(const change of ['mask','frame','revision','stale','escape','pointercancel','capture','off','blur','wheel','resize','hidden']){
    const h=harness();
    try{
      h.enable();h.pointer('pointerdown');h.pointer('pointermove',{clientX:520});
      if(change==='mask')h.setContext({...h.context(),mask_index:null});
      else if(change==='frame')h.setContext({...h.context(),frame:25});
      else if(change==='revision')h.setContext({...h.context(),revision:'changed'});
      else if(change==='stale')h.setContext({...h.context(),preview_current:false});
      else if(change==='escape')emit(h.document,'keydown',{key:'Escape'});
      else if(change==='pointercancel')h.pointer('pointercancel');
      else if(change==='capture')h.pointer('lostpointercapture');
      else if(change==='off')h.overlay.setEnabled(false);
      else if(change==='hidden'){h.document.hidden=true;emit(h.document,'visibilitychange');}
      else emit(change==='wheel'?h.screen:h.window,change);
      h.overlay.invalidate();h.pointer('pointerup',{clientX:530});await settle();assert.deepEqual(h.commands,[],change);assert.equal(h.canvas.hasPointerCapture(1),false,change);
      h.flush();h.flush();assert.equal(h.pending(),0,change);
    }finally{h.overlay.dispose();}
  }
});

test('path selection draws native vertices and selected tangents without an edit',async()=>{
  const h=harness(true);
  try{
    h.enable();const geometry=viewerMaskGeometry(h.context(),h.image.rect),[x,y]=geometry.vertices[0];
    h.pointer('pointerdown',{clientX:x,clientY:y});h.pointer('pointerup',{clientX:x,clientY:y});await settle();h.canvas.calls=[];h.flush();
    assert.deepEqual(h.commands,[]);assert.equal(h.canvas.calls.filter(call=>call.method==='arc' && call.args[2]===3.5).length,2);assert.ok(h.canvas.calls.some(call=>call.method==='arc' && call.args[2]===5.5));
    const selected=viewerMaskGeometry(h.context(),h.image.rect,{selectedVertex:0}),tangent=selected.tangents.find(value=>value.kind==='tangent_out').point;
    h.pointer('pointerdown',{clientX:tangent[0],clientY:tangent[1]});h.pointer('pointermove',{clientX:tangent[0]+20,clientY:tangent[1],altKey:true});assert.equal(h.commands.length,0);
    h.pointer('pointerup',{clientX:tangent[0]+20,clientY:tangent[1],altKey:true});await settle();assert.equal(h.commands.length,1);assert.ok(h.commands[0].path);assert.equal(h.commands[0].path.points.length,3);
  }finally{h.overlay.dispose();}
});

test('unavailable and read-only mask overlays keep a numeric fallback without writes',async()=>{
  const h=harness();
  try{
    h.setWritable(false);h.enable();assert.equal(h.canvas.style.pointerEvents,'none');assert.match(h.status.textContent,/Read only/);
    h.pointer('pointerdown');h.pointer('pointerup',{clientX:530});await settle();assert.deepEqual(h.commands,[]);
    h.setWritable(true);h.setContext({...h.context(),mask_index:null});h.overlay.invalidate();h.flush();assert.equal(h.canvas.hidden,true);assert.match(h.status.textContent,/numeric Inspector/);
  }finally{h.overlay.dispose();}
});

function penPoint(h,x,y,options={}){
  h.pointer('pointerdown',{clientX:x,clientY:y,...options});h.pointer('pointerup',{clientX:x,clientY:y,...options});
}
function triangle(h){penPoint(h,300,400);penPoint(h,650,400);penPoint(h,450,650);}

test('pen starts without a selected mask, shares bounded canvas and commits one completed path on Enter',async()=>{
  const h=harness();
  try{
    h.setContext({...h.context(),mask_index:null});h.flush();assert.equal(h.penToggle.disabled,false);assert.equal(h.overlay.startPen(),true);assert.equal(h.document.activeElement,h.canvas);assert.equal(h.canvas.hidden,false);h.flush();
    assert.equal(h.overlay.enabled(),true);assert.equal(h.penToggle.getAttribute('aria-pressed'),'true');assert.equal(h.canvas.style.cursor,'crosshair');assert.match(h.status.textContent,/0 of 21/);
    triangle(h);assert.equal(h.commands.length,0);h.flush();assert.match(h.status.textContent,/3 of 21/);assert.ok(h.canvas.width*h.canvas.height<=4_194_304);
    const enter=emit(h.document,'keydown',{key:'Enter'});assert.equal(enter.defaultPrevented,true);await settle();assert.equal(h.commands.length,1);
    const operation=h.commands[0];assert.equal(operation.kind,'edit_mask');assert.equal(operation.clip_id,h.context().clip_id);assert.equal(operation.edit.action,'add');assert.equal(operation.edit.shape,'Path');assert.equal(operation.edit.path.points.length,3);assert.equal(h.overlay.penActive(),false);
    h.flush();h.flush();assert.equal(h.pending(),0);
  }finally{h.overlay.dispose();}
});

test('pen points use owner capture and local tangent drafts; first-vertex owner release closes exactly once',async()=>{
  let release;const h=harness(false,{commit:()=>new Promise(resolve=>{release=resolve;})});
  try{
    h.overlay.startPen();h.pointer('pointerdown',{clientX:300,clientY:400});
    h.pointer('pointermove',{clientX:350,clientY:430,altKey:true});h.pointer('pointerup',{pointerId:2,clientX:350,clientY:430});assert.equal(h.canvas.hasPointerCapture(1),true);assert.equal(h.commands.length,0);
    h.pointer('pointerup',{clientX:350,clientY:430,altKey:true});assert.equal(h.canvas.hasPointerCapture(1),false);
    penPoint(h,650,400);penPoint(h,450,650);assert.equal(h.commands.length,0);
    h.pointer('pointerdown',{clientX:300,clientY:400});h.pointer('pointerup',{pointerId:2,clientX:300,clientY:400});assert.equal(h.commands.length,0);
    h.pointer('pointerup',{clientX:300,clientY:400});await settle();assert.equal(h.commands.length,1);assert.equal(h.overlay.penActive(),true);
    const first=h.commands[0].edit.path.points[0];assert.deepEqual(first.in_handle,[0,0]);assert.notDeepEqual(first.out_handle,[0,0]);
    h.flush();assert.equal(h.penToggle.disabled,true);emit(h.document,'keydown',{key:'Enter'});emit(h.canvas,'dblclick',{button:0});assert.equal(h.overlay.startPen(),false);assert.equal(h.commands.length,1);
    release({command_id:'ack'});await settle();assert.equal(h.overlay.penActive(),false);emit(h.canvas,'dblclick',{button:0});await settle();assert.equal(h.commands.length,1);
  }finally{h.overlay.dispose();}
});

test('unfinished pen paths stay local and Escape cancels the complete draft',async()=>{
  const h=harness(true);
  try{
    h.overlay.startPen();penPoint(h,300,400);penPoint(h,650,400);emit(h.document,'keydown',{key:'Enter'});await settle();assert.equal(h.commands.length,0);assert.equal(h.overlay.penActive(),true);assert.match(h.notices[0],/three vertices/);
    const escape=emit(h.document,'keydown',{key:'Escape'});assert.equal(escape.defaultPrevented,true);assert.equal(h.overlay.penActive(),false);await settle();assert.deepEqual(h.commands,[]);
    h.overlay.startPen();triangle(h);emit(h.canvas,'dblclick',{button:0,clientX:300,clientY:400});await settle();assert.deepEqual(h.commands,[]);
    emit(h.penToggle,'click');assert.equal(h.overlay.penActive(),false);
  }finally{h.overlay.dispose();}
});

test('pen never consumes Enter from text focus or an open dialog and shows truthful start availability',async()=>{
  const h=harness();
  try{
    h.setWritable(false);h.flush();assert.equal(h.penToggle.disabled,true);assert.match(h.penToggle.title,/writable/);assert.equal(h.overlay.startPen(),false);
    h.setWritable(true);h.overlay.invalidate();h.flush();h.overlay.startPen();triangle(h);h.document.activeElement={tagName:'INPUT'};
    assert.equal(emit(h.document,'keydown',{key:'Enter'}).defaultPrevented,false);await settle();assert.deepEqual(h.commands,[]);
    h.canvas.focus();h.setDialog(true);assert.equal(emit(h.document,'keydown',{key:'Enter'}).defaultPrevented,false);assert.equal(h.overlay.penActive(),false);await settle();assert.deepEqual(h.commands,[]);
    h.overlay.invalidate();h.flush();assert.equal(h.penToggle.disabled,true);assert.equal(h.overlay.startPen(),false);
    h.setDialog(false);h.setContext(null);h.overlay.invalidate();h.flush();assert.equal(h.penToggle.disabled,true);assert.ok(h.penToggle.title);
  }finally{h.overlay.dispose();}
});

test('pen drafts cancel on stale native identity, viewport, writer, image and lifecycle changes',async()=>{
  for(const change of ['frame','clip','revision','stale','readonly','viewport','image','escape','pointercancel','capture','off','blur','wheel','resize','hidden']){
    const h=harness();
    try{
      h.overlay.startPen();triangle(h);h.pointer('pointerdown',{clientX:700,clientY:600});
      if(change==='frame')h.setContext({...h.context(),frame:25});
      else if(change==='clip')h.setContext({...h.context(),clip_id:'other'});
      else if(change==='revision')h.setContext({...h.context(),revision:'new'});
      else if(change==='stale')h.setContext({...h.context(),preview_current:false});
      else if(change==='readonly')h.setWritable(false);
      else if(change==='viewport')h.image.rect={...h.image.rect,width:900};
      else if(change==='image')h.observers[0].callback();
      else if(change==='escape')emit(h.document,'keydown',{key:'Escape'});
      else if(change==='pointercancel')h.pointer('pointercancel');
      else if(change==='capture')h.pointer('lostpointercapture');
      else if(change==='off')h.overlay.setEnabled(false);
      else if(change==='hidden'){h.document.hidden=true;emit(h.document,'visibilitychange');}
      else emit(change==='wheel'?h.screen:h.window,change);
      h.overlay.invalidate();assert.equal(h.overlay.penActive(),false,change);assert.equal(h.canvas.hasPointerCapture(1),false,change);
      h.pointer('pointerup',{clientX:700,clientY:600});emit(h.document,'keydown',{key:'Enter'});await settle();assert.deepEqual(h.commands,[],change);h.flush();h.flush();assert.equal(h.pending(),0,change);
    }finally{h.overlay.dispose();}
  }
});

test('pen own native refresh does not repeat a completed command or retain the old draft',async()=>{
  const h=harness(false,{commit:()=>{h.setContext({...h.context(),revision:'own-ack',if_generation:'2',mask_index:null});h.observers[0].callback();return {command_id:'ack'};}});
  try{
    h.overlay.startPen();triangle(h);emit(h.document,'keydown',{key:'Enter'});await settle();h.flush();assert.equal(h.commands.length,1);assert.equal(h.overlay.penActive(),false);assert.equal(h.canvas.hasPointerCapture(1),false);assert.equal(h.penToggle.disabled,false);
    emit(h.document,'keydown',{key:'Enter'});emit(h.canvas,'dblclick',{button:0});await settle();assert.equal(h.commands.length,1);assert.equal(h.pending(),0);
  }finally{h.overlay.dispose();}
});
