import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaImportPanel} from '../js/media-import.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function settle(){for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));}
function harness({read,commit,onImported}={}){
  const original={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes=new Map();this.disabled=false;this.textContent='';this.open=false;this.value='';}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}
    setAttribute(name,value){this.attributes.set(name,value);}getAttribute(name){return this.attributes.get(name);}
    querySelector(selector){return selector==='form[method="dialog"] button'?this.headerClose??null:null;}
    get selectedOptions(){return this.children.filter(child=>child.selected);}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
    showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
  }
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(name,value){super('option');this.textContent=name;this.value=value;this.selected=false;}};
  const dialog=new Element('dialog'),root=new Element('root'),status=new Element('status');dialog.append(root,status);
  const closeButton=new Element('button');dialog.headerClose=closeButton;closeButton.addEventListener('click',()=>dialog.close());
  let context={project_epoch:'epoch',generation:'7'},writable=true;
  const files=['a.mp4','b.wav'].map(path_token=>({name:path_token,path_token})),reads=[],prepares=[],deletes=[],writes=[],imported=[];
  const receipt={command_id:'command-1',project_epoch:'epoch',media_ids:['9007199254740993'],errors:[]};
  const panel=createMediaImportPanel({dialog,root,status,getContext:()=>context,canCommit:()=>writable,
    api(path,body,options={}){
      if(options.method==='DELETE'){deletes.push(path);return Promise.resolve({state:'canceled'});}
      if(path==='/projects'){reads.push({path,options});return read?read(reads.length-1):Promise.resolve({importable_media:files});}
      if(path==='/media/imports/prepare'){const gate=deferred();prepares.push({...gate,body});return gate.promise;}
      throw Error(`Unexpected panel request ${path}`);
    },pause:()=>Promise.reject(Error('No unexpected polling in panel fixture')),
    commit(operation){writes.push(operation);return commit?commit(operation):Promise.resolve(receipt);},onImported(ids,value){imported.push(ids);return onImported?.(ids,value);},
  });
  const walk=node=>[node,...node.children.filter(child=>child instanceof Element).flatMap(walk)],find=predicate=>{const result=walk(root).find(predicate);assert(result);return result;};
  const list=()=>find(node=>node.getAttribute('aria-label')==='Files to import');
  const job=(patch={})=>({id:'import-1',project_epoch:'epoch',generation:'7',kind:'media_import',state:'ready',progress:{completed:2,total:2},result:{items:[{path_token:'a.mp4',name:'a.mp4',state:'ready'}],errors:[{path_token:'b.wav',name:'b.wav',code:'INVALID_MEDIA',message:'Unreadable file',status:422}]},...patch});
  return {panel,dialog,closeButton,root,status,files,reads,prepares,deletes,writes,imported,receipt,job,list,button:text=>find(node=>node.tag==='button' && node.textContent===text),results:()=>find(node=>node.tag==='ul').children,
    choose(indexes){list().children.forEach((option,index)=>{option.selected=indexes.includes(index);});list().dispatchEvent(new Event('change'));},
    setContext:value=>{context=value;},setWritable:value=>{writable=value;},destroy(){panel.hide();for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}},
  };
}

test('media import dialog has one explicit import action and supports selecting multiple files',async()=>{
  const h=harness();try{
    await h.panel.open();assert.equal(h.list().multiple,true);assert.equal(h.button('Import selected files').disabled,true);h.choose([0,1]);assert.equal(h.button('Import selected files').disabled,false);
    h.button('Import selected files').click();assert.deepEqual(h.prepares[0].body.path_tokens,['a.mp4','b.wav']);assert.equal(h.list().disabled,true);h.prepares[0].resolve(h.job());await settle();
    assert.deepEqual(h.writes,[{kind:'import_prepared_media',job_id:'import-1'}]);assert.deepEqual(h.imported,[['9007199254740993']]);assert.match(h.status.textContent,/1 files imported.*1 could not/);
    assert.match(h.results()[0].textContent,/a.mp4.*imported/);assert.match(h.results()[1].textContent,/b.wav.*INVALID_MEDIA.*Unreadable/);assert.equal(h.button('Import selected files').disabled,true);
    h.button('Import selected files').click();await settle();assert.equal(h.writes.length,1);assert.equal(h.prepares.length,1);
  }finally{h.destroy();}
});

test('readonly and foreign-project stale file selection cannot start an import',async()=>{
  const h=harness();try{
    h.setWritable(false);await h.panel.open();h.choose([0,1]);assert.equal(h.button('Import selected files').disabled,true);h.button('Import selected files').click();
    h.setWritable(true);h.panel.invalidate();assert.equal(h.button('Import selected files').disabled,false);
    h.setContext({project_epoch:'new-epoch',generation:'0'});h.panel.invalidate();assert.equal(h.button('Import selected files').disabled,true);h.button('Import selected files').click();assert.equal(h.prepares.length,0);
  }finally{h.destroy();}
});

