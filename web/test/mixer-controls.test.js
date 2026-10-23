import test from 'node:test';
import assert from 'node:assert/strict';
import {MIXER_GAIN_CURVE,mixerGainPosition,mixerGainDb,mixerControlDelta,bindMixerControl} from '../js/mixer-controls.js';
import {renderMixer} from '../js/mixer.js';

function fixture(kind='gain_db',value=0){
  class Control extends EventTarget{
    isConnected=true;disabled=false;attributes={};properties={};captured=new Set();rect={left:10,top:20,width:70,height:230};
    style={setProperty:(key,value)=>{this.properties[key]=value;}};
    setAttribute(key,value){this.attributes[key]=value;}getBoundingClientRect(){return {...this.rect};}focus(){}
    setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}
  }
  const element=new Control(),windowRef=new EventTarget(),documentRef=new EventTarget(),writes=[],drafts=[],messages=[];let allowed=true,context='current',canceled=0,commit=async next=>{writes.push(next);};
  const control=bindMixerControl(element,{kind,value,windowRef,documentRef,canInteract:()=>allowed,getContext:()=>context,onDraft:next=>drafts.push(next),onCancel:()=>canceled++,onCommit:next=>commit(next),notice:message=>messages.push(message)});
  const send=(type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:50,clientY:120,...values}))Object.defineProperty(event,key,{value});element.dispatchEvent(event);return event;};
  return {element,windowRef,documentRef,writes,drafts,messages,control,send,setContext:value=>{context=value;},setAllowed:value=>{allowed=value;},setCommit:value=>{commit=value;},canceled:()=>canceled};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('native gain calibration round-trips every knot and retains native pan/fine-drag scaling',()=>{
  assert.deepEqual(MIXER_GAIN_CURVE,[[-100,0],[-60,.07],[-40,.16],[-30,.24],[-20,.34],[-12,.46],[-6,.58],[0,.7],[6,.8],[12,.88],[30,1]].map(pair=>pair.map(Math.fround)));
  for(const [db,position] of MIXER_GAIN_CURVE){assert.equal(mixerGainPosition(db),position);assert.equal(mixerGainDb(position),db);}
  assert.equal(mixerGainDb(-1),-100);assert.equal(mixerGainDb(2),30);assert.equal(mixerGainPosition(-200),0);assert.equal(mixerGainPosition(200),1);
  assert.equal(mixerControlDelta('pan',0,100,0,212),1);assert.equal(mixerControlDelta('pan',0,0,100,212),-1);
  assert.ok(Math.abs(mixerControlDelta('pan',0,100,0,212,true)-.1)<1e-6);
  assert.ok(mixerControlDelta('gain_db',0,0,-20,212,true)<mixerControlDelta('gain_db',0,0,-20,212));
  assert.equal(mixerControlDelta('gain_db',0,0,-1000,212),30);
});

test('gain drag remains local, keeps pointer ownership and commits the final release endpoint once',async()=>{
  const f=fixture();try{
    f.send('pointerdown');f.send('pointermove',{clientY:100});assert.equal(f.writes.length,0);assert.ok(f.drafts.at(-1)>0);
    f.send('pointerup',{pointerId:2,clientY:10});assert.equal(f.writes.length,0);assert.equal(f.element.hasPointerCapture(1),true);
    const before=f.drafts.at(-1);f.send('pointerup',{clientY:90});await settle();assert.equal(f.writes.length,1);assert.ok(f.writes[0]>before);assert.equal(f.element.captured.size,0);
    f.send('pointerup',{clientY:50});assert.equal(f.writes.length,1);
  }finally{f.control.dispose();}
});

test('no motion, Escape, capture loss, stale context, readonly, resize and hidden state cancel without writes',async t=>{
  for(const action of ['none','escape','capture','stale','readonly','resize','hidden'])await t.test(action,()=>{
    const f=fixture();try{
      f.send('pointerdown');if(action!=='none')f.send('pointermove',{clientY:100});
      if(action==='escape')assert.equal(f.send('keydown',{key:'Escape'}).defaultPrevented,true);
      if(action==='capture')f.send('lostpointercapture');
      if(action==='stale')f.setContext('changed');
      if(action==='readonly')f.setAllowed(false);
      if(action==='resize')f.windowRef.dispatchEvent(new Event('resize'));
      if(action==='hidden'){f.documentRef.hidden=true;f.documentRef.dispatchEvent(new Event('visibilitychange'));}
      f.send('pointerup');assert.deepEqual(f.writes,[]);assert.equal(f.element.captured.size,0);assert.equal(Number(f.element.attributes['aria-valuenow']),0);
    }finally{f.control.dispose();}
  });
});

