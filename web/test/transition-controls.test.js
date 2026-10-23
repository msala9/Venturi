import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTransitionControls,transitionDuration,transitionFrameRate} from '../js/transition-controls.js';
import {bindInspectorNumber,transitionSelectionOperation} from '../js/inspector.js';

const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(options={}){
  class Surface extends EventTarget{
    constructor(){super();this.listeners=new Map();}
    addEventListener(type,handler,settings){super.addEventListener(type,handler,settings);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
    removeEventListener(type,handler,settings){super.removeEventListener(type,handler,settings);this.listeners.get(type)?.delete(handler);}
    count(){return [...this.listeners.values()].reduce((sum,handlers)=>sum+handlers.size,0);}
  }
  class Element extends Surface{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes=new Map();this.style={};this.disabled=false;this.value='';this.ownerDocument=doc;this.captures=new Set();}
    get isConnected(){return this===doc.body || !!this.parent?.isConnected;}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
    contains(node){return this===node || this.children.some(child=>child.contains(node));}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name) ?? null;}removeAttribute(name){this.attributes.delete(name);}
    reportValidity(){return valid;}closest(){return null;}focus(){doc.activeElement=this;}
    getBoundingClientRect(){return {left:640,bottom:450,width:110};}showPopover(){}hidePopover(){}scrollIntoView(){}
    setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);fire(this,'lostpointercapture',{pointerId:id});}
  }
  const doc=new Surface(),view=new Surface();doc.defaultView=view;doc.createElement=tag=>new Element(tag);doc.body=doc.createElement('body');doc.querySelector=()=>null;view.innerWidth=962;view.innerHeight=964;
  const root=doc.createElement('section');doc.body.append(root);
  const target={track_id:'v',clip_id:'9',slot:'cut_after',max:48,transition:{kind:'Push',duration:13,direction:'Up',ease:'Out',curve:0.625,...options.transition}},commands=[],previews=[],notices=[],timers=new Map();
  let current=structuredClone(target),allowed=true,valid=true,now=0,sequence=0;
  function fire(node,type,props={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(props))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;}
  const controls=renderTransitionControls(root,target,{fps:options.fps ?? {num:24,den:1},getTarget:()=>current,canInteract:()=>allowed,disabled:options.disabled,bindNumber:bindInspectorNumber,operation:transitionSelectionOperation,commit:operation=>{commands.push(operation);return options.commit?.(operation);},onPreview:value=>{previews.push(value);return options.preview?.(value);},notice:value=>notices.push(value),schedule:(callback,ms)=>{const id=++sequence;timers.set(id,{at:now+ms,callback});return id;},unschedule:id=>timers.delete(id)});
  const all=(node=doc.body)=>[node,...node.children.flatMap(all)],field=label=>{const node=all().find(node=>node.getAttribute('aria-label')===label);assert(node,label);return node;};
  const popup=()=>all().find(node=>node.getAttribute('role')==='listbox');
  return {controls,root,doc,view,target,commands,previews,notices,timers,fire,field,popup,all,
    point:(node,type,x,extra={})=>fire(node,type,{button:0,buttons:1,pointerId:1,clientX:x,preventDefault(){},...extra}),
    key:(node,key,extra={})=>fire(node,'keydown',{key,...extra}),
    advance(ms){const end=now+ms;for(;;){const next=[...timers.entries()].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();}now=end;},
    readonly(){allowed=false;},allow(){allowed=true;},stale(){current={...current,transition:{...current.transition,duration:12}};},invalid(){valid=false;},dispose(){controls.dispose();},
  };
}

test('transition seconds and frame duration use rational native FPS, integer rounding and bounds',()=>{
  assert.equal(transitionFrameRate({num:30000,den:1001}),30000/1001);
  assert.equal(transitionDuration(0.5,'seconds',{num:24,den:1},48),12);
  assert.equal(transitionDuration(1,'seconds',{num:30000,den:1001},48),30);
  assert.equal(transitionDuration(17*1001/30000,'seconds',{num:30000,den:1001},48),17);
  assert.equal(transitionDuration(0,'frames',{num:24,den:1},48),1);assert.equal(transitionDuration(999,'seconds',{num:24,den:1},48),48);
  for(const value of ['',NaN,Infinity])assert.throws(()=>transitionDuration(value,'seconds',{num:24,den:1},48));
  assert.equal(transitionFrameRate({num:24,den:0}),null);assert.throws(()=>transitionDuration(1,'seconds',null,48));
});

