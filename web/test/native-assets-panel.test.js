import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAssetPanel,nativeAssetMutation} from '../js/native-assets.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));}
const foldersRevision='f'.repeat(64);
const assetRevision='a'.repeat(64);
const draggableAsset=(id,name=id)=>({id,name,revision:`revision-${id}`,media_count:1,file_count:1,archived:false,placement:{project_epoch:'epoch',generation:'7',error:null,items:[{source_in:0,source_out:48,fps:{num:24,den:1},has_video:true,has_audio:true,audio_streams:1,is_image:false}]}});
function dragEvent(){const values=new Map(),event=new Event('dragstart',{cancelable:true});event.dataTransfer={effectAllowed:'none',setData:(type,value)=>values.set(type,value)};return {event,values};}
function harness({pageReader,folderReader,projectReader,sourceReader,libraryCommit,projectCommit,timelineCommit,assetDnd}={}){
  const original={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes=new Map();this.dataset={};this.textContent='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.parent=null;}
    get value(){return this.tag==='select'?this.selectedOptions[0]?.value??this._value:this._value;}
    set value(value){this._value=String(value);if(this.tag==='select')for(const child of this.children)child.selected=child.value===this._value;}
    get selectedOptions(){return this.children.filter(child=>child.tag==='option' && child.selected);}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    append(...children){for(const child of children){this.children.push(child);if(child instanceof Element)child.parent=this;}}
    replaceChildren(...children){for(const child of this.children)if(child instanceof Element)child.parent=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}getAttribute(name){return this.attributes.get(name)??null;}
    closest(selector){for(let node=this;node;node=node.parent)if(selector.split(',').some(part=>part.trim()==='[contenteditable]'?node.attributes.has('contenteditable'):node.tag===part.trim()))return node;return null;}
    dispatchEvent(event){const result=super.dispatchEvent(event);this[`on${event.type}`]?.(event);return result;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  const body=new Element('body'),root=new Element('root');body.append(root);
  globalThis.document={body,createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  let context={project_name:'project.vvproj',project_epoch:'epoch',generation:'7',command_epoch:'commands',media:[{id:'media-a',name:'Shot A'},{id:'media-b',name:'Shot B'}],selected_ids:['media-a']},writable=true;
  let items=[{id:'asset-a',revision:'rev-a',name:'Reusable shot',media_count:2,file_count:1,archived:false,can_restore_previous:true}];
  let folders=[{id:'outer',name:'Shots',parent:null},{id:'inner',name:'Day 1',parent:'outer'},{id:'other',name:'Other',parent:null}];
  const pages=[],folderReads=[],projectReads=[],sourceReads=[],prepares=[],deletes=[],libraryWrites=[],preparedWrites=[],projectWrites=[],timelineWrites=[],imported=[],placed=[],notices=[],deleteGate=deferred();
  let delayDelete=false;
  const panel=createNativeAssetPanel({root,getContext:()=>context,canCommit:()=>writable,notice:text=>notices.push(text),onImported:ids=>imported.push(ids),assetDnd,onPlaced:receipt=>placed.push(receipt),
    makeLibraryMutation:operation=>nativeAssetMutation(context,'client',operation,'relink-command'),
    libraryCommit(operation,prepared){libraryWrites.push(structuredClone(operation));if(prepared)preparedWrites.push(structuredClone(prepared));return libraryCommit?libraryCommit(operation,prepared):Promise.resolve({command_id:prepared?.command_id || 'published',project_epoch:context.project_epoch,...(prepared?{missing_count:0,relinked_files:1}:{})});},
    projectCommit(operation){projectWrites.push(structuredClone(operation));return projectCommit?projectCommit(operation):Promise.resolve({command_id:'imported',project_epoch:context.project_epoch,media_ids:['new-media']});},
    timelineCommit(operation){timelineWrites.push(structuredClone(operation));return timelineCommit?timelineCommit(operation):Promise.resolve({command_id:'placed',project_epoch:context.project_epoch,media_ids:['new-media'],clip_ids:['placed-video','placed-audio']});},
    api(path,body,options={}){
      if(path.startsWith('/native-assets/folders?')){
        folderReads.push({path,options});
        return folderReader?folderReader(folderReads.length-1,path,structuredClone(folders)):Promise.resolve({project_epoch:context.project_epoch,version:1,folders_revision:foldersRevision,folders:structuredClone(folders)});
      }
      if(path.startsWith('/native-assets/pages/')){
        pages.push({path,options});
        return pageReader?pageReader(pages.length-1,path,items):Promise.resolve({page:0,pages:1,total:items.length,items:structuredClone(items)});
      }
      if(path==='/projects'){projectReads.push({path,options});return projectReader?projectReader(projectReads.length-1,options):Promise.resolve({importable_media:[{name:'Shot.mov',path_token:'Shot.mov'},{name:'Sound.wav',path_token:'Sound.wav'}]});}
      if(path.startsWith('/media/sources?')){const query=new URL(path,'http://fixture').searchParams,directory=query.get('directory_token');sourceReads.push({path,options});return sourceReader?sourceReader(sourceReads.length-1,query,options):Promise.resolve({project_epoch:context.project_epoch,directory_token:directory,parent_token:directory?'':null,page:0,pages:1,entries:directory?[]:[{kind:'directory',name:'Takes',path_token:'Takes'}]});}
      if(path==='/native-assets/prepare' || path==='/native-assets/commands/prepare'){const gate=deferred();prepares.push({...gate,body:structuredClone(body),options});return gate.promise;}
      if(path.startsWith('/native-assets/items/published?'))return Promise.resolve({id:'published',revision:'published-revision',name:'Newly captured asset',media_count:1,file_count:1,archived:false,can_restore_previous:false});
      if(options.method==='DELETE'){deletes.push({path,options});return delayDelete?deleteGate.promise:Promise.resolve({state:'canceled'});}
      throw Error(`Unexpected panel request ${path}`);
    },
    pause:()=>Promise.reject(Error('Panel fixture must not start an unplanned poll')),
  });
  const walk=node=>[node,...node.children.filter(child=>child instanceof Element).flatMap(walk)];
  const find=(predicate,label)=>{const node=walk(root).find(predicate);assert(node,`Expected ${label}`);return node;};
  const button=text=>find(node=>node.tag==='button' && node.textContent===text,`button ${text}`);
  const field=label=>find(node=>node.getAttribute('aria-label')===label,label);
  const status=()=>find(node=>node.getAttribute('role')==='status','panel status').textContent;
  const job=(index=0,patch={})=>{const {project_epoch,if_generation,action,operation}=prepares[index].body;return {id:`job-${index+1}`,state:'ready',project_epoch,generation:if_generation,kind:operation?'library_edit':action.kind,bytes:0,total_bytes:32,result:operation?.edit.action==='import_tree'?{imported_assets:1,skipped_files:1,error_count:1,created_folders:1,root_folder_id:'import-root',folders_revision:foldersRevision,errors:[{path_token:'Takes/bad.mov',code:'BAD_MEDIA',message:'Native probe failed'}]}:operation?{asset_id:operation.edit.id,revision:operation.edit.revision,missing_count:0,relinked_files:1}:action.kind==='import'?{asset_id:action.asset_id,revision:action.revision}:null,...patch};};
  return {panel,root,pages,folderReads,projectReads,sourceReads,prepares,deletes,libraryWrites,preparedWrites,projectWrites,timelineWrites,imported,placed,notices,button,field,status,job,deleteGate,texts:()=>walk(root).map(node=>node.textContent),
    context:()=>context,setContext:value=>{context=value;},setWritable:value=>{writable=value;},setItems:value=>{items=value;},setFolders:value=>{folders=value;},delayDelete:()=>{delayDelete=true;},
    change(label,value){const node=field(label);node.value=value;node.dispatchEvent(new Event('change'));},
    chooseAssets(indexes){const node=field('Native assets');for(const [index,option] of node.children.entries())option.selected=indexes.includes(index);node.dispatchEvent(new Event('change'));},
    chooseFiles(tokens){const node=field('Approved source files');for(const option of node.children)option.selected=tokens.includes(option.value);node.dispatchEvent(new Event('change'));},
    moveAssets:()=>find(node=>node.tag==='button' && /^Move \d* ?native assets to folder$/.test(node.textContent),'move assets button'),
    capture:()=>find(node=>node.tag==='button' && node.textContent.startsWith('Save ') && node.textContent.endsWith('selected media as native assets'),'capture button'),
    open:()=>panel.open(),
    destroy(){panel.hide();for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}},
  };
}

test('cold native asset panel selects the first result and enables only valid write controls',async()=>{
  const h=harness();try{
    await h.open();assert.equal(h.pages.length,1);assert.equal(h.field('Native assets').value,'0');assert.equal(h.field('Native asset name').value,'Reusable shot');
    for(const text of ['Import native asset into project','Rename native asset','Archive native asset','Restore previous native asset settings'])assert.equal(h.button(text).disabled,false,text);
    assert.equal(h.capture().disabled,false);assert.equal(h.button('Cancel native asset preparation').disabled,true);
    h.context().selected_ids=[];h.panel.invalidate();assert.equal(h.capture().disabled,true);assert.equal(h.button('Import native asset into project').disabled,false);
    h.setWritable(false);h.panel.invalidate();for(const text of ['Import native asset into project','Rename native asset','Archive native asset','Restore previous native asset settings'])assert.equal(h.button(text).disabled,true,text);
    assert.equal(h.prepares.length,0);assert.equal(h.libraryWrites.length+h.projectWrites.length,0);
  }finally{h.destroy();}
});

test('Library rows own native Shift range, Ctrl toggle and focused Ctrl+A without any command',async()=>{
  const starts=[],dnd={type:'application/x-venturi-native-assets',end(){},start(items,current,onDrop){starts.push({items,current,onDrop});return 'trusted-token';}},h=harness({assetDnd:dnd});
  try{
    h.setItems([draggableAsset('c'),draggableAsset('a'),draggableAsset('b')]);await h.open();
    h.button('c').click();h.button('b').dispatchEvent(Object.assign(new Event('click'),{shiftKey:true}));assert.equal(h.field('Native assets').selectedOptions.length,3);
    h.button('a').dispatchEvent(Object.assign(new Event('click'),{shiftKey:true,ctrlKey:true}));assert.deepEqual(h.field('Native assets').selectedOptions.map(item=>item.value),['0','1']);
    h.button('b').dispatchEvent(Object.assign(new Event('click'),{ctrlKey:true}));const dragging=dragEvent();h.button('a').dispatchEvent(dragging.event);assert.deepEqual(starts[0].items.map(item=>item.id),['c','a','b']);assert.equal(dragging.values.get(dnd.type),'trusted-token');assert.equal(dragging.event.dataTransfer.effectAllowed,'copy');assert.equal(h.prepares.length,0);
    h.button('a').click();const key=new Event('keydown',{cancelable:true});Object.defineProperties(key,{key:{value:'a'},ctrlKey:{value:true},target:{value:h.button('a')}});h.root.dispatchEvent(key);assert.equal(key.defaultPrevented,true);assert.equal(h.field('Native assets').selectedOptions.length,3);
    const nameKey=new Event('keydown',{cancelable:true});Object.defineProperties(nameKey,{key:{value:'a'},ctrlKey:{value:true},target:{value:h.field('Native asset name')}});h.root.dispatchEvent(nameKey);assert.equal(nameKey.defaultPrevented,false);assert.equal(h.projectWrites.length+h.timelineWrites.length+h.libraryWrites.length,0);
  }finally{h.destroy();}
});

test('dragging an unselected Library row replaces selection and drop prepares one batch before one placement',async()=>{
  let source;const dnd={type:'application/x-venturi-native-assets',end(){},start(items,current,onDrop){source={items,current,onDrop};return 'trusted';}},h=harness({assetDnd:dnd});
  try{
    h.setItems([draggableAsset('a'),draggableAsset('b')]);await h.open();const event=dragEvent();h.button('b').dispatchEvent(event.event);assert.deepEqual(source.items.map(item=>item.id),['b']);assert.equal(h.button('b').getAttribute('aria-pressed'),'true');
    const snapshot=source.items.map(item=>({id:item.id,revision:item.revision,name:item.name,placement:item.placement}));assert.equal(source.current(snapshot),true);assert.equal(h.prepares.length,0);
    const controller=new AbortController(),assets=[{asset_id:'b',revision:'revision-b'}],pending=source.onDrop({assets,start_frame:96,target:{kind:'new_video_track'},overwrite:true},()=>true,controller.signal);
    assert.deepEqual(h.prepares[0].body,{project_epoch:'epoch',if_generation:'7',action:{kind:'import_set',assets}});
    h.prepares[0].resolve(h.job(0,{result:{assets:[{...assets[0],name:'b'}]}}));await pending;
    assert.deepEqual(h.timelineWrites,[{kind:'place_native_assets',job_id:'job-1',assets,start_frame:96,target:{kind:'new_video_track'},overwrite:true}]);assert.deepEqual(h.projectWrites,[]);assert.deepEqual(h.imported,[]);assert.equal(h.placed.length,1);
  }finally{h.destroy();}
});

test('cached compound placement refreshes once per generation, retains Library selection and refuses stale ghosts',async()=>{
  const starts=[],read=deferred(),dnd={type:'application/x-venturi-native-assets',end(){},start(items){starts.push(items);return 'trusted';}},h=harness({assetDnd:dnd,pageReader:(index,path,items)=>index===1?read.promise:Promise.resolve({page:0,pages:1,total:items.length,items:structuredClone(items)})});
  try{
    h.setItems([draggableAsset('a'),draggableAsset('b')]);await h.open();h.chooseAssets([0,1]);h.context().generation='8';h.panel.invalidate();await settle();assert.equal(h.pages.length,2);
    let e=dragEvent();h.button('a').dispatchEvent(e.event);assert.equal(e.event.defaultPrevented,true);assert.equal(starts.length,0);
    const refreshed=[draggableAsset('a'),draggableAsset('b')];for(const item of refreshed){item.placement.generation='8';item.placement.items[0].source_out=96;}
    read.resolve({page:0,pages:1,total:2,items:refreshed});await settle();assert.equal(h.field('Native assets').selectedOptions.length,2);assert.equal(h.pages.length,2);
    e=dragEvent();h.button('a').dispatchEvent(e.event);assert.equal(e.event.defaultPrevented,false);assert.deepEqual(starts[0].map(item=>item.placement.items[0].source_out),[96,96]);
    h.context().generation='9';h.panel.invalidate();await settle();assert.equal(h.pages.length,3);for(let index=0;index<3;index++)h.panel.invalidate();await settle();assert.equal(h.pages.length,3);e=dragEvent();h.button('a').dispatchEvent(e.event);assert.equal(e.event.defaultPrevented,true);assert.equal(starts.length,1);assert.equal(h.prepares.length,0);
  }finally{h.destroy();}
});

test('Library drop cancellation, stale source and failed dataTransfer never apply or replay',async()=>{
  for(const action of ['cancel','hide','generation','selection']){
    let source,ends=0;const dnd={type:'application/x-venturi-native-assets',end(){ends++;},start(items,current,onDrop){source={items,current,onDrop};return 'trusted';}},h=harness({assetDnd:dnd});
    try{
      h.setItems([draggableAsset('a'),draggableAsset('b')]);await h.open();let event=dragEvent();event.event.dataTransfer.setData=()=>{throw Error('Clipboard transfer refused');};h.button('a').dispatchEvent(event.event);assert.equal(event.event.defaultPrevented,true);assert.ok(ends>0);assert.equal(h.prepares.length,0);
      event=dragEvent();h.button('a').dispatchEvent(event.event);const controller=new AbortController(),assets=[{asset_id:'a',revision:'revision-a'}];let targetValid=true;const pending=source.onDrop({assets,start_frame:0,target:{kind:'track',track_id:'v1'},overwrite:false},()=>targetValid,controller.signal);assert.equal(h.prepares.length,1);
      if(action==='cancel'){targetValid=false;controller.abort();}else if(action==='hide')h.panel.hide();else if(action==='generation'){h.context().generation='8';h.panel.invalidate();}else{h.setItems([draggableAsset('b')]);h.panel.hide();}
      h.prepares[0].resolve(h.job(0,{result:{assets:[{...assets[0],name:'a'}]}}));await pending;assert.equal(h.deletes.length,1,action);assert.equal(h.timelineWrites.length+h.projectWrites.length,0,action);assert.equal(h.placed.length,0);
    }finally{h.destroy();}
  }
});

test('a panel without an opened project performs no catalog read or mutation',async()=>{
  const h=harness();try{h.setContext(null);await h.open();assert.equal(h.pages.length,0);assert.equal(h.capture().disabled,true);assert.equal(h.button('Import native asset into project').disabled,true);assert.match(h.status(),/Create or open a project/);assert.equal(h.prepares.length,0);}finally{h.destroy();}
});

test('a newly published asset outside the current page stays selected for the next explicit import',async()=>{
  const h=harness();try{
    await h.open();h.capture().click();h.prepares[0].resolve(h.job());await settle();
    assert.equal(h.field('Native assets').value,'-1');assert.equal(h.field('Native asset name').value,'Newly captured asset');
    assert.equal(h.libraryWrites.length,1);h.button('Import native asset into project').click();
    assert.deepEqual(h.prepares[1].body.action,{kind:'import',asset_id:'published',revision:'published-revision'});
    h.prepares[1].resolve(h.job(1));await settle();assert.equal(h.projectWrites.length,1);
  }finally{h.destroy();}
});

test('reopening during prepare waits for the late cancellation then automatically reloads the new panel',async()=>{
  const h=harness();try{
    await h.open();h.delayDelete();h.capture().click();assert.equal(h.prepares.length,1);
    await h.open();assert.equal(h.pages.length,1);assert.equal(h.field('Native assets').children.length,0);assert.equal(h.capture().disabled,true);
    h.prepares[0].resolve(h.job());await settle();assert.equal(h.deletes.length,1);assert.equal(h.pages.length,1);assert.equal(h.libraryWrites.length,0);
    h.deleteGate.resolve({state:'canceled'});await settle();assert.equal(h.pages.length,2);assert.equal(h.field('Native assets').children.length,1);
    assert.equal(h.capture().disabled,false);assert.equal(h.button('Import native asset into project').disabled,false);assert.match(h.status(),/Page 1 of 1/);
    assert.equal(h.libraryWrites.length+h.projectWrites.length,0);assert.equal(h.prepares.length,1);
  }finally{h.destroy();}
});

test('reopening during an acknowledged library edit reloads after settlement without replaying the edit',async()=>{
  const editing=deferred(),h=harness({libraryCommit:()=>editing.promise});try{
    await h.open();h.field('Native asset name').value='Changed name';h.button('Rename native asset').click();
    assert.equal(h.libraryWrites.length,1);assert.deepEqual(h.libraryWrites[0],{kind:'edit_native_asset_library',edit:{action:'update',id:'asset-a',revision:'rev-a',name:'Changed name'}});
    await h.open();assert.equal(h.pages.length,1);assert.equal(h.button('Rename native asset').disabled,true);
    h.setItems([{id:'asset-a',revision:'rev-b',name:'Changed name',media_count:2,file_count:1,archived:false,can_restore_previous:true}]);editing.resolve({command_id:'edited',project_epoch:'epoch'});await settle();
    assert.equal(h.pages.length,2);assert.equal(h.field('Native asset name').value,'Changed name');assert.equal(h.button('Rename native asset').disabled,false);
    assert.equal(h.libraryWrites.length,1);assert.equal(h.prepares.length,0);assert.match(h.status(),/Page 1 of 1/);
  }finally{h.destroy();}
});

test('a batch stops after an acknowledged publication whose refresh fails and preserves its warning',async()=>{
  const h=harness({pageReader:async(index,_path,items)=>{if(index>0)throw Error('Catalog disconnected');return {page:0,pages:1,total:items.length,items:structuredClone(items)};}});try{
    await h.open();h.context().selected_ids=['media-a','media-b'];h.panel.invalidate();h.capture().click();assert.equal(h.prepares.length,1);
    h.prepares[0].resolve(h.job());await settle();assert.equal(h.libraryWrites.length,1);assert.equal(h.libraryWrites[0].kind,'publish_native_asset');
    assert.equal(h.prepares.length,1);assert.equal(h.pages.length,2);assert.match(h.status(),/Command applied.*refresh failed.*do not repeat/i);
    assert.doesNotMatch(h.status(),/^1 native asset saved/);assert.equal(h.capture().disabled,false);assert.equal(h.deletes.length,0);
  }finally{h.destroy();}
});

test('an old import commit cannot select media or refresh into a reopened project panel',async()=>{
  const committing=deferred(),h=harness({projectCommit:()=>committing.promise});try{
    await h.open();h.button('Import native asset into project').click();h.prepares[0].resolve(h.job());await settle();assert.equal(h.projectWrites.length,1);
    h.setContext({...h.context(),project_name:'new-project.vvproj',project_epoch:'new-epoch',generation:'0',selected_ids:[]});
    await h.open();assert.equal(h.pages.length,1);assert.equal(h.field('Native assets').children.length,0);
    h.setItems([{id:'asset-new',revision:'new-revision',name:'New panel choice',media_count:1,file_count:0,archived:false,can_restore_previous:false}]);
    committing.resolve({command_id:'old-import',project_epoch:'epoch',media_ids:['old-media']});await settle();
    assert.deepEqual(h.imported,[]);assert.equal(h.projectWrites.length,1);assert.equal(h.pages.length,2);
    assert.match(h.pages[1].path,/project_epoch=new-epoch/);assert.equal(h.field('Native asset name').value,'New panel choice');assert.match(h.status(),/Page 1 of 1/);
    assert.equal(h.prepares.length,1);assert.equal(h.deletes.length,0);
  }finally{h.destroy();}
});

test('reopening in the same project also isolates the new panel from old import selection callbacks',async()=>{
  const committing=deferred(),h=harness({projectCommit:()=>committing.promise});try{
    await h.open();h.button('Import native asset into project').click();h.prepares[0].resolve(h.job());await settle();await h.open();
    committing.resolve({command_id:'old-import',project_epoch:'epoch',media_ids:['old-media']});await settle();
    assert.deepEqual(h.imported,[]);assert.equal(h.pages.length,2);assert.equal(h.button('Import native asset into project').disabled,false);
    assert.equal(h.projectWrites.length,1);assert.equal(h.prepares.length,1);
  }finally{h.destroy();}
});

test('Delete and Backspace stay inside the native assets pane without suppressing normal text handling',async()=>{
  const h=harness();try{
    assert.equal(h.root.dataset.commandOwner,'library');
    await h.open();for(const key of ['Delete','Backspace']){
      let stopped=0;const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:key},target:{value:h.button('Archive native asset')}});event.stopPropagation=()=>{stopped++;};
      h.root.dispatchEvent(event);assert.equal(stopped,1,key);assert.equal(event.defaultPrevented,true,key);
      assert.match(h.notices.at(-1),/Library Delete is unavailable.*timeline clips are unchanged/);
      const notices=h.notices.length,text=new Event('keydown',{cancelable:true});Object.defineProperties(text,{key:{value:key},target:{value:h.field('Native asset name')}});text.stopPropagation=()=>{stopped++;};
      h.root.dispatchEvent(text);assert.equal(stopped,2,key);assert.equal(text.defaultPrevented,false,'text editing keeps its native key behavior');assert.equal(h.notices.length,notices);
    }
    let stopped=0;const event=new Event('keydown');Object.defineProperty(event,'key',{value:'ArrowLeft'});event.stopPropagation=()=>{stopped++;};h.root.dispatchEvent(event);assert.equal(stopped,0);
    assert.equal(h.prepares.length+h.libraryWrites.length+h.projectWrites.length,0);
  }finally{h.destroy();}
});

