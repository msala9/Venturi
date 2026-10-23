import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRound,audioFrequencyPosition,audioFrequencyAt,audioGraphHandles,audioGraphDraft,audioGraphWheel,createAudioGraph,compressorActivitySample} from '../js/audio-graphs.js';
import {renderMixer} from '../js/mixer.js';

const eqMeta={frequency_hz:[20,20000],display_db:[-27,27],gain_db:[-24,24],q_wheel_factor:Math.fround(1.15),shape_has_gain:{HighPass:false,LowShelf:true,Peak:true,HighShelf:true,LowPass:false}};
const compMeta={frequency_hz:[20,20000],display_db:[-30,24],min_crossover_ratio:Math.fround(1.2),response_kind:'makeup_only'};
const eqCatalog={graph:eqMeta,freq_hz:[20,20000],gain_db:[-24,24],q:[.1,18],shapes:Object.keys(eqMeta.shape_has_gain)};
const compCatalog={graph:compMeta,crossovers_hz:[20,20000],makeup_db:[-24,24],threshold_db:[-60,0],ratio:[1,20],attack_ms:[.1,200],release_ms:[1,2000]};
const equalizer=()=>({bands:Array.from({length:6},(_,index)=>({enabled:true,shape:index===0?'HighPass':'Peak',freq_hz:[80,200,600,2000,6000,12000][index],gain_db:index===0?7:0,q:1}))});
const compressor=()=>({crossovers_hz:[200,2000],bands:Array.from({length:3},()=>({threshold_db:-12,ratio:2,attack_ms:10,release_ms:100,makeup_db:0}))});
class Element extends EventTarget{
  constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.properties={};this.isConnected=true;this.disabled=false;this.open=false;this.captured=new Set();this.rect={left:0,top:0,width:300,height:200};}
  style={setProperty:(key,value)=>{this.properties[key]=value;}};
  append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}getBoundingClientRect(){return {...this.rect};}getClientRects(){return [this.rect];}
  focus(){}setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}reportValidity(){return true;}checkValidity(){return true;}
}
const all=node=>[node,...node.children.flatMap(all)];
const send=(element,type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:100,clientY:100,...values}))Object.defineProperty(event,key,{value});element.dispatchEvent(event);return event;};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(kind='Equalizer',options={}){
  const root=new Element('div'),documentRef=new EventTarget(),windowRef=new EventTarget(),writes=[],messages=[];documentRef.createElement=tag=>new Element(tag);let parameters=kind==='Equalizer'?equalizer():compressor(),context='current',allowed=true,valid=true,reads=0,fail=false;
  const defaults=structuredClone(parameters),catalog=kind==='Equalizer'?eqCatalog:compCatalog;
  const readResponse=()=>{reads++;return options.readResponse?.() ?? Promise.resolve({sample_rate:48000,enabled:true,points:[[20,0],[20000,0]],...(kind==='MultibandCompressor'?{response_kind:'makeup_only',activity:null}:{})});};
  const control=createAudioGraph({root,kind,label:'Master insert 1',getParameters:()=>parameters,defaults,catalog,windowRef,documentRef,getContext:()=>context,canInteract:()=>allowed,isValid:()=>valid,onCommit:async next=>{writes.push(next);if(fail)throw Error('Native write refused');parameters=structuredClone(next);},readResponse,notice:message=>messages.push(message)});
  const handles=all(root).filter(node=>node.dataset.audioGraphHandle),status=all(root).find(node=>node.attributes.role==='status');
  return {root,control,handles,status,writes,messages,windowRef,documentRef,reads:()=>reads,parameters:()=>parameters,setParameters:value=>{parameters=value;},setAllowed:value=>{allowed=value;},setValid:value=>{valid=value;},setContext:value=>{context=value;},reject:()=>{fail=true;}};
}

