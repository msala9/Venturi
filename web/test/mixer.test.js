import test from "node:test";
import assert from "node:assert/strict";
import { effectName,chainOperation,normalizationModeTarget,renderMixer } from "../js/mixer.js";
test("audio insert names and ordered native values pass through without browser DSP",()=>{
  const mono={enabled:true,kind:"Mono"},eq={enabled:false,kind:{Equalizer:{bands:[{freq_hz:120,gain_db:-3,q:0.7}]}}};
  assert.equal(effectName(mono),"Mono");assert.equal(effectName(eq),"Equalizer");
  const command=chainOperation("master",[eq,mono]);assert.equal(command.effects[0],eq);assert.equal(command.effects[1],mono);assert.equal(command.channel,"master");assert.equal(command.kind,"set_audio_effects");
});

test('actual mixer strips share one native subscription, keep numeric drafts and apply track-only Solo/Mute with locks',async()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.isConnected=true;}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}reportValidity(){return true;}
  }
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  let consumer,disposed=0,visible=true;const writes=[],timeline={id:'1',tracks:[{id:'9007199254740993',kind:'audio',label:'A1',locked:false,solo:false,muted:true,mix:{gain_db:0,pan:0,effects:[]}},{id:'2',kind:'audio',label:'A2',locked:true,solo:false,muted:false,mix:{gain_db:-3,pan:0,effects:[]}}],master:{gain_db:0,pan:0,effects:[]}},snapshot=structuredClone(timeline);
  try{
    const root=new Element('div'),section=renderMixer(root,timeline,{writable:true,open:true,commit:operation=>{writes.push(operation);return Promise.resolve();},notice(){},query:new URLSearchParams({project_epoch:'epoch',if_generation:'3',timeline_id:'1',revision:'revision'}),meters:{visible:()=>visible,sync(){},subscribe:options=>{assert.equal(consumer,undefined);consumer=options;return ()=>disposed++;}}});
    const all=node=>[node,...node.children.flatMap(all)],nodes=all(root),input=nodes.find(node=>node.tag==='label' && node.textContent==='A1 Gain dB').children[0];input.value='-7.25';
    assert.equal(consumer.visible(),true);assert.equal(nodes.filter(node=>node.tag==='meter').length,6);
    consumer.onRead({telemetry:true,end_sample:8192,channels:[{channel:'9007199254740993',db:[-3,-6],clipped:[false,true]},{channel:'2',db:[null,null],clipped:[false,false]},{channel:'master',db:[-4,-8],clipped:[false,false]}]});
    assert.equal(nodes.find(node=>node.attributes['aria-label']==='A1 L dBFS').value,-3);assert.equal(input.value,'-7.25');
    assert.ok(nodes.some(node=>node.tag==='output' && node.textContent==='-3.0 / -6.0 dBFS · CLIP'));
    nodes.find(node=>node.attributes['aria-label']==='A1 Solo').dispatchEvent(new Event('click'));await Promise.resolve();
    assert.deepEqual(writes,[{kind:'set_track',track:'9007199254740993',solo:true}]);assert.equal(nodes.find(node=>node.attributes['aria-label']==='A1 Mute').attributes['aria-pressed'],'true');
    nodes.find(node=>node.attributes['aria-label']==='A2 Mute').dispatchEvent(new Event('click'));assert.equal(writes.length,1);
    assert.equal(nodes.some(node=>node.attributes['aria-label']==='Master Solo'),false);
    visible=false;assert.equal(consumer.visible(),false);consumer.onClear();assert.equal(nodes.find(node=>node.attributes['aria-label']==='A1 L dBFS').value,-60);assert.equal(input.value,'-7.25');
    section.disposeMeters();assert.equal(disposed,1);assert.deepEqual(timeline,snapshot);
  }finally{globalThis.document=previous;}
});