test('archive and restore clear stale off-page selection before reloading the chosen source',async()=>{
  const h=harness();try{
    await h.open();h.setItems([]);h.button('Archive native asset').click();await settle();
    assert.equal(h.field('Native assets').children.length,0);assert.equal(h.field('Native asset name').value,'');
    assert.equal(h.button('Import native asset into project').disabled,true);assert.equal(h.button('Archive native asset').disabled,true);
    h.setItems([{id:'asset-a',revision:'archived-revision',name:'Reusable shot',media_count:2,file_count:1,archived:true,can_restore_previous:false}]);
    const archived=h.field('Show archived native assets');archived.checked=true;archived.dispatchEvent(new Event('change'));await settle();
    assert.equal(h.button('Restore native asset').disabled,false);h.setItems([]);h.button('Restore native asset').click();await settle();
    assert.equal(h.field('Native assets').children.length,0);assert.equal(h.field('Native asset name').value,'');
    assert.equal(h.button('Import native asset into project').disabled,true);assert.equal(h.button('Archive native asset').disabled,true);
    assert.deepEqual(h.libraryWrites.map(operation=>operation.edit.action),['archive','restore']);
  }finally{h.destroy();}
});

test('All, Root and an exact native folder use distinct page queries with the current folder CAS',async()=>{
  const h=harness();try{
    await h.open();
    let query=new URL(h.pages.at(-1).path,'http://fixture').searchParams;
    assert.equal(query.has('folder'),false);assert.equal(query.has('folders_revision'),false);
    h.change('Native asset folder','');await settle();
    query=new URL(h.pages.at(-1).path,'http://fixture').searchParams;
    assert.equal(query.get('folder'),'');assert.equal(query.get('folders_revision'),foldersRevision);
    h.change('Native asset folder','inner');await settle();
    query=new URL(h.pages.at(-1).path,'http://fixture').searchParams;
    assert.equal(query.get('folder'),'inner');assert.equal(query.get('folders_revision'),foldersRevision);
    assert.equal(h.field('Native folder name').value,'Day 1');assert.equal(h.field('Native folder parent').value,'outer');
    assert.equal(h.field('New native folder parent').value,'inner');
    assert(h.field('New native folder parent').children.some(option=>option.value==='inner'));
    assert(!h.field('Native folder parent').children.some(option=>option.value==='inner'));
    h.change('Native asset folder','*');await settle();
    assert.equal(new URL(h.pages.at(-1).path,'http://fixture').searchParams.has('folder'),false);
    assert.equal(h.folderReads.length,4);assert.equal(h.libraryWrites.length+h.projectWrites.length,0);
  }finally{h.destroy();}
});

