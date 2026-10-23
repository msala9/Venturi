const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const scope=query=>query && typeof query.project_epoch==='string' && typeof query.timeline_id==='string'?JSON.stringify([query.project_epoch,query.timeline_id]):null;
const identity=query=>JSON.stringify([scope(query),query?.if_generation,query?.revision]);

export function insertMoveTarget(from,slot,length){
  if(!Number.isInteger(from) || from<0 || from>=length || !Number.isInteger(slot) || slot<0 || slot>length)return null;
  const to=slot>from?slot-1:slot;
  return to===from?null:to;
}
export function editMixerEffects(effects,edit){
  if(!Array.isArray(effects) || effects.length>32 || !edit)return null;
  const order=effects.map((_,index)=>index),next=[...effects],valid=index=>Number.isInteger(index) && index>=0 && index<effects.length;
  if(edit.kind==='move'){
    if(!valid(edit.from) || !valid(edit.to) || edit.from===edit.to)return null;
    order.splice(edit.to,0,...order.splice(edit.from,1));next.splice(edit.to,0,...next.splice(edit.from,1));
  }else if(edit.kind==='remove'){
    if(!valid(edit.index))return null;order.splice(edit.index,1);next.splice(edit.index,1);
  }else if(edit.kind==='toggle'){
    if(!valid(edit.index))return null;next[edit.index]={...effects[edit.index],enabled:!effects[edit.index].enabled};
  }else if(edit.kind==='add'){
    if(effects.length>=32 || !edit.effect)return null;order.push(null);next.push(structuredClone(edit.effect));
  }else return null;
  return {effects:next,indices:effects.map((_,index)=>{const to=order.indexOf(index);return to<0?null:to;})};
}
export function remapMixerPaths(paths,channel,indices){
  const prefix=`${channel}:effects:`,next=new Set();
  for(const path of paths){
    if(!path.startsWith(prefix)){next.add(path);continue;}
    const match=/^(0|[1-9][0-9]*)(:.*)?$/.exec(path.slice(prefix.length)),index=match?Number(match[1]):-1;
    if(indices[index]!==undefined && indices[index]!==null)next.add(`${prefix}${indices[index]}${match[2] || ''}`);
  }
  paths.clear();for(const path of next)paths.add(path);
}
export function createMixerEditorState(paths=new Set()){
  let context=null,currentIdentity=null,pending=null,discard=false,previousChannels=new Map();
  const closeChannel=channel=>{for(const path of paths)if(path.startsWith(`${channel}:effects:`))paths.delete(path);};
  const changedOrder=(before,after)=>{
    if(before.length!==after.length)return true;
    const kind=effect=>typeof effect.kind==='string'?effect.kind:Object.keys(effect.kind)[0];
    if(before.some((effect,index)=>kind(effect)!==kind(after[index])))return true;
    return !same(before,after) && same(before.map(effect=>JSON.stringify(effect)).sort(),after.map(effect=>JSON.stringify(effect)).sort());
  };
  return {
    paths,
    capture(query,nodes=[],channels=[]){
      const next=scope(query);
      const changed=currentIdentity!==identity(query),priorChannels=previousChannels;
      previousChannels=new Map(channels.map(channel=>[channel.channel,structuredClone(channel.effects)]));
      currentIdentity=identity(query);
      if(next!==context){context=next;pending=null;paths.clear();discard=false;return;}
      if(discard){paths.clear();discard=false;return;}
      for(const node of nodes){const path=node.dataset?.mixerPath;if(path){if(node.open)paths.add(path);else paths.delete(path);}}
      if(!pending){
        if(changed)for(const channel of channels){const before=priorChannels.get(channel.channel);if(before && changedOrder(before,channel.effects))closeChannel(channel.channel);}
        return;
      }
      const owner=pending;
      if(owner.failed){if(owner.unknown || identity(query)!==owner.identity)closeChannel(owner.channel);pending=null;return;}
      if(owner.receipt){
        const channel=channels.find(value=>value.channel===owner.channel);
        if(query.if_generation===owner.receipt.generation && same(channel?.effects,owner.effects))remapMixerPaths(paths,owner.channel,owner.indices);
        else closeChannel(owner.channel);
        pending=null;
      }else if(identity(query)!==owner.identity){closeChannel(owner.channel);pending=null;}
    },
    begin(query,channel,effects,edit){
      const plan=editMixerEffects(effects,edit);
      if(!plan || pending || !scope(query) || scope(query)!==context || identity(query)!==currentIdentity)return null;
      const owner={channel,identity:identity(query),query:{...query},effects:structuredClone(plan.effects),indices:plan.indices};pending=owner;
      return {
        effects:plan.effects,
        onReceipt(receipt,body){
          if(pending!==owner)return;
          if(receipt?.status!=='applied' || receipt.project_epoch!==owner.query.project_epoch || typeof receipt.generation!=='string' || receipt.command_id!==body?.command_id || body.project_epoch!==owner.query.project_epoch || body.if_generation!==owner.query.if_generation || body.if_revision!==owner.query.revision || body.operation?.kind!=='set_audio_effects' || body.operation.channel!==channel || !same(body.operation.effects,owner.effects)){
            owner.failed=true;owner.unknown=true;return;
          }
          owner.receipt=receipt;
        },
        onError(error){
          if(pending!==owner)return;
          owner.failed=true;owner.unknown=error?.code==='OUTCOME_UNKNOWN';
        },
      };
    },
    reset(){pending=null;paths.clear();discard=true;},
  };
}
export function notifyMixerMutation(callbacks,method,value,body){
  try{callbacks?.[method]?.(value,body);return true;}catch{return false;}
}

