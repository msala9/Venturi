import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAssetPanel} from '../js/native-assets.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));}
const foldersRevision='f'.repeat(64);
const assetRevision='a'.repeat(64);
function harness({pageReader,folderReader,libraryCommit,projectCommit}={}){
  const original={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes=new Map();this.textContent='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.parent=null;}
    get value(){return this.tag==='select'?this.selectedOptions[0]?.value??this._value:this._value;}
    set value(value){this._value=String(value);if(this.tag==='select')for(const child of this.children)child.selected=child.value===this._value;}
    get selectedOptions(){return this.children.filter(child=>child.tag==='option' && child.selected);}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    append(...children){for(const child of children){this.children.push(child);if(child instanceof Element)child.parent=this;}}
    replaceChildren(...children){for(const child of this.children)if(child instanceof Element)child.parent=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
    dispatchEvent(event){const result=super.dispatchEvent(event);this[`on${event.type}`]?.(event);return result;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  const body=new Element('body'),root=new Element('root');body.append(root);
  globalThis.document={body,createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  let context={project_name:'project.vvproj',project_epoch:'epoch',generation:'7',media:[{id:'media-a',name:'Shot A'},{id:'media-b',name:'Shot B'}],selected_ids:['media-a']},writable=true;
  let items=[{id:'asset-a',revision:'rev-a',name:'Reusable shot',media_count:2,file_count:1,archived:false,can_restore_previous:true}];
  let folders=[{id:'outer',name:'Shots',parent:null},{id:'inner',name:'Day 1',parent:'outer'},{id:'other',name:'Other',parent:null}];
  const pages=[],folderReads=[],prepares=[],deletes=[],libraryWrites=[],projectWrites=[],imported=[],notices=[],deleteGate=deferred();
  let delayDelete=false;
  const panel=createNativeAssetPanel({root,getContext:()=>context,canCommit:()=>writable,notice:text=>notices.push(text),onImported:ids=>imported.push(ids),
    libraryCommit(operation){libraryWrites.push(structuredClone(operation));return libraryCommit?libraryCommit(operation):Promise.resolve({command_id:'published',project_epoch:context.project_epoch});},
    projectCommit(operation){projectWrites.push(structuredClone(operation));return projectCommit?projectCommit(operation):Promise.resolve({command_id:'imported',project_epoch:context.project_epoch,media_ids:['new-media']});},
    api(path,body,options={}){
      if(path.startsWith('/native-assets/folders?')){
        folderReads.push({path,options});
        return folderReader?folderReader(folderReads.length-1,path,structuredClone(folders)):Promise.resolve({project_epoch:context.project_epoch,version:1,folders_revision:foldersRevision,folders:structuredClone(folders)});
      }
      if(path.startsWith('/native-assets/pages/')){
        pages.push({path,options});
        return pageReader?pageReader(pages.length-1,path,items):Promise.resolve({page:0,pages:1,total:items.length,items:structuredClone(items)});
      }
      if(path==='/native-assets/prepare'){const gate=deferred();prepares.push({...gate,body:structuredClone(body),options});return gate.promise;}
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
  const job=(index=0,patch={})=>{const {project_epoch,if_generation,action}=prepares[index].body;return {id:`job-${index+1}`,state:'ready',project_epoch,generation:if_generation,kind:action.kind,bytes:0,total_bytes:32,result:action.kind==='import'?{asset_id:action.asset_id,revision:action.revision}:null,...patch};};
  return {panel,root,pages,folderReads,prepares,deletes,libraryWrites,projectWrites,imported,notices,button,field,status,job,deleteGate,
    context:()=>context,setContext:value=>{context=value;},setWritable:value=>{writable=value;},setItems:value=>{items=value;},setFolders:value=>{folders=value;},delayDelete:()=>{delayDelete=true;},
    change(label,value){const node=field(label);node.value=value;node.dispatchEvent(new Event('change'));},
    chooseAssets(indexes){const node=field('Native assets');for(const [index,option] of node.children.entries())option.selected=indexes.includes(index);node.dispatchEvent(new Event('change'));},
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
    await h.open();for(const key of ['Delete','Backspace']){
      let stopped=0;const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:key});event.stopPropagation=()=>{stopped++;};
      h.root.dispatchEvent(event);assert.equal(stopped,1,key);assert.equal(event.defaultPrevented,false,key);
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
