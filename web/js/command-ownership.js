const owners=new Set(['media','library','timeline','keys']);

export function commandOwnerAt(target){
  const explicit=target?.closest?.('[data-command-owner]')?.dataset?.commandOwner;
  if(owners.has(explicit))return explicit;
  if(target?.closest?.('[data-key-editor-window],.curve-window'))return 'keys';
  if(target?.closest?.('.native-asset-panel'))return 'library';
  if(target?.closest?.('#media-list,.catalog-rows'))return 'media';
  if(target?.closest?.('#timeline-panel,#viewer,#inspector'))return 'timeline';
  return null;
}

export function createCommandOwnership(){
  let previous='timeline';
  return {
    note(target){previous=commandOwnerAt(target) || previous;return previous;},
    owner(target){return commandOwnerAt(target) || previous;},
    reset(owner='timeline'){previous=owners.has(owner)?owner:'timeline';return previous;},
  };
}

export function deleteCommandOwner(event,{owner='timeline',dialogOpen=false,keysOwnDelete=false}={}){
  if(!['Delete','Backspace'].includes(event?.key) || event.defaultPrevented || event.repeat
    || event.isComposing || event.keyCode===229 || event.getModifierState?.('AltGraph')
    || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || dialogOpen
    || event.target?.isContentEditable || event.target?.closest?.('input,textarea,select,dialog,video,audio')
    || event.target?.closest?.('[contenteditable]:not([contenteditable="false"])'))return null;
  if(owner==='keys')return keysOwnDelete?'keys':'timeline';
  return owners.has(owner)?owner:'timeline';
}

export function projectMediaDeleteOperation(ids){
  if(!Array.isArray(ids) || !ids.length || ids.length>256
    || ids.some(id=>typeof id!=='string' || !id) || new Set(ids).size!==ids.length)return null;
  return {kind:'edit_catalog',edit:{kind:'remove_media',media_ids:[...ids]}};
}
