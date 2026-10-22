import test from 'node:test';
import assert from 'node:assert/strict';
import {audioPresetIdentity,audioPresetName,checkedAudioPresets,createAudioPresets,renderAudioPresets,canRetainAudioPresetDraft} from '../js/audio-presets.js';

const revision='a'.repeat(64);
const eq={bands:[{freq_hz:120,gain_db:-3,q:0.7}]};
const compressor={crossovers_hz:[200,2000],bands:[{threshold_db:-12,ratio:2,attack_ms:10,release_ms:120,makeup_db:0}]};
const context=()=>({project_epoch:'epoch',generation:'1',timeline_id:'timeline',timeline_revision:'revision'});
const catalog=()=>({project_epoch:'epoch',revision,eq_presets:[{name:'Warm',params:structuredClone(eq)}],compressor_presets:[{name:'Warm',params:structuredClone(compressor)}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let n=0;n<4;n++)await Promise.resolve();};
function harness(options={}){
  let current=context(),connected=true,writable=true,valid=true,draft={Equalizer:structuredClone(eq)};
  const reads=[],writes=[],applies=[],states=[];
  const config={kind:'Equalizer',channel:'audio-track',index:1,expectedContext:context(),getContext:()=>current,canCommit:()=>writable,isCurrent:()=>connected,getParameters:()=>draft,validateDraft:()=>valid,
    api:async(path,body,init)=>{reads.push({path,body,init});return options.read?options.read(path,body,init):catalog();},
    libraryCommit:async operation=>{writes.push(operation);return options.write?options.write(operation):{command_id:'library'};},
    commit:async operation=>{applies.push(operation);return options.apply?options.apply(operation):{command_id:'apply'};},onChange:value=>states.push(value),...options.config};
  const controller=createAudioPresets(config);
  return {controller,config,reads,writes,applies,states,setContext:value=>current=value,setConnected:value=>connected=value,setWritable:value=>writable=value,setValid:value=>valid=value,setDraft:value=>draft=value};
}

const draftSession=()=>({project_epoch:'epoch:1',generation:'12',project_name:'Current.vvproj',unsaved:true,history:{position:1,labels:['ImportMedia','SetAudioEffect']},media:[{id:'18446744073709551615',name:'Sound',content_hash:'123',offline:false}],timelines:[{id:'42',revision:'0123456789abcdef'},{id:'43',revision:'abcdef0123456789'}]});
test('library-only authoritative refresh can retain drafts without confusing command or catalog metadata with edits',()=>{
  const before=draftSession(),next=structuredClone(before);next.audio_presets_revision='new';next.command_epoch='rotated';
  assert.equal(canRetainAudioPresetDraft(before,next,'42'),true);assert.equal(canRetainAudioPresetDraft(before,next,'43'),true);
  before.project_name=next.project_name=null;assert.equal(canRetainAudioPresetDraft(before,next,'42'),true);
  assert.equal(canRetainAudioPresetDraft(before,next,'44'),false);
});
test('project, dirty state, native history and every timeline revision change require the normal rebuild',()=>{
  const before=draftSession();
  for(const change of [next=>next.project_epoch='other',next=>next.generation='13',next=>next.project_name='SavedAs.vvproj',next=>next.unsaved=false,next=>next.history.position=0,next=>next.history.labels[0]='Other edit',next=>next.timelines[1].revision='1111111111111111',next=>next.timelines.reverse(),next=>next.timelines.pop()]){
    const next=structuredClone(before);change(next);assert.equal(canRetainAudioPresetDraft(before,next,'42'),false);
  }
});
test('any native media metadata difference, removal or order change discards retained draft UI',()=>{
  const before=draftSession();before.media.push({id:'7',name:'Other',offline:false});
  for(const change of [next=>next.media[0].offline=true,next=>next.media[0].content_hash='124',next=>next.media.pop(),next=>next.media.reverse(),next=>next.media[0].folder='8']){
    const next=structuredClone(before);change(next);assert.equal(canRetainAudioPresetDraft(before,next,'42'),false);
  }
});
test('retention refuses missing, noncanonical, numeric or duplicate native identity fields and malformed history',()=>{
  const good=draftSession();
  for(const change of [next=>delete next.generation,next=>next.generation=12,next=>next.generation='012',next=>next.timelines[0].id=42,next=>next.timelines[0].id='042',next=>next.timelines[0].revision=123,next=>next.timelines[0].revision='',next=>next.timelines[0].revision='0123456789abcdeF',next=>next.timelines.push({...next.timelines[0]}),next=>next.media[0].id='18446744073709551616',next=>next.media.push({...next.media[0]}),next=>next.history.position=3,next=>next.history.labels=[null],next=>next.unsaved='true']){
    const malformed=structuredClone(good);change(malformed);assert.equal(canRetainAudioPresetDraft(good,malformed,'42'),false);assert.equal(canRetainAudioPresetDraft(malformed,good,'42'),false);
  }
  for(const missing of [null,undefined,{}])assert.equal(canRetainAudioPresetDraft(missing,good,'42'),false);
});
test('oversize and cyclic metadata fail closed without changing either authoritative snapshot',()=>{
  const good=draftSession(),oversize=structuredClone(good);oversize.media[0].name='x'.repeat(4*1024*1024);assert.equal(canRetainAudioPresetDraft(oversize,structuredClone(oversize),'42'),false);
  const longHistory=structuredClone(good);longHistory.history.labels=Array(10001).fill('Edit');assert.equal(canRetainAudioPresetDraft(longHistory,longHistory,'42'),false);
  const cycle=structuredClone(good);cycle.media[0].cycle=cycle.media;assert.equal(canRetainAudioPresetDraft(cycle,cycle,'42'),false);
  assert.deepEqual(good,draftSession());
});

test('custom names use native byte limits, trim, allow metadata slashes and reject controls',()=>{
  assert.equal(audioPresetName('  Room/voice\\one  '),'Room/voice\\one');
  assert.equal(audioPresetName('é'.repeat(128)),'é'.repeat(128));
  for(const value of ['', '  ', 'é'.repeat(129),'x\u0085y','x\u0000y'])assert.throws(()=>audioPresetName(value));
});
test('catalog preserves kind-scoped names and rejects wrong epoch, revisions and malformed rows',()=>{
  const value=catalog();assert.equal(checkedAudioPresets(value,'epoch'),value);
  for(const invalid of [{...value,project_epoch:'other'},{...value,revision:'A'.repeat(64)},{...value,eq_presets:[...value.eq_presets,...value.eq_presets]},{...value,eq_presets:[{name:' Warm ',params:eq}]},{...value,compressor_presets:[{name:'bad',params:null}]},{...value,eq_presets:Array.from({length:257},(_,n)=>({name:`EQ${n}`,params:eq}))}])assert.throws(()=>checkedAudioPresets(invalid,'epoch'));
});
test('context requires exact project, generation, timeline and revision identity',()=>{
  assert.ok(audioPresetIdentity(context()));for(const key of Object.keys(context()))assert.equal(audioPresetIdentity({...context(),[key]:null}),null);
  const h=harness({config:{expectedContext:{...context(),timeline_id:'old'}}});assert.equal(h.controller.current(),false);
});
test('opening reads native catalog without mutations even for a readonly or locked insert',async()=>{
  const h=harness();h.setWritable(false);await h.controller.load();
  assert.equal(h.reads.length,1);assert.equal(h.reads[0].path,'/audio/presets?project_epoch=epoch');assert.equal(h.reads[0].body,undefined);
  assert.equal(h.controller.rows()[0].name,'Warm');assert.equal(h.controller.canAct(),false);
  assert.equal(await h.controller.save('New'),null);assert.equal(await h.controller.apply('Warm'),null);assert.equal(await h.controller.remove('Warm'),null);assert.deepEqual(h.writes,[]);assert.deepEqual(h.applies,[]);
});
test('Save clones only the current tagged draft parameters and reloads once after library acknowledgement',async()=>{
  const pending=deferred(),h=harness({write:()=>pending.promise});await h.controller.load();
  const draft={Equalizer:structuredClone(eq)};h.setDraft(draft);const saving=h.controller.save(' New ');
  draft.Equalizer.bands[0].gain_db=9;
  assert.deepEqual(h.writes,[{kind:'edit_audio_preset_library',edit:{action:'save',name:'New',revision,parameters:{Equalizer:eq}}}]);assert.equal(h.controller.busy(),true);
  assert.equal(await h.controller.save('Duplicate'),null);assert.equal(await h.controller.apply('Warm'),null);assert.equal(await h.controller.remove('Warm'),null);
  pending.resolve({command_id:'library'});await saving;await settle();assert.equal(h.reads.length,2);assert.deepEqual(h.applies,[]);
});
test('Apply sends an authoritative native preset reference, preserving parameters and enabled state in Rust',async()=>{
  const h=harness();await h.controller.load();await h.controller.apply('Warm');
  assert.deepEqual(h.applies,[{kind:'apply_saved_audio_preset',channel:'audio-track',index:1,preset_kind:'equalizer',name:'Warm',revision}]);assert.deepEqual(h.writes,[]);assert.equal(h.reads.length,1);
  await assert.rejects(()=>h.controller.apply('Not in catalog'));
});
test('compressor Save and Delete use the compressor category, never the same-name EQ row',async()=>{
  const h=harness({config:{kind:'MultibandCompressor'}});h.setDraft({MultibandCompressor:compressor});await h.controller.load();
  await h.controller.save('Warm');await settle();await h.controller.remove('Warm');await settle();
  assert.deepEqual(h.writes[0].edit.parameters,{MultibandCompressor:compressor});assert.deepEqual(h.writes[1],{kind:'edit_audio_preset_library',edit:{action:'delete',kind:'multiband_compressor',name:'Warm',revision}});assert.deepEqual(h.applies,[]);
});
test('Save refuses an invalid draft and a changed insert kind before any library mutation',async()=>{
  const h=harness();await h.controller.load();h.setValid(false);assert.equal(await h.controller.save('New'),null);
  h.setValid(true);h.setDraft({Normalize:{mode:'peak'}});await assert.rejects(()=>h.controller.save('New'));assert.deepEqual(h.writes,[]);
});
test('late catalog cannot bind to a changed timeline, generation, project or detached card',async()=>{
  for(const key of Object.keys(context())){
    const pending=deferred(),h=harness({read:()=>pending.promise});const loading=h.controller.load();h.setContext({...context(),[key]:'new'});pending.resolve(catalog());assert.equal(await loading,null);assert.equal(h.controller.canAct(),false);assert.deepEqual(h.controller.rows(),[]);
  }
  const pending=deferred(),h=harness({read:()=>pending.promise});const loading=h.controller.load();h.setConnected(false);pending.resolve(catalog());assert.equal(await loading,null);assert.equal(h.states.length,1);
});
test('closed-card reader is aborted and cannot overwrite the reopened catalog',async()=>{
  const first=deferred(),second=deferred();let count=0;const h=harness({read:()=>++count===1?first.promise:second.promise});const old=h.controller.load();h.controller.suspend();assert.equal(h.reads[0].init.signal.aborted,true);
  const fresh=h.controller.load(),newCatalog={...catalog(),eq_presets:[{name:'Reopened',params:eq}]};second.resolve(newCatalog);await fresh;first.resolve(catalog());await old;assert.equal(h.controller.rows()[0].name,'Reopened');
});
test('an acknowledged Save that refreshes the mixer does not fetch into or replay from the old card',async()=>{
  let h;h=harness({write:async()=>{h.setConnected(false);return {command_id:'saved'};}});await h.controller.load();assert.deepEqual(await h.controller.save('Saved'),{command_id:'saved'});await settle();assert.equal(h.reads.length,1);assert.equal(h.writes.length,1);
  const next=harness();await next.controller.load();assert.equal(next.reads.length,1);
});
test('known and uncertain failures never replay and require explicit catalog refresh',async()=>{
  for(const code of ['AUDIO_PRESETS_CHANGED','AUDIO_PRESETS_BUSY','AUDIO_PRESETS_UNCERTAIN','OUTCOME_UNKNOWN']){
    const failure=Object.assign(Error('Native library refused or outcome is unknown'),{code}),h=harness({write:async()=>{throw failure;}});await h.controller.load();await assert.rejects(()=>h.controller.save('New'),error=>error===failure);await settle();
    assert.equal(h.writes.length,1);assert.equal(h.reads.length,1);assert.equal(h.controller.canAct(),false);assert.equal(await h.controller.save('New'),null);assert.equal(h.controller.state().phase,code.endsWith('UNCERTAIN') || code==='OUTCOME_UNKNOWN'?'uncertain':'error');
    await h.controller.load();assert.equal(h.controller.canAct(),true);assert.equal(h.writes.length,1);
  }
});
test('mutation is refused when a synchronous status callback changes ownership before submission',async()=>{
  const h=harness();await h.controller.load();h.config.onChange=()=>{};
  const config={...h.config,onChange:state=>{if(state.phase==='saving')h.setContext({...context(),generation:'2'});}},controller=createAudioPresets(config);await controller.load();assert.equal(await controller.save('New'),null);assert.deepEqual(h.writes,[]);
});
test('malformed or failed catalog leaves the draft usable but never permits native Save or Apply',async()=>{
  const h=harness({read:async()=>({...catalog(),revision:'invalid'})});await assert.rejects(()=>h.controller.load());assert.equal(h.controller.canAct(),false);assert.equal(await h.controller.apply('Warm'),null);assert.deepEqual(h.applies,[]);assert.deepEqual(h.writes,[]);
});
test('disposing cancels in-flight reads and ignores late responses without follow-up work',async()=>{
  const pending=deferred(),h=harness({read:()=>pending.promise});const loading=h.controller.load();h.controller.dispose();assert.equal(h.reads[0].init.signal.aborted,true);pending.resolve(catalog());assert.equal(await loading,null);assert.equal(await h.controller.load(),null);assert.equal(await h.controller.save('New'),null);
});

test('custom UI separates its library controls, warns about replacement and uses no nested form',async()=>{
  const original={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.textContent='';this.value='';this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this.value=nodes[0]?.value??'';}setAttribute(key,value){this.attributes[key]=value;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  try{
    const root=new Element('form'),h=harness(),controller=renderAudioPresets(root,{...h.config,label:'A1 insert 2'});await settle();
    const all=node=>[node,...node.children.flatMap(all)],nodes=all(root),find=text=>nodes.find(node=>node.textContent===text);
    assert.equal(nodes.filter(node=>node.tag==='form').length,1);assert.ok(find('Custom audio presets'));const name=nodes.find(node=>node.attributes['aria-label']==='A1 insert 2 custom preset name');name.value=' Warm ';name.dispatchEvent(new Event('input'));
    assert.ok(find('Replace custom preset'));assert.ok(nodes.some(node=>node.textContent.includes('Saving replaces the custom preset “Warm”')));
    const select=nodes.find(node=>node.tag==='select');select.value='Warm';select.dispatchEvent(new Event('change'));find('Apply custom preset').click();await settle();assert.equal(h.applies.length,1);assert.deepEqual(h.writes,[]);controller.dispose();
  }finally{globalThis.document=original.document;globalThis.Option=original.Option;}
});