test('mix numeric drafts survive same-context EOF and readonly rebuilds, then Apply emits one native mix command',async()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.isConnected=true;}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}reportValidity(){return true;}
  }
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  const timeline={id:'1',tracks:[{id:'9007199254740993',kind:'audio',label:'A1',locked:false,mix:{gain_db:0,pan:0,effects:[]}}],master:{gain_db:0,pan:0,effects:[]}},snapshot=structuredClone(timeline),writes=[];
  const query={project_epoch:'epoch',if_generation:'3',timeline_id:'1',revision:'revision'},all=node=>[node,...node.children.flatMap(all)];
  const input=(root,label)=>all(root).find(node=>node.tag==='label' && node.textContent===label).children[0];
  const form=(root,label)=>all(root).find(node=>node.tag==='form' && node.children.some(child=>child.tag==='strong' && child.textContent===label));
  const render=(mixDrafts,writable=true,identity=query)=>renderMixer(new Element('div'),timeline,{writable,query:new URLSearchParams(identity),mixDrafts,commit:operation=>{writes.push(operation);return Promise.resolve();},notice(){}});
  try{
    const first=render();input(first,'A1 Gain dB').value='-3.25';input(first,'A1 Balance L/R').value='0.125';input(first,'Master Gain dB').value='-1.50';input(first,'Master Balance L/R').value='';
    const draft=first.captureMixDrafts();first.disposeMeters();
    form(first,'A1').dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(writes.length,0,'Disposed controls cannot apply a retained draft');
    const readonly=render(draft,false);
    assert.equal(input(readonly,'A1 Gain dB').value,'-3.25');assert.equal(input(readonly,'A1 Gain dB').disabled,true);
    form(readonly,'A1').dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(writes.length,0);
    const eof=render(readonly.captureMixDrafts());readonly.disposeMeters();
    assert.equal(input(eof,'A1 Balance L/R').value,'0.125');assert.equal(input(eof,'Master Gain dB').value,'-1.50');assert.equal(input(eof,'Master Balance L/R').value,'','Incomplete input must not become a committed default');
    form(eof,'A1').dispatchEvent(new Event('submit',{cancelable:true}));form(eof,'A1').dispatchEvent(new Event('submit',{cancelable:true}));await Promise.resolve();
    assert.deepEqual(writes,[{kind:'set_mixer',channel:'9007199254740993',gain_db:-3.25,pan:0.125}]);
    assert.deepEqual(timeline,snapshot,'Draft retention never mutates the authoritative timeline');
    for(const key of Object.keys(query)){
      const changed=render(draft,true,{...query,[key]:`${query[key]}-changed`});
      assert.equal(Number(input(changed,'A1 Gain dB').value),0,`${key} changes expire drafts, including Undo generations`);
      assert.equal(Number(input(changed,'Master Gain dB').value),0);
    }
  }finally{globalThis.document=previous;}
});

test('restored numeric drafts never bypass newly locked or detached mixer controls',()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.isConnected=true;}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}reportValidity(){return true;}
  }
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  try{
    const timeline={id:'1',tracks:[{id:'2',kind:'audio',label:'A1',locked:false,mix:{gain_db:0,pan:0,effects:[]}}],master:{gain_db:0,pan:0,effects:[]}},writes=[],query={project_epoch:'epoch',if_generation:'3',timeline_id:'1',revision:'revision'};
    const render=mixDrafts=>renderMixer(new Element('div'),timeline,{writable:true,query,mixDrafts,commit:operation=>{writes.push(operation);return Promise.resolve();},notice(){}}),all=node=>[node,...node.children.flatMap(all)];
    const first=render(),gain=all(first).find(node=>node.tag==='label' && node.textContent==='A1 Gain dB').children[0];gain.value='-3.25';const draft=first.captureMixDrafts();
    timeline.tracks[0].locked=true;const locked=render(draft),forms=all(locked).filter(node=>node.tag==='form');
    assert.equal(all(locked).find(node=>node.tag==='label' && node.textContent==='A1 Gain dB').children[0].disabled,true);
    forms[0].dispatchEvent(new Event('submit',{cancelable:true}));locked.isConnected=false;forms[1].dispatchEvent(new Event('submit',{cancelable:true}));assert.deepEqual(writes,[]);
  }finally{globalThis.document=previous;}
});

