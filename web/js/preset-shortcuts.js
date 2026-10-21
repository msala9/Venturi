import {isTextTarget} from './ui.js';

const reserved = new Set(['C','K','Q','S','V','Z']);
const limit = 64;

export function presetShortcutBinding(shortcut){
  if(typeof shortcut!=='string' || shortcut.length>64)return {reason:'This preset has no supported desktop shortcut'};
  const parts=shortcut.split('+'),key=parts.pop(),modifiers=new Set(parts);
  if(!/^[A-Z]$/.test(key || '') || modifiers.size!==parts.length || parts.some(part=>!['Ctrl','Alt','Shift'].includes(part)))return {reason:'Web activation supports Ctrl+Alt+Shift with a letter; the desktop shortcut is preserved'};
  if(!['Ctrl','Alt','Shift'].every(part=>modifiers.has(part)))return {reason:'Web activation requires Ctrl+Alt+Shift to avoid browser and editor commands'};
  if(reserved.has(key))return {reason:`${key} conflicts with an editor or system command; the desktop shortcut is preserved`};
  return {key,label:`Ctrl+Alt+Shift+${key}`};
}

export function presetShortcutMatches(event,binding){
  return Boolean(binding.key && !event.repeat && !event.isComposing && event.keyCode!==229 && !event.getModifierState?.('AltGraph') &&
    (Boolean(event.ctrlKey)!==Boolean(event.metaKey)) && event.altKey && event.shiftKey && event.key?.toUpperCase()===binding.key);
}

export function createPresetShortcuts({getContext,canCommit,commit,notice,document:documentRef=globalThis.document}){
  const entries=new Map();let epoch=null,busy=false,disposed=false;
  function sync(){const next=getContext()?.epoch ?? null;if(next!==epoch){entries.clear();epoch=next;}}
  function state(item){
    sync();const binding=presetShortcutBinding(item?.shortcut),entry=entries.get(item?.id);
    if(!item || item.error || item.archived || typeof item.id!=='string' || typeof item.revision!=='string'){entries.delete(item?.id);return {enabled:false,reason:'Choose a valid active saved preset'};}
    if(binding.reason){entries.delete(item.id);return {enabled:false,...binding};}
    if(entry && entry.revision!==item.revision){entries.delete(item.id);return {enabled:false,...binding,reason:'Preset settings changed; enable the shortcut again'};}
    return {enabled:Boolean(entry),...binding};
  }
  function activate(item){
    const info=state(item);if(disposed)throw Error('Preset shortcuts are closed');if(info.reason)throw Error(info.reason);
    if(!epoch)throw Error('Connect to a native session before enabling a shortcut');
    if(!canCommit())throw Error('A writable idle session is required to enable a preset shortcut');
    const duplicate=[...entries.values()].find(entry=>entry.key===info.key && entry.id!==item.id);
    if(duplicate)throw Error(`This shortcut is already enabled for ${duplicate.name}; disable it first`);
    if(!entries.has(item.id) && entries.size>=limit)throw Error(`At most ${limit} preset shortcuts can be enabled in this browser session`);
    entries.set(item.id,{id:item.id,revision:item.revision,key:info.key,name:item.name || item.id});
    return state(item);
  }
  function keydown(event){
    sync();if(disposed || busy || event.defaultPrevented || event.target?.isContentEditable || isTextTarget(event.target) || documentRef.querySelector?.('dialog[open]') || !canCommit())return;
    const context=getContext();if(!context?.clip_ids?.length)return;
    const entry=[...entries.values()].find(candidate=>presetShortcutMatches(event,candidate));if(!entry)return;
    event.preventDefault();event.stopImmediatePropagation();busy=true;
    const operation={kind:'apply_saved_preset',clip_ids:[...context.clip_ids],preset_id:entry.id,revision:entry.revision};
    const rejected=error=>{
      if(epoch===context.epoch && entries.get(entry.id)===entry)entries.delete(entry.id);
      notice(`${error.message} · preset shortcut disabled; refresh the preset before enabling it again`);
    };
    try{Promise.resolve(commit(operation)).catch(rejected).finally(()=>{busy=false;});}
    catch(error){rejected(error);busy=false;}
  }
  documentRef.addEventListener('keydown',keydown,true);
  return {state,activate,sync,deactivate(id){entries.delete(id);},dispose(){disposed=true;entries.clear();documentRef.removeEventListener('keydown',keydown,true);}};
}
