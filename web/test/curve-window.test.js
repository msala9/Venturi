import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurveWindow,curveWindowRect,CURVE_WINDOW_STORAGE_KEY} from '../js/curve-window.js';

class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.style={};this.attributes={};this.listeners=new Map();this.isConnected=true;this.captures=new Set();}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
  remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
  contains(node){return node===this || this.children.some(child=>child.contains(node));}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,fn){this.listeners.set(name,[...(this.listeners.get(name)||[]),fn]);}
  removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(value=>value!==fn));}
  emit(name,values={}){const event={target:this,pointerId:1,button:0,clientX:0,clientY:0,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const fn of this.listeners.get(name)||[])fn(event);return event;}
  focus(){this.ownerDocument.activeElement=this;this.focusCount=(this.focusCount||0)+1;}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);this.emit('lostpointercapture',{pointerId:id});}
}
function harness({saved,storageFailure=false}={}){
  const document=new Element('document');document.createElement=tag=>new Element(tag,document);document.hidden=false;document.modal=false;document.querySelector=()=>document.modal?{}:null;
  const window=new Element('window',document),root=new Element('body',document),launcher=new Element('button',document);document.defaultView=window;root.append(launcher);launcher.focus();
  const writes=[],changes=[],notices=[];let viewport={width:1280,height:720};
  const store={getItem:key=>{assert.equal(key,CURVE_WINDOW_STORAGE_KEY);return saved;},setItem:(key,value)=>{if(storageFailure)throw Error('Storage denied');writes.push({key,value:JSON.parse(value)});}};
  const controller=createCurveWindow({root,storage:store,viewport:()=>viewport,onChange:value=>changes.push(value),notice:message=>notices.push(message)});
  const find=className=>controller.element.children.flatMap(node=>[node,...node.children]).find(node=>node.className===className),header=find('curve-window-header'),close=find('curve-window-close'),grip=find('curve-window-resize');
  return {controller,root,header,close,grip,launcher,document,window,writes,changes,notices,setViewport:value=>viewport=value,rect:()=>Object.fromEntries(['left','top','width','height'].map(key=>[key,Number.parseFloat(controller.element.style[key])]))};
}

test('Curves window geometry centers defaults and clamps persisted or malformed rectangles to the current screen',()=>{
  assert.deepEqual(curveWindowRect({}, {width:1280,height:720}),{x:280,y:140,width:720,height:440});
  assert.deepEqual(curveWindowRect({x:-100,y:5000,width:9000,height:0},{width:500,height:300}),{x:8,y:72,width:484,height:220});
  assert.deepEqual(curveWindowRect({width:NaN,height:Infinity,x:'9',y:null},{width:100,height:80}),{x:8,y:8,width:84,height:64});
  assert.deepEqual(curveWindowRect({}, {width:1,height:1}),{x:0,y:0,width:1,height:1});
});

test('nonmodal open and close preserve content and restore the launcher, notifying only real visibility changes',()=>{
  const h=harness();try{
    assert.equal(h.controller.element.attributes.role,'region');assert.equal(h.controller.element.attributes['aria-label'],'Curves editor window');assert.equal(h.controller.element.attributes['data-key-editor-window'],'true');assert.equal(h.controller.isOpen(),false);
    const graph=new Element('canvas',h.document);h.controller.content.append(graph);h.controller.setTitle('<literal clip>');h.controller.setStatus('Read native keys');h.controller.open();assert.equal(h.controller.isOpen(),true);assert.equal(h.document.activeElement,h.header);h.controller.open();assert.deepEqual(h.changes,[true]);
    h.close.emit('click');assert.equal(h.controller.isOpen(),false);assert.equal(h.document.activeElement,h.launcher);assert.equal(h.controller.content.children[0],graph);assert.deepEqual(h.changes,[true,false]);h.controller.close();assert.deepEqual(h.changes,[true,false]);assert.equal(h.writes.length,0);
    h.controller.open({focus:false});assert.equal(h.document.activeElement,h.launcher);h.launcher.isConnected=false;const prior=h.launcher.focusCount;h.controller.close();assert.equal(h.launcher.focusCount,prior);
  }finally{h.controller.dispose();}
});

