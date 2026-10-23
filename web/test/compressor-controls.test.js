import test from 'node:test';
import assert from 'node:assert/strict';
import {compressorPosition,compressorValue,compressorDelta,createCompressorControls} from '../js/compressor-controls.js';
import {renderMixer} from '../js/mixer.js';

const f=Math.fround;
const catalog={threshold_db:[-60,0],ratio:[1,20],attack_ms:[f(.1),200],release_ms:[5,2000],makeup_db:[-12,24],crossovers_hz:[20,20000]};
const defaults=()=>({crossovers_hz:[200,2000],bands:Array.from({length:3},()=>({threshold_db:-24,ratio:3,attack_ms:10,release_ms:150,makeup_db:0}))});
class Element extends EventTarget{
  constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.properties={};this.isConnected=true;this.disabled=false;this.open=true;this.captured=new Set();this.rect={left:10,top:20,width:40,height:150};this.value='';}
  style={setProperty:(key,value)=>{this.properties[key]=value;}};
  append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}getBoundingClientRect(){return {...this.rect};}getClientRects(){return [this.rect];}
  focus(){}setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}reportValidity(){return true;}checkValidity(){return true;}
}
const all=node=>[node,...node.children.flatMap(all)];
const send=(node,type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:50,clientY:80,...values}))Object.defineProperty(event,key,{value});node.dispatchEvent(event);return event;};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  const root=new Element('div'),windowRef=new EventTarget(),documentRef=new EventTarget(),writes=[],drafts=[],messages=[];documentRef.createElement=tag=>new Element(tag);
  let parameters=structuredClone(options.parameters??defaults()),context='current',allowed=true,valid=true,canceled=0,reject=null;
  const control=createCompressorControls({root,label:'Master insert 1',getParameters:()=>parameters,defaults:defaults(),catalog,windowRef,documentRef,getContext:()=>context,canInteract:()=>allowed,isValid:()=>valid,onDraft:next=>drafts.push(next),onCancel:()=>canceled++,onCommit:async next=>{writes.push(next);if(reject)throw reject;await options.wait?.();parameters=structuredClone(next);},notice:message=>messages.push(message)});
  const button=(band,key)=>all(root).find(node=>node.dataset.compressorBand===String(band) && node.dataset.compressorParam===key);
  return {root,control,button,writes,drafts,messages,documentRef,windowRef,parameters:()=>parameters,setParameters:value=>{parameters=value;},setContext:value=>{context=value;},setAllowed:value=>{allowed=value;},setValid:value=>{valid=value;},reject:value=>{reject=value;},canceled:()=>canceled};
}

test('native threshold travel and linear/logarithmic knob mappings use supplied native bounds and f32 values',()=>{
  for(const [key,range] of Object.entries(catalog).filter(([key])=>key!=='crossovers_hz')){
    const log=['ratio','attack_ms','release_ms'].includes(key);
    assert.equal(compressorPosition(range[0],range,log),0);assert.equal(compressorPosition(range[1],range,log),1);
    assert.ok(Math.abs(compressorValue(.5,range,log)-(log?Math.sqrt(range[0]*range[1]):(range[0]+range[1])/2))<.0001);
    for(const position of [.1,.5,.9])assert.ok(Math.abs(compressorPosition(compressorValue(position,range,log),range,log)-position)<.00001);
  }
  const native=f(f(-24)-f(f(f(f(-20)/f(136))*f(60))*f(1)));
  assert.equal(compressorDelta('threshold_db',-24,0,-20,150,catalog.threshold_db),native);
  assert.equal(compressorDelta('threshold_db',-24,999,-10000,150,catalog.threshold_db),0);
  assert.equal(compressorDelta('threshold_db',-24,0,10000,150,catalog.threshold_db),-60);
  const threshold=compressorDelta('threshold_db',-24,0,-20,150,catalog.threshold_db,true);
  assert.ok(Math.abs((threshold+24)/(native+24)-.1)<.00001);
  const ratio=compressorDelta('ratio',3,20,0,40,catalog.ratio),fine=compressorDelta('ratio',3,20,0,40,catalog.ratio,true);
  assert.ok(ratio>fine && fine>3);assert.equal(compressorDelta('ratio',3,20,20,40,catalog.ratio),3);
});

