import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurveWindow,createToolWindow,curveWindowRect,CURVE_WINDOW_STORAGE_KEY} from '../js/curve-window.js';
import {commandOwnerAt} from '../js/command-ownership.js';

class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.style={};this.attributes={};this.dataset={};this.listeners=new Map();this.isConnected=true;this.captures=new Set();}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
  remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
  contains(node){return node===this || this.children.some(child=>child.contains(node));}
  setAttribute(name,value){this.attributes[name]=value;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;}
  closest(selector){return selector.split(',').some(value=>value.startsWith('.')?this.className===value.slice(1):value.startsWith('[')?Object.hasOwn(this.attributes,value.slice(1,-1)):false)?this:this.parentNode?.closest(selector)??null;}
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

function toolParts(controller){
  const all=controller.element.children.flatMap(node=>[node,...node.children]);
  const find=part=>all.find(node=>node.className===`native-tool-window-${part}`);
  return {header:find('header'),close:find('close'),grip:find('resize'),title:find('title'),status:find('status'),rect:()=>Object.fromEntries(['left','top','width','height'].map(key=>[key,Number.parseFloat(controller.element.style[key])]))};
}

test('Mixer and Color tools have independent native defaults, accessible names and no Curves key ownership',()=>{
  const h=harness(),mixer=createToolWindow({root:h.root,name:'Mixer',storage:null,viewport:()=>({width:1280,height:720})}),color=createToolWindow({root:h.root,name:'Color',storage:null,viewport:()=>({width:1280,height:720})});
  try{
    const m=toolParts(mixer),c=toolParts(color);
    assert.deepEqual(m.rect(),{left:430,top:180,width:420,height:360});
    assert.deepEqual(c.rect(),{left:260,top:40,width:760,height:640});
    for(const [controller,parts,name] of [[mixer,m,'Mixer'],[color,c,'Color']]){
      assert.equal(controller.element.className,'native-tool-window');assert.equal(controller.element.attributes.role,'region');assert.equal(controller.element.attributes['aria-label'],`${name} window`);
      assert.equal(controller.element.attributes['data-key-editor-window'],undefined);assert.equal(controller.element.attributes['data-tool-window'],name.toLowerCase());
      assert.equal(commandOwnerAt(parts.header),'timeline');assert.equal(commandOwnerAt(controller.content),'timeline');
      assert.equal(parts.header.attributes['aria-label'],`Move ${name} window`);assert.equal(parts.grip.attributes['aria-label'],`Resize ${name} window`);assert.equal(parts.close.textContent,`Close ${name}`);
      controller.open();const event=parts.header.emit('keydown',{key:'Delete'});assert.equal(event.defaultPrevented,undefined);assert.equal(event.stopped,undefined);
    }
    assert.equal(commandOwnerAt(h.header),'keys');
    assert.equal(h.root.children.filter(node=>node.tagName==='section').length,3);
  }finally{mixer.dispose();color.dispose();h.controller.dispose();}
});

test('tool layouts use separate storage and Home restores their own defaults without consuming Curves layout',()=>{
  const h=harness(),records=new Map([[CURVE_WINDOW_STORAGE_KEY,JSON.stringify({version:1,x:20,y:20,width:1000,height:650})]]),writes=[],changes=[];
  const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>{records.set(key,value);writes.push(key);}};
  const options={root:h.root,storage,viewport:()=>({width:1280,height:720})};
  let mixer=createToolWindow({...options,name:'Mixer',storageKey:'mixer-layout',onChange:value=>changes.push(value)}),color=createToolWindow({...options,name:'Color',storageKey:'color-layout'});
  try{
    let m=toolParts(mixer);const c=toolParts(color);
    mixer.open();m.header.emit('keydown',{key:'ArrowRight',shiftKey:true});m.grip.emit('keydown',{key:'ArrowDown',shiftKey:true});
    assert.deepEqual(writes,['mixer-layout','mixer-layout']);assert.deepEqual(c.rect(),{left:260,top:40,width:760,height:640});assert.deepEqual(changes,[true]);
    const saved=m.rect();mixer.dispose();mixer=createToolWindow({...options,name:'Mixer',storageKey:'mixer-layout'});m=toolParts(mixer);assert.deepEqual(m.rect(),saved);
    mixer.open();m.header.emit('keydown',{key:'Home'});assert.deepEqual(m.rect(),{left:430,top:180,width:420,height:360});
    color.open();c.grip.emit('keydown',{key:'ArrowLeft'});c.grip.emit('keydown',{key:'Home'});assert.deepEqual(c.rect(),{left:260,top:40,width:760,height:640});
    assert.equal(records.get(CURVE_WINDOW_STORAGE_KEY),JSON.stringify({version:1,x:20,y:20,width:1000,height:650}));assert.ok(writes.includes('color-layout'));
    assert.throws(()=>createToolWindow({...options,name:'Mixer',storageKey:CURVE_WINDOW_STORAGE_KEY}),/independent layout/);
  }finally{mixer.dispose();color.dispose();h.controller.dispose();}
});