test('header movement is a local draft until final release, and stored layout reopens without rebuilding the editor',()=>{
  const h=harness();try{
    h.controller.open();h.header.emit('pointerdown',{clientX:10,clientY:10});h.header.emit('pointermove',{clientX:40,clientY:30});assert.deepEqual(h.rect(),{left:310,top:160,width:720,height:440});assert.equal(h.writes.length,0);assert.deepEqual(h.changes,[true]);
    h.header.emit('pointerup',{clientX:60,clientY:50});assert.deepEqual(h.rect(),{left:330,top:180,width:720,height:440});assert.equal(h.writes.length,1);assert.equal(h.header.captures.size,0);assert.deepEqual(h.changes,[true]);
    const reopened=harness({saved:JSON.stringify(h.writes[0].value)});try{assert.deepEqual(reopened.rect(),h.rect());}finally{reopened.controller.dispose();}
  }finally{h.controller.dispose();}
});

test('resize grip uses release coordinates and Escape, blur and capture loss restore drafts without storage writes',()=>{
  const h=harness();try{
    h.controller.open();h.grip.emit('pointerdown',{clientX:100,clientY:100});h.grip.emit('pointermove',{clientX:120,clientY:120});h.grip.emit('pointerup',{clientX:180,clientY:160});assert.deepEqual(h.rect(),{left:280,top:140,width:800,height:500});assert.equal(h.writes.length,1);
    const before=h.rect();
    for(const cancel of [()=>h.controller.element.emit('keydown',{key:'Escape',target:h.grip}),()=>h.window.emit('blur'),()=>h.grip.emit('lostpointercapture'),()=>h.grip.emit('pointercancel')]){
      h.grip.emit('pointerdown',{clientX:10,clientY:10});h.grip.emit('pointermove',{clientX:100,clientY:50});cancel();h.grip.emit('pointerup',{clientX:110,clientY:60});assert.deepEqual(h.rect(),before);assert.equal(h.writes.length,1);
    }
  }finally{h.controller.dispose();}
});

test('keyboard movement and resize remain bounded while graph keys and Save/Undo stay with their owners',()=>{
  const h=harness();try{
    h.controller.open();h.header.emit('keydown',{key:'ArrowRight',shiftKey:true});assert.equal(h.rect().left,290);h.grip.emit('keydown',{key:'ArrowDown',shiftKey:true});assert.equal(h.rect().height,450);assert.deepEqual(h.changes,[true]);
    for(const key of ['s','z']){const event=h.header.emit('keydown',{key,ctrlKey:true});assert.equal(event.defaultPrevented,undefined);}
    const graph=new Element('canvas',h.document);h.controller.content.append(graph);const event=h.header.emit('keydown',{key:'ArrowRight',target:graph});assert.equal(event.defaultPrevented,undefined);assert.equal(h.writes.length,2);
    h.header.emit('keydown',{key:'Home'});assert.deepEqual(h.rect(),{left:280,top:140,width:720,height:440});h.setViewport({width:500,height:300});h.window.emit('resize');assert.deepEqual(h.rect(),{left:8,top:8,width:484,height:284});assert.deepEqual(h.changes,[true]);
  }finally{h.controller.dispose();}
});

test('modal, hidden, stale and disposed callbacks cannot persist a window draft or intercept content events',()=>{
  const h=harness({saved:'malformed'});h.controller.open();
  for(const blocked of ['modal','hidden']){h.document[blocked]=true;h.header.emit('pointerdown',{clientX:1,clientY:1});h.header.emit('pointerup',{clientX:100,clientY:100});h.document[blocked]=false;}assert.equal(h.writes.length,0);
  const before=h.rect();h.header.emit('pointerdown',{clientX:1,clientY:1});h.header.emit('pointermove',{clientX:80,clientY:50});h.document.modal=true;h.document.emit('toggle');h.document.modal=false;assert.deepEqual(h.rect(),before);
  const oldMove=h.header.listeners.get('pointermove')[0];h.controller.dispose();oldMove({pointerId:1,clientX:100,clientY:100});h.controller.open();assert.equal(h.controller.isOpen(),false);assert.equal(h.writes.length,0);assert.equal(h.controller.element.isConnected,false);assert.ok([...h.window.listeners.values()].every(list=>list.length===0));
});

test('unavailable browser storage reports once and does not prevent keyboard window controls',()=>{
  const h=harness({storageFailure:true});try{h.controller.open();h.header.emit('keydown',{key:'ArrowRight'});h.grip.emit('keydown',{key:'ArrowDown'});assert.equal(h.notices.length,1);assert.equal(h.rect().left,281);assert.equal(h.rect().height,441);assert.deepEqual(h.changes,[true]);}finally{h.controller.dispose();}
});