test('threshold and knob pointer drafts commit one complete band edit on release and preserve all other native parameters',async()=>{
  for(const key of ['threshold_db','ratio','attack_ms','release_ms','makeup_db']){
    const item=fixture();try{
      const before=structuredClone(item.parameters()),node=item.button(1,key);send(node,'pointerdown');send(node,'pointermove',{clientX:70,clientY:60,shiftKey:true});
      assert.equal(item.writes.length,0);assert.deepEqual(item.parameters(),before);assert.equal(item.drafts.length,1);
      send(node,'pointerup',{pointerId:2});assert.equal(node.captured.size,1);send(node,'pointerup',{clientX:80,clientY:50,shiftKey:true});await settle();
      assert.equal(item.writes.length,1);assert.equal(node.captured.size,0);assert.notEqual(item.parameters().bands[1][key],before.bands[1][key]);
      const expected=structuredClone(before);expected.bands[1][key]=item.parameters().bands[1][key];assert.deepEqual(item.parameters(),expected);
      send(node,'pointerup');assert.equal(item.writes.length,1);
    }finally{item.control.dispose();}
  }
});

test('motionless or canceled dynamics gestures never write or retain pointer capture',async t=>{
  for(const reason of ['none','escape','pointercancel','lost','blur','windowblur','resize','scroll','hidden','stale','readonly','invalid','numeric','detached','detachedbutton','disabledbutton','wrongbutton'])await t.test(reason,()=>{
    const item=fixture();try{
      const node=item.button(0,'threshold_db');send(node,'pointerdown');if(reason!=='none')send(node,'pointermove',{clientY:50});
      if(reason==='escape')send(node,'keydown',{key:'Escape'});if(reason==='pointercancel')send(node,'pointercancel');if(reason==='lost')send(node,'lostpointercapture');if(reason==='blur')send(node,'blur');
      if(reason==='windowblur')item.windowRef.dispatchEvent(new Event('blur'));if(reason==='resize')node.rect.height++;
      if(reason==='scroll')item.windowRef.dispatchEvent(new Event('scroll'));if(reason==='hidden'){item.documentRef.hidden=true;item.documentRef.dispatchEvent(new Event('visibilitychange'));}
      if(reason==='stale')item.setContext('new');if(reason==='readonly')item.setAllowed(false);if(reason==='invalid')item.setValid(false);
      if(reason==='numeric'){const next=structuredClone(item.parameters());next.bands[0].threshold_db=-30;item.setParameters(next);item.control.sync();}
      if(reason==='detached')item.root.isConnected=false;
      if(reason==='detachedbutton')node.isConnected=false;if(reason==='disabledbutton')node.disabled=true;
      if(reason==='wrongbutton'){send(item.button(1,'threshold_db'),'pointermove',{clientY:0});item.control.cancel();}
      send(node,'pointerup',{clientY:reason==='none'?80:50});assert.deepEqual(item.writes,[]);assert.equal(node.captured.size,0);
    }finally{item.control.dispose();}
  });
});

test('detached and disabled dynamics buttons refuse pointer keyboard and both reset paths',async()=>{
  for(const state of ['detached','disabled']){
    const parameters=defaults();parameters.bands[0].ratio=5;parameters.bands[0].threshold_db=-12;
    const item=fixture({parameters});try{
      const node=item.button(0,'ratio'),reset=all(item.root).find(node=>node.attributes['aria-label']==='Reset Master insert 1 Low band dynamics');
      if(state==='detached'){node.isConnected=false;reset.isConnected=false;}else{node.disabled=true;reset.disabled=true;}
      send(node,'pointerdown');send(node,'pointermove',{clientX:90});send(node,'pointerup',{clientX:90});
      send(node,'keydown',{key:'ArrowUp'});send(node,'keydown',{key:'Enter'});send(node,'dblclick');send(reset,'click');await settle();
      assert.deepEqual(item.writes,[]);assert.deepEqual(item.parameters(),parameters);assert.equal(node.captured.size,0);
    }finally{item.control.dispose();}
  }
});