test('a filtered native catalog skips empty source pages in the requested direction and stops at its boundary',async()=>{
  const h=harness({pageReader:async(_index,path,items)=>{
    const url=new URL(path,'http://fixture'),page=Number(url.pathname.split('/').at(-1));
    return {page,pages:4,total:1,items:url.searchParams.has('folder') && page!==2?[]:structuredClone(items)};
  }});try{
    await h.open();h.change('Native asset folder','inner');await settle();
    assert.deepEqual(h.pages.map(item=>Number(new URL(item.path,'http://fixture').pathname.split('/').at(-1))),[0,0,1,2]);
    assert.match(h.status(),/Page 3 of 4/);assert.equal(h.field('Native assets').children.length,1);
    h.button('Next native assets').click();await settle();
    assert.match(h.status(),/Page 4 of 4/);assert.equal(h.button('Next native assets').disabled,true);assert.equal(h.field('Native assets').children.length,0);
    h.button('Previous native assets').click();await settle();
    assert.match(h.status(),/Page 3 of 4/);assert.equal(h.field('Native assets').children.length,1);
    assert.equal(h.pages.length,6);assert.equal(h.prepares.length+h.libraryWrites.length,0);
  }finally{h.destroy();}
});

test('folder create, rename, move and remove emit one native DTO each without timeline mutations',async()=>{
  const h=harness();try{
    await h.open();h.change('Native asset folder','inner');await settle();
    h.field('Native folder name').value='  Renamed day  ';h.setFolders([{id:'outer',name:'Shots',parent:null},{id:'inner',name:'Renamed day',parent:'outer'},{id:'other',name:'Other',parent:null}]);h.button('Rename native folder').click();await settle();
    h.field('Native folder parent').value='other';h.setFolders([{id:'outer',name:'Shots',parent:null},{id:'inner',name:'Renamed day',parent:'other'},{id:'other',name:'Other',parent:null}]);h.button('Move native folder').click();await settle();
    h.setFolders([{id:'outer',name:'Shots',parent:null},{id:'other',name:'Other',parent:null}]);h.button('Remove folder and move contents up').click();await settle();
    assert.equal(h.field('Native asset folder').value,'other');
    h.setFolders([{id:'outer',name:'Shots',parent:null},{id:'other',name:'Other',parent:null},{id:'published',name:'New folder',parent:'other'}]);
    h.field('Native folder name').value=' New folder ';h.field('Native folder parent').value='other';h.button('Create native folder').click();await settle();
    assert.deepEqual(h.libraryWrites,[
      {kind:'edit_native_asset_library',edit:{action:'rename_folder',folders_revision:foldersRevision,id:'inner',name:'Renamed day'}},
      {kind:'edit_native_asset_library',edit:{action:'move_folder',folders_revision:foldersRevision,id:'inner',parent:'other'}},
      {kind:'edit_native_asset_library',edit:{action:'remove_folder',folders_revision:foldersRevision,id:'inner'}},
      {kind:'edit_native_asset_library',edit:{action:'create_folder',folders_revision:foldersRevision,name:'New folder',parent:'other'}},
    ]);
    assert.equal(h.field('Native asset folder').value,'published');assert.equal(h.field('Native folder name').value,'New folder');
    assert.equal(h.prepares.length+h.projectWrites.length,0);
  }finally{h.destroy();}
});

