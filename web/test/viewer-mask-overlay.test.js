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
function harness(path=false){
  const frames=new Map(),observers=[],commands=[],notices=[];let sequence=0,context=fixture(path),writable=true;
  const window=new EventTarget(),document=new EventTarget();document.defaultView=window;document.hidden=false;window.devicePixelRatio=1.5;window.getComputedStyle=()=>({getPropertyValue:()=>''});
  window.requestAnimationFrame=callback=>{const id=++sequence;frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
  class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  window.MutationObserver=window.ResizeObserver=Observer;
  class Element extends EventTarget{
    constructor(){super();this.ownerDocument=document;this.style={};this.attributes=new Map();this.children=[];this.captures=new Set();this.hidden=false;this.textContent='';this.rect={left:0,top:0,width:1000,height:1000};this.calls=[];}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name) ?? null;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    getBoundingClientRect(){return {...this.rect};}getContext(){return new Proxy({},{get:(_,method)=>(...args)=>this.calls.push({method,args})});}
    setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);emit(this,'lostpointercapture',{pointerId:id});}
  }
  document.createElement=()=>new Element();const screen=new Element(),image=new Element(),toggle=new Element();
  const overlay=createViewerMaskOverlay({screen,image,toggle,getContext:()=>context,canCommit:()=>writable,commit:async operation=>{commands.push(operation);return {command_id:'ack'};},notice:message=>notices.push(message)});
  const [canvas,status]=screen.children;
  return {overlay,screen,image,toggle,canvas,status,window,document,commands,notices,observers,context:()=>context,setContext:value=>context=value,setWritable:value=>writable=value,pending:()=>frames.size,
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