test('native graph coordinates, pass-band behavior, ties-away rounding and Q wheel remain parameter-only',()=>{
  assert.equal(nativeRound(-12.5),-13);assert.equal(nativeRound(12.5),13);
  for(const hz of [20,200,2000,20000])assert.ok(Math.abs(audioFrequencyAt(audioFrequencyPosition(hz,[20,20000]),[20,20000])-hz)<.02);
  const original=equalizer(),draft=audioGraphDraft('Equalizer',original,{kind:'eq',index:0},[.5,0],eqMeta,eqCatalog);
  assert.equal(draft.bands[0].gain_db,7);assert.equal(draft.bands[0].enabled,true);assert.notEqual(draft.bands[0].freq_hz,original.bands[0].freq_hz);assert.equal(original.bands[0].freq_hz,80);
  assert.equal(audioGraphDraft('Equalizer',original,{kind:'eq',index:1},[1,1],eqMeta,eqCatalog).bands[1].gain_db,-24);
  const wheel=audioGraphWheel(original,1,1,eqMeta,eqCatalog);assert.ok(Math.abs(wheel.bands[1].q-1.15)<1e-6);assert.equal(original.bands[1].q,1);
  assert.equal(audioGraphHandles('Equalizer',original,eqMeta)[0].y,.5);
});

test('compressor graph uses native crossover ratio and 0.1 dB makeup without changing dynamics',()=>{
  const original=compressor(),left=audioGraphDraft('MultibandCompressor',original,{kind:'crossover',index:0},[1,0],compMeta,compCatalog),right=audioGraphDraft('MultibandCompressor',original,{kind:'crossover',index:1},[0,0],compMeta,compCatalog);
  assert.equal(left.crossovers_hz[0],1667);assert.equal(right.crossovers_hz[1],240);assert.deepEqual(left.bands,original.bands);
  const makeup=audioGraphDraft('MultibandCompressor',original,{kind:'makeup',index:1},[0,1],compMeta,compCatalog);
  assert.equal(makeup.bands[1].makeup_db,-24);assert.equal(makeup.bands[1].threshold_db,-12);assert.deepEqual(makeup.crossovers_hz,original.crossovers_hz);
  const numeric=compressor();numeric.crossovers_hz=[19000,20000];assert.equal(audioGraphHandles('MultibandCompressor',numeric,compMeta)[1].blocked,true);assert.deepEqual(audioGraphDraft('MultibandCompressor',numeric,{kind:'crossover',index:1},[1,0],compMeta,compCatalog),numeric);
});

test('owned graph drag sends nothing while moving and commits the final release once over a clearly committed curve',async()=>{
  const f=fixture();try{
    await settle();const node=f.handles[1],reads=f.reads();send(node,'pointerdown');send(node,'pointermove',{clientX:150,clientY:80});assert.deepEqual(f.writes,[]);assert.equal(f.reads(),reads);assert.match(f.status.textContent,/Local parameter draft.*Committed native response/);
    send(node,'pointerup',{pointerId:2,clientX:200});assert.deepEqual(f.writes,[]);assert.equal(node.captured.size,1);
    send(node,'pointerup',{clientX:210,clientY:60});await settle();assert.equal(f.writes.length,1);assert.equal(f.writes[0].bands[1].freq_hz,Math.round(audioFrequencyAt(Math.fround(.7),eqMeta.frequency_hz)));assert.equal(node.captured.size,0);assert.equal(f.reads(),reads+1);
    send(node,'pointerup');assert.equal(f.writes.length,1);
  }finally{f.control.dispose();}
});

test('motionless clicks and canceled, stale, readonly, invalid or resized gestures never write',async t=>{
  for(const action of ['none','escape','cancel','lost','stale','readonly','invalid','resize','hidden','numeric'])await t.test(action,()=>{
    const f=fixture();try{
      const node=f.handles[1];send(node,'pointerdown');if(action!=='none')send(node,'pointermove',{clientX:150});
      if(action==='escape')send(node,'keydown',{key:'Escape'});
      if(action==='cancel')send(node,'pointercancel');if(action==='lost')send(node,'lostpointercapture');
      if(action==='stale')f.setContext('new');if(action==='readonly')f.setAllowed(false);if(action==='invalid')f.setValid(false);
      if(action==='resize')f.windowRef.dispatchEvent(new Event('resize'));
      if(action==='hidden'){f.documentRef.hidden=true;f.documentRef.dispatchEvent(new Event('visibilitychange'));}
      if(action==='numeric'){const parameters=f.parameters();parameters.bands[1].freq_hz=321;f.control.sync();}
      send(node,'pointerup');assert.deepEqual(f.writes,[]);assert.equal(node.captured.size,0);
    }finally{f.control.dispose();}
  });
});

