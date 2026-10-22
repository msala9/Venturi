import {request} from './api.js';

const nativeKinds={Equalizer:'equalizer',MultibandCompressor:'multiband_compressor'};
const apiRequest=(path,body,{signal}={})=>request(path,body,(url,init)=>fetch(url,{...init,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));
export function audioPresetIdentity(context){
  if(!context || ![context.project_epoch,context.generation,context.timeline_id,context.timeline_revision].every(value=>typeof value==='string' && value.length>0))return null;
  return JSON.stringify([context.project_epoch,context.generation,context.timeline_id,context.timeline_revision]);
}
export function canRetainAudioPresetDraft(before,next,timelineId){
  // This exception only preserves an existing view after a library-only mutation.
  // Any uncertain session shape falls back to the ordinary authoritative rebuild.
  const id=value=>typeof value==='string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value)<=18446744073709551615n;
  const text=(value,max)=>typeof value==='string' && value.length>0 && value.length<=max;
  function shape(value){
    if(!value || !text(value.project_epoch,256) || !id(value.generation) || !(value.project_name===null || text(value.project_name,4096)) || typeof value.unsaved!=='boolean')return false;
    const history=value.history;
    if(!history || !Array.isArray(history.labels) || history.labels.length>10000 || !Number.isSafeInteger(history.position) || history.position<0 || history.position>history.labels.length || history.labels.some(label=>typeof label!=='string' || label.length>1024))return false;
    if(!Array.isArray(value.media) || value.media.length>10000 || value.media.some(item=>!item || typeof item!=='object' || !id(item.id)) || new Set(value.media.map(item=>item.id)).size!==value.media.length)return false;
    if(!Array.isArray(value.timelines) || value.timelines.length>10000 || value.timelines.some(item=>!item || !id(item.id) || typeof item.revision!=='string' || !/^[0-9a-f]{16}$/.test(item.revision)) || new Set(value.timelines.map(item=>item.id)).size!==value.timelines.length)return false;
    return value.timelines.some(item=>item.id===timelineId);
  }
  try{
    if(!id(timelineId) || !shape(before) || !shape(next))return false;
    if(['project_epoch','generation','project_name','unsaved'].some(key=>before[key]!==next[key]))return false;
    if(before.history.position!==next.history.position || JSON.stringify(before.history.labels)!==JSON.stringify(next.history.labels))return false;
    const previousMedia=JSON.stringify(before.media),nextMedia=JSON.stringify(next.media);
    if(previousMedia.length>4*1024*1024 || nextMedia.length>4*1024*1024 || previousMedia!==nextMedia)return false;
    return before.timelines.length===next.timelines.length && before.timelines.every((item,index)=>item.id===next.timelines[index].id && item.revision===next.timelines[index].revision);
  }catch{return false;}
}
export function audioPresetName(value){
  const name=String(value??'').trim();if(!name || new TextEncoder().encode(name).length>256 || /[\u0000-\u001f\u007f-\u009f]/.test(name))throw Error('Choose a preset name of up to 256 UTF-8 bytes without control characters');return name;
}
export function checkedAudioPresets(value,epoch){
  if(value?.project_epoch!==epoch || typeof value.revision!=='string' || !/^[0-9a-f]{64}$/.test(value.revision))throw Error('The custom audio preset library changed or returned an invalid revision');
  for(const rows of [value.eq_presets,value.compressor_presets]){
    if(!Array.isArray(rows) || rows.length>256 || new Set(rows.map(row=>row?.name)).size!==rows.length)throw Error('The custom audio preset catalog is invalid');
    for(const row of rows)if(audioPresetName(row?.name)!==row.name || !row.params || typeof row.params!=='object' || Array.isArray(row.params))throw Error('The custom audio preset catalog is invalid');
  }
  if(new TextEncoder().encode(JSON.stringify(value)).length>4*1024*1024)throw Error('The custom audio preset catalog exceeds its metadata limit');
  return value;
}

export function createAudioPresets({kind,channel,index,expectedContext,getContext,canCommit,isCurrent=()=>true,getParameters,validateDraft=()=>true,libraryCommit,commit,api=apiRequest,onChange=()=>{}}){
  const presetKind=nativeKinds[kind],bound=audioPresetIdentity(expectedContext || getContext());
  if(!presetKind || typeof channel!=='string' || !Number.isSafeInteger(index) || index<0 || index>=32)throw Error('Custom presets require a native EQ or compressor insert');
  let disposed=false,sequence=0,reader=null,working=false,catalog=null,state={phase:'idle',message:'Custom presets are stored separately from the project',catalog:null};
  const live=()=>!disposed && Boolean(bound) && isCurrent() && audioPresetIdentity(getContext())===bound;
  const emit=(phase,message)=>{state={phase,message,catalog};if(live())onChange(state);};
  const rows=()=>catalog?.[kind==='Equalizer'?'eq_presets':'compressor_presets'] || [];
  const available=()=>live() && !working && canCommit();
  const selected=name=>rows().some(row=>row.name===name);
  async function load(){
    if(!live() || working)return null;
    const attempt=++sequence;reader?.abort();reader=new AbortController();const signal=reader.signal;catalog=null;emit('loading','Reading custom audio presets…');
    try{
      if(!live() || signal.aborted)return null;const value=await api(`/audio/presets?${new URLSearchParams({project_epoch:getContext().project_epoch})}`,undefined,{signal});
      if(!live() || attempt!==sequence || signal.aborted)return null;catalog=checkedAudioPresets(value,getContext().project_epoch);emit('ready',`${rows().length} custom ${kind==='Equalizer'?'EQ':'compressor'} presets`);return catalog;
    }catch(error){if(!live() || attempt!==sequence || signal.aborted)return null;emit('error',error.message);throw error;}
    finally{if(attempt===sequence)reader=null;}
  }
  async function run(action,name){
    if(!available() || !catalog)return null;
    name=audioPresetName(name);
    if(action!=='save' && !selected(name))throw Error('Choose a custom preset from the current native catalog');
    let parameters;
    if(action==='save'){
      if(!validateDraft())return null;parameters=structuredClone(getParameters());
      if(!parameters || typeof parameters!=='object' || Array.isArray(parameters) || Object.keys(parameters).length!==1 || !Object.hasOwn(parameters,kind))throw Error('The current insert no longer has the matching native parameters');
    }
    const revision=catalog.revision,attempt=++sequence;reader?.abort();reader=null;working=true;let submitted=false,acknowledged=false;
    emit(action==='apply'?'applying':'saving',action==='apply'?'Applying custom preset · one Undo…':action==='save'?'Saving draft parameters to the custom preset library…':'Deleting the selected custom preset…');
    try{
      if(!live() || !canCommit())return null;
      submitted=true;const receipt=action==='apply'?await commit({kind:'apply_saved_audio_preset',channel,index,preset_kind:presetKind,name,revision}):await libraryCommit({kind:'edit_audio_preset_library',edit:action==='save'?{action:'save',name,revision,parameters}:{action:'delete',kind:presetKind,name,revision}});
      acknowledged=true;emit('ready',action==='apply'?'Custom preset applied · one Undo restores the insert':action==='save'?'Custom audio preset saved · project Undo unchanged':'Custom audio preset deleted · project Undo unchanged');return receipt;
    }catch(error){
      // A failed revision or uncertain write requires an explicit authoritative refresh.
      catalog=null;
      emit(error.code==='OUTCOME_UNKNOWN' || error.code==='AUDIO_PRESETS_UNCERTAIN'?'uncertain':'error',`${error.message}${submitted?' · Do not repeat automatically; refresh or check command status first':''}`);throw error;
    }finally{
      working=false;
      // Main refresh can replace this entire card after the receipt; only a still-current card reloads.
      if(acknowledged && action!=='apply' && live() && attempt===sequence)void load().catch(()=>{});
      else if(live())onChange(state);
    }
  }
  return {load,save:name=>run('save',name),remove:name=>run('delete',name),apply:name=>run('apply',name),state:()=>state,rows,current:live,canAct:()=>available() && Boolean(catalog),busy:()=>working,replaces:name=>{try{return selected(audioPresetName(name));}catch{return false;}},suspend(){sequence++;reader?.abort();reader=null;catalog=null;},dispose(){disposed=true;sequence++;reader?.abort();reader=null;}};
}

export function renderAudioPresets(root,{label,...options}){
  const fieldset=document.createElement('fieldset'),legend=document.createElement('legend'),list=document.createElement('select'),name=document.createElement('input'),nameLabel=document.createElement('label'),warning=document.createElement('p'),status=document.createElement('output');
  legend.textContent='Custom audio presets';list.setAttribute('aria-label',`${label} custom preset`);name.setAttribute('aria-label',`${label} custom preset name`);name.maxLength=256;nameLabel.className='field';nameLabel.textContent='Save current draft as';nameLabel.append(name);warning.className='muted';status.setAttribute('role','status');
  const button=text=>{const node=document.createElement('button');node.type='button';node.textContent=text;return node;};
  const save=button('Save custom preset'),apply=button('Apply custom preset'),remove=button('Delete custom preset'),refresh=button('Refresh custom presets');
  fieldset.append(legend,list,apply,remove,nameLabel,save,warning,refresh,status);root.append(fieldset);
  function controls(){
    const valid=controller.canAct();list.disabled=controller.busy() || !valid;name.disabled=!valid;apply.disabled=remove.disabled=!valid || !list.value;refresh.disabled=controller.busy();save.disabled=!valid;
    try{audioPresetName(name.value);}catch{save.disabled=true;}
    const replacing=controller.replaces(name.value);save.textContent=replacing?'Replace custom preset':'Save custom preset';warning.textContent=replacing?`Saving replaces the custom preset “${name.value.trim()}” of this effect kind. Project Undo stays unchanged.`:'Save stores only this draft’s native effect parameters. Library Save/Delete do not change the project or its Undo history.';
  }
  const controller=createAudioPresets({...options,onChange(state){
    if(!controller.current())return;const previous=list.value;list.replaceChildren(new Option('Choose a custom preset…',''));
    for(const row of controller.rows())list.append(new Option(row.name,row.name));if(controller.rows().some(row=>row.name===previous))list.value=previous;
    status.textContent=state.message;controls();
  }});
  const invoke=promise=>void promise.catch(error=>{if(controller.current()){status.textContent=error.message;options.notice?.(error.message);controls();}});
  list.addEventListener('change',()=>{if(list.value)name.value=list.value;controls();});name.addEventListener('input',controls);
  save.addEventListener('click',()=>invoke(controller.save(name.value)));apply.addEventListener('click',()=>invoke(controller.apply(list.value)));remove.addEventListener('click',()=>invoke(controller.remove(list.value)));refresh.addEventListener('click',()=>invoke(controller.load()));
  controls();invoke(controller.load());return controller;
}