test('closing and reopening before a late prepare acknowledgment cancels only that job and then reloads',async()=>{
  const h=harness();try{
    await h.panel.open();h.choose([0,1]);h.button('Import selected files').click();h.dialog.close();await h.panel.open();
    assert.equal(h.reads.length,1);assert.equal(h.button('Import selected files').disabled,true);h.prepares[0].resolve(h.job());await settle();
    assert.equal(h.deletes.length,1);assert.equal(h.writes.length,0);assert.equal(h.reads.length,2);assert.equal(h.list().children.length,2);assert.match(h.status.textContent,/files available/);
  }finally{h.destroy();}
});

test('late obsolete file lists cannot replace the reopened dialog',async()=>{
  const first=deferred(),h=harness({read:index=>index===0?first.promise:Promise.resolve({importable_media:[{path_token:'new.avi',name:'new.avi'}]})});try{
    const opened=h.panel.open();h.setContext({project_epoch:'new',generation:'0'});await h.panel.open();first.resolve({importable_media:[{path_token:'old.mp4',name:'old.mp4'}]});await opened;await settle();
    assert.deepEqual(h.list().children.map(option=>option.value),['new.avi']);assert.equal(h.prepares.length,0);
  }finally{h.destroy();}
});

test('committing blocks header close, Escape and reopen until the original acknowledgment stays visible',async()=>{
  const committing=deferred(),h=harness({commit:()=>committing.promise});try{
    await h.panel.open();h.choose([0,1]);h.button('Import selected files').click();h.prepares[0].resolve(h.job());await settle();
    assert.equal(h.writes.length,1);assert.equal(h.button('Cancel import').disabled,true);h.button('Cancel import').click();
    assert.equal(h.closeButton.disabled,true);h.closeButton.click();assert.equal(h.dialog.open,true);
    const escape=new Event('cancel',{cancelable:true});h.dialog.dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);
    await h.panel.open();assert.equal(h.reads.length,1);assert.match(h.status.textContent,/Importing/);
    h.dialog.close();assert.equal(h.dialog.open,true);
    committing.resolve(h.receipt);await settle();assert.equal(h.writes.length,1);assert.equal(h.prepares.length,1);assert.equal(h.deletes.length,0);assert.deepEqual(h.imported,[['9007199254740993']]);assert.equal(h.reads.length,1);
    assert.match(h.status.textContent,/1 files imported.*1 could not/);assert.equal(h.closeButton.disabled,false);h.closeButton.click();assert.equal(h.dialog.open,false);
  }finally{h.destroy();}
});

test('a commit error after attempted close or reopen keeps the unknown outcome visible without replay',async()=>{
  const committing=deferred(),h=harness({commit:()=>committing.promise});try{
    await h.panel.open();h.choose([0,1]);h.button('Import selected files').click();h.prepares[0].resolve(h.job());await settle();
    h.dialog.close();await h.panel.open();committing.reject(Error('Connection dropped'));await settle();
    assert.equal(h.dialog.open,true);assert.match(h.status.textContent,/Import command needs review.*Connection dropped.*Check command status/);
    assert.equal(h.writes.length,1);assert.equal(h.prepares.length,1);assert.equal(h.reads.length,1);assert.equal(h.deletes.length,0);assert.deepEqual(h.imported,[]);
    assert.equal(h.button('Import selected files').disabled,true);assert.equal(h.closeButton.disabled,false);
  }finally{h.destroy();}
});

test('acknowledged import followed by a refresh error stays consumed until explicit refresh',async()=>{
  const h=harness({onImported:()=>{throw Error('Project refresh failed');}});try{
    await h.panel.open();h.choose([0,1]);h.button('Import selected files').click();h.prepares[0].resolve(h.job());await settle();
    assert.match(h.status.textContent,/Import applied.*refresh failed.*do not repeat/);assert.equal(h.button('Import selected files').disabled,true);assert.equal(h.writes.length,1);
    h.button('Refresh import files').click();await settle();assert.equal(h.writes.length,1);assert.equal(h.prepares.length,1);assert.equal(h.list().selectedOptions.length,0);
  }finally{h.destroy();}
});

test('losing the writer lease during checking cancels before the automatic commit',async()=>{
  const h=harness();try{
    await h.panel.open();h.choose([0,1]);h.button('Import selected files').click();h.setWritable(false);h.panel.invalidate();h.prepares[0].resolve(h.job());await settle();
    assert.equal(h.writes.length,0);assert.equal(h.deletes.length,1);assert.equal(h.button('Import selected files').disabled,true);
  }finally{h.destroy();}
});
