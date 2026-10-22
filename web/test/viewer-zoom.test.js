import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewerZoom,isViewerFullscreenShortcut,viewerZoomRect,viewerZoomScale,viewerZoomAround,viewerZoomPan,viewerZoomPercent} from '../js/viewer-zoom.js';

const area={left:20,top:30,width:960,height:540},frame=[1920,1080],fit=()=>({scale:null,pan:[0,0]});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);

test('native Ctrl F fullscreen shortcut accepts one explicit non-text user intent',()=>{
  assert.equal(isViewerFullscreenShortcut({key:'f',ctrlKey:true}),true);
  assert.equal(isViewerFullscreenShortcut({key:'F',ctrlKey:true}),true);
});

test('fullscreen shortcut preserves modal, text, composition and already-handled keyboard ownership',()=>{
  const event={key:'f',ctrlKey:true};
  for(const extra of [{ctrlKey:false},{metaKey:true},{altKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{keyCode:229},{getModifierState:()=>true},{defaultPrevented:true},{target:{closest:()=>({})}}])assert.equal(Boolean(isViewerFullscreenShortcut({...event,...extra})),false);
  assert.equal(isViewerFullscreenShortcut(event,{dialogOpen:true}),false);
});

test('native Fit fills aspect bounds while 100% maps received pixels to physical display pixels',()=>{
  const fitted=viewerZoomRect(fit(),area,frame,2);
  assert.equal(fitted.scale,1);assert.deepEqual([fitted.left,fitted.top,fitted.width,fitted.height],[20,30,960,540]);
  const actual=viewerZoomRect(viewerZoomScale(fit(),1,area,frame,1),area,frame,1);
  assert.deepEqual([actual.width,actual.height],[1920,1080]);
  const downsampled=viewerZoomRect({scale:1,pan:[0,0]},area,[960,540],2);
  assert.deepEqual([downsampled.width,downsampled.height],[480,270]);
  const letterbox=viewerZoomRect(fit(),area,[100,100]);
  assert.deepEqual([letterbox.left,letterbox.top,letterbox.width,letterbox.height],[230,30,540,540]);
});

test('native wheel zoom preserves the frame point under the pointer and preset zoom preserves the viewer center',()=>{
  const pointer=[720,130],before=viewerZoomRect(fit(),area,frame);
  const uv=[(pointer[0]-before.left)/before.width,(pointer[1]-before.top)/before.height];
  const state=viewerZoomAround(fit(),pointer,3,area,frame),after=viewerZoomRect(state,area,frame);
  close(after.left+uv[0]*after.width,pointer[0]);close(after.top+uv[1]*after.height,pointer[1]);
  assert.equal(state.scale,1.5);
  const preset=viewerZoomScale(state,3,area,frame);
  assert.deepEqual(preset.pan,state.pan.map(value=>value*2));
  assert.equal(viewerZoomAround(fit(),pointer,1e20,area,frame).scale,32);
  assert.equal(viewerZoomScale(fit(),0,area,frame).scale,0.02);
});

test('native pan clamps leave 32 CSS points visible without altering clip transforms',()=>{
  const state=viewerZoomPan(viewerZoomScale(fit(),0.5,area,frame),[10_000,-10_000],area,frame);
  const rect=viewerZoomRect(state,area,frame);
  assert.equal(rect.left,area.left+area.width-32);assert.equal(rect.top+rect.height,area.top+32);
  assert.equal(viewerZoomPercent(0.0625),'6.25%');assert.equal(viewerZoomPercent(0.125),'12.5%');assert.equal(viewerZoomPercent(3.52),'352%');
  assert.equal(viewerZoomRect(fit(),{...area,width:0},frame),null);
});

class Node {
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.parentNode=null;this.children=[];this.listeners=new Map();this.style={cssText:''};this.dataset={};this.attributes=new Map();this.hidden=false;this.value='';this.textContent='';}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  removeEventListener(type){this.listeners.delete(type);}
  emit(type,values={}){const event={type,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};this.listeners.get(type)?.(event);return event;}
  getAttribute(name){return this.attributes.get(name) ?? null;}
  insertBefore(node,before){if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}
  querySelector(selector){return selector==='option[value="custom"]'?this.children.find(child=>child.value==='custom'):null;}
  getBoundingClientRect(){return {...this.ownerDocument.area};}
}
function harness(){
  const observers=[];
  const document={area:{...area},hidden:false,modal:false,querySelector(){return this.modal?{}:null;},createElement(tag){return new Node(tag,this);},listeners:new Map(),addEventListener:Node.prototype.addEventListener,removeEventListener:Node.prototype.removeEventListener,emit:Node.prototype.emit};
  class Observer {constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  const window={devicePixelRatio:1,innerHeight:720,ResizeObserver:Observer,MutationObserver:Observer,listeners:new Map(),addEventListener:Node.prototype.addEventListener,removeEventListener:Node.prototype.removeEventListener,emit:Node.prototype.emit};document.defaultView=window;
  const screen=new Node('div',document),preview=new Node('img',document),sourceParent=new Node('div',document),source=new Node('video',document),image=new Node('img',document),toolbar=new Node('div',document),select=new Node('select',document),status=new Node('output',document);
  preview.naturalWidth=1920;preview.naturalHeight=1080;source.videoWidth=640;source.videoHeight=360;
  sourceParent.append(source,image,toolbar);screen.append(preview,sourceParent);
  const captures=new Set();screen.setPointerCapture=id=>captures.add(id);screen.hasPointerCapture=id=>captures.has(id);screen.releasePointerCapture=id=>{captures.delete(id);screen.emit('lostpointercapture',{pointerId:id});};
  let active=preview,context='project:timeline';const changes=[];
  const zoom=createViewerZoom({screen,media:[preview,source,image],getActive:()=>active,getContext:()=>context,onChange:event=>changes.push(event.reason),select,status});
  return {zoom,document,window,screen,preview,sourceParent,source,image,toolbar,select,status,captures,changes,observers,setActive:value=>active=value,setContext:value=>context=value};
}

test('viewer controls act on actual media boxes, share Source/Program zoom, and keep source toolbars outside the clipping viewport',()=>{
  const h=harness();try{
    assert.equal(h.preview.parentNode.className,'viewer-zoom-viewport');assert.equal(h.toolbar.parentNode,h.sourceParent);
    assert.equal(h.source.parentNode,h.image.parentNode);assert.equal(h.preview.style.width,'960px');
    h.select.value='1';h.select.emit('change');assert.equal(h.preview.style.width,'1920px');assert.match(h.status.textContent,/1920 × 1080 received preview pixels/);
    h.setActive(h.source);h.zoom.refresh();assert.equal(h.source.style.width,'640px');assert.equal(h.zoom.current().scale,1);assert.match(h.status.textContent,/640 × 360 received preview pixels/);
    h.setContext('other-project:timeline');h.zoom.refresh();assert.equal(h.zoom.current().scale,1);
    h.zoom.fit();assert.equal(h.source.style.width,'960px');assert.equal(h.select.value,'fit');
    h.window.devicePixelRatio=2;h.zoom.setScale(1);assert.equal(h.source.style.width,'320px');assert.equal(h.zoom.bounds().width,320);
    h.document.modal=true;h.document.emit('toggle');assert.equal(h.select.disabled,true);
    h.document.modal=false;h.document.emit('toggle');assert.equal(h.select.disabled,false);assert.equal(h.zoom.current().scale,1);
  }finally{h.zoom.dispose();}
  assert.equal(h.preview.parentNode,h.screen);assert.deepEqual(h.sourceParent.children,[h.source,h.image,h.toolbar]);assert.ok(h.observers.every(observer=>observer.disconnected));
});

test('wheel zoom anchors to the pointer, Ctrl-wheel pans only outside Fit, and source toolbar scrolling stays native',()=>{
  const h=harness();try{
    const before=h.zoom.bounds(),x=720,y=130;
    const wheel=h.screen.emit('wheel',{clientX:x,clientY:y,deltaX:0,deltaY:-200*Math.log(3),deltaMode:0});
    assert.equal(wheel.defaultPrevented,true);const after=h.zoom.bounds();
    close((x-before.left)/before.width,(x-after.left)/after.width);
    const left=after.left;h.screen.emit('wheel',{clientX:x,clientY:y,deltaX:0,deltaY:10,deltaMode:0,ctrlKey:true,shiftKey:true});assert.equal(h.zoom.bounds().left,left-10);
    const outside=h.screen.emit('wheel',{clientX:x,clientY:area.top+area.height+1,deltaX:0,deltaY:100,deltaMode:0});assert.equal(outside.defaultPrevented,undefined);
    h.zoom.fit();h.screen.emit('wheel',{clientX:x,clientY:y,deltaX:0,deltaY:10,deltaMode:0,ctrlKey:true});assert.equal(h.zoom.current().is_fit,true);
  }finally{h.zoom.dispose();}
});

test('middle pan owns one pointer and cancels on viewport, media or context changes without resuming stale gestures',()=>{
  for(const change of [h=>h.document.area.left++,h=>h.setContext('other'),h=>h.setActive(h.source),h=>h.document.hidden=true,h=>h.document.modal=true]){
    const h=harness();try{
      h.screen.emit('pointerdown',{button:1,pointerId:7,clientX:400,clientY:200});assert.equal(h.captures.size,1);
      h.screen.emit('pointermove',{pointerId:8,buttons:4,clientX:450,clientY:200});assert.equal(h.zoom.current().is_fit,true);
      change(h);h.zoom.refresh();assert.equal(h.captures.size,0);
      const width=h.preview.style.width,left=h.preview.style.left;
      h.screen.emit('pointermove',{pointerId:7,buttons:4,clientX:600,clientY:200});assert.equal(h.preview.style.width,width);assert.equal(h.preview.style.left,left);
    }finally{h.zoom.dispose();}
  }
});

test('middle pan freezes Fit into explicit zoom and releases on button loss and dispose',()=>{
  const h=harness();
  h.screen.emit('pointerdown',{button:1,pointerId:1,clientX:400,clientY:200});
  h.screen.emit('pointermove',{pointerId:1,buttons:4,clientX:430,clientY:220});
  assert.equal(h.zoom.current().is_fit,false);assert.equal(h.zoom.bounds().left,area.left+30);
  h.screen.emit('pointermove',{pointerId:1,buttons:0,clientX:450,clientY:230});assert.equal(h.captures.size,0);
  h.screen.emit('pointerdown',{button:1,pointerId:2,clientX:400,clientY:200});h.zoom.dispose();assert.equal(h.captures.size,0);assert.equal(h.screen.listeners.size,0);
});