test('EQ keyboard, wheel, toggle and native reset operations remain accessible and atomic',async()=>{
  const f=fixture();try{
    await settle();const node=f.handles[1];send(node,'keydown',{key:'ArrowUp'});await settle();assert.ok(Math.abs(f.parameters().bands[1].gain_db-.1)<1e-6);
    send(node,'wheel',{deltaY:-1});await settle();assert.ok(Math.abs(f.parameters().bands[1].q-1.15)<1e-6);
    send(node,'dblclick');await settle();assert.equal(f.parameters().bands[1].enabled,false);
    send(node,'keydown',{key:'Enter'});await settle();assert.equal(f.parameters().bands[1].enabled,true);
    f.control.resetBand(1);await settle();assert.equal(f.parameters().bands[1].gain_db,0);assert.equal(f.parameters().bands[1].q,1);
    const count=f.writes.length;f.control.resetBand(1);await settle();assert.equal(f.writes.length,count);
  }finally{f.control.dispose();}
});

test('refused writes retain the previous numeric draft and do not refresh or claim it committed',async()=>{
  const f=fixture();try{
    await settle();const parameters=f.parameters();parameters.bands[1].gain_db=-3.25;f.control.sync();assert.match(f.status.textContent,/Local parameter draft/);const reads=f.reads();f.reject();
    send(f.handles[1],'keydown',{key:'ArrowUp'});await settle();assert.equal(f.parameters().bands[1].gain_db,-3.25);assert.equal(f.reads(),reads);assert.match(f.status.textContent,/Local parameter draft/);assert.deepEqual(f.messages,['Native write refused']);
  }finally{f.control.dispose();}
});

test('a late native response cannot repaint a replaced graph context',async()=>{
  let resolve;const f=fixture('MultibandCompressor',{readResponse:()=>new Promise(done=>{resolve=done;})});
  try{const status=f.status.textContent;f.setContext('replacement');resolve({sample_rate:48000,enabled:true,response_kind:'makeup_only',activity:null,points:[[20,7],[20000,7]]});await settle();assert.equal(f.status.textContent,status);assert.match(f.status.textContent,/Native response unavailable/);}finally{f.control.dispose();}
});

function activityReading(parameters=compressor()){
  return {telemetry:true,sample_rate:48000,end_sample:8192,frozen:true,spectrum_hz:Array.from({length:128},(_,i)=>20*Math.pow(1000,i/127)),insert:{kind:'MultibandCompressor',channel:'master',index:0,inactive:false,band_level:[.5,.25,.125],reduction_db:[12,6,3],sample_activity:{band_level:[.5,.25,.125],reduction_db:[3,2,1]},before_db:Array(128).fill(-20),after_db:Array(128).fill(-24),response:{sample_rate:48000,response_kind:'native_activity',parameters:structuredClone(parameters),points:Array.from({length:241},(_,i)=>[20*Math.pow(1000,i/240),0,-3])}}};
}

test('compressor activity matches immutable parameters and slot, uses exact bin values and tolerates truthful legacy spectra',()=>{
  const reading=activityReading(),options={channel:'master',index:0,parameters:compressor()},sample=compressorActivitySample(reading,options);
  assert.deepEqual(sample.reduction_db,[3,2,1]);assert.equal(sample.frozen,true);assert.equal(sample.response.points.length,241);
  assert.equal(compressorActivitySample(reading,{...options,index:1}),null);assert.equal(compressorActivitySample(reading,{...options,channel:'foreign'}),null);
  reading.insert.response.parameters.bands[0].ratio=10;assert.equal(compressorActivitySample(reading,options),null);reading.insert.response=null;reading.insert.response_error='Legacy telemetry has no captured compressor parameters';
  assert.match(compressorActivitySample(reading,options).error,/Legacy/);reading.insert.before_db=[NaN];assert.equal(compressorActivitySample(reading,options),null);
});

