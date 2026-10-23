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
export function createTitleFontChooser({root,group,title,readFonts,register=node=>node,sync=()=>{},isCurrent=()=>true,canInteract=isCurrent,onFamily,onFace}){
  let catalog=null,loading=false,attempted=false,disposed=false,sequence=0,controller=null;
  const connected=()=>!disposed && group.open && root.isConnected!==false && group.isConnected!==false && isCurrent();
  const available=()=>connected() && !loading && !!catalog && canInteract();
  const row=(label,available)=>{const field=document.createElement('label'),select=register(document.createElement('select'),available);field.className='field';field.textContent=label;select.setAttribute('aria-label',label);select.style?.setProperty?.('min-width','0');select.style?.setProperty?.('width','100%');field.append(select);root.append(field);return select;};
  const family=row('Server font family',available),face=row('Server font style',available),status=document.createElement('p');status.className='muted';status.setAttribute('role','status');root.append(status);
  const retry=register(document.createElement('button'),()=>connected() && !loading && !catalog);retry.type='button';retry.textContent='Retry server fonts';retry.setAttribute('aria-label','Retry server fonts');retry.hidden=true;root.append(retry);
  let familyOptions=[],faceOptions=[];
  function options(select,values,current){
    const nodes=values.map(value=>{const option=document.createElement('option');option.value=value.value;option.textContent=value.label;option.disabled=value.disabled;return option;});
    if(select.replaceChildren)select.replaceChildren(...nodes);else{select.textContent='';select.append(...nodes);}select.value=current;
  }
  function paint(){
    familyOptions=catalog?fontFamilyChoices(catalog,title.font_family):[{value:title.font_family,label:`Current: ${title.font_family || 'Sans-serif'}`,disabled:false}];
    faceOptions=catalog?fontFaceChoices(catalog,title.font_family,{weight:title.font_weight,italic:title.italic}):[{value:faceKey({weight:title.font_weight,italic:title.italic}),label:`Current: ${title.font_weight}${title.italic?' italic':' normal'}`,disabled:false}];
    options(family,familyOptions,title.font_family);options(face,faceOptions,faceKey({weight:title.font_weight,italic:title.italic}));sync();
  }
  async function load(){
    if(!connected() || loading || catalog)return;attempted=true;loading=true;retry.hidden=true;status.textContent='Reading fonts installed on the server…';const owner=new AbortController(),seq=++sequence;controller=owner;sync();
    try{
      if(typeof readFonts!=='function')throw Error('Server font catalog is unavailable');
      const result=await readFonts({signal:owner.signal});if(controller!==owner || seq!==sequence || !connected())return;
      catalog=validateFontCatalog(result);status.textContent='Fonts installed on the server · choices apply when confirmed';paint();
    }catch(error){if(controller===owner && seq===sequence && connected() && error.name!=='AbortError'){status.textContent=`${error.message} · manual font entry is available below`;retry.hidden=false;}}
    finally{if(controller===owner){controller=null;loading=false;sync();}}
  }
  function close(){if(controller){sequence++;controller.abort();controller=null;loading=false;attempted=false;}sync();}
  const toggle=()=>{if(!group.open){close();return;}if(!attempted && !catalog)void load();else sync();};
  const chooseFamily=()=>{if(!available())return;const choice=familyOptions.find(choice=>choice.value===family.value);if(choice && !choice.disabled && choice.value!==title.font_family)onFamily(choice.value);};
  const chooseFace=()=>{if(!available())return;const choice=faceOptions.find(choice=>choice.value===face.value);if(choice && !choice.disabled && (choice.face.weight!==title.font_weight || choice.face.italic!==title.italic))onFace(choice.face);};
  const retryLoad=()=>{if(connected())void load();};
  family.addEventListener('change',chooseFamily);face.addEventListener('change',chooseFace);retry.addEventListener('click',retryLoad);group.addEventListener('toggle',toggle);
  status.textContent='Open this section to read server fonts';paint();if(group.open)void load();
  return {dispose(){disposed=true;close();family.removeEventListener('change',chooseFamily);face.removeEventListener('change',chooseFace);retry.removeEventListener('click',retryLoad);group.removeEventListener('toggle',toggle);}};
}
