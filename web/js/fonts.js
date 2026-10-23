const fallbackFaces=Object.freeze([{weight:400,italic:false,name:'Regular'},{weight:700,italic:false,name:'Bold'},{weight:400,italic:true,name:'Italic'},{weight:700,italic:true,name:'Bold Italic'}].map(Object.freeze));
const faceKey=face=>`${face.weight}:${Number(face.italic)}`;
export function selectableFontFamily(family){return typeof family==='string' && new TextEncoder().encode(family).length<=128 && !/\p{Cc}/u.test(family);}
export function validateFontCatalog(value){
  if(!Array.isArray(value?.families) || !value.families.length || value.families.length>4096)throw Error('Invalid server font catalog');
  const seen=new Set(),families=value.families.map(entry=>{
    if(typeof entry?.family!=='string' || entry.family.length>4096 || typeof entry.name!=='string' || !entry.name || entry.name.length>4096 || seen.has(entry.family) || !Array.isArray(entry.faces) || entry.faces.length>256)throw Error('Invalid server font family');
    seen.add(entry.family);const facesSeen=new Set();
    const faces=entry.faces.map(face=>{
      if(!Number.isInteger(face?.weight) || face.weight<0 || face.weight>65535 || typeof face.italic!=='boolean' || typeof face.name!=='string' || !face.name || face.name.length>512 || facesSeen.has(faceKey(face)))throw Error('Invalid server font style');
      facesSeen.add(faceKey(face));return Object.freeze({weight:face.weight,italic:face.italic,name:face.name});
    });
    return Object.freeze({family:entry.family,name:entry.name,faces:Object.freeze(faces)});
  });
  if(!seen.has(''))throw Error('Server font catalog is missing Sans-serif');
  return Object.freeze({families:Object.freeze(families)});
}
export function createFontCatalogReader(load){
  let cached=null,pending=null;
  return function read({signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason ?? new DOMException('Canceled','AbortError'));
    const shared=cached?Promise.resolve(cached):(pending ??=Promise.resolve().then(load).then(value=>{cached=validateFontCatalog(value);return cached;}).finally(()=>{pending=null;}));
    if(!signal)return shared;
    return new Promise((resolve,reject)=>{
      const aborted=()=>{signal.removeEventListener('abort',aborted);reject(signal.reason ?? new DOMException('Canceled','AbortError'));};
      signal.addEventListener('abort',aborted,{once:true});
      shared.then(value=>{signal.removeEventListener('abort',aborted);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',aborted);if(!signal.aborted)reject(error);});
    });
  };
}
export function fontFamilyChoices(catalog,current){
  const choices=catalog.families.map(entry=>({value:entry.family,label:entry.name+(selectableFontFamily(entry.family)?'':' · unavailable for editing'),disabled:!selectableFontFamily(entry.family)}));
  if(!choices.some(choice=>choice.value===current))choices.push({value:current,label:`Current: ${current || 'Sans-serif'} · not installed`,disabled:true});
  return choices;
}
export function fontFaceChoices(catalog,family,current){
  const faces=catalog.families.find(entry=>entry.family===family)?.faces;
  const choices=(faces?.length?faces:fallbackFaces).map(face=>({value:faceKey(face),label:face.name,face,disabled:false}));
  if(!choices.some(choice=>choice.value===faceKey(current)))choices.push({value:faceKey(current),label:`Current: ${current.weight}${current.italic?' italic':' normal'} · not in server styles`,face:current,disabled:true});
  return choices;
}
let fontChooserSequence=0;
export function createTitleFontChooser({root,group,title,readFonts,register=node=>node,sync=()=>{},isCurrent=()=>true,canInteract=isCurrent,onFamily,onFace,onPreview=null,schedule=setTimeout,unschedule=clearTimeout}){
  const doc=root.ownerDocument ?? document,view=doc.defaultView ?? globalThis,prefix=`font-chooser-${++fontChooserSequence}`,listeners=[];
  let catalog=null,loading=false,attempted=false,disposed=false,committing=false,sequence=0,previewSequence=0,controller=null,popup=null,draft=null,previewTimer=null,wheelTimer=null,previewSent=false,searchText='',searchAt=0;
  const connected=()=>!disposed && group.open && root.isConnected!==false && group.isConnected!==false && isCurrent();
  const available=()=>connected() && !loading && !committing && !!catalog && canInteract();
  const listen=(target,event,handler,options)=>{target?.addEventListener?.(event,handler,options);listeners.push(()=>target?.removeEventListener?.(event,handler,options));};
  const row=label=>{const field=doc.createElement('label'),button=register(doc.createElement('button'),available);field.className='field';field.textContent=label;button.type='button';button.className='font-combobox';button.setAttribute('role','combobox');button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');field.append(button);root.append(field);return button;};
  const family=row('Server font family'),face=row('Server font style'),status=doc.createElement('p');status.className='muted font-chooser-status';status.setAttribute('role','status');root.append(status);
  const retry=register(doc.createElement('button'),()=>connected() && !loading && !catalog);retry.type='button';retry.textContent='Retry server fonts';retry.setAttribute('aria-label','Retry server fonts');retry.hidden=true;root.append(retry);
  let familyOptions=[],faceOptions=[];
  const choices=kind=>kind==='family'?familyOptions:faceOptions;
  const control=kind=>kind==='family'?family:face;
  const current=kind=>kind==='family'?title.font_family:faceKey({weight:title.font_weight,italic:title.italic});
  const patch=(kind,choice)=>kind==='family'?{font_family:choice.value}:{font_weight:choice.face.weight,italic:choice.face.italic};
  const plain=event=>!event.defaultPrevented && !event.repeat && !event.isComposing && event.keyCode!==229 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.getModifierState?.('AltGraph');
  function reportPreview(value,owner){
    const id=++previewSequence;try{Promise.resolve(onPreview?.(value)).catch(error=>{if(!disposed && id===previewSequence && draft===owner)status.textContent=`Font preview unavailable · ${error.message}`;});}catch(error){if(!disposed && id===previewSequence && draft===owner)status.textContent=`Font preview unavailable · ${error.message}`;}
  }
  function clearTimers(){if(previewTimer!==null)unschedule(previewTimer);if(wheelTimer!==null)unschedule(wheelTimer);previewTimer=wheelTimer=null;}
  function paint(){
    familyOptions=catalog?fontFamilyChoices(catalog,title.font_family):[{value:title.font_family,label:`Current: ${title.font_family || 'Sans-serif'}`,disabled:true}];
    faceOptions=catalog?fontFaceChoices(catalog,title.font_family,{weight:title.font_weight,italic:title.italic}):[{value:current('face'),label:`Current: ${title.font_weight}${title.italic?' italic':' normal'}`,disabled:true}];
    for(const kind of ['family','face']){const button=control(kind),value=draft?.kind===kind?choices(kind)[draft.index]?.value:current(kind);button.value=value;button.textContent=choices(kind).find(choice=>choice.value===value)?.label || String(value);button.disabled=!available();button.setAttribute('aria-expanded',String(popup?.kind===kind));if(popup?.kind!==kind)button.removeAttribute?.('aria-activedescendant');}
    sync();
  }
  function cancel(restore=false){
    const old=popup,hadDraft=Boolean(draft || previewSent);clearTimers();popup=null;draft=null;previewSent=false;searchText='';searchAt=0;
    if(old){try{old.node.hidePopover?.();}catch{}old.node.remove();control(old.kind).removeAttribute?.('aria-controls');}
    if(hadDraft)reportPreview(null,null);paint();if(restore && old && connected())control(old.kind).focus?.();
  }
  function draftCurrent(owner){return draft===owner && available() && (owner.mode==='wheel' || popup?.owner===owner);}
  function updateActive(){
    if(!popup || !draft)return;for(const [index,node] of popup.rows.entries()){node.setAttribute('aria-selected',String(index===draft.index));node.className=`font-option${index===draft.index?' is-active':''}`;}
    const node=popup.rows[draft.index];if(node){control(draft.kind).setAttribute('aria-activedescendant',node.id);node.scrollIntoView?.({block:'nearest'});}paint();
  }
  function preview(owner){
    if(previewTimer!==null)unschedule(previewTimer);previewTimer=schedule(()=>{previewTimer=null;if(!draftCurrent(owner)){if(draft===owner)cancel();return;}const choice=choices(owner.kind)[owner.index];if(choice && !choice.disabled && choice.value!==current(owner.kind)){previewSent=true;reportPreview(patch(owner.kind,choice),owner);}else if(previewSent){previewSent=false;reportPreview(null,owner);}},130);
  }
  function select(index){
    if(!draft || !available() || !choices(draft.kind)[index] || choices(draft.kind)[index].disabled)return;if(draft.index!==index && previewSent){previewSent=false;reportPreview(null,draft);}draft.index=index;updateActive();preview(draft);
  }
  function step(kind,index,direction){for(let next=index+direction;next>=0 && next<choices(kind).length;next+=direction)if(!choices(kind)[next].disabled)return next;return index;}
  function position(node,button){
    const bounds=button.getBoundingClientRect?.() ?? {left:0,bottom:0,width:240},width=Math.min(Math.max(160,bounds.width),Math.max(160,(view.innerWidth ?? 1024)-16)),height=Math.min(320,Math.max(40,node.children.length*28+8),Math.max(40,(view.innerHeight ?? 768)-16)),left=Math.max(8,Math.min(bounds.left,(view.innerWidth ?? 1024)-width-8)),top=Math.max(8,Math.min(bounds.bottom+3,(view.innerHeight ?? 768)-height-8));
    for(const [name,value] of Object.entries({left:`${left}px`,top:`${top}px`,width:`${width}px`,'max-height':`${height}px`}))node.style?.setProperty?.(name,value);
  }
  function open(kind){
    if(!available())return;cancel();const button=control(kind),node=doc.createElement('div'),owner={kind,index:Math.max(0,choices(kind).findIndex(choice=>choice.value===current(kind))),mode:'popup'},rows=[];
    node.id=`${prefix}-${kind}`;node.className='font-listbox';node.setAttribute('role','listbox');node.setAttribute('aria-label',kind==='family'?'Server font family choices':'Server font style choices');node.setAttribute('popover','manual');draft=owner;popup={kind,node,rows,owner};
    choices(kind).forEach((choice,index)=>{const row=doc.createElement('div');row.id=`${node.id}-${index}`;row.textContent=choice.label;row.setAttribute('role','option');row.setAttribute('aria-disabled',String(Boolean(choice.disabled)));row.addEventListener('pointerenter',()=>{if(popup?.owner===owner)select(index);});row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',event=>{if(!plain(event) || popup?.owner!==owner || !available() || choice.disabled)return;event.preventDefault();event.stopPropagation();void confirm(kind,index,owner);});rows.push(row);node.append(row);});
    (doc.body ?? root).append(node);button.setAttribute('aria-controls',node.id);position(node,button);try{node.showPopover?.();}catch{}updateActive();button.focus?.();
  }
  async function confirm(kind,index,owner=draft){
    if(!owner || !draftCurrent(owner))return;const choice=choices(kind)[index];if(!choice || choice.disabled)return;const changed=choice.value!==current(kind);cancel();if(!changed)return;committing=true;paint();
    try{await (kind==='family'?onFamily(choice.value):onFace(choice.face));}catch(error){if(connected())status.textContent=`Font change failed · ${error.message}`;}finally{committing=false;if(!disposed)paint();}
  }
  function keyboard(event,kind){
    event.stopPropagation();if(event.key==='Tab'){cancel();return;}if(event.key==='Escape'){if(popup || draft){event.preventDefault();cancel(true);}return;}if(!plain(event)){if(['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key))event.preventDefault();return;}
    if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){event.preventDefault();if(!available()){cancel();return;}if(event.key==='Enter' || event.key===' '){if(popup?.kind===kind)void confirm(kind,draft.index);else open(kind);return;}if(popup?.kind!==kind)open(kind);if(!draft)return;
      let index=draft.index;if(event.key==='Home')index=choices(kind).findIndex(choice=>!choice.disabled);else if(event.key==='End')index=choices(kind).findLastIndex(choice=>!choice.disabled);else index=step(kind,index,event.key==='ArrowDown'?1:-1);select(index);
    }
    else if(event.key?.length===1){event.preventDefault();if(!available()){cancel();return;}if(popup?.kind!==kind)open(kind);if(!draft)return;const now=event.timeStamp,letter=event.key.toLocaleLowerCase();searchText=now-searchAt>700?letter:searchText+letter;searchAt=now;if([...searchText].every(char=>char===letter))searchText=letter;const items=choices(kind);for(let offset=1;offset<=items.length;offset++){const index=(draft.index+offset)%items.length;if(!items[index].disabled && items[index].label.toLocaleLowerCase().startsWith(searchText)){select(index);break;}}}
  }
  function wheel(event,kind){
    if(popup || !plain(event) || !Number.isFinite(event.deltaY) || !event.deltaY || !available())return;event.preventDefault();event.stopPropagation();
    if(draft?.kind!==kind || draft.mode!=='wheel'){cancel();draft={kind,index:Math.max(0,choices(kind).findIndex(choice=>!choice.disabled && choice.value===current(kind))),mode:'wheel'};}
    const owner=draft,index=step(kind,owner.index,Math.sign(event.deltaY));if(choices(kind)[index]?.value===current(kind)){cancel();return;}if(index!==owner.index && previewSent){previewSent=false;reportPreview(null,owner);}owner.index=index;paint();preview(owner);if(wheelTimer!==null)unschedule(wheelTimer);wheelTimer=schedule(()=>{wheelTimer=null;if(draftCurrent(owner))void confirm(kind,owner.index,owner);else if(draft===owner)cancel();},150);
  }
  async function load(){
    if(!connected() || loading || catalog)return;attempted=true;loading=true;retry.hidden=true;status.textContent='Reading fonts installed on the server…';const owner=new AbortController(),seq=++sequence;controller=owner;paint();
    try{if(typeof readFonts!=='function')throw Error('Server font catalog is unavailable');const result=await readFonts({signal:owner.signal});if(controller!==owner || seq!==sequence || !connected())return;catalog=validateFontCatalog(result);status.textContent=onPreview?'Server-rendered font preview · click or Enter confirms; Escape, Tab or outside click cancels':'Fonts installed on the server · choices apply when confirmed';}
    catch(error){if(controller===owner && seq===sequence && connected() && error.name!=='AbortError'){status.textContent=`${error.message} · manual font entry is available below`;retry.hidden=false;}}
    finally{if(controller===owner){controller=null;loading=false;paint();}}
  }
  function close(){cancel();if(controller){sequence++;controller.abort();controller=null;loading=false;attempted=false;}if(!disposed)paint();}
  const inside=target=>target===family || target===face || Boolean(popup?.node.contains?.(target));
  for(const kind of ['family','face']){const button=control(kind);listen(button,'click',event=>{if(!plain(event))return;if(popup?.kind===kind)cancel();else open(kind);});listen(button,'keydown',event=>keyboard(event,kind));listen(button,'wheel',event=>wheel(event,kind),{passive:false});}
  listen(retry,'click',()=>{if(connected())void load();});listen(group,'toggle',()=>{if(!group.open)close();else if(!attempted && !catalog)void load();else paint();});
  listen(doc,'pointerdown',event=>{if((popup || draft) && !inside(event.target))cancel();},true);listen(doc,'focusin',event=>{if((popup || draft) && !inside(event.target))cancel();});listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel();});listen(view,'blur',()=>cancel());listen(view,'resize',()=>cancel());listen(doc,'scroll',event=>{if((popup || draft) && !popup?.node.contains?.(event.target))cancel();},true);
  status.textContent='Open this section to read server fonts';paint();if(group.open)void load();
  return {cancel:()=>cancel(),dispose(){if(disposed)return;close();disposed=true;for(const remove of listeners)remove();}};
}