test('prepared compressor activity draws supplied curves and spectra without extra reads, then clears local or stale activity',async()=>{
  const item=fixture('MultibandCompressor');try{
    await settle();const reads=item.reads(),sample=compressorActivitySample(activityReading(),{channel:'master',index:0,parameters:item.parameters()}),line=name=>all(item.root).find(node=>node.attributes.class===`audio-graph-${name}`);
    item.control.setActivity(sample);assert.equal(line('active').attributes.points.split(' ').length,241);assert.equal(line('pre').attributes.points.split(' ').length,128);assert.match(item.status.textContent,/Frozen prepared sample 8192.*native activity response/);assert.equal(item.reads(),reads);assert.deepEqual(item.writes,[]);
    item.parameters().bands[0].ratio=5;item.control.sync();assert.equal(line('active').attributes.points,'');assert.equal(line('post').attributes.points,'');assert.match(item.status.textContent,/Local parameter draft/);
    item.parameters().bands[0].ratio=2;item.control.sync();sample.inactive=true;item.control.setActivity(sample);assert.match(item.status.textContent,/insert inactive/);
    item.setContext('changed');item.control.sync();assert.equal(line('active').attributes.points,'');item.control.dispose();item.control.setActivity(sample);assert.equal(line('active').attributes.points,'');assert.equal(item.reads(),reads);
  }finally{item.control.dispose();}
});

test('actual insert integration retains collapsed precise fields, full chain order, bypass state and one raw native command',async()=>{
  const previous={document:globalThis.document,Option:globalThis.Option,fetch:globalThis.fetch};
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  const reads=[];globalThis.fetch=async url=>{reads.push(url);return Response.json({sample_rate:48000,enabled:false,points:[[20,0],[20000,0]]});};
  const eq={enabled:false,kind:{Equalizer:equalizer()}},mono={enabled:true,kind:'Mono'},timeline={id:'1',tracks:[],master:{gain_db:0,pan:0,effects:[eq,mono]}},writes=[],root=new Element('div'),catalog={defaults:{Equalizer:eq},eq:eqCatalog};let section;
  try{
    section=renderMixer(root,timeline,{writable:true,open:true,query:{project_epoch:'p',if_generation:'1',timeline_id:'1',revision:'r'},openPaths:new Set(['master:effects','master:effects:0']),catalog,commit:async operation=>{writes.push(operation);},notice(){}});
    const effects=all(root).find(node=>node.dataset.mixerPath==='master:effects');effects.dispatchEvent(new Event('toggle'));const card=all(root).find(node=>node.dataset.mixerPath==='master:effects:0');card.dispatchEvent(new Event('toggle'));await settle();
    const nodes=all(root),groups=nodes.filter(node=>node.className==='audio-graph-parameters');assert.equal(groups.length,6);assert.ok(groups.every(node=>!node.open));
    const handle=nodes.find(node=>node.dataset.audioGraphHandle==='eq' && node.textContent==='2');send(handle,'keydown',{key:'ArrowUp'});await settle();
    assert.equal(writes.length,1);assert.equal(writes[0].kind,'set_audio_effects');assert.equal(writes[0].effects[0].enabled,false);assert.deepEqual(writes[0].effects[1],mono);assert.ok(Math.abs(writes[0].effects[0].kind.Equalizer.bands[1].gain_db-.1)<1e-6);assert.equal(eq.kind.Equalizer.bands[1].gain_db,0);assert.ok(reads.every(url=>url.includes('/eq/0?')));
  }finally{section?.disposeMeters();globalThis.document=previous.document;globalThis.Option=previous.Option;globalThis.fetch=previous.fetch;}
});