const normalization=[{mode:'SamplePeak',range:[-30,0],default:-1},{mode:'TruePeak',range:[-30,0],default:-1},{mode:'Loudness',range:[-40,-5],default:-23}];
test('normalization mode changes preserve custom same-unit targets and use native destination defaults only across dBFS and LUFS',()=>{
  assert.equal(normalizationModeTarget('SamplePeak','TruePeak',-7.25,normalization),-7.25);
  assert.equal(normalizationModeTarget('TruePeak','SamplePeak',-3.5,normalization),-3.5);
  assert.equal(normalizationModeTarget('Loudness','Loudness',-18.75,normalization),-18.75);
  assert.equal(normalizationModeTarget('TruePeak','Loudness',-3.5,normalization),-23);
  assert.equal(normalizationModeTarget('Loudness','SamplePeak',-18.75,normalization),-1);
  assert.throws(()=>normalizationModeTarget('Unknown','SamplePeak',-2,normalization));
  assert.throws(()=>normalizationModeTarget('SamplePeak','Unknown',-2,normalization));
});

test('normalization forms retain drafts through peak-mode changes and show clip-level policy only on tracks without changing master metadata',()=>{
  const original={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget {
    constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.value='';this.disabled=false;this.open=false;}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}reportValidity(){return true;}
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  try {
    const effect=set_level=>({enabled:true,kind:{Normalize:{mode:'SamplePeak',target_db:-7.25,set_level}}});
    const timeline={id:'9007199254740993',tracks:[{id:'0',label:'A1',kind:'audio',locked:false,mix:{gain_db:0,pan:0,effects:[effect('Relative')]}}],master:{gain_db:0,pan:0,effects:[effect('Independent')]}};
    const snapshot=structuredClone(timeline),writes=[],root=new Element('div');
    renderMixer(root,timeline,{writable:true,commit:operation=>{writes.push(operation);return Promise.resolve();},notice:()=>{},catalog:{normalization,defaults:{Normalize:effect('Relative')}}});
    const all=node=>[node,...node.children.flatMap(all)];
    for(const details of all(root).filter(node=>node.tag==='details' && node.dataset.mixerPath?.endsWith(':effects'))){details.open=true;details.dispatchEvent(new Event('toggle'));}
    for(const details of all(root).filter(node=>node.tag==='details' && node.dataset.mixerPath?.endsWith(':effects:0'))){details.open=true;details.dispatchEvent(new Event('toggle'));}
    const label=text=>all(root).find(node=>node.tag==='label' && node.textContent===text);
    const input=text=>label(text)?.children[0];
    assert.ok(input('A1 clip level policy'));assert.equal(label('Master clip level policy'),undefined);
    const mode=input('A1 normalization mode'),target=input('A1 normalization target');
    mode.value='TruePeak';mode.dispatchEvent(new Event('change'));assert.equal(Number(target.value),-7.25);
    target.value='-4.5';target.dispatchEvent(new Event('input'));
    mode.value='SamplePeak';mode.dispatchEvent(new Event('change'));assert.equal(Number(target.value),-4.5);
    mode.value='Loudness';mode.dispatchEvent(new Event('change'));assert.equal(Number(target.value),-23);assert.equal(Number(target.min),-40);assert.equal(Number(target.max),-5);
    target.value='-18.75';target.dispatchEvent(new Event('input'));
    mode.value='TruePeak';mode.dispatchEvent(new Event('change'));assert.equal(Number(target.value),-1);assert.equal(Number(target.min),-30);assert.equal(Number(target.max),0);
    const masterMode=input('Master normalization mode');masterMode.value='TruePeak';masterMode.dispatchEvent(new Event('change'));
    const form=all(root).find(node=>node.tag==='form' && all(node).includes(masterMode));form.dispatchEvent(new Event('submit',{cancelable:true}));
    assert.equal(writes.length,1);assert.equal(writes[0].channel,'master');
    assert.deepEqual(writes[0].effects,[{enabled:true,kind:{Normalize:{mode:'TruePeak',target_db:-7.25,set_level:'Independent'}}}]);
    assert.deepEqual(timeline,snapshot,'Editing the controls must leave the committed timeline snapshot unchanged');
  } finally {globalThis.document=original.document;globalThis.Option=original.Option;}
});
