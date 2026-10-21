import {folderPaths} from './catalog.js';

const token=value=>typeof value==='string' && value.length>0 && value.length<=80 && /^[a-zA-Z0-9_-]+$/.test(value);
const label=value=>typeof value==='string' && value.trim().length>0 && new TextEncoder().encode(value).length<=128 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const invalid=()=>Error('Native library folders changed or are invalid; refresh the library');

export function nativeFolderCatalog(value,epoch){
  if(value?.project_epoch!==epoch || value.version!==1 || !Array.isArray(value.folders) || value.folders.length>512 || !(value.folders_revision==='absent' || typeof value.folders_revision==='string' && /^[a-f0-9]{64}$/.test(value.folders_revision)))throw invalid();
  const ids=new Set();
  for(const folder of value.folders){if(!token(folder.id) || !label(folder.name) || folder.parent!==null && !token(folder.parent) || ids.has(folder.id))throw invalid();ids.add(folder.id);}
  const map=new Map(value.folders.map(folder=>[folder.id,folder]));
  for(const folder of value.folders){
    const seen=new Set([folder.id]);let parent=folder.parent;
    while(parent!==null){if(!map.has(parent) || seen.has(parent) || seen.size>=16)throw invalid();seen.add(parent);parent=map.get(parent).parent;}
  }
  return {project_epoch:value.project_epoch,folders_revision:value.folders_revision,version:1,folders:value.folders.map(({id,name,parent})=>({id,name,parent}))};
}

export function nativeFolderChoices(catalog,moving=null){
  const map=new Map(catalog.folders.map(folder=>[folder.id,folder]));
  if(moving!==null && !map.has(moving))throw invalid();
  const ancestors=id=>{const result=[];while(map.has(id)){result.push(id);id=map.get(id).parent;}return result;};
  const height=moving===null?0:Math.max(...catalog.folders.map(folder=>{const path=ancestors(folder.id),index=path.indexOf(moving);return index<0?0:index+1;}));
  const allowed=id=>{const path=ancestors(id);return !path.includes(moving) && path.length+height<=16;};
  return [{value:'',label:'Library root'},...folderPaths(catalog.folders).filter(folder=>allowed(folder.id)).map(folder=>({value:folder.id,label:folder.path}))];
}

export function nativeFolderFilter(catalog,folder){
  if(folder===null)return {};
  if(typeof folder!=='string' || folder!=='' && !catalog.folders.some(item=>item.id===folder))throw invalid();
  return {folder,folders_revision:catalog.folders_revision};
}

export function nativeFolderOperation(action,catalog,options){
  const revision={folders_revision:catalog.folders_revision};
  const existing=id=>{if(!token(id) || !catalog.folders.some(folder=>folder.id===id))throw invalid();return id;};
  const parent=value=>{if(value!==null && value!=='' && !catalog.folders.some(folder=>folder.id===value))throw invalid();return value || null;};
  const name=value=>{const result=typeof value==='string'?value.trim():'';if(!label(result))throw Error('Choose a native folder name within 128 UTF-8 bytes');return result;};
  switch(action){
    case 'create_folder':{
      const destination=parent(options.parent);let depth=0,current=destination;
      while(current!==null){depth++;current=catalog.folders.find(folder=>folder.id===current).parent;}
      if(depth>=16)throw Error('Native library folders are limited to 16 levels');
      return {action,...revision,name:name(options.name),parent:destination};
    }
    case 'rename_folder':return {action,...revision,id:existing(options.id),name:name(options.name)};
    case 'move_folder':{
      const id=existing(options.id),destination=parent(options.parent);
      if(!nativeFolderChoices(catalog,id).some(item=>item.value===(destination || '')))throw Error('Choose a parent outside the selected folder and its children');
      return {action,...revision,id,parent:destination};
    }
    case 'remove_folder':return {action,...revision,id:existing(options.id)};
    case 'move_assets':{
      const items=options.items;
      if(!Array.isArray(items) || !items.length || items.length>64 || new Set(items.map(item=>item.id)).size!==items.length || items.some(item=>!token(item.id) || typeof item.revision!=='string' || !/^[a-f0-9]{64}$/.test(item.revision)))throw Error('Choose up to 64 current native assets to move');
      return {action,...revision,items:items.map(({id,revision})=>({id,revision})),folder:parent(options.folder)};
    }
    default:throw Error('Choose a supported native folder operation');
  }
}