test('pan relative drag, precise keyboard changes and reset preserve the same one-command workflow',async()=>{
  const f=fixture('pan',.5);try{
    f.send('pointerdown');f.send('pointerup',{clientX:60,clientY:110,shiftKey:true});await settle();assert.equal(f.writes.length,1);assert.ok(Math.abs(f.writes[0]-.52)<1e-6);
    f.send('keydown',{key:'ArrowLeft',shiftKey:true});await settle();assert.equal(f.writes.length,2);assert.ok(Math.abs(f.writes[1]-.519)<1e-6);
    f.send('dblclick');await settle();assert.equal(f.writes.at(-1),0);const count=f.writes.length;f.send('dblclick');await settle();assert.equal(f.writes.length,count);
    f.send('keydown',{key:' '});assert.equal(f.writes.length,count);
  }finally{f.control.dispose();}
});

test('pending/rejected writes do not repeat and failure restores the authoritative control value',async()=>{
  const f=fixture();let reject;
  try{
    f.setCommit(value=>{f.writes.push(value);return new Promise((resolve,failed)=>{reject=failed;});});
    f.send('pointerdown');f.send('pointerup',{clientY:100});assert.equal(f.writes.length,1);assert.equal(f.element.attributes['aria-busy'],'true');
    f.send('dblclick');f.send('keydown',{key:'ArrowUp'});assert.equal(f.writes.length,1);
    reject(new Error('Rejected native edit'));await settle();assert.equal(Number(f.element.attributes['aria-valuenow']),0);assert.deepEqual(f.messages,['Rejected native edit']);assert.equal(f.element.attributes['aria-busy'],'false');
    f.control.dispose();f.send('pointerdown');f.send('pointerup',{clientY:50});assert.equal(f.writes.length,1);
  }finally{f.control.dispose();}
});

test('actual mixer gesture writes only its native axis, preserves unrelated numeric drafts and cancels capture before retaining drafts',async()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.isConnected=true;this.value='';this.capture=null;}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}getBoundingClientRect(){return {left:0,top:0,width:70,height:230};}
    focus(){}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}reportValidity(){return true;}
  }
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  const timeline={id:'1',tracks:[{id:'2',kind:'audio',label:'A1',locked:false,mix:{gain_db:0,pan:0,effects:[]}}],master:{gain_db:0,pan:0,effects:[]}},writes=[],all=node=>[node,...node.children.flatMap(all)];
  let section;
  try{
    section=renderMixer(new Element('div'),timeline,{writable:true,open:true,commit:async operation=>{writes.push(operation);},notice(){},query:{project_epoch:'p',if_generation:'1',timeline_id:'1',revision:'r'}});
    const nodes=all(section),gain=nodes.find(node=>node.attributes['aria-label']==='A1 gain fader'),input=label=>nodes.find(node=>node.tag==='label' && node.textContent===label).children[0];
    const send=(type,y)=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:1,clientX:0,clientY:y}))Object.defineProperty(event,key,{value});gain.dispatchEvent(event);};
    input('A1 Balance L/R').value='0.123456';send('pointerdown',100);send('pointermove',90);assert.equal(writes.length,0);send('pointerup',80);await settle();
    assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0]).sort(),['channel','gain_db','kind']);assert.equal(writes[0].channel,'2');assert.equal(input('A1 Balance L/R').value,'0.123456');
    input('A1 Gain dB').value='-7.123456';send('pointerdown',100);send('pointermove',70);const draft=section.captureMixDrafts();
    assert.equal(draft.channels[0].gain_db,'-7.123456');assert.equal(gain.capture,null);send('pointerup',60);assert.equal(writes.length,1);assert.equal(timeline.tracks[0].mix.gain_db,0);
  }finally{section?.disposeMeters();globalThis.document=previous;}
});