test('multiasset folder move binds every selected raw revision and disables single-item actions',async()=>{
  const h=harness();try{
    const items=[{id:'asset-a',revision:assetRevision,name:'A',media_count:1,file_count:0,archived:false},{id:'asset-b',revision:'b'.repeat(64),name:'B',media_count:1,file_count:0,archived:false}];
    h.setItems(items);await h.open();h.chooseAssets([0,1]);
    assert.equal(h.field('Native assets').selectedOptions.length,2);assert.equal(h.button('Import native asset into project').disabled,true);assert.equal(h.button('Rename native asset').disabled,true);assert.equal(h.button('Archive native asset').disabled,true);
    assert.equal(h.moveAssets().disabled,false);h.field('Move native assets to').value='inner';h.moveAssets().click();await settle();
    assert.deepEqual(h.libraryWrites,[{kind:'edit_native_asset_library',edit:{action:'move_assets',folders_revision:foldersRevision,items:items.map(({id,revision})=>({id,revision})),folder:'inner'}}]);
    assert.equal(h.projectWrites.length+h.prepares.length,0);assert.deepEqual(items.map(item=>item.revision),[assetRevision,'b'.repeat(64)]);
  }finally{h.destroy();}
});

test('readonly and foreign-epoch folder controls cannot emit writes from an old catalog',async()=>{
  const h=harness();try{
    h.setWritable(false);await h.open();
    for(const text of ['Create native folder','Rename native folder','Move native folder','Remove folder and move contents up']){assert.equal(h.button(text).disabled,true);h.button(text).click();}
    assert.equal(h.moveAssets().disabled,true);h.moveAssets().click();
    h.setWritable(true);h.panel.invalidate();assert.equal(h.button('Create native folder').disabled,false);
    h.setContext({...h.context(),project_epoch:'new-epoch'});h.panel.invalidate();
    assert.equal(h.field('Native asset folder').disabled,true);assert.equal(h.button('Create native folder').disabled,true);assert.equal(h.moveAssets().disabled,true);
    h.button('Create native folder').click();h.moveAssets().click();assert.equal(h.libraryWrites.length,0);
  }finally{h.destroy();}
});

