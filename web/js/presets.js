import {request} from './api.js';
import {attributeGroups} from './attributes.js';

export function presetSelectionIdentity(context){return context?JSON.stringify([context.epoch,context.generation,context.timeline,context.revision,[...context.clip_ids].sort()]):null;}
export function presetAttributeAllowed(attribute,roles){return attribute==='volume'?roles.audio:['fades','speed'].includes(attribute)?roles.video || roles.audio:roles.video;}
export function presetOptions(name,attributes,anchor,appendFilters){
  name=name.trim();
  if(!name || new TextEncoder().encode(name).length>128 || /[\u0000-\u001f\u007f]/.test(name))throw Error('Choose a preset name within 128 UTF-8 bytes');
  if(!attributes.length || new Set(attributes).size!==attributes.length || attributes.some(value=>!attributeGroups.some(([key])=>key===value)))throw Error('Choose native preset property groups');
  if(!['start','end','stretch'].includes(anchor))throw Error('Choose a native keyframe anchor');
  return {name,attributes,anchor,append_filters:Boolean(appendFilters)};
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
export function createPresetPanel({root,getContext,canCommit,commit,libraryCommit,notice,shortcuts=null,api=(path,body,options)=>request(path,body,(url,init)=>fetch(url,{...init,signal:options?.signal?AbortSignal.any([init.signal,options.signal]):init.signal}))}){
  let active=false,sequence=0,controller=null,page=0,pages=1,search='',archived=false,busy=false,selected=null,section=null,list=null,status=null,previous=null,next=null,caption=null,apply=null,edit=null,archive=null,download=null,restorePrevious=null,saveSelection=null,importFile=null,dialog=null,bound=null,dialogControls=null,navigation=[],shortcutToggle=null,shortcutStatus=null;
  const button=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',action);return node;};
  const message=text=>{if(status?.isConnected)status.textContent=text;};
  function controls(){
    if(!active)return;const context=getContext(),writable=canCommit() && !busy,valid=selected && !selected.error;
    for(const control of navigation)control.disabled=busy;
    list.disabled=busy;previous.disabled=busy || page===0;next.disabled=busy || page+1>=pages;
    caption.textContent=selected?`${selected.name}${selected.archived?' · archived':''}`:'No saved preset selected';
    apply.disabled=!writable || !valid || selected.archived || !context?.clip_ids.length;
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
  }
  async function reload(wanted=page,preferred=selected?.id,direction=1,afterWrite=false){
    if(!active || busy && !afterWrite)return false;const context=getContext();if(!context){message('Connect to a native session to read saved presets');return false;}
    controller?.abort();controller=new AbortController();const token=++sequence;message('Reading saved presets…');
    try{
      let result,scan=wanted;
      while(true){
        result=await api(`/presets/pages/${scan}?${new URLSearchParams({project_epoch:context.epoch,search,archived:String(archived)})}`,undefined,{signal:controller.signal});
        if(!active || token!==sequence || context.epoch!==getContext()?.epoch)return false;
        const following=scan+direction;if(!search || result.items.length || following<0 || following>=result.pages)break;
        message(`Searching preset page ${scan+1} of ${result.pages}…`);scan=following;
      }
      page=result.page;pages=result.pages;list.replaceChildren(...result.items.map((item,index)=>new Option(`${item.name}${item.error?` · ${item.error}`:''}`,String(index))));
      const found=result.items.findIndex(item=>item.id===preferred),keepOutside=found<0 && selected?.id===preferred && selected.archived===archived,index=keepOutside?-1:Math.max(0,found);list.value=String(index);if(!keepOutside)selected=result.items[index] || null;
      list.onchange=()=>{selected=result.items[Number(list.value)] || null;controls();};
      message(`Page ${page+1} of ${result.pages} · ${result.total} ${archived?'archived':'saved'} presets${search?` · ${result.items.length} matches on this page`:''}`);controls();return true;
    }catch(error){if(active && token===sequence && error.name!=='AbortError'){if(wanted && error.message.includes('beyond the last page'))return reload(0,preferred,direction,afterWrite);message(error.message);}return false;}
  }
  async function write(operation,project=true){
    if(busy || !canCommit())return;busy=true;sequence++;controller?.abort();controller=null;controls();message('Updating preset library…');
    try{
      const {receipt,refreshError}=await presetMutationResult(()=>project?libraryCommit(operation):commit(operation),async receipt=>{
        if(operation.kind==='edit_preset_library' && operation.edit.id)shortcuts?.deactivate(operation.edit.id);
        if(!active)return;
        const created=operation.kind==='save_attribute_preset' || operation.kind==='edit_preset_library' && operation.edit.action==='import',id=created?receipt?.command_id:operation.preset_id || operation.edit?.id || selected?.id;
        selected=null;
        if(id && !(operation.kind==='edit_preset_library' && operation.edit.action==='archive'))selected=await api(`/presets/items/${encodeURIComponent(id)}?${new URLSearchParams({project_epoch:getContext().epoch})}`);
        if(!await reload(page,id,1,true))throw Error('The preset list could not be refreshed');
      });
      if(refreshError){selected=null;const text=`Command applied successfully · library refresh failed: ${refreshError.message}. Refresh presets to see the saved result; do not submit it again.`;message(text);notice(text);}
      return receipt;
    }
    catch(error){message(`${error.message} · refresh the library before retrying`);notice(error.message);throw error;}
    finally{busy=false;controls();}
  }
  function openSettings(item=null){
    const context=getContext();if(!canCommit() || busy || !item && !context?.clip_ids.length)return;
    dialog?.remove();dialog=document.createElement('dialog');dialog.className='preset-settings';const form=document.createElement('form'),heading=document.createElement('h2');heading.textContent=item?'Edit saved preset':'Save selected clips as preset';form.append(heading);
    const label=document.createElement('label');label.className='field';label.textContent='Preset name';const name=document.createElement('input');name.required=true;name.maxLength=128;name.value=item?.name || context.name || 'Preset';label.append(name);form.append(label);
    const groups=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Preset properties';groups.append(legend);const roles=item?{video:item.video,audio:item.audio}:context.roles;
    const defaults=item?.attributes || attributeGroups.filter(([key])=>presetAttributeAllowed(key,roles) && ['zoom','position','rotation','opacity','filters','volume'].includes(key)).map(([key])=>key);
    const checks=attributeGroups.map(([key,text])=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=defaults.includes(key);input.disabled=!presetAttributeAllowed(key,roles);label.append(input,text);groups.append(label);return input;});form.append(groups);
    const anchorLabel=document.createElement('label');anchorLabel.className='field';anchorLabel.textContent='Preset keyframe anchor';const anchor=document.createElement('select');for(const [value,text] of [['start','Start'],['end','End'],['stretch','Stretch to fit']])anchor.append(new Option(text,value));anchor.value=item?.anchor || 'start';anchorLabel.append(anchor);form.append(anchorLabel);
    const appendLabel=document.createElement('label'),append=document.createElement('input');append.type='checkbox';append.checked=Boolean(item?.append_filters);appendLabel.append(append,' Append filters instead of replacing');form.append(appendLabel);
    const note=document.createElement('p');note.className='muted';note.textContent='Keyframe timing, fps and pixel values are adapted to each destination clip. Applying a preset is one Undo. Saving or editing the library does not edit the timeline.';form.append(note);
    const detail=document.createElement('p');detail.setAttribute('role','status');form.append(detail);
    const cancel=button('Cancel preset settings',()=>{if(!busy)dialog.close();}),save=document.createElement('button');save.textContent=item?'Save preset changes':'Save selection as new preset';form.append(save,cancel);dialog.append(form);document.body.append(dialog);bound=context;
    dialogControls=()=>{const stale=!item && presetSelectionIdentity(bound)!==presetSelectionIdentity(getContext());save.disabled=busy || !canCommit() || stale;cancel.disabled=busy;if(stale)detail.textContent='The source selection changed. Cancel and reopen to capture the current clips; settings are retained here.';};
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{dialogControls=null;bound=null;});dialog.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(save.disabled || !form.reportValidity())return;
      try{
        const options=presetOptions(name.value,checks.filter(input=>input.checked && !input.disabled).map(input=>input.value),anchor.value,append.checked);
        const operation=item?{kind:'edit_preset_library',edit:{action:'update',id:item.id,revision:item.revision,options}}:{kind:'save_attribute_preset',clip_ids:[...bound.clip_ids],options};
        await write(operation,Boolean(item));dialog.close();
      }catch(error){detail.textContent=`${error.message} · settings retained`;}
    });
    dialog.showModal();dialogControls();name.focus();
  }
  async function changeArchive(){if(!selected?.revision)return;const item=selected;try{await write({kind:'edit_preset_library',edit:{action:item.archived?'restore':'archive',id:item.id,revision:item.revision}});}catch{}}
  return {
    async open(){
      this.hide();active=true;section=document.createElement('section');section.className='saved-presets';section.setAttribute('aria-label','Saved attribute presets');
      const heading=document.createElement('h3');heading.textContent='Saved attribute presets';const note=document.createElement('p');note.className='muted';note.textContent='This library is shared by projects using the configured preset folder. Import and export use desktop preset JSON.';section.append(heading,note);
      const searchForm=document.createElement('form'),searchLabel=document.createElement('label'),searchInput=document.createElement('input');searchLabel.className='field';searchLabel.textContent='Search saved presets';searchInput.type='search';searchInput.value=search;searchLabel.append(searchInput);const submit=document.createElement('button');submit.textContent='Search presets';searchForm.append(searchLabel,submit);searchForm.addEventListener('submit',event=>{event.preventDefault();if(busy)return;search=searchInput.value;reload(0);});section.append(searchForm);
      const archivedLabel=document.createElement('label'),archivedInput=document.createElement('input');archivedInput.type='checkbox';archivedInput.checked=archived;archivedLabel.append(archivedInput,' Show archived presets');archivedInput.addEventListener('change',()=>{if(busy)return;archived=archivedInput.checked;reload(0);});section.append(archivedLabel);
      list=document.createElement('select');list.size=7;list.setAttribute('aria-label','Saved presets');section.append(list);status=document.createElement('p');status.className='muted';status.setAttribute('role','status');section.append(status);
      previous=button('Previous presets',()=>reload(page-1,selected?.id,-1));next=button('Next presets',()=>reload(page+1));const refresh=button('Refresh presets',()=>reload());navigation=[searchInput,submit,archivedInput,refresh];section.append(previous,next,refresh);
      caption=document.createElement('p');caption.className='muted';section.append(caption);
      apply=button('Apply preset to selected clips',async()=>{if(!selected || !getContext()?.clip_ids.length)return;try{await write({kind:'apply_saved_preset',clip_ids:[...getContext().clip_ids],preset_id:selected.id,revision:selected.revision},false);}catch{}});
      edit=button('Edit preset settings',()=>openSettings(selected));archive=button('Archive preset',changeArchive);restorePrevious=button('Restore previous preset settings',async()=>{try{await write({kind:'edit_preset_library',edit:{action:'restore_previous',id:selected.id,revision:selected.revision}});}catch{}});section.append(apply,edit,archive,restorePrevious);
      if(shortcuts){
        shortcutToggle=button('Enable preset shortcut',()=>{
          if(busy || !selected)return;
          try{if(shortcuts.state(selected).enabled)shortcuts.deactivate(selected.id);else shortcuts.activate(selected);controls();}
          catch(error){shortcutStatus.textContent=error.message;notice(error.message);}
        });
        shortcutStatus=document.createElement('p');shortcutStatus.className='muted';shortcutStatus.setAttribute('role','status');section.append(shortcutToggle,shortcutStatus);
      }
      download=document.createElement('a');download.textContent='Download desktop preset JSON';saveSelection=button('Save selection as preset',()=>openSettings());section.append(download,saveSelection);
      const importLabel=document.createElement('label'),file=document.createElement('input');importFile=file;importLabel.className='field';importLabel.textContent='Import desktop preset JSON';file.type='file';file.accept='.json,application/json';importLabel.append(file);section.append(importLabel);file.addEventListener('change',async()=>{const chosen=file.files?.[0];if(!chosen)return;try{if(chosen.size>4*1024*1024)throw Error('Choose a native preset within 4 MiB');const text=await chosen.text();if(!active)return;await write(presetImportOperation(text));file.value='';}catch(error){message(error.message);}});
      section.addEventListener('keydown',event=>{if(['Delete','Backspace'].includes(event.key))event.stopPropagation();});root.append(section);controls();await reload(page);
    },
    invalidate(){shortcuts?.sync();controls();},
    hide(){active=false;sequence++;controller?.abort();controller=null;if(!busy){dialog?.remove();dialog=null;dialogControls=null;}},
  };
}