test('seconds and frame scrubbing stay local until one owned release, preserving complete native settings',async()=>{
  for(const [label,distance,duration] of [['Duration seconds',25,25],['Duration frames',8,15]]){
    const h=harness();try{
      const field=h.field(label);h.point(field,'pointerdown',10);h.point(field,'pointermove',10+distance);assert.deepEqual(h.commands,[]);
      h.point(field,'pointerup',100,{pointerId:2,buttons:0});assert.deepEqual(h.commands,[]);
      h.point(field,'pointerup',10+distance,{buttons:0});h.point(field,'pointerup',10+distance,{buttons:0});await settle();
      assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:'9',slot:'cut_after',transition:{...h.target.transition,duration}}]);
    }finally{h.dispose();}
  }
});

test('curve pointer edits commit once while Escape, foreign cancellation and stale ownership do not leak writes',async()=>{
  const h=harness();try{
    const range=h.field('Transition curve slider');h.point(range,'pointerdown',10);range.value='0.75';h.fire(range,'input');h.point(range,'pointermove',20);assert.deepEqual(h.commands,[]);assert.equal(h.field('Curve').value,'0.75');
    h.point(range,'pointercancel',20,{pointerId:2});h.point(range,'pointerup',20,{pointerId:2,buttons:0});assert.deepEqual(h.commands,[]);
    h.point(range,'pointerup',20,{buttons:0});h.fire(range,'change');await settle();assert.equal(h.commands.length,1);assert.equal(h.commands[0].transition.curve,0.75);
  }finally{h.dispose();}
  for(const cancel of [h=>h.key(h.field('Transition curve slider'),'Escape'),h=>h.stale(),h=>h.fire(h.view,'resize'),h=>h.dispose()]){
    const h=harness();try{const range=h.field('Transition curve slider');h.point(range,'pointerdown',10);range.value='0.9';h.fire(range,'input');cancel(h);h.point(range,'pointerup',20,{buttons:0});await settle();assert.deepEqual(h.commands,[]);}finally{h.dispose();}
  }
});

test('transition choices preview stable hover and keyboard changes, cancel without writing and explicitly confirm once',async()=>{
  let resolve;const h=harness({commit:()=>new Promise(done=>{resolve=done;})});try{
    const direction=h.field('Push direction');h.fire(direction,'click');assert.equal(direction.getAttribute('role'),'combobox');
    h.fire(h.popup().children[0],'pointerenter');h.advance(129);assert.deepEqual(h.previews,[]);h.advance(1);assert.deepEqual(h.previews.at(-1),{...h.target.transition,direction:'Left'});assert.deepEqual(h.commands,[]);
    h.key(direction,'Escape');assert.equal(h.popup(),undefined);assert.equal(h.previews.at(-1),null);assert.equal(direction.value,'Up');
    const event=h.key(direction,'ArrowDown');assert.equal(event.defaultPrevented,true);h.advance(130);assert.equal(h.previews.at(-1).direction,'Down');h.key(direction,'Enter');h.key(direction,'Enter');await settle();
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].transition.direction,'Down');assert.equal(h.previews.at(-1),null);assert.equal(h.popup(),undefined);resolve();await settle();
  }finally{h.dispose();}
  const click=harness();try{click.fire(click.field('Ease'),'click');click.fire(click.popup().children[0],'click');await settle();assert.equal(click.commands[0].transition.ease,'None','Direct option click works without a preceding hover');}finally{click.dispose();}
});

test('closed transition wheel bursts commit once without wrapping and canceled or stale previews never confirm',async()=>{
  const h=harness();try{const ease=h.field('Ease');h.fire(ease,'wheel',{deltaY:1});h.advance(70);h.fire(ease,'wheel',{deltaY:1});h.advance(149);assert.deepEqual(h.commands,[]);h.advance(1);await settle();assert.equal(h.commands.length,1);assert.equal(h.commands[0].transition.ease,'InOut');assert.equal(h.timers.size,0);}finally{h.dispose();}
  const boundary=harness({transition:{ease:'InOut'}});try{boundary.fire(boundary.field('Ease'),'wheel',{deltaY:1});boundary.advance(300);assert.deepEqual(boundary.commands,[]);}finally{boundary.dispose();}
  for(const cancel of [h=>h.key(h.field('Ease'),'Tab'),h=>h.fire(h.doc,'pointerdown',{target:h.doc.body}),h=>h.fire(h.doc,'scroll',{target:h.doc}),h=>h.readonly(),h=>h.stale(),h=>h.dispose()]){
    const h=harness();try{h.fire(h.field('Ease'),'click');h.fire(h.popup().children[0],'pointerenter');cancel(h);h.advance(300);assert.deepEqual(h.commands,[]);assert.equal(h.popup(),undefined);assert.equal(h.timers.size,0);}finally{h.dispose();}
  }
});