test('late old folder catalog responses cannot populate or issue a page request in a reopened project',async()=>{
  const old=deferred(),h=harness({folderReader:(index,_path,folders)=>index===0?old.promise:Promise.resolve({project_epoch:'new-epoch',version:1,folders_revision:foldersRevision,folders})});try{
    const first=h.open();assert.equal(h.folderReads.length,1);assert.equal(h.pages.length,0);
    h.setContext({...h.context(),project_epoch:'new-epoch'});await h.open();assert.equal(h.pages.length,1);
    old.resolve({project_epoch:'epoch',version:1,folders_revision:'e'.repeat(64),folders:[{id:'old',name:'Old folder',parent:null}]});await first;await settle();
    assert.equal(h.pages.length,1);assert.match(h.pages[0].path,/project_epoch=new-epoch/);
    assert.equal(h.field('Native asset folder').children.some(option=>option.value==='old'),false);
    assert.equal(h.button('Create native folder').disabled,false);assert.equal(h.libraryWrites.length,0);
  }finally{h.destroy();}
});

test('foreign or malformed folder catalogs fail closed before reading assets or enabling folder writes',async()=>{
  for(const patch of [{project_epoch:'foreign'},{folders_revision:'not-a-revision'},{folders:[{id:'orphan',name:'Orphan',parent:'missing'}]}]){
    const h=harness({folderReader:async()=>({project_epoch:'epoch',version:1,folders_revision:foldersRevision,folders:[],...patch})});try{
      await h.open();assert.equal(h.pages.length,0);assert.equal(h.button('Create native folder').disabled,true);assert.equal(h.moveAssets().disabled,true);
      assert.match(h.status(),/folders changed or are invalid/);assert.equal(h.libraryWrites.length,0);
    }finally{h.destroy();}
  }
});

