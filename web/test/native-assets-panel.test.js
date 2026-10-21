import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAssetPanel} from '../js/native-assets.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));}
function harness({pageReader,libraryCommit,projectCommit}={}){
  const original={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes=new Map();this.textContent='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.parent=null;}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    append(...children){for(const child of children){this.children.push(child);if(child instanceof Element)child.parent=this;}}
    replaceChildren(...children){for(const child of this.children)if(child instanceof Element)child.parent=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name)??null;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  const body=new Element('body'),root=new Element('root');body.append(root);
  globalThis.document={body,createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  let context={project_name:'project.vvproj',project_epoch:'epoch',generation:'7',media:[{id:'media-a',name:'Shot A'},{id:'media-b',name:'Shot B'}],selected_ids:['media-a']},writable=true;
  let items=[{id:'asset-a',revision:'rev-a',name:'Reusable shot',media_count:2,file_count:1,archived:false,can_restore_previous:true}];
  const pages=[],prepares=[],deletes=[],libraryWrites=[],projectWrites=[],imported=[],notices=[],deleteGate=deferred();
  let delayDelete=false;
  const panel=createNativeAssetPanel({root,getContext:()=>context,canCommit:()=>writable,notice:text=>notices.push(text),onImported:ids=>imported.push(ids),
    libraryCommit(operation){libraryWrites.push(structuredClone(operation));return libraryCommit?libraryCommit(operation):Promise.resolve({command_id:'published',project_epoch:context.project_epoch});},
    projectCommit(operation){projectWrites.push(structuredClone(operation));return projectCommit?projectCommit(operation):Promise.resolve({command_id:'imported',project_epoch:context.project_epoch,media_ids:['new-media']});},
    api(path,body,options={}){
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
  return {panel,root,pages,prepares,deletes,libraryWrites,projectWrites,imported,notices,button,field,status,job,deleteGate,
    context:()=>context,setContext:value=>{context=value;},setWritable:value=>{writable=value;},setItems:value=>{items=value;},delayDelete:()=>{delayDelete=true;},
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