test('typed precision and explicit Apply stay available while invalid, no-op and stale edits are refused',async()=>{
  const h=harness({fps:{num:30000,den:1001}});try{
    const form=h.root.children[1];h.fire(form,'submit');await settle();assert.deepEqual(h.commands,[]);
    h.field('Duration seconds').value='1';h.fire(h.field('Duration seconds'),'input');assert.equal(h.field('Duration frames').value,'30');h.field('Curve').value='0.123456789';h.fire(form,'submit');h.fire(form,'submit');await settle();assert.equal(h.commands.length,1);assert.equal(h.commands[0].transition.duration,30);assert.equal(h.commands[0].transition.curve,0.123456789);
  }finally{h.dispose();}
  for(const block of [h=>h.invalid(),h=>h.stale(),h=>h.readonly()]){const h=harness();try{h.field('Curve').value='0.75';block(h);h.fire(h.root.children[1],'submit');await settle();assert.deepEqual(h.commands,[]);}finally{h.dispose();}}
});

test('temporary unavailability recovers and disposal clears listeners, timers and preview ownership',async()=>{
  const h=harness();h.readonly();h.fire(h.field('Ease'),'click');assert.equal(h.popup(),undefined);assert.equal(h.field('Ease').disabled,false);h.allow();h.fire(h.field('Ease'),'click');h.fire(h.popup().children[0],'pointerenter');h.advance(130);
  h.fire(h.doc,'scroll',{target:h.popup()});assert(h.popup());h.dispose();h.advance(500);await settle();assert.equal(h.previews.at(-1),null);assert.deepEqual(h.commands,[]);assert.equal(h.timers.size,0);assert.equal(h.doc.count(),0);assert.equal(h.view.count(),0);
});

test('blur and public cancel discard drafts while leaving mounted controls editable; dispose makes them inert',async()=>{
  const h=harness();try{
    const ease=h.field('Ease');h.fire(ease,'click');h.fire(h.popup().children[0],'pointerenter');h.advance(130);h.fire(h.view,'blur');assert.equal(h.popup(),undefined);assert.equal(h.previews.at(-1),null);assert.deepEqual(h.commands,[]);
    const frames=h.field('Duration frames');h.point(frames,'pointerdown',10);h.point(frames,'pointermove',18);h.controls.cancel();h.point(frames,'pointerup',18,{buttons:0});assert.deepEqual(h.commands,[]);assert.equal(frames.value,'13');
    h.point(frames,'pointerdown',10);h.point(frames,'pointerup',18,{buttons:0});await settle();assert.equal(h.commands.length,1);assert.equal(h.commands[0].transition.duration,15);
  }finally{h.dispose();}
  const disposed=harness();const ease=disposed.field('Ease'),form=disposed.root.children[1];disposed.dispose();disposed.fire(ease,'click');disposed.field('Curve').value='0.75';disposed.fire(form,'submit');disposed.advance(300);await settle();assert.equal(disposed.popup(),undefined);assert.deepEqual(disposed.commands,[]);
});

test('a refused or unknown transition write restores local values and is never automatically replayed',async()=>{
  const h=harness({commit:()=>Promise.reject(Error('Transition write unresolved'))});try{
    h.field('Curve').value='0.75';h.fire(h.root.children[1],'submit');await settle();h.advance(500);await settle();
    assert.equal(h.commands.length,1);assert.equal(h.field('Curve').value,'0.625');assert(h.notices.includes('Transition write unresolved'));assert.equal(h.timers.size,0);
  }finally{h.dispose();}
  let reject;const late=harness({commit:()=>new Promise((_,fail)=>{reject=fail;})});late.field('Curve').value='0.75';late.fire(late.root.children[1],'submit');late.dispose();reject(Error('Native transition refused'));await settle();assert(late.notices.includes('Native transition refused'));assert.equal(late.commands.length,1);
});