test('acknowledged folder edit with failed refresh warns without replay and explicitly reopening recovers',async()=>{
  let failRefresh=false;const h=harness({folderReader:async(index,_path,folders)=>{
    if(index>0 && failRefresh)throw Error('Folder catalog unavailable');
    return {project_epoch:'epoch',version:1,folders_revision:foldersRevision,folders};
  }});try{
    await h.open();h.change('Native asset folder','inner');await settle();
    failRefresh=true;h.field('Native folder name').value='Renamed';h.button('Rename native folder').click();await settle();
    assert.equal(h.libraryWrites.length,1);assert.match(h.status(),/Command applied.*Refresh before.*do not repeat/i);
    assert.equal(h.button('Rename native folder').disabled,true);assert.equal(h.button('Create native folder').disabled,true);
    h.button('Rename native folder').click();assert.equal(h.libraryWrites.length,1);
    failRefresh=false;await h.open();assert.equal(h.libraryWrites.length,1);assert.equal(h.button('Rename native folder').disabled,false);
    assert.match(h.status(),/Page 1 of 1/);assert.equal(h.prepares.length+h.projectWrites.length,0);
  }finally{h.destroy();}
});

test('an old acknowledged folder creation cannot select its new ID in a reopened project panel',async()=>{
  const writing=deferred(),h=harness({libraryCommit:()=>writing.promise});try{
    await h.open();h.field('Native folder name').value='Old project choice';h.button('Create native folder').click();assert.equal(h.libraryWrites.length,1);
    h.setContext({...h.context(),project_epoch:'new-epoch'});await h.open();assert.equal(h.folderReads.length,1);assert.equal(h.pages.length,1);
    writing.resolve({command_id:'old-created-folder',project_epoch:'epoch'});await settle();
    assert.equal(h.folderReads.length,2);assert.equal(h.pages.length,2);assert.match(h.pages[1].path,/project_epoch=new-epoch/);
    assert.equal(h.field('Native asset folder').value,'*');assert.equal(h.field('Native folder name').value,'');
    assert.equal(h.libraryWrites.length,1);assert.equal(h.projectWrites.length+h.prepares.length,0);
  }finally{h.destroy();}
});

