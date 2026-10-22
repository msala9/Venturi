import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedSourceDirectory,createSourcePicker} from '../js/source-picker.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const listing=(directory='',page=0)=>({project_epoch:'epoch',directory_token:directory,parent_token:directory?directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'':null,page,pages:directory==='Takes'?2:1,entries:directory===''?[{kind:'directory',name:'Takes',path_token:'Takes'}]:directory==='Takes' && page===0?[{kind:'directory',name:'Day 1',path_token:'Takes/Day 1'},{kind:'media',name:'Shot.mov',path_token:'Takes/Shot.mov'}]:[]});
function harness(t,{reader,onChoose}={}){
  const previous=globalThis.document;
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.disabled=false;this.textContent='';this.attributes=new Map();}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    focus(){globalThis.document.activeElement=this;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  const body=new Element('body'),root=new Element('section');body.append(root);globalThis.document={body,activeElement:body,createElement:tag=>new Element(tag)};t.after(()=>{globalThis.document=previous;});
  let epoch='epoch',valid=true,writable=true,cancelable=true;const calls=[],chosen=[],canceled=[];
  const control=createSourcePicker({root,getContext:()=>({project_epoch:epoch}),isCurrent:()=>valid,canChoose:()=>writable,canCancel:()=>cancelable,onChoose:async directory=>{chosen.push(directory);return onChoose?.(directory);},onCancel:()=>canceled.push(true),api:(path,_body,options)=>{const query=new URL(path,'http://fixture').searchParams;calls.push({path,options});return reader?reader(calls.length-1,query,options):Promise.resolve(listing(query.get('directory_token'),Number(query.get('page'))));}});
  const walk=node=>[node,...node.children.flatMap(walk)],button=text=>{const result=walk(root).find(node=>node.tagName==='BUTTON' && node.textContent===text);assert.ok(result,text);return result;};
  return {control,root,body,button,calls,chosen,canceled,setEpoch:value=>epoch=value,setValid:value=>valid=value,setWritable:value=>writable=value,setCancelable:value=>cancelable=value};
}

test('approved folder responses require exact native epoch, parent, page and immediate bounded entries',()=>{
  const value=listing('Takes');assert.equal(checkedSourceDirectory(value,'epoch','Takes',0),value);
  for(const patch of [{project_epoch:'other'},{directory_token:'elsewhere'},{parent_token:null},{page:1},{pages:129},{entries:[{kind:'directory',name:'..',path_token:'Takes/..'}]},{entries:[{kind:'directory',name:'deep/path',path_token:'Takes/deep/path'}]},{entries:[{kind:'directory',name:'.hidden',path_token:'Takes/.hidden'}]}])assert.throws(()=>checkedSourceDirectory({...value,...patch},'epoch','Takes',0));
  assert.throws(()=>checkedSourceDirectory({...value,entries:Array(33).fill(value.entries[0])},'epoch','Takes',0));
});

test('approved folder chooser browses native breadcrumbs and pages and chooses a non-root folder once',async t=>{
  const h=harness(t);await h.control.open();assert.equal(h.button('Choose this source folder').disabled,true);
  h.button('Open folder Takes').click();await settle();assert.equal(h.control.current().directory_token,'Takes');assert.equal(h.button('Choose this source folder').disabled,false);
  h.button('Next source page').click();await settle();assert.equal(h.control.current().page,1);h.button('Previous source page').click();await settle();
  h.button('Open folder Day 1').click();await settle();assert.equal(h.control.current().parent_token,'Takes');h.button('Parent source folder').click();await settle();assert.equal(h.control.current().directory_token,'Takes');
  h.button('Choose this source folder').click();h.button('Choose this source folder').click();await settle();assert.deepEqual(h.chosen,['Takes']);h.control.dispose();
});

test('new source reads and epoch changes reject late responses and detached old navigation callbacks',async t=>{
  const stale=deferred(),h=harness(t,{reader:index=>index===0?stale.promise:Promise.resolve(listing('Takes'))});
  const first=h.control.open();const signal=h.calls[0].options.signal;await h.control.open('Takes');assert.equal(signal.aborted,true);
  stale.resolve(listing());await first;assert.equal(h.control.current().directory_token,'Takes');const choose=h.button('Choose this source folder');h.setEpoch('new');choose.dispatchEvent(new Event('click'));await settle();assert.deepEqual(h.chosen,[]);assert.equal(h.control.current(),null);h.control.dispose();
});

test('source selection rechecks permission and owner before the asynchronous choose callback',async t=>{
  const h=harness(t);await h.control.open('Takes');h.button('Choose this source folder').click();h.setValid(false);await settle();assert.deepEqual(h.chosen,[]);
  h.control.dispose();h.body.replaceChildren();assert.equal(h.control.current(),null);
});

test('source preparation can be canceled after choosing but a final commit cannot be canceled',async t=>{
  const pending=deferred(),h=harness(t,{onChoose:()=>pending.promise});await h.control.open('Takes');h.button('Choose this source folder').click();await settle();
  h.setCancelable(false);h.control.refresh();assert.equal(h.button('Cancel source folder choice').disabled,true);h.button('Cancel source folder choice').click();assert.equal(h.canceled.length,0);
  h.setCancelable(true);h.control.refresh();h.button('Cancel source folder choice').click();assert.equal(h.canceled.length,1);pending.resolve();await settle();assert.equal(h.control.current(),null);
});

test('Escape cancels the owned source chooser without choosing and restores its opening focus',async t=>{
  const h=harness(t);await h.control.open();assert.equal(globalThis.document.activeElement,h.button('Open folder Takes'));
  const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});h.root.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(h.canceled.length,1);assert.deepEqual(h.chosen,[]);assert.equal(globalThis.document.activeElement,h.body);assert.equal(h.control.current(),null);
});
