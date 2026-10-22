import test from "node:test";
import assert from "node:assert/strict";
import { effectName,chainOperation,normalizationModeTarget,renderMixer } from "../js/mixer.js";
test("audio insert names and ordered native values pass through without browser DSP",()=>{
  const mono={enabled:true,kind:"Mono"},eq={enabled:false,kind:{Equalizer:{bands:[{freq_hz:120,gain_db:-3,q:0.7}]}}};
  assert.equal(effectName(mono),"Mono");assert.equal(effectName(eq),"Equalizer");
  const command=chainOperation("master",[eq,mono]);assert.equal(command.effects[0],eq);assert.equal(command.effects[1],mono);assert.equal(command.channel,"master");assert.equal(command.kind,"set_audio_effects");
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
