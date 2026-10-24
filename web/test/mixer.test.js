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

test('floating Mixer close cancels its fader, retains numeric drafts, refuses hidden submission and remains editable on reopen',async()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.isConnected=true;this.captures=new Set();}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}reportValidity(){return true;}
    focus(){}getBoundingClientRect(){return {left:0,top:0,width:40,height:160};}
    setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
  }
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  const timeline={id:'1',tracks:[{id:'2',kind:'audio',label:'A1',locked:false,mix:{gain_db:0,pan:0,effects:[]}}],master:{gain_db:0,pan:0,effects:[]}},before=structuredClone(timeline),writes=[],notices=[];let visible=true,section;
  const all=node=>[node,...node.children.flatMap(all)],send=(node,type,properties={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(properties))Object.defineProperty(event,key,{value});node.dispatchEvent(event);};
  try{
    section=renderMixer(new Element('div'),timeline,{writable:true,open:true,canInteract:()=>visible,commit:async operation=>{writes.push(operation);},notice:message=>notices.push(message)});
    const nodes=all(section),input=nodes.find(node=>node.tag==='label' && node.textContent==='A1 Gain dB').children[0],fader=nodes.find(node=>node.attributes['aria-label']==='A1 gain fader'),form=nodes.find(node=>node.tag==='form');
    input.value='-3.25';send(fader,'pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});send(fader,'pointermove',{pointerId:1,buttons:1,clientX:0,clientY:30});
    assert.notEqual(String(input.value),'-3.25');section.cancelGestures();visible=false;send(fader,'pointerup',{pointerId:1,button:0});assert.equal(input.value,'-3.25');assert.equal(fader.captures.size,0);
    send(form,'submit');await new Promise(resolve=>setImmediate(resolve));assert.equal(writes.length,0);assert.match(notices[0],/hidden/);
    visible=true;section.syncVisibility();assert.equal(input.value,'-3.25');send(form,'submit');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(writes,[{kind:'set_mixer',channel:'2',gain_db:-3.25,pan:0}]);assert.deepEqual(timeline,before);
  }finally{section?.disposeMeters();globalThis.document=previous;}
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
    renderMixer(root,timeline,{writable:true,open:true,commit:operation=>{writes.push(operation);return Promise.resolve();},notice:()=>{},catalog:{normalization,defaults:{Normalize:effect('Relative')}}});
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

test('native loudness preset shortcuts preserve mode, bypass, clip policy and chain order without changing peak modes',async()=>{
  const previous={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.isConnected=true;this.open=false;this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}reportValidity(){return true;}
  }
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  const all=node=>[node,...node.children.flatMap(all)],event=(node,type)=>node.dispatchEvent(new Event(type,{cancelable:true})),settle=()=>new Promise(resolve=>setImmediate(resolve));
  const modes=normalization.map(value=>({...value,unit:value.mode==='Loudness'?'LUFS':'dBFS',presets:value.mode==='Loudness'?[{name:'EBU R128',target:-23},{name:'ATSC A/85',target:-24},{name:'Streaming',target:-14}]:[]}));
  const mono={enabled:true,kind:'Mono'},effect=(mode,set_level)=>({enabled:false,kind:{Normalize:{mode,target_db:mode==='Loudness'?-18.5:-3.25,set_level}}});
  const timeline={id:'1',tracks:[{id:'2',kind:'audio',label:'A1',locked:false,mix:{gain_db:0,pan:0,effects:[mono,effect('Loudness','Relative')]}}],master:{gain_db:0,pan:0,effects:[effect('SamplePeak','Independent')]}},snapshot=structuredClone(timeline),writes=[];let section,context={epoch:'e'},allowed=true,reject=null;
  try{
    section=renderMixer(new Element('div'),timeline,{writable:true,open:true,catalog:{normalization:modes,defaults:{Normalize:effect('Loudness','Relative')}},commit:async operation=>{writes.push(structuredClone(operation));if(reject)throw reject;},notice(){},audioPresets:{getContext:()=>context,canCommit:()=>allowed}});
    for(const details of all(section).filter(node=>node.dataset.mixerPath?.endsWith(':effects'))){details.open=true;event(details,'toggle');}
    for(const details of all(section).filter(node=>['2:effects:1','master:effects:0'].includes(node.dataset.mixerPath))){details.open=true;event(details,'toggle');}
    const track=all(section).find(node=>node.dataset.mixerPath==='2:effects:1'),master=all(section).find(node=>node.dataset.mixerPath==='master:effects:0'),buttons=node=>all(node).filter(node=>node.tag==='button' && node.textContent?.includes('LUFS)')),input=(node,label)=>all(node).find(node=>node.tag==='label' && node.textContent===label)?.children[0];
    assert.equal(buttons(track).length,3);assert.equal(all(track).find(node=>node.className==='normalization-presets').hidden,false);assert.equal(all(master).find(node=>node.className==='normalization-presets').hidden,true);
    event(buttons(master)[2],'click');assert.equal(writes.length,0,'Loudness buttons never switch a peak insert to LUFS');
    event(buttons(track)[2],'click');event(buttons(track)[1],'click');await settle();assert.equal(writes.length,1);assert.deepEqual(writes[0],{kind:'set_audio_effects',channel:'2',effects:[mono,{enabled:false,kind:{Normalize:{mode:'Loudness',target_db:-14,set_level:'Relative'}}}]});assert.equal(Number(input(track,'A1 normalization target').value),-14);assert.equal(buttons(track)[2].attributes['aria-pressed'],'true');
    event(buttons(track)[2],'click');await settle();assert.equal(writes.length,1,'A preset already applied is a no-op');
    const mode=input(master,'Master normalization mode');mode.value='Loudness';event(mode,'change');assert.equal(all(master).find(node=>node.className==='normalization-presets').hidden,false);event(buttons(master)[1],'click');await settle();assert.equal(writes[1].channel,'master');assert.deepEqual(writes[1].effects,[{enabled:false,kind:{Normalize:{mode:'Loudness',target_db:-24,set_level:'Independent'}}}]);assert.equal(input(master,'Master clip level policy'),undefined);
    allowed=false;event(buttons(track)[0],'click');allowed=true;context={epoch:'new'};event(buttons(track)[0],'click');assert.equal(writes.length,2);context={epoch:'e'};
    reject=Object.assign(Error('Unknown outcome'),{code:'OUTCOME_UNKNOWN'});event(buttons(track)[0],'click');await settle();const count=writes.length;reject=null;event(buttons(track)[1],'click');assert.equal(writes.length,count);assert.equal(Number(input(track,'A1 normalization target').value),-14);
    section.disposeMeters();event(buttons(master)[0],'click');assert.equal(writes.length,count);assert.deepEqual(timeline,snapshot);
  }finally{section?.disposeMeters();globalThis.document=previous.document;globalThis.Option=previous.Option;}
});

