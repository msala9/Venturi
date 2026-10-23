import test from 'node:test';
import assert from 'node:assert/strict';
import {eqKnobDelta,createEqControls} from '../js/eq-controls.js';
import {compressorPosition,compressorValue} from '../js/compressor-controls.js';

const f=Math.fround;
const catalog={freq_hz:[20,20000],gain_db:[-24,24],q:[f(.1),18],shapes:['HighPass','LowShelf','Peak','HighShelf','LowPass'],graph:{shape_has_gain:{HighPass:false,LowShelf:true,Peak:true,HighShelf:true,LowPass:false}}};
const defaults=()=>({bands:Array.from({length:6},(_,index)=>({enabled:true,shape:index===0?'HighPass':'Peak',freq_hz:[80,200,600,2000,6000,12000][index],gain_db:0,q:1}))});
class Element extends EventTarget{
  constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.properties={};this.isConnected=true;this.disabled=false;this.captured=new Set();this.rect={left:10,top:20,width:34,height:34};}
  style={setProperty:(key,value)=>{this.properties[key]=value;}};
  append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}getBoundingClientRect(){return {...this.rect};}
  focus(){}setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}
}
const all=node=>[node,...node.children.flatMap(all)];
const send=(node,type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:50,clientY:80,...values}))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(parameters=defaults()){
  const root=new Element('div'),windowRef=new EventTarget(),documentRef=new EventTarget(),writes=[],drafts=[],messages=[];documentRef.createElement=tag=>new Element(tag);
  let current=structuredClone(parameters),context='current',allowed=true,valid=true,reject=null,wait=null;
  const control=createEqControls({root,label:'Master insert 1',getParameters:()=>current,defaults:defaults(),catalog,windowRef,documentRef,getContext:()=>context,canInteract:()=>allowed,isValid:()=>valid,onDraft:value=>drafts.push(value),onCommit:async value=>{writes.push(value);if(reject)throw reject;await wait?.();current=structuredClone(value);},notice:value=>messages.push(value)});
  return {root,control,writes,drafts,messages,windowRef,documentRef,button:(band,key)=>all(root).find(node=>node.dataset.eqBand===String(band) && node.dataset.eqParam===key),named:label=>all(root).find(node=>node.attributes['aria-label']===label),parameters:()=>current,setParameters:value=>{current=value;},setContext:value=>{context=value;},setAllowed:value=>{allowed=value;},setValid:value=>{valid=value;},reject:value=>{reject=value;},wait:value=>{wait=value;}};
}

test('EQ knob travel uses native f32 logarithmic frequency and Q, linear gain and Shift precision',()=>{
  for(const [key,value] of [['freq_hz',200],['q',1],['gain_db',0]]){
    const log=key!=='gain_db',range=catalog[key];
    const expected=compressorValue(f(compressorPosition(value,range,log)+f(30/200)),range,log);
    assert.equal(eqKnobDelta(value,range,log,20,-10),expected);
    assert.equal(eqKnobDelta(value,range,log,10,10),f(value));
    const fine=eqKnobDelta(value,range,log,20,-10,true);assert.ok(fine>value && fine<expected);
    assert.equal(eqKnobDelta(value,range,log,100000,0),range[1]);assert.equal(eqKnobDelta(value,range,log,-100000,0),range[0]);
  }
});

test('six EQ strips commit one release, preserve peers and gate disabled bands and pass-filter gain',async()=>{
  const item=fixture();try{
    assert.equal(all(item.root).filter(node=>node.className==='eq-band-controls').length,6);assert.equal(item.button(0,'gain_db').disabled,true);
    const before=structuredClone(item.parameters()),node=item.button(1,'q');send(node,'pointerdown');send(node,'pointermove',{clientX:70,clientY:60,shiftKey:true});assert.equal(item.writes.length,0);assert.deepEqual(item.parameters(),before);
    send(node,'pointerup',{pointerId:2});assert.equal(node.captured.size,1);send(node,'pointerup',{clientX:75,clientY:55,shiftKey:true});await settle();assert.equal(item.writes.length,1);assert.equal(node.captured.size,0);
    const expected=structuredClone(before);expected.bands[1].q=item.parameters().bands[1].q;assert.deepEqual(item.parameters(),expected);
    const toggle=item.named('Master insert 1 EQ band 2 on');toggle.checked=false;send(toggle,'change');await settle();assert.equal(item.parameters().bands[1].enabled,false);assert.equal(item.button(1,'q').disabled,true);assert.equal(toggle.disabled,false);
    const shape=item.named('Master insert 1 EQ band 2 shape');shape.value='LowShelf';send(shape,'change');await settle();assert.equal(item.parameters().bands[1].shape,'LowShelf');assert.equal(item.parameters().bands[1].enabled,false);
    const reset=item.named('Reset Master insert 1 EQ band 2');send(reset,'click');await settle();assert.deepEqual(item.parameters().bands[1],defaults().bands[1]);assert.deepEqual(item.parameters().bands[2],before.bands[2]);
    const count=item.writes.length;send(reset,'click');send(item.button(0,'gain_db'),'keydown',{key:'ArrowUp'});await settle();assert.equal(item.writes.length,count);
  }finally{item.control.dispose();}
});