test('simultaneous tools preserve draft content and visibility independently without stealing another window focus',()=>{
  const h=harness(),changes=[];
  const mixer=createToolWindow({root:h.root,name:'Mixer',storage:null,viewport:()=>({width:1280,height:720}),onChange:value=>changes.push(['mixer',value])});
  const color=createToolWindow({root:h.root,name:'Color',storage:null,viewport:()=>({width:1280,height:720}),onChange:value=>changes.push(['color',value])});
  try{
    const m=toolParts(mixer),c=toolParts(color),draft=new Element('input',h.document);draft.value='-3.25';mixer.content.append(draft);
    mixer.open();color.open();mixer.close();assert.equal(color.isOpen(),true);assert.equal(h.document.activeElement,c.header);assert.equal(mixer.content.children[0],draft);assert.equal(draft.value,'-3.25');
    const priorFocus=m.header.focusCount;color.close();assert.equal(m.header.focusCount,priorFocus);h.launcher.focus();mixer.open();draft.focus();m.close.emit('click');assert.equal(h.document.activeElement,h.launcher);assert.equal(mixer.content.children[0],draft);
    mixer.open();mixer.open();assert.equal(h.root.children.filter(node=>node===mixer.element).length,1);assert.deepEqual(changes,[['mixer',true],['color',true],['mixer',false],['color',false],['mixer',true],['mixer',false],['mixer',true]]);
  }finally{mixer.dispose();color.dispose();h.controller.dispose();}
});

test('tool pointer drafts cancel on close or geometry changes and disposed callbacks cannot change another tool',()=>{
  const h=harness(),writes=[];let viewport={width:1280,height:720};
  const tool=createToolWindow({root:h.root,name:'Mixer',ariaLabel:'Native audio mixer',closeLabel:'Close audio mixer',moveLabel:'Move audio mixer',resizeLabel:'Resize audio mixer',storageKey:'custom-mixer',defaultRect:{width:450,height:380},viewport:()=>viewport,storage:{getItem:()=>JSON.stringify({version:1,width:'invalid'}),setItem:(...value)=>writes.push(value)}});
  try{
    const p=toolParts(tool);assert.deepEqual(p.rect(),{left:415,top:170,width:450,height:380});assert.equal(tool.element.attributes['aria-label'],'Native audio mixer');assert.equal(p.close.textContent,'Close audio mixer');
    assert.equal(p.header.attributes['aria-label'],'Move audio mixer');assert.equal(p.grip.attributes['aria-label'],'Resize audio mixer');tool.setTitle(null);tool.setStatus('Native meters');assert.equal(p.title.textContent,'Mixer');assert.equal(p.status.textContent,'Native meters');
    tool.open();p.header.emit('pointerdown',{clientX:10,clientY:10});p.header.emit('pointermove',{clientX:80,clientY:60});tool.close();assert.deepEqual(p.rect(),{left:415,top:170,width:450,height:380});assert.equal(writes.length,0);
    tool.open();p.grip.emit('pointerdown',{clientX:0,clientY:0});p.grip.emit('pointermove',{clientX:50,clientY:50});viewport={width:500,height:300};h.window.emit('resize');assert.deepEqual(p.rect(),{left:42,top:8,width:450,height:284});assert.equal(writes.length,1);
    const move=p.header.listeners.get('pointermove')[0];tool.dispose();move({pointerId:1,clientX:100,clientY:100});tool.open();assert.equal(tool.isOpen(),false);assert.equal(writes.length,1);assert.equal(tool.element.isConnected,false);
  }finally{tool.dispose();h.controller.dispose();}
});

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