test('readonly Mixer reads EQ and compressor curves on open and reopen while all edits stay blocked',async()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.properties={};this.isConnected=true;this.disabled=false;this.open=false;this.value='';this.rect={left:0,top:0,width:300,height:200};}
    style={setProperty:(key,value)=>{this.properties[key]=value;}};
    append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}
    getBoundingClientRect(){return {...this.rect};}getClientRects(){return [this.rect];}
    focus(){}reportValidity(){return true;}checkValidity(){return true;}
  }
  const previous={document:globalThis.document,Option:globalThis.Option,fetch:globalThis.fetch};
  const doc=new EventTarget();doc.hidden=false;doc.createElement=tag=>new Element(tag);globalThis.document=doc;
  globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  const eqGraph={frequency_hz:[20,20000],display_db:[-27,27],gain_db:[-24,24],q_wheel_factor:Math.fround(1.15),shape_has_gain:{HighPass:false,LowShelf:true,Peak:true,HighShelf:true,LowPass:false}};
  const eq={enabled:true,kind:{Equalizer:{bands:Array.from({length:6},(_,index)=>({enabled:true,shape:'Peak',freq_hz:[80,200,600,2000,6000,12000][index],gain_db:0,q:1}))}}};
  const compressor={enabled:true,kind:{MultibandCompressor:{crossovers_hz:[200,2000],bands:Array.from({length:3},()=>({threshold_db:-12,ratio:2,attack_ms:10,release_ms:100,makeup_db:0}))}}};
  const catalog={defaults:{Equalizer:eq,MultibandCompressor:compressor},
    eq:{graph:eqGraph,freq_hz:[20,20000],gain_db:[-24,24],q:[.1,18],shapes:Object.keys(eqGraph.shape_has_gain)},
    compressor:{graph:{frequency_hz:[20,20000],display_db:[-30,24],min_crossover_ratio:Math.fround(1.2),response_kind:'makeup_only'},crossovers_hz:[20,20000],makeup_db:[-24,24],threshold_db:[-60,0],ratio:[1,20],attack_ms:[.1,200],release_ms:[1,2000]}};
  const timeline={id:'1',tracks:[],master:{gain_db:0,pan:0,effects:[eq,compressor]}},before=structuredClone(timeline),reads=[],writes=[];
  const all=node=>[node,...node.children.flatMap(all)],send=(node,type,values={})=>{const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries(values))Object.defineProperty(event,key,{value});node.dispatchEvent(event);};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));let visible=true,section;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.method,'GET');reads.push(url);
    return Response.json({sample_rate:48000,enabled:true,points:[[20,0],[20000,0]],...(url.includes('/compressor/')?{response_kind:'makeup_only',activity:null}:{})});
  };
  try{
    section=renderMixer(new Element('div'),timeline,{writable:false,open:true,catalog,canInteract:()=>false,canRead:()=>visible,
      query:new URLSearchParams({project_epoch:'epoch',if_generation:'3',timeline_id:'1',revision:'revision'}),
      openPaths:new Set(['master:effects','master:effects:0','master:effects:1']),commit:async operation=>{writes.push(operation);},notice(){}});
    const openButtons=all(section).filter(node=>node.className==='mixer-insert-open');assert.equal(openButtons.length,2);
    for(const button of openButtons)send(button,'click');
    await settle();
    assert.equal(reads.length,2);assert.ok(reads.some(url=>url.includes('/audio/master/eq/0?')));assert.ok(reads.some(url=>url.includes('/audio/master/compressor/1?')));
    const statuses=all(section).filter(node=>node.className==='audio-graph-status');assert.equal(statuses.length,2);
    assert.ok(statuses.every(node=>node.textContent.includes('Committed native response')));
    const handles=all(section).filter(node=>node.dataset.audioGraphHandle);assert.equal(handles.length,11);assert.ok(handles.every(node=>node.disabled));
    const fader=all(section).find(node=>node.attributes['aria-label']==='Master gain fader');assert.equal(fader.disabled,true);
    const apply=all(section).find(node=>node.tag==='button' && node.textContent==='Apply Master mix');assert.equal(apply.disabled,true);
    for(const form of all(section).filter(node=>node.tag==='form'))send(form,'submit');
    for(const handle of handles)send(handle,'keydown',{key:'ArrowUp'});
    await settle();assert.deepEqual(writes,[]);
    visible=false;section.cancelGestures();section.syncVisibility();await settle();assert.equal(reads.length,2);
    visible=true;section.syncVisibility();await settle();assert.equal(reads.length,4);
    assert.ok(handles.every(node=>node.disabled));assert.ok(statuses.every(node=>node.textContent.includes('Committed native response')));
    section.disposeMeters();section.syncVisibility();await settle();assert.equal(reads.length,4);
    assert.deepEqual(writes,[]);assert.deepEqual(timeline,before);
  }finally{section?.disposeMeters();globalThis.document=previous.document;globalThis.Option=previous.Option;globalThis.fetch=previous.fetch;}
});
