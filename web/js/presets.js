import {request} from './api.js';
import {attributeGroups} from './attributes.js';

export function presetSelectionIdentity(context){return context?JSON.stringify([context.epoch,context.generation,context.timeline,context.revision,[...context.clip_ids].sort()]):null;}
export function presetCaptureContext(current,captured=current){
  if(!current || !captured || ['epoch','generation','timeline','revision'].some(key=>current[key]!==captured[key]) || !Array.isArray(captured.clip_ids) || !captured.clip_ids.length || captured.clip_ids.length>4096 || new Set(captured.clip_ids).size!==captured.clip_ids.length || captured.clip_ids.some(id=>typeof id!=='string' || !id) || !captured.roles || !['video','audio'].every(role=>typeof captured.roles[role]==='boolean') || !captured.roles.video && !captured.roles.audio)throw Error('The preset source context changed; open Save preset again');
  return structuredClone(captured);
}
export function presetAttributeAllowed(attribute,roles){return attribute==='volume'?roles.audio:['fades','speed'].includes(attribute)?roles.video || roles.audio:roles.video;}
export function presetOptions(name,attributes,anchor,appendFilters){
  name=name.trim();
  if(!name || new TextEncoder().encode(name).length>128 || /[\u0000-\u001f\u007f]/.test(name))throw Error('Choose a preset name within 128 UTF-8 bytes');
  if(!attributes.length || new Set(attributes).size!==attributes.length || attributes.some(value=>!attributeGroups.some(([key])=>key===value)))throw Error('Choose native preset property groups');
  if(!['start','end','stretch'].includes(anchor))throw Error('Choose a native keyframe anchor');
  return {name,attributes,anchor,append_filters:Boolean(appendFilters)};
}
export function presetShortcutCatalog(value){
  if(value?.version!==1 || !Array.isArray(value.keys) || !value.keys.length || value.keys.length>256 || new Set(value.keys).size!==value.keys.length || value.keys.some(key=>typeof key!=='string' || !key || key.length>64 || /[\u0000-\u001f\u007f]/.test(key)) || !Array.isArray(value.modifiers) || value.modifiers.length!==3 || !['Ctrl','Shift','Alt'].every((modifier,index)=>value.modifiers[index]===modifier))throw Error('Native shortcut catalog is unavailable or invalid');
  return {version:1,keys:[...value.keys],modifiers:[...value.modifiers]};
}
export function presetShortcutEdit(action,key,modifiers=[],catalog=null){
  if(action==='keep')return {};
  if(action==='clear')return {shortcut:{action:'clear'}};
  if(action!=='set')throw Error('Choose Keep, Assign or Remove for the desktop shortcut');
  const native=presetShortcutCatalog(catalog);
  if(!native.keys.includes(key) || !Array.isArray(modifiers) || new Set(modifiers).size!==modifiers.length || modifiers.some(modifier=>!native.modifiers.includes(modifier)))throw Error('Choose a listed native key and its modifiers before assigning a shortcut');
  return {shortcut:{action:'set',value:[...native.modifiers.filter(modifier=>modifiers.includes(modifier)),key].join('+')}};
}
export function presetImportOperation(text){
  if(!text || new TextEncoder().encode(text).length>4*1024*1024)throw Error('Choose a native preset JSON file within 4 MiB');
  return {kind:'edit_preset_library',edit:{action:'import',json:text}};
}
export async function presetMutationResult(mutate,refresh){
  const receipt=await mutate();
  try{await refresh(receipt);return {receipt,refreshError:null};}
  catch(refreshError){return {receipt,refreshError};}
}
export function createPresetPanel({root,getContext,canCommit,commit,libraryCommit,notice,shortcuts=null,presetDnd=null,api=(path,body,options)=>request(path,body,(url,init)=>fetch(url,{...init,signal:options?.signal?AbortSignal.any([init.signal,options.signal]):init.signal}))}){
  let active=false,sequence=0,controller=null,page=0,pages=1,search='',archived=false,busy=false,loading=false,loadedEpoch=null,readEpochAttempt=null,selected=null,section=null,list=null,status=null,previous=null,next=null,caption=null,apply=null,edit=null,archive=null,download=null,restorePrevious=null,saveSelection=null,importFile=null,dialog=null,bound=null,dialogControls=null,navigation=[],shortcutToggle=null,shortcutStatus=null,settingsSequence=0,shortcutController=null;
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',action);return node;};
  const message=text=>{if(status?.isConnected)status.textContent=text;};
  let dragButton=null,dragTicket=null,deleteButton=null,deletion=null;
  const deletionIdentity=()=>{const context=getContext();return context?JSON.stringify([context.epoch,context.generation,context.command_epoch]):null;};
  function deleteAvailable(ownedList=list,ownedDialog=null){
    const context=getContext(),modal=document.querySelector?.('dialog[open]');
    return Boolean(active && section?.isConnected && ownedList===list && ownedList?.isConnected && !busy && !loading && canCommit() && (!modal || modal===ownedDialog) && typeof context?.epoch==='string' && context.epoch && typeof context.generation==='string' && context.generation && loadedEpoch===context.epoch && selected && !selected.error && ['id','revision','name'].every(key=>typeof selected[key]==='string' && selected[key]) && Boolean(selected.archived)===archived);
  }
  const deletionCurrent=draft=>deletion===draft && draft.dialog.open && draft.sequence===sequence && draft.identity===deletionIdentity() && deleteAvailable(draft.list,draft.dialog) && selected.id===draft.item.id && selected.revision===draft.item.revision && selected.name===draft.item.name && Boolean(selected.archived)===draft.item.archived;
  function closeDeletion(restore=true){
    const draft=deletion;if(!draft)return;deletion=null;draft.dialog.close();draft.dialog.remove();
    if(restore && active && draft.list===list && draft.list.isConnected && draft.identity===deletionIdentity())draft.list.focus();
  }
  function syncDeletion(){
    if(!deletion)return;const current=deletionCurrent(deletion);deletion.confirm.disabled=!current;deletion.status.textContent=current?'Delete removes this shared preset permanently; project Undo cannot restore it.':'The preset, panel or session changed, or editing is unavailable. Cancel and reopen Delete.';
  }
  function openDeletion(ownedList=list){
    if(!deleteAvailable(ownedList))return false;endDrag();
    const ownedDialog=document.createElement('dialog'),form=document.createElement('form'),heading=document.createElement('h2'),name=document.createElement('p'),note=document.createElement('p'),detail=document.createElement('p');ownedDialog.className='preset-settings';ownedDialog.setAttribute('aria-label','Confirm permanent preset deletion');heading.textContent='Permanently delete shared preset?';name.id=`preset-delete-name-${sequence}`;note.id=`preset-delete-note-${sequence}`;ownedDialog.setAttribute('aria-describedby',`${name.id} ${note.id}`);name.textContent=selected.name;note.textContent='This affects every project using this preset library. Effects already applied to clips are unchanged. Use Archive to keep the preset recoverable.';detail.setAttribute('role','status');
    const cancel=button('Cancel preset deletion',()=>closeDeletion()),confirm=document.createElement('button');confirm.type='submit';confirm.textContent='Permanently delete preset';cancel.autofocus=true;
    const draft={dialog:ownedDialog,list:ownedList,item:{id:selected.id,revision:selected.revision,name:selected.name,archived:Boolean(selected.archived)},epoch:getContext().epoch,identity:deletionIdentity(),sequence,confirm,status:detail};deletion=draft;
    form.append(heading,name,note,detail,cancel,confirm);ownedDialog.append(form);document.body.append(ownedDialog);
    form.addEventListener('submit',event=>{event.preventDefault();syncDeletion();if(!deletionCurrent(draft))return;closeDeletion(false);void write({kind:'edit_preset_library',edit:{action:'delete',id:draft.item.id,revision:draft.item.revision,archived:draft.item.archived}}).catch(()=>{});});
    confirm.addEventListener('click',event=>{if(event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph'))event.preventDefault();});
    ownedDialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.repeat || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph')){if(['Enter','Delete','Backspace'].includes(event.key))event.preventDefault();}});
    ownedDialog.addEventListener('cancel',event=>{event.preventDefault();closeDeletion();});ownedDialog.addEventListener('close',()=>{if(deletion===draft)closeDeletion(false);});ownedDialog.showModal();syncDeletion();cancel.focus();return true;
  }
  function applyAvailable(ownedList=list){
    const context=getContext();
    return Boolean(active && section?.isConnected && ownedList===list && ownedList?.isConnected && !busy && !loading && canCommit() && !dialog?.open && !document.querySelector?.('dialog[open]') && selected && !selected.error && !selected.archived && ['id','revision'].every(key=>typeof selected[key]==='string' && selected[key]) && context?.epoch===loadedEpoch && ['epoch','generation','timeline','revision'].every(key=>typeof context?.[key]==='string' && context[key]) && context.timeline!=='fixture' && Array.isArray(context.clip_ids) && context.clip_ids.length>0 && context.clip_ids.length<=4096 && new Set(context.clip_ids).size===context.clip_ids.length && context.clip_ids.every(id=>typeof id==='string' && id));
  }
  async function applySelected(ownedList=list){
    if(!applyAvailable(ownedList))return;
    const context=getContext(),operation={kind:'apply_saved_preset',clip_ids:[...context.clip_ids],preset_id:selected.id,revision:selected.revision};
    try{await write(operation,false);}catch{}
  }
  function activateList(event,ownedList){
    if(event.currentTarget!==ownedList || event.target!==ownedList && !Array.from(ownedList.children).includes(event.target) || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph') || event.type==='keydown' && event.key!=='Enter' || !applyAvailable(ownedList))return;
    event.preventDefault();event.stopPropagation();void applySelected(ownedList);
  }
  function endDrag(){if(!dragTicket)return;dragTicket=null;try{presetDnd?.end();}catch{}}
  function dragSource(){
    const context=getContext();
    if(!active || busy || !canCommit() || dialog?.open || document.querySelector?.('dialog[open]') || presetDnd?.type!=='application/x-venturi-preset' || typeof presetDnd.start!=='function' || typeof presetDnd.end!=='function' || !context?.epoch || !context.generation || !context.timeline || context.timeline==='fixture' || !context.revision || !Array.isArray(context.clip_ids) || !selected || selected.error || selected.archived || !['id','revision','name'].every(key=>typeof selected[key]==='string' && selected[key]) || typeof selected.video!=='boolean' || typeof selected.audio!=='boolean' || !selected.video && !selected.audio)return null;
    return {item:{id:selected.id,revision:selected.revision,name:selected.name,video:selected.video,audio:selected.audio},identity:presetSelectionIdentity(context)};
  }
  function dragCurrent(ticket,snapshot=ticket.item){
    let current=null;try{current=dragSource();}catch{}
    const valid=dragTicket===ticket && Boolean(current) && current.identity===ticket.identity && ['id','revision','name','video','audio'].every(key=>current.item[key]===ticket.item[key] && snapshot?.[key]===ticket.item[key]);
    if(!valid && dragTicket===ticket)endDrag();
    return valid;
  }
  function startDrag(event){
    if(event.currentTarget!==dragButton || !dragButton.isConnected){event.preventDefault();return;}
    endDrag();let source=null;
    try{
      source=dragSource();if(!source || !event.dataTransfer){event.preventDefault();return;}
      const ticket=dragTicket={...source,button:dragButton},payload=presetDnd.start(source.item,snapshot=>dragCurrent(ticket,snapshot));
      if(typeof payload!=='string' || !payload || !dragCurrent(ticket)){event.preventDefault();endDrag();return;}
      event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(presetDnd.type,payload);
    }catch(error){event.preventDefault();endDrag();message(`Preset drag unavailable · ${error.message}`);}
  }
  function controls(){
    if(!active)return;const context=getContext(),writable=canCommit() && !busy,valid=selected && !selected.error;
    for(const control of navigation)control.disabled=busy;
    list.disabled=busy;previous.disabled=busy || page===0;next.disabled=busy || page+1>=pages;
    caption.textContent=selected?`${selected.name}${selected.archived?' · archived':''}`:'No saved preset selected';
    apply.disabled=!applyAvailable();
    if(dragTicket)dragCurrent(dragTicket);
    dragButton.disabled=!dragSource();dragButton.draggable=!dragButton.disabled;dragButton.textContent=selected?`Drag preset: ${selected.name}`:'Drag selected preset';
    saveSelection.disabled=!writable || !context?.clip_ids.length;importFile.disabled=!writable;
    edit.disabled=!writable || !valid || selected.archived;archive.disabled=!writable || !selected?.revision;
    archive.textContent=selected?.archived?'Restore preset':'Archive preset';restorePrevious.disabled=!writable || !selected?.can_restore_previous || selected.archived;
    download.hidden=!selected || selected.archived;
    if(selected && context)download.href=`/api/v1/presets/items/${encodeURIComponent(selected.id)}/download?${new URLSearchParams({project_epoch:context.epoch})}`;
    if(shortcuts){
      const binding=shortcuts.state(selected),native=typeof selected?.shortcut==='string'?selected.shortcut:'None';
      shortcutToggle.textContent=binding.enabled?'Disable preset shortcut':'Enable preset shortcut';
      shortcutToggle.disabled=busy || !selected || !binding.enabled && (!writable || Boolean(binding.reason));
      shortcutToggle.setAttribute('aria-pressed',String(binding.enabled));
      shortcutStatus.textContent=`Desktop shortcut: ${native} · ${binding.reason || (binding.enabled?`${binding.label} enabled for this browser session`:'Enable to use this shortcut in the current project and browser session')}`;
    }
    dialogControls?.();
    if(deleteButton)deleteButton.disabled=!deleteAvailable();syncDeletion();
  }
  async function reload(wanted=page,preferred=selected?.id,direction=1,afterWrite=false){
    endDrag();if(!active || busy && !afterWrite)return false;const live=getContext();if(!live){message('Connect to a native session to read saved presets');return false;}const context={...live};
    controller?.abort();controller=new AbortController();const token=++sequence;readEpochAttempt=context.epoch;loading=true;loadedEpoch=null;controls();message('Reading saved presets…');
    try{
      let result,scan=wanted;
      while(true){
        result=await api(`/presets/pages/${scan}?${new URLSearchParams({project_epoch:context.epoch,search,archived:String(archived)})}`,undefined,{signal:controller.signal});
        if(!active || token!==sequence || context.epoch!==getContext()?.epoch)return false;
        const following=scan+direction;if(!search || result.items.length || following<0 || following>=result.pages)break;
        message(`Searching preset page ${scan+1} of ${result.pages}…`);scan=following;
      }
      loadedEpoch=context.epoch;page=result.page;pages=result.pages;list.replaceChildren(...result.items.map((item,index)=>new Option(`${item.name}${item.error?` · ${item.error}`:''}`,String(index))));
      const found=result.items.findIndex(item=>item.id===preferred),keepOutside=selected && found<0 && selected.id===preferred && selected.archived===archived,index=keepOutside?-1:Math.max(0,found);list.value=String(index);if(!keepOutside)selected=result.items[index] || null;
      list.onchange=()=>{endDrag();selected=result.items[Number(list.value)] || null;controls();};
      message(`Page ${page+1} of ${result.pages} · ${result.total} ${archived?'archived':'saved'} presets${search?` · ${result.items.length} matches on this page`:''}`);return true;
    }catch(error){if(active && token===sequence && error.name!=='AbortError'){if(wanted && error.message.includes('beyond the last page'))return reload(0,preferred,direction,afterWrite);message(`${error.message} · use Refresh presets to retry`);}return false;}
    finally{if(token===sequence){loading=false;controls();}}
  }
  async function write(operation,project=true){
    if(busy || !canCommit())return;const deleting=operation.kind==='edit_preset_library' && operation.edit.action==='delete',epoch=getContext()?.epoch;endDrag();busy=true;sequence++;loading=false;controller?.abort();controller=null;controls();message(deleting?'Permanently deleting shared preset…':'Updating preset library…');
    try{
      const {receipt,refreshError}=await presetMutationResult(async()=>{
        const receipt=await (project?libraryCommit(operation):commit(operation));
        if(deleting && (typeof receipt?.command_id!=='string' || !receipt.command_id || receipt.status!=='applied' || receipt.project_epoch!==epoch || receipt.library_durable!==true || receipt.preset_library_durable!==true || receipt.deleted_preset?.id!==operation.edit.id || receipt.deleted_preset.revision!==operation.edit.revision || receipt.deleted_preset.archived!==operation.edit.archived))throw Error('The permanent deletion acknowledgment could not be verified');
        return receipt;
      },async receipt=>{
        if(operation.kind==='edit_preset_library' && operation.edit.id)shortcuts?.deactivate(operation.edit.id);
        if(!active || deleting && getContext()?.epoch!==epoch)return;
        const created=operation.kind==='save_attribute_preset' || operation.kind==='edit_preset_library' && operation.edit.action==='import',id=created?receipt?.command_id:operation.preset_id || operation.edit?.id || selected?.id;
        selected=null;
        if(id && !deleting && !(operation.kind==='edit_preset_library' && operation.edit.action==='archive'))selected=await api(`/presets/items/${encodeURIComponent(id)}?${new URLSearchParams({project_epoch:getContext().epoch})}`);
        if(!await reload(page,id,1,true))throw Error('The preset list could not be refreshed');
      });
      if(refreshError){selected=null;const text=`Command applied successfully · library refresh failed: ${refreshError.message}. Refresh presets to see the saved result; do not submit it again.`;message(text);notice(text);}
      else if(deleting)message('Shared preset permanently deleted · applied clip effects unchanged · no project Undo');
      return receipt;
    }
    catch(error){if(deleting)loadedEpoch=null;const text=deleting?`${error.message} · check command status and refresh the library before repeating deletion`:`${error.message} · refresh the library before retrying`;message(text);notice(deleting?text:error.message);throw error;}
    finally{busy=false;controls();}
  }
  function openSettings(item=null,captured=null){
    const live=getContext(),context=captured?presetCaptureContext(live,captured):live;if(!context || !canCommit() || busy || !item && !context.clip_ids.length)return;
    endDrag();
    shortcutController?.abort();const token=++settingsSequence;dialog?.remove();dialog=document.createElement('dialog');dialog.className='preset-settings';const ownedDialog=dialog,boundContext={...context,clip_ids:[...context.clip_ids]},identity=presetSelectionIdentity(live),itemID=item?.id,itemRevision=item?.revision;
    const settingsCurrent=()=>active && dialog===ownedDialog && ownedDialog.open && identity===presetSelectionIdentity(getContext()) && (!item || selected?.id===itemID && selected?.revision===itemRevision && !selected.archived);
    const form=document.createElement('form'),heading=document.createElement('h2');heading.textContent=item?'Edit saved preset':'Save selected clips as preset';form.append(heading);
    const label=document.createElement('label');label.className='field';label.textContent='Preset name';const name=document.createElement('input');name.required=true;name.maxLength=128;name.value=item?.name || context.name || 'Preset';label.append(name);form.append(label);
    const groups=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Preset properties';groups.append(legend);const roles=item?{video:item.video,audio:item.audio}:context.roles;
    const defaults=item?.attributes || attributeGroups.filter(([key])=>presetAttributeAllowed(key,roles) && ['zoom','position','rotation','opacity','filters','volume'].includes(key)).map(([key])=>key);
    const checks=attributeGroups.map(([key,text])=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=defaults.includes(key);input.disabled=!presetAttributeAllowed(key,roles);label.append(input,text);groups.append(label);return input;});form.append(groups);
    const anchorLabel=document.createElement('label');anchorLabel.className='field';anchorLabel.textContent='Preset keyframe anchor';const anchor=document.createElement('select');for(const [value,text] of [['start','Start'],['end','End'],['stretch','Stretch to fit']])anchor.append(new Option(text,value));anchor.value=item?.anchor || 'start';anchorLabel.append(anchor);form.append(anchorLabel);
    const appendLabel=document.createElement('label'),append=document.createElement('input');append.type='checkbox';append.checked=Boolean(item?.append_filters);appendLabel.append(append,' Append filters instead of replacing');form.append(appendLabel);
    const currentShortcut=document.createElement('p');currentShortcut.setAttribute('data-preset-current-shortcut','');currentShortcut.textContent=`Current desktop shortcut: ${typeof item?.shortcut==='string'?item.shortcut || 'Empty imported shortcut string · preserved by Keep':item?.shortcut==null?'None':'Imported native metadata · preserved by Keep'}`;form.append(currentShortcut);
    const modeLabel=document.createElement('label'),shortcutMode=document.createElement('select');modeLabel.className='field';modeLabel.textContent='Desktop shortcut action';shortcutMode.setAttribute('data-preset-shortcut-mode','');for(const [value,text] of [['keep','Keep current shortcut'],['set','Assign a shortcut'],['clear','Remove shortcut']])shortcutMode.append(new Option(text,value));shortcutMode.value='keep';modeLabel.append(shortcutMode);form.append(modeLabel);
    const keyLabel=document.createElement('label'),shortcutKey=document.createElement('select');keyLabel.className='field';keyLabel.textContent='Native shortcut key';shortcutKey.setAttribute('data-preset-shortcut-key','');shortcutKey.append(new Option('Choose a native key',''));shortcutKey.value='';keyLabel.append(shortcutKey);form.append(keyLabel);
    const modifierGroup=document.createElement('fieldset'),modifierLegend=document.createElement('legend');modifierLegend.textContent='Shortcut modifiers';modifierGroup.append(modifierLegend);const modifierChecks=['Ctrl','Shift','Alt'].map(value=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=value;input.setAttribute('data-preset-shortcut-modifier',value);label.append(input,value);modifierGroup.append(label);return input;});form.append(modifierGroup);
    const shortcutDetail=document.createElement('p');shortcutDetail.setAttribute('role','status');shortcutDetail.setAttribute('data-preset-shortcut-status','');form.append(shortcutDetail);
    const activationNote=document.createElement('p');activationNote.className='muted';activationNote.textContent='Saving a desktop shortcut does not enable it in this browser. Browser activation uses the separate Enable action and supports Ctrl+Alt+Shift with allowed letters.';form.append(activationNote);
    let shortcutCatalog=null,shortcutMessage='Reading native shortcut keys · Keep and Remove remain available';
    const note=document.createElement('p');note.className='muted';note.textContent='Keyframe timing, fps and pixel values are adapted to each destination clip. Applying a preset is one Undo. Saving or editing the library does not edit the timeline.';form.append(note);
    const detail=document.createElement('p');detail.setAttribute('role','status');form.append(detail);
    const cancel=button('Cancel preset settings',()=>{if(!busy)ownedDialog.close();}),save=document.createElement('button');save.textContent=item?'Save preset changes':'Save selection as new preset';form.append(save,cancel);ownedDialog.append(form);document.body.append(ownedDialog);bound=boundContext;
    const updateSettings=()=>{const stale=!settingsCurrent();let shortcutError=null,shortcutEdit=null;try{shortcutEdit=presetShortcutEdit(shortcutMode.value,shortcutKey.value,modifierChecks.filter(input=>input.checked).map(input=>input.value),shortcutCatalog);}catch(error){shortcutError=error;}
      save.disabled=busy || !canCommit() || stale || Boolean(shortcutError);cancel.disabled=busy;shortcutMode.disabled=busy;shortcutKey.disabled=busy || shortcutMode.value!=='set' || !shortcutCatalog;for(const input of modifierChecks)input.disabled=shortcutKey.disabled;
      shortcutDetail.textContent=shortcutError?`${shortcutError.message} · Keep or Remove remains available`:shortcutEdit.shortcut?.action==='set'?`Assign desktop shortcut: ${shortcutEdit.shortcut.value} · browser activation remains separate`:shortcutMode.value==='clear'?'The desktop shortcut will be removed when these settings are saved':shortcutMessage;if(stale)detail.textContent='The source selection, session or saved preset changed. Cancel and reopen; settings are retained here.';
    };dialogControls=updateSettings;
    for(const control of [shortcutMode,shortcutKey,...modifierChecks])control.addEventListener('change',updateSettings);
    ownedDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});ownedDialog.addEventListener('close',()=>{if(dialog!==ownedDialog)return;settingsSequence++;shortcutController?.abort();shortcutController=null;dialogControls=null;bound=null;});ownedDialog.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();updateSettings();if(save.disabled || !settingsCurrent() || !form.reportValidity())return;
      try{
        const options={...presetOptions(name.value,checks.filter(input=>input.checked && !input.disabled).map(input=>input.value),anchor.value,append.checked),...presetShortcutEdit(shortcutMode.value,shortcutKey.value,modifierChecks.filter(input=>input.checked).map(input=>input.value),shortcutCatalog)};
        const operation=item?{kind:'edit_preset_library',edit:{action:'update',id:itemID,revision:itemRevision,options}}:{kind:'save_attribute_preset',clip_ids:[...boundContext.clip_ids],options};
        await write(operation,Boolean(item));ownedDialog.close();
      }catch(error){detail.textContent=`${error.message} · settings retained`;}
    });
    ownedDialog.showModal();updateSettings();name.focus();shortcutController=new AbortController();const signal=shortcutController.signal;
    void (async()=>{try{const result=await api('/presets/shortcuts',undefined,{signal});if(signal.aborted || token!==settingsSequence || !settingsCurrent())return;shortcutCatalog=presetShortcutCatalog(result);shortcutKey.replaceChildren(new Option('Choose a native key',''),...shortcutCatalog.keys.map(key=>new Option(key,key)));shortcutKey.value='';shortcutMessage='Choose a native key and modifiers to assign; Keep preserves all imported shortcut metadata';}
      catch(error){if(signal.aborted || token!==settingsSequence || !settingsCurrent())return;shortcutMessage=`Native shortcut keys unavailable · ${error.message} · Keep and Remove remain available`;}
      finally{if(!signal.aborted && token===settingsSequence && settingsCurrent())updateSettings();}})();
  }
  async function changeArchive(){if(!selected?.revision)return;const item=selected;try{await write({kind:'edit_preset_library',edit:{action:item.archived?'restore':'archive',id:item.id,revision:item.revision}});}catch{}}
  return {
    async open(){
      this.hide();active=true;section=document.createElement('section');section.className='saved-presets';section.setAttribute('aria-label','Saved attribute presets');
      const heading=document.createElement('h3');heading.textContent='Saved attribute presets';const note=document.createElement('p');note.className='muted';note.textContent='This library is shared by projects using the configured preset folder. Import and export use desktop preset JSON.';section.append(heading,note);
      const searchForm=document.createElement('form'),searchLabel=document.createElement('label'),searchInput=document.createElement('input');searchLabel.className='field';searchLabel.textContent='Search saved presets';searchInput.type='search';searchInput.value=search;searchLabel.append(searchInput);const submit=document.createElement('button');submit.textContent='Search presets';searchForm.append(searchLabel,submit);searchForm.addEventListener('submit',event=>{event.preventDefault();if(busy)return;search=searchInput.value;reload(0);});section.append(searchForm);
      const archivedLabel=document.createElement('label'),archivedInput=document.createElement('input');archivedInput.type='checkbox';archivedInput.checked=archived;archivedLabel.append(archivedInput,' Show archived presets');archivedInput.addEventListener('change',()=>{if(busy)return;archived=archivedInput.checked;reload(0);});section.append(archivedLabel);
      list=document.createElement('select');list.size=7;list.setAttribute('aria-label','Saved presets');list.title='Double-click or press Enter to apply to the selected clips';const ownedList=list;list.addEventListener('dblclick',event=>activateList(event,ownedList));list.addEventListener('keydown',event=>activateList(event,ownedList));section.append(list);status=document.createElement('p');status.className='muted';status.setAttribute('role','status');section.append(status);
      previous=button('Previous presets',()=>reload(page-1,selected?.id,-1));next=button('Next presets',()=>reload(page+1));const refresh=button('Refresh presets',()=>reload());navigation=[searchInput,submit,archivedInput,refresh];section.append(previous,next,refresh);
      caption=document.createElement('p');caption.className='muted';section.append(caption);
      apply=button('Apply preset to selected clips',()=>void applySelected(ownedList));
      dragButton=button('Drag selected preset',()=>{});dragButton.setAttribute('data-preset-drag','');dragButton.addEventListener('dragstart',startDrag);dragButton.addEventListener('dragend',event=>{if(dragTicket?.button===event.currentTarget)endDrag();});const dragNote=document.createElement('p');dragNote.className='muted';dragNote.textContent='Drop on a selected clip to apply to the selection; otherwise apply to the target clip. Linked clips follow native preset rules. You can also select clips and use Apply.';section.append(dragButton,dragNote);
      edit=button('Edit preset settings',()=>openSettings(selected));archive=button('Archive preset',changeArchive);restorePrevious=button('Restore previous preset settings',async()=>{try{await write({kind:'edit_preset_library',edit:{action:'restore_previous',id:selected.id,revision:selected.revision}});}catch{}});deleteButton=button('Permanently delete saved preset…',()=>openDeletion(ownedList));const actions=document.createElement('details'),actionsHeading=document.createElement('summary');actionsHeading.textContent='Preset actions';actions.append(actionsHeading,edit,archive,restorePrevious,deleteButton);section.append(apply,actions);
      if(shortcuts){
        shortcutToggle=button('Enable preset shortcut',()=>{
          if(busy || !selected)return;
          try{if(shortcuts.state(selected).enabled)shortcuts.deactivate(selected.id);else shortcuts.activate(selected);controls();}
          catch(error){shortcutStatus.textContent=error.message;notice(error.message);}
        });
        shortcutStatus=document.createElement('p');shortcutStatus.className='muted';shortcutStatus.setAttribute('role','status');section.append(shortcutToggle,shortcutStatus);
      }
      download=document.createElement('a');download.textContent='Download desktop preset JSON';saveSelection=button('Save selection as preset',()=>openSettings());actions.append(download);section.append(saveSelection);
      const importLabel=document.createElement('label'),file=document.createElement('input');importFile=file;importLabel.className='field';importLabel.textContent='Import desktop preset JSON';file.type='file';file.accept='.json,application/json';importLabel.append(file);section.append(importLabel);file.addEventListener('change',async()=>{const chosen=file.files?.[0];if(!chosen)return;try{if(chosen.size>4*1024*1024)throw Error('Choose a native preset within 4 MiB');const text=await chosen.text();if(!active)return;await write(presetImportOperation(text));file.value='';}catch(error){message(error.message);}});
      section.addEventListener('keydown',event=>{
        if(!['Delete','Backspace'].includes(event.key))return;event.stopPropagation();
        if(event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph') || event.target!==ownedList && !Array.from(ownedList.children).includes(event.target))return;
        event.preventDefault();openDeletion(ownedList);
      });root.append(section);controls();await reload(page);
    },
    saveSelection(captured){if(!active || busy || !canCommit())return false;openSettings(null,presetCaptureContext(getContext(),captured));return true;},
    invalidate(){shortcuts?.sync();const epoch=getContext()?.epoch;if(active && section?.isConnected && !busy && typeof epoch==='string' && epoch && epoch!==readEpochAttempt)void reload(page,selected?.id);controls();},
    hide(){closeDeletion(false);endDrag();active=false;loading=false;loadedEpoch=null;readEpochAttempt=null;sequence++;controller?.abort();controller=null;settingsSequence++;shortcutController?.abort();shortcutController=null;if(!busy){dialog?.remove();dialog=null;dialogControls=null;bound=null;}},
  };
}