test('keyboard, parameter reset and native whole-band reset preserve crossovers, peers and no-op history',async()=>{
  const params=defaults();params.bands[1]={threshold_db:-10,ratio:5,makeup_db:8,attack_ms:40,release_ms:400};const item=fixture({parameters:params});
  try{
    const ratio=item.button(1,'ratio');send(ratio,'keydown',{key:'Home'});await settle();assert.equal(item.parameters().bands[1].ratio,1);
    send(ratio,'keydown',{key:'End'});await settle();assert.equal(item.parameters().bands[1].ratio,20);
    send(ratio,'keydown',{key:'Enter'});await settle();assert.equal(item.parameters().bands[1].ratio,3);
    const count=item.writes.length;send(ratio,'dblclick');await settle();assert.equal(item.writes.length,count);
    send(item.button(1,'threshold_db'),'keydown',{key:'ArrowUp',shiftKey:true});await settle();assert.equal(item.parameters().bands[1].threshold_db,f(-10+f(.02)));
    const reset=all(item.root).find(node=>node.attributes['aria-label']==='Reset Master insert 1 Mid band dynamics');send(reset,'click');await settle();
    assert.deepEqual(item.parameters().bands[1],defaults().bands[1]);assert.deepEqual(item.parameters().bands[0],params.bands[0]);assert.deepEqual(item.parameters().crossovers_hz,params.crossovers_hz);
    const final=item.writes.length;send(reset,'click');await settle();assert.equal(item.writes.length,final);
  }finally{item.control.dispose();}
});

test('pending and unknown dynamics outcomes fence further input while known refusals preserve the previous draft',async()=>{
  let release;const item=fixture({wait:()=>new Promise(resolve=>{release=resolve;})});try{
    const node=item.button(0,'ratio');send(node,'keydown',{key:'ArrowUp'});send(node,'keydown',{key:'ArrowUp'});assert.equal(item.writes.length,1);assert.equal(node.disabled,true);
    release();await settle();assert.equal(item.parameters().bands[0].ratio,f(3+f(.05)));
    const before=structuredClone(item.parameters());item.reject(Object.assign(Error('Unknown command outcome'),{code:'OUTCOME_UNKNOWN'}));send(node,'keydown',{key:'ArrowUp'});await settle();
    assert.deepEqual(item.parameters(),before);const count=item.writes.length;item.reject(null);item.control.sync();send(node,'keydown',{key:'ArrowUp'});assert.equal(item.writes.length,count);assert.equal(node.disabled,true);
  }finally{item.control.dispose();}
  const refused=fixture();try{
    refused.reject(Error('Native range refused'));send(refused.button(0,'ratio'),'keydown',{key:'ArrowUp'});await settle();assert.equal(refused.parameters().bands[0].ratio,3);assert.deepEqual(refused.messages,['Native range refused']);
    refused.reject(null);send(refused.button(0,'ratio'),'keydown',{key:'ArrowUp'});await settle();assert.equal(refused.writes.length,2);
  }finally{refused.control.dispose();}
});

test('threshold activity uses native linear input and 24dB reduction meters without editing and clears stale or disposed samples',()=>{
  const item=fixture(),sample={parameters:defaults(),band_level:[.5,.25,.125],reduction_db:[3,6,12],frozen:true,inactive:false},views=all(item.root).filter(node=>node.attributes.class==='compressor-activity');
  try{
    item.control.setActivity(sample);assert.match(views[0].attributes['aria-label'],/−?6\.0 dBFS.*3\.0 dB GR.*frozen/);assert.equal(Number(views[0].children[2].attributes.height),12.5);assert.equal(Number(views[2].children[2].attributes.height),50);assert.deepEqual(item.writes,[]);
    sample.inactive=true;item.control.setActivity(sample);assert.equal(Number(views[0].children[2].attributes.height),0);assert.match(views[0].attributes['aria-label'],/inactive/);
    item.setContext('new');item.control.sync();assert.equal(Number(views[0].children[0].attributes.height),0);assert.match(views[0].attributes['aria-label'],/no current native sample/);
    item.control.setActivity({...sample,inactive:false});item.documentRef.hidden=true;item.control.sync();assert.match(views[0].attributes['aria-label'],/no current native sample/);item.control.dispose();item.control.setActivity(sample);assert.equal(Number(views[0].children[2].attributes.height),0);assert.deepEqual(item.writes,[]);
  }finally{item.control.dispose();}
});