test('a stale filtered asset page cannot replace rows or folder controls after reopening',async()=>{
  const stale=deferred(),h=harness({pageReader:(index,_path,items)=>index===0?stale.promise:Promise.resolve({page:0,pages:1,total:items.length,items:structuredClone(items)})});try{
    const first=h.open();await settle();assert.equal(h.pages.length,1);
    h.setContext({...h.context(),project_epoch:'new-epoch'});h.setItems([{id:'new-asset',revision:assetRevision,name:'Current project choice',media_count:1,file_count:0,archived:false}]);await h.open();
    stale.resolve({page:7,pages:9,total:1,items:[{id:'old-asset',revision:'c'.repeat(64),name:'Stale row',media_count:1,file_count:0,archived:false}]});await first;await settle();
    assert.equal(h.field('Native asset name').value,'Current project choice');assert.match(h.status(),/Page 1 of 1/);
    assert.equal(h.field('Native assets').children.length,1);assert.equal(h.button('Create native folder').disabled,false);assert.equal(h.libraryWrites.length,0);
  }finally{h.destroy();}
});

const offlineAsset=()=>({id:'asset-a',revision:assetRevision,name:'Offline native shot',media_count:2,file_count:2,missing_count:1,offline_files:[{name:'Shot.mov',missing:true},{name:'Sound.wav',missing:false}],archived:false,can_restore_previous:true});

test('offline asset Relink uses approved selected files and refreshes native missing counts after one library command',async()=>{
  const h=harness({libraryCommit:(_operation,body)=>{h.setItems([{...offlineAsset(),revision:'b'.repeat(64),missing_count:0}]);return Promise.resolve({command_id:body.command_id,project_epoch:'epoch',missing_count:0,relinked_files:1});}});try{
    await h.open();assert.equal(h.button('Relink missing native asset files').disabled,true);assert.equal(h.projectReads.length,0);
    h.setItems([offlineAsset()]);await h.open();h.button('Relink missing native asset files').click();await settle();assert.equal(h.projectReads.length,1);assert.equal(h.prepares.length,0);
    assert.equal(h.button('Relink selected source files').disabled,true);h.chooseFiles(['Shot.mov']);h.button('Relink selected source files').click();assert.equal(h.prepares.length,1);
    const body=h.prepares[0].body;assert.deepEqual(body.operation,{kind:'edit_native_asset_library',edit:{action:'relink',id:'asset-a',revision:assetRevision,path_tokens:['Shot.mov']}});assert.equal(body.command_id,'relink-command');assert.equal(h.button('Cancel native asset preparation').disabled,false);
    h.prepares[0].resolve(h.job());await settle();assert.deepEqual(h.preparedWrites,[body]);assert.equal(h.libraryWrites.length,1);assert.equal(h.projectWrites.length,0);assert.equal(h.deletes.length,0);assert.equal(h.button('Relink missing native asset files').disabled,true);assert.match(h.status(),/1 files restored.*0 still missing/);
  }finally{h.destroy();}
});