export function createMixerInsertStack({root,label,effects,slots=effects.length,catalog,canInteract,isCurrent=()=>true,getContext=()=>null,onOpen,onEdit,notice=()=>{},documentRef=globalThis.document,windowRef=globalThis.window}){
  root.className='mixer-insert-stack';
  const rows=[],listeners=[];let drag=null,menu=null,disposed=false,waiting=false,unknown=false;
  const listen=(node,type,fn,options)=>{node?.addEventListener?.(type,fn,options);listeners.push(()=>node?.removeEventListener?.(type,fn,options));};
  const buttonKey=event=>{if(['Enter',' '].includes(event.key)){event.stopPropagation();if(event.isComposing || event.keyCode===229)event.preventDefault();}};
  const owned=()=>!disposed && root.isConnected!==false && (root.getClientRects?.().length ?? 1)>0 && isCurrent() && !documentRef.hidden && !documentRef.querySelector?.('dialog[open]');
  const writable=()=>owned() && !waiting && !unknown && canInteract();
  const rectKey=()=>{const rect=root.getBoundingClientRect();return JSON.stringify([rect.left,rect.top,rect.width,rect.height]);};
  const clearDrag=()=>{drag=null;for(const row of rows)delete row.dataset.drop;};
  function closeMenu(focus=false){if(!menu)return;const owner=menu;menu=null;owner.element.remove();if(focus && owned() && owner.button?.isConnected!==false)owner.button.focus();}
  function sync(){for(const row of rows){row.draggable=writable();row.querySelector?.('.mixer-insert-actions')?.setAttribute('aria-disabled',String(!owned()));}}
  async function edit(action){
    closeMenu();clearDrag();if(!writable() || !editMixerEffects(effects,action))return;
    waiting=true;sync();
    try{await onEdit(action);}catch(error){if(error.code==='OUTCOME_UNKNOWN')unknown=true;notice(error.message);}finally{waiting=false;if(!disposed)sync();}
  }
  function openMenu(button,items,event){
    if(!owned())return;event?.preventDefault();event?.stopPropagation();closeMenu();clearDrag();
    const element=documentRef.createElement('div');element.className='mixer-insert-menu';element.setAttribute('role','menu');element.dataset.clipboardOwner='mixer';
    const bounds=button.getBoundingClientRect();element.style.left=`${Math.max(0,Math.min(event?.clientX || bounds.left,(windowRef?.innerWidth || 1280)-190))}px`;element.style.top=`${Math.max(0,Math.min(event?.clientY || bounds.bottom,(windowRef?.innerHeight || 720)-items.length*30))}px`;
    const context=getContext(),buttons=[];
    for(const item of items){const entry=documentRef.createElement('button');entry.type='button';entry.textContent=item.label;entry.setAttribute('role','menuitem');entry.disabled=Boolean(item.disabled);entry.addEventListener('click',()=>{if(menu?.element!==element || !owned() || context!==getContext() || entry.disabled)return;closeMenu();item.action();});element.append(entry);buttons.push(entry);}
    menu={element,button};documentRef.body.append(element);buttons.find(button=>!button.disabled)?.focus();
    element.addEventListener('keydown',event=>{
      if(event.ctrlKey || event.metaKey || event.altKey)return;event.stopPropagation();
      const enabled=buttons.filter(button=>!button.disabled),index=enabled.indexOf(documentRef.activeElement);
      if(event.key==='Escape'){event.preventDefault();closeMenu(true);return;}
      if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?enabled.length-1:(index+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;enabled[target]?.focus();}
      else if(event.key==='Tab')closeMenu();
    });
  }
  const kind=effect=>typeof effect.kind==='string'?effect.kind:Object.keys(effect.kind)[0];
  const actions=(index,button,event)=>openMenu(button,[
    {label:'Open settings',action:()=>onOpen(index)},
    {label:effects[index].enabled?'Disable':'Enable',disabled:!writable(),action:()=>void edit({kind:'toggle',index})},
    {label:'Move up',disabled:!writable() || index===0,action:()=>void edit({kind:'move',from:index,to:index-1})},
    {label:'Move down',disabled:!writable() || index===effects.length-1,action:()=>void edit({kind:'move',from:index,to:index+1})},
    {label:'Remove',disabled:!writable(),action:()=>void edit({kind:'remove',index})},
  ],event);
  for(let index=effects.length;index<slots;index++){const spacer=documentRef.createElement('div');spacer.className='mixer-insert-spacer';spacer.setAttribute('aria-hidden','true');root.append(spacer);}
  for(const [index,effect] of effects.entries()){
    const row=documentRef.createElement('div');row.className='mixer-insert-row';row.dataset.enabled=String(effect.enabled);row.dataset.insertIndex=String(index);
    const open=documentRef.createElement('button');open.type='button';open.className='mixer-insert-open';open.textContent=kind(effect);open.title=`${label} insert ${index+1} · ${kind(effect)}${effect.enabled?'':' · bypassed'}`;open.setAttribute('aria-label',open.title);
    open.addEventListener('click',()=>{if(owned() && !drag){closeMenu();onOpen(index);}});
    const more=documentRef.createElement('button');more.type='button';more.className='mixer-insert-actions';more.textContent='⋮';more.setAttribute('aria-label',`${label} insert ${index+1} actions`);more.addEventListener('click',event=>actions(index,more,event));row.append(open,more);root.append(row);rows.push(row);
    listen(open,'keydown',buttonKey);listen(more,'keydown',buttonKey);
    listen(row,'contextmenu',event=>actions(index,more,event));
    listen(row,'keydown',event=>{if(event.key==='ContextMenu' || event.key==='F10' && event.shiftKey)actions(index,more,event);});
    listen(row,'dragstart',event=>{
      if(!writable() || !event.dataTransfer){event.preventDefault();return;}
      event.stopPropagation();
      closeMenu();drag={index,context:getContext(),rect:rectKey()};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-venturi-audio-insert',String(index));
    });
    const destination=event=>{if(!drag || !writable() || drag.context!==getContext() || drag.rect!==rectKey()){clearDrag();return null;}const bounds=row.getBoundingClientRect();return index+Number(event.clientY>bounds.top+bounds.height/2);};
    listen(row,'dragover',event=>{const slot=destination(event);if(slot===null)return;event.preventDefault();event.stopPropagation();for(const peer of rows)delete peer.dataset.drop;row.dataset.drop=slot===index?'before':'after';if(event.dataTransfer)event.dataTransfer.dropEffect='move';});
    listen(row,'drop',event=>{const slot=destination(event),from=drag?.index;if(slot===null)return;event.preventDefault();event.stopPropagation();clearDrag();const to=insertMoveTarget(from,slot,effects.length);if(to!==null)void edit({kind:'move',from,to});});
    listen(row,'dragend',clearDrag);
  }
  const add=documentRef.createElement('button');add.type='button';add.className='mixer-insert-add';add.textContent='+';add.setAttribute('aria-label',`Add ${label} insert menu`);root.append(add);
  listen(add,'keydown',buttonKey);
  add.addEventListener('click',event=>openMenu(add,['Normalize','MultibandCompressor','Equalizer','Mono'].filter(name=>catalog?.defaults?.[name]).map(name=>({label:name,disabled:!writable() || effects.length>=32,action:()=>void edit({kind:'add',effect:catalog.defaults[name]})})),event));
  const cancel=()=>{clearDrag();closeMenu();};
  listen(documentRef,'pointerdown',event=>{if(drag)clearDrag();if(menu && !menu.element.contains(event.target) && !root.contains(event.target))closeMenu();},true);
  listen(documentRef,'keydown',event=>{if(event.key==='Escape' && (menu || drag)){event.preventDefault();event.stopPropagation();clearDrag();closeMenu(true);}},true);
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  listen(documentRef,'toggle',()=>{if(!owned())cancel();sync();},true);
  listen(windowRef,'blur',event=>{if(event.target===windowRef)cancel();});
  listen(windowRef,'resize',cancel);
  listen(windowRef,'scroll',event=>{if(menu && (event.target===menu.element || event.target?.nodeType && menu.element.contains(event.target)))return;cancel();},true);
  sync();return {cancel,sync,dispose(){cancel();disposed=true;for(const remove of listeners)remove();}};
}
