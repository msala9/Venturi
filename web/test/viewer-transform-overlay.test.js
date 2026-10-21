import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createViewerTransformOverlay} from '../js/viewer-transform-overlay.js';

function contextFixture(){
  const values={ZoomX:1,ZoomY:1,PositionX:0,PositionY:0,Rotation:0,AnchorX:0,AnchorY:0,CropLeft:0,CropTop:0,CropRight:0,CropBottom:0};
  return {project_epoch:'epoch',if_generation:'1',timeline_id:'timeline',revision:'r1',frame:24,clip_id:'9007199254740993',preview_current:true,timeline_size:[1920,1080],detail:{clip_id:'9007199254740993',timeline_frame:24,source_frame:24,source_size:[1920,1080],video:true,locked:false,flip:[false,false],transform:Object.entries(values).map(([param,value])=>({param,value,default:value,key_count:0,min:param.startsWith('Zoom')?Math.fround(0.01):-1_000_000,max:param.startsWith('Zoom')?20:1_000_000}))}};
}

function harness(){
  const frames=new Map(),observers=[],commands=[],notices=[];let sequence=0,writable=true,context=contextFixture();
  const window=new EventTarget(),document=new EventTarget();document.defaultView=window;document.hidden=false;
  window.devicePixelRatio=1.5;window.getComputedStyle=()=>({getPropertyValue:()=>''});
  window.requestAnimationFrame=callback=>{const id=++sequence;frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
  class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  window.MutationObserver=window.ResizeObserver=Observer;
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.style={};this.attributes=new Map();this.children=[];this.captures=new Set();this.textContent='';this.hidden=false;this.rect={left:0,top:0,width:1000,height:1000};}
    setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key) ?? null;}removeAttribute(key){this.attributes.delete(key);}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    getBoundingClientRect(){return {...this.rect};}
    getContext(){return new Proxy({},{get:()=>()=>{}});}
    setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}
    releasePointerCapture(id){this.captures.delete(id);emit(this,'lostpointercapture',{pointerId:id});}
  }
  document.createElement=tag=>new Element(tag);
  const screen=new Element('section'),image=new Element('img'),toggle=new Element('button');
  const overlay=createViewerTransformOverlay({screen,image,toggle,getContext:()=>context,canCommit:()=>writable,commit:async operation=>{commands.push(operation);return {command_id:'ack'};},notice:message=>notices.push(message)});
  const [canvas,status]=screen.children;
  return {overlay,screen,image,toggle,canvas,status,window,document,commands,notices,observers,context:()=>context,setContext:value=>context=value,setWritable:value=>writable=value,
    pendingFrames:()=>frames.size,flush(){const batch=[...frames.values()];frames.clear();for(const callback of batch)callback();},
    enable(){emit(toggle,'click');this.flush();},pointer(type,extra={}){return emit(canvas,type,{pointerId:1,button:0,buttons:1,isPrimary:true,clientX:500,clientY:500,shiftKey:false,...extra});}};
}
function emit(target,type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});target.dispatchEvent(event);return event;}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('viewer handles start off and do not retain an animation loop',()=>{
  const h=harness();
  try{
    assert.equal(h.toggle.getAttribute('aria-pressed'),'false');assert.equal(h.canvas.hidden,true);
    h.pointer('pointerdown');h.pointer('pointermove',{clientX:530});h.pointer('pointerup',{clientX:530});
    assert.deepEqual(h.commands,[]);h.flush();assert.equal(h.pendingFrames(),0);
    for(let i=0;i<100;i++)h.overlay.invalidate();assert.equal(h.pendingFrames(),1);h.flush();assert.equal(h.pendingFrames(),0);
    h.enable();assert.equal(h.toggle.getAttribute('aria-pressed'),'true');assert.equal(h.canvas.hidden,false);assert.equal(h.canvas.style.pointerEvents,'auto');assert.equal(h.pendingFrames(),0);
  }finally{h.overlay.dispose();}
  assert.equal(h.pendingFrames(),0);assert.equal(h.screen.children.length,0);assert.ok(h.observers.every(observer=>observer.disconnected));
});