test('late approved-source reads cannot populate a reopened asset panel or emit relink commands',async()=>{
  const stale=deferred(),h=harness({projectReader:()=>stale.promise});try{
    h.setItems([offlineAsset()]);await h.open();h.button('Relink missing native asset files').click();assert.equal(h.projectReads.length,1);
    h.setContext({...h.context(),project_epoch:'new-epoch'});h.setItems([]);await h.open();assert.equal(h.projectReads[0].options.signal.aborted,true);
    stale.resolve({importable_media:[{name:'Old.mov',path_token:'Old.mov'}]});await settle();assert.throws(()=>h.field('Approved source files'),/Expected/);assert.match(h.status(),/Page 1 of 1/);assert.equal(h.prepares.length+h.libraryWrites.length,0);
  }finally{h.destroy();}
});

test('canceling Relink before its late prepare acknowledgment deletes the owned job without applying',async()=>{
  const h=harness();try{
    h.setItems([offlineAsset()]);await h.open();h.button('Relink missing native asset files').click();await settle();h.chooseFiles(['Shot.mov']);h.button('Relink selected source files').click();
    h.button('Cancel native asset relink').click();assert.equal(h.deletes.length,0);h.prepares[0].resolve(h.job());await settle();
    assert.equal(h.deletes.length,1);assert.match(h.deletes[0].path,/jobs\/job-1\?project_epoch=epoch/);assert.equal(h.libraryWrites.length+h.projectWrites.length,0);assert.equal(h.prepares.length,1);assert.match(h.status(),/canceled.*project unchanged/i);
  }finally{h.destroy();}
});

test('folder import captures the chosen parent and refreshes the native root with ready per-file errors retained',async()=>{
  const h=harness({libraryCommit:(_operation,body)=>{
    h.setFolders([{id:'outer',name:'Shots',parent:null},{id:'inner',name:'Day 1',parent:'outer'},{id:'import-root',name:'Takes',parent:'inner'}]);
    h.setItems([{id:'new-asset',revision:assetRevision,name:'New shot',folder:'import-root',effective_folder:'import-root',media_count:1,file_count:1,missing_count:0,archived:false}]);
    return Promise.resolve({command_id:body.command_id,project_epoch:'epoch',imported_assets:1,skipped_files:1,error_count:1,created_folders:1,root_folder_id:'import-root',folders_revision:foldersRevision});
  }});try{
    await h.open();h.button('Import source folder').click();await settle();assert.equal(h.button('Choose this source folder').disabled,true);assert.equal(h.prepares.length,0);
    h.change('Import into native library folder','inner');h.button('Open folder Takes').click();await settle();h.button('Choose this source folder').click();await settle();
    const body=h.prepares[0].body;assert.deepEqual(body.operation.edit,{action:'import_tree',directory_token:'Takes',parent:'inner',folders_revision:foldersRevision});
    h.prepares[0].resolve(h.job());await settle();assert.deepEqual(h.preparedWrites,[body]);assert.equal(h.libraryWrites.length,1);assert.equal(h.projectWrites.length,0);assert.equal(h.field('Native asset folder').value,'import-root');assert.ok(h.texts().some(text=>/Takes\/bad.mov.*BAD_MEDIA.*Native probe failed/.test(text)));assert.match(h.status(),/1 assets.*1 skipped.*1 errors.*timeline unchanged/);
  }finally{h.destroy();}
});

test('recursive Relink uses its native asset revision and folder cancellation disposes the owned preparation',async()=>{
  const h=harness();try{
    h.setItems([offlineAsset()]);await h.open();h.button('Search folder for missing files').click();await settle();h.button('Open folder Takes').click();await settle();h.button('Choose this source folder').click();await settle();
    assert.deepEqual(h.prepares[0].body.operation.edit,{action:'relink_folder',id:'asset-a',revision:assetRevision,directory_token:'Takes'});
    h.button('Cancel source folder choice').click();h.prepares[0].resolve(h.job());await settle();assert.equal(h.deletes.length,1);assert.equal(h.libraryWrites.length,0);assert.equal(h.projectWrites.length,0);
    h.button('Relink missing native asset files').click();await settle();assert.equal(h.projectReads.length,1);assert.equal(h.field('Approved source files').children.length,2);
  }finally{h.destroy();}
});

test('an invalidated folder chooser aborts its source read and cannot start a command after a late response',async()=>{
  const stale=deferred(),h=harness({sourceReader:()=>stale.promise});try{
    await h.open();h.button('Import source folder').click();assert.equal(h.sourceReads.length,1);h.setContext({...h.context(),project_epoch:'new-epoch'});h.panel.invalidate();assert.equal(h.sourceReads[0].options.signal.aborted,true);
    stale.resolve({project_epoch:'epoch',directory_token:'',parent_token:null,page:0,pages:1,entries:[{kind:'directory',name:'Old',path_token:'Old'}]});await settle();await h.open();assert.throws(()=>h.button('Open folder Old'),/Expected/);assert.equal(h.prepares.length+h.libraryWrites.length,0);
  }finally{h.destroy();}
});