test('real mixer dynamics synchronize precise fields and emit one native chain while preserving bypass and other inserts',async()=>{
  const previousDocument=globalThis.document,previousFetch=globalThis.fetch,previousOption=globalThis.Option;const documentRef=new EventTarget();documentRef.createElement=tag=>new Element(tag);globalThis.document=documentRef;
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  globalThis.fetch=async()=>({ok:true,json:async()=>({sample_rate:48000,enabled:false,response_kind:'makeup_only',activity:null,points:[[20,0],[20000,0]]})});
  const original={enabled:false,kind:{MultibandCompressor:defaults()}},mono={enabled:true,kind:'Mono'},timeline={id:'1',tracks:[],master:{gain_db:0,pan:0,effects:[mono,original]}},writes=[],consumers=[];let unsubscribed=0;
  try{
    const section=renderMixer(new Element('div'),timeline,{writable:true,open:true,catalog:{defaults:{MultibandCompressor:original},compressor:{...catalog,graph:{frequency_hz:[20,20000],display_db:[-30,24],min_crossover_ratio:f(1.2)}}},query:new URLSearchParams({project_epoch:'epoch',if_generation:'3',timeline_id:'1',revision:'r'}),commit:async operation=>{writes.push(operation);},notice(){},meters:{visible:()=>true,sync(){},subscribe:consumer=>{consumers.push(consumer);return ()=>{unsubscribed++;consumer.onClear();};}}});
    const effects=all(section).find(node=>node.dataset.mixerPath==='master:effects');effects.open=true;send(effects,'toggle');
    const card=all(section).find(node=>node.dataset.mixerPath==='master:effects:1');card.open=true;send(card,'toggle');await settle();
    const node=all(card).find(node=>node.dataset.compressorBand==='1' && node.dataset.compressorParam==='threshold_db');
    const exact=all(card).find(node=>node.tag==='label' && node.textContent==='Master compressor band 2 threshold_db').children[0];
    const consumer=consumers.find(item=>item.insert);assert.deepEqual(consumer.insert,{channel:'master',index:1});assert.equal(consumer.visible(),true);
    const reading={telemetry:true,sample_rate:48000,end_sample:4096,frozen:true,spectrum_hz:Array.from({length:128},(_,i)=>20*Math.pow(1000,i/127)),insert:{channel:'master',index:1,kind:'MultibandCompressor',inactive:true,band_level:[0,0,0],reduction_db:[0,0,0],before_db:Array(128).fill(-96),after_db:Array(128).fill(-96),response:{sample_rate:48000,response_kind:'native_activity',parameters:defaults(),points:Array.from({length:241},(_,i)=>[20*Math.pow(1000,i/240),0,0])}}};
    consumer.onRead(reading);const active=all(card).find(node=>node.attributes.class==='audio-graph-active');assert.equal(active.attributes.points.split(' ').length,241);assert.ok(all(card).some(node=>node.attributes.role==='status' && /Frozen prepared sample.*inactive/.test(node.textContent)));assert.equal(writes.length,0);
    card.open=false;consumer.onRead(reading);assert.equal(active.attributes.points,'');card.open=true;consumer.onRead(reading);assert.notEqual(active.attributes.points,'');
    send(node,'pointerdown');send(node,'pointermove',{clientY:50});assert.notEqual(Number(exact.value),-24);assert.equal(writes.length,0);
    send(node,'keydown',{key:'Escape'});assert.equal(Number(exact.value),-24);assert.equal(writes.length,0);
    send(node,'keydown',{key:'ArrowUp'});await settle();assert.equal(writes.length,1);assert.equal(writes[0].kind,'set_audio_effects');assert.equal(writes[0].channel,'master');
    assert.equal(writes[0].effects[1].enabled,false);assert.deepEqual(writes[0].effects[0],mono);assert.equal(writes[0].effects[1].kind.MultibandCompressor.bands[1].threshold_db,f(-24+f(.2)));assert.equal(Number(exact.value),f(-24+f(.2)));
    assert.deepEqual(timeline.master.effects,[mono,original]);
    send(node,'pointerdown');send(node,'pointermove',{clientY:50});exact.value='-17.25';send(exact,'input');send(node,'pointerup',{clientY:50});assert.equal(exact.value,'-17.25');assert.equal(writes.length,1);
    section.disposeMeters();send(node,'keydown',{key:'ArrowUp'});consumer.onRead(reading);assert.equal(active.attributes.points,'');assert.equal(unsubscribed,2);assert.equal(writes.length,1);
  }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;globalThis.Option=previousOption;}
});