test('only the owner pointer releases one native edit and pointer moves never submit',async()=>{
  const h=harness();
  try{
    h.enable();h.pointer('pointerdown');assert.equal(h.canvas.hasPointerCapture(1),true);
    for(let i=1;i<=50;i++)h.pointer('pointermove',{clientX:500+i,clientY:500-i});
    assert.equal(h.commands.length,0);assert.equal(h.pendingFrames(),1);
    h.pointer('pointermove',{pointerId:2,clientX:800});h.pointer('pointerup',{pointerId:2,clientX:800});assert.equal(h.commands.length,0);assert.equal(h.canvas.hasPointerCapture(1),true);
    h.pointer('pointerup',{clientX:550,clientY:450});await settle();assert.equal(h.commands.length,1);
    assert.equal(h.commands[0].kind,'edit_viewer_transform');assert.equal(h.commands[0].clip_id,'9007199254740993');assert.equal(h.commands[0].timeline_frame,24);
    assert.deepEqual(h.commands[0].transform,[{param:'AnchorX',value:96},{param:'AnchorY',value:96}]);
    assert.equal(h.canvas.hasPointerCapture(1),false);h.pointer('pointerup',{clientX:560});assert.equal(h.commands.length,1);
    h.flush();assert.equal(h.pendingFrames(),0);
  }finally{h.overlay.dispose();}
});

test('Escape, cancellation, capture loss, hidden document and stale frame discard a gesture',async()=>{
  for(const cancel of ['escape','pointercancel','lostpointercapture','visibility','stale','revision','disable','blur']){
    const h=harness();
    try{
      h.enable();h.pointer('pointerdown');h.pointer('pointermove',{clientX:530});assert.equal(h.commands.length,0);
      if(cancel==='escape')emit(h.document,'keydown',{key:'Escape'});
      else if(cancel==='visibility'){h.document.hidden=true;emit(h.document,'visibilitychange');}
      else if(cancel==='stale'){h.setContext({...h.context(),preview_current:false});h.overlay.invalidate();}
      else if(cancel==='revision'){h.setContext({...h.context(),revision:'r2'});h.overlay.invalidate();}
      else if(cancel==='disable')emit(h.toggle,'click');
      else if(cancel==='blur')emit(h.window,'blur');
      else h.pointer(cancel);
      h.pointer('pointerup',{clientX:540});await settle();assert.deepEqual(h.commands,[],cancel);assert.equal(h.canvas.hasPointerCapture(1),false,cancel);
      h.flush();h.flush();assert.equal(h.pendingFrames(),0,cancel);
    }finally{h.overlay.dispose();}
  }
});

test('read-only and unavailable frames expose a fallback without accepting an edit',async()=>{
  const h=harness();
  try{
    h.setWritable(false);h.enable();assert.equal(h.canvas.style.pointerEvents,'none');assert.match(h.status.textContent,/Read only/);
    h.pointer('pointerdown');h.pointer('pointermove',{clientX:530});h.pointer('pointerup',{clientX:530});await settle();assert.deepEqual(h.commands,[]);
    h.setWritable(true);h.setContext({...h.context(),preview_current:false});h.overlay.invalidate();h.flush();assert.equal(h.canvas.hidden,true);assert.match(h.status.textContent,/numeric Inspector/);
    h.pointer('pointerdown');h.pointer('pointerup',{clientX:530});await settle();assert.deepEqual(h.commands,[]);
  }finally{h.overlay.dispose();}
});

test('image replacement and viewer resizing cancel a pending ghost without background redraws',async()=>{
  for(const change of ['image','resize']){
    const h=harness();
    try{
      h.enable();h.pointer('pointerdown');h.pointer('pointermove',{clientX:530});
      if(change==='image')emit(h.image,'load');else{h.image.rect.width=900;emit(h.window,'resize');}
      h.pointer('pointerup',{clientX:540});await settle();assert.deepEqual(h.commands,[]);h.flush();h.flush();assert.equal(h.pendingFrames(),0);
    }finally{h.overlay.dispose();}
  }
});