test('EQ cancellation and native ownership changes discard pointer drafts without writes',async t=>{
  for(const reason of ['none','escape','cancel','lost','blur','windowblur','resize','scroll','hidden','context','readonly','invalid','numeric','detached','disabledbutton'])await t.test(reason,()=>{
    const item=fixture();try{
      const node=item.button(1,'freq_hz');send(node,'pointerdown');if(reason!=='none')send(node,'pointermove',{clientX:70});
      if(reason==='escape')send(node,'keydown',{key:'Escape'});if(reason==='cancel')send(node,'pointercancel');if(reason==='lost')send(node,'lostpointercapture');if(reason==='blur')send(node,'blur');
      if(reason==='windowblur')item.windowRef.dispatchEvent(new Event('blur'));if(reason==='resize')node.rect.width++;if(reason==='scroll')item.windowRef.dispatchEvent(new Event('scroll'));
      if(reason==='hidden'){item.documentRef.hidden=true;item.documentRef.dispatchEvent(new Event('visibilitychange'));}if(reason==='context')item.setContext('new');if(reason==='readonly')item.setAllowed(false);if(reason==='invalid')item.setValid(false);
      if(reason==='numeric'){const next=structuredClone(item.parameters());next.bands[1].freq_hz=315;item.setParameters(next);item.control.sync();}if(reason==='detached')node.isConnected=false;if(reason==='disabledbutton')node.disabled=true;
      send(node,'pointerup',{clientX:reason==='none'?50:70});assert.deepEqual(item.writes,[]);assert.equal(node.captured.size,0);
    }finally{item.control.dispose();}
  });
});

test('EQ keyboard, exact defaults and known or unknown outcomes retain complete native parameters',async()=>{
  const parameters=defaults();parameters.bands[1].gain_db=4;const item=fixture(parameters);try{
    const gain=item.button(1,'gain_db');send(gain,'keydown',{key:'ArrowDown',shiftKey:true});await settle();assert.equal(item.parameters().bands[1].gain_db,f(4+f(-.01)));
    send(gain,'keydown',{key:'Enter'});await settle();assert.equal(item.parameters().bands[1].gain_db,0);const count=item.writes.length;send(gain,'dblclick');await settle();assert.equal(item.writes.length,count);
    for(const key of ['freq_hz','q']){const node=item.button(1,key);send(node,'keydown',{key:'Home'});await settle();assert.equal(item.parameters().bands[1][key],catalog[key][0]);send(node,'keydown',{key:'End'});await settle();assert.equal(item.parameters().bands[1][key],catalog[key][1]);}
    item.reject(Error('Native edit refused'));const before=structuredClone(item.parameters());send(gain,'keydown',{key:'ArrowUp'});await settle();assert.deepEqual(item.parameters(),before);assert.deepEqual(item.messages,['Native edit refused']);
    item.reject(Object.assign(Error('Unknown command outcome'),{code:'OUTCOME_UNKNOWN'}));send(gain,'keydown',{key:'ArrowUp'});await settle();const final=item.writes.length;item.reject(null);item.control.sync();send(gain,'keydown',{key:'ArrowUp'});assert.equal(item.writes.length,final);assert.equal(gain.disabled,true);
  }finally{item.control.dispose();}
});

test('EQ detached controls and in-flight writes fence keyboard, pointer, toggle, shape and reset entry points',async()=>{
  const parameters=defaults();parameters.bands[1].gain_db=5;const item=fixture(parameters);try{
    for(const node of [item.button(1,'gain_db'),item.named('Master insert 1 EQ band 2 on'),item.named('Master insert 1 EQ band 2 shape'),item.named('Reset Master insert 1 EQ band 2')]){
      node.isConnected=false;send(node,'pointerdown');send(node,'pointerup',{clientX:80});send(node,'keydown',{key:'ArrowUp'});send(node,'dblclick');send(node,'change');send(node,'click');
    }
    assert.deepEqual(item.writes,[]);assert.deepEqual(item.parameters(),parameters);
    let release;item.wait(()=>new Promise(resolve=>{release=resolve;}));const node=item.button(2,'gain_db');send(node,'keydown',{key:'ArrowUp'});send(node,'keydown',{key:'ArrowUp'});assert.equal(item.writes.length,1);assert.equal(node.disabled,true);release();await settle();assert.equal(item.parameters().bands[2].gain_db,f(.1));
  }finally{item.control.dispose();}
});
