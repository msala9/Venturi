import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG_DRAG_TYPE,makeCatalogDrag,parseCatalogDrag,createCatalogInteractions} from '../js/catalog-interactions.js';

const snapshot=()=>({media:[{id:'a',folder:null},{id:'b',folder:'f'},{id:'old',folder:null}],folders:[{id:'f',parent:null},{id:'g',parent:'f'}]});
const context=()=>({project_epoch:'epoch',generation:'7',snapshot:snapshot(),selected:['old'],anchor:'old',selectedFolder:null,presentation:{layout:'details',expanded:['f']},backgroundFolder:null});
const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};

function harness({canWrite=true,onDrop,dragType=CATALOG_DRAG_TYPE}={}){
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};this.style={};this.listeners=new Map();this.captured=new Set();this.bounds={left:10,top:20,right:210,bottom:220};}
    append(...children){for(const node of children){node.parentElement=this;node.ownerDocument=this.ownerDocument;this.children.push(node);}}
    remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
    setAttribute(key,value){this.attributes[key]=String(value);}
    addEventListener(type,callback){const rows=this.listeners.get(type) || [];rows.push(callback);this.listeners.set(type,rows);}
    removeEventListener(type,callback){this.listeners.set(type,(this.listeners.get(type) || []).filter(row=>row!==callback));}
    fire(type,extra={}){const event={type,target:this,button:0,pointerId:1,clientX:15,clientY:25,detail:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const callback of [...(this.listeners.get(type) || [])]){callback(event);if(event.stopped)break;}return event;}
    get isConnected(){return this===body || Boolean(this.parentElement?.isConnected);}
    getBoundingClientRect(){return {...this.bounds};}
    focus(){doc.activeElement=this;}
    setPointerCapture(pointer){this.captured.add(pointer);}
    hasPointerCapture(pointer){return this.captured.has(pointer);}
    releasePointerCapture(pointer){this.captured.delete(pointer);this.fire('lostpointercapture',{pointerId:pointer});}
  }
  const doc=new Element(),window=new Element(),body=new Element(),root=new Element(),list=new Element();let modal=false,writable=canWrite;
  doc.defaultView=window;doc.hidden=false;doc.createElement=tag=>new Element(tag);doc.querySelector=()=>modal?{}:null;root.ownerDocument=doc;body.append(root);root.ownerDocument=doc;root.append(list);
  const a=new Element('button'),b=new Element('button'),folder=new Element(),folderButton=new Element('button');a.dataset.mediaId='a';b.dataset.mediaId='b';folder.dataset.folderId='f';folder.append(folderButton);list.append(a,b,folder);a.bounds={left:30,top:40,right:100,bottom:60};b.bounds={left:110,top:70,right:180,bottom:100};folder.bounds={left:20,top:110,right:190,bottom:130};
  let value={...context(),rows:[{kind:'media',id:'a',element:a},{kind:'media',id:'b',element:b},{kind:'folder',id:'f',element:folder}]};
  const marquees=[],menus=[],drops=[],notices=[];
  const controller=createCatalogInteractions({root,list,getContext:()=>value,canWrite:()=>writable,onMarquee:result=>marquees.push(result),onContextMenu:result=>menus.push(result),onDrop:result=>{drops.push(result);return onDrop?.(result);},notice:message=>notices.push(message),dragType});
  const transfer=(raw=makeCatalogDrag('media',['b'],value),types=[dragType])=>({types,reads:0,getData(type){this.reads++;assert.equal(type,dragType);return raw;}});
  return {doc,window,body,root,list,a,b,folder,folderButton,controller,marquees,menus,drops,notices,transfer,overlay:root.children.at(-1),context:()=>value,setContext:next=>value=next,setModal:next=>modal=next,setWritable:next=>writable=next,down:extra=>list.fire('pointerdown',extra),move:extra=>doc.fire('pointermove',{target:list,...extra}),up:extra=>doc.fire('pointerup',{target:list,...extra})};
}

test('catalog drag v1 binds ordered distinct media or a folder to native epoch, generation and original membership',()=>{
  const owner=context(),raw=makeCatalogDrag('media',['b','a'],owner),payload=parseCatalogDrag(raw,owner);assert.deepEqual(payload.media_ids,['b','a']);assert.deepEqual(payload.source_folders,[{media_id:'b',folder_id:'f'},{media_id:'a',folder_id:null}]);payload.source_folders[0].folder_id='g';assert.equal(parseCatalogDrag(raw,owner).source_folders[0].folder_id,'f');
  const folder=makeCatalogDrag('folder','g',owner);assert.equal(parseCatalogDrag(folder,owner).source_parent,'f');assert.equal(parseCatalogDrag(folder,{...owner,snapshot:{...owner.snapshot,folders:[{id:'g',parent:null}]}}),null);
  assert.equal(makeCatalogDrag('media',['a','a'],owner),null);assert.equal(makeCatalogDrag('media',['foreign'],owner),null);assert.equal(makeCatalogDrag('folder','foreign',owner),null);assert.equal(makeCatalogDrag('media',Array.from({length:257},(_,index)=>String(index)),owner),null);
  for(const invalid of ['not JSON',JSON.stringify({...JSON.parse(raw),version:2}),JSON.stringify({...JSON.parse(raw),extra:true}),JSON.stringify({...JSON.parse(raw),generation:'8'}),JSON.stringify({...JSON.parse(raw),project_epoch:'foreign'})])assert.equal(parseCatalogDrag(invalid,owner),null);
  const moved={...owner,snapshot:{...owner.snapshot,media:owner.snapshot.media.map(item=>item.id==='b'?{...item,folder:'g'}:item)}};assert.equal(parseCatalogDrag(raw,moved),null);
});

test('a library interaction adapter accepts only its isolated internal MIME and leaves project catalog drops untouched',async()=>{
  const h=harness({dragType:'application/x-native-library-move'});try{
    const foreign=h.transfer(undefined,[CATALOG_DRAG_TYPE]);assert.notEqual(h.root.fire('dragover',{target:h.folderButton,dataTransfer:foreign}).defaultPrevented,true);assert.notEqual(h.root.fire('drop',{target:h.folderButton,dataTransfer:foreign}).defaultPrevented,true);await settle();assert.equal(foreign.reads,0);assert.deepEqual(h.drops,[]);
    const own=h.transfer();assert.equal(h.root.fire('dragover',{target:h.folderButton,dataTransfer:own}).defaultPrevented,true);assert.equal(h.root.fire('drop',{target:h.folderButton,dataTransfer:own}).defaultPrevented,true);await settle();assert.equal(own.reads,1);assert.equal(h.drops.length,1);assert.equal(h.drops[0].target.folder_id,'f');
  }finally{h.controller.dispose();}
});

test('native background marquee replaces only on release, ignores Ctrl/Shift and includes touching media rectangles in visible order',()=>{
  const h=harness({canWrite:false});try{
    h.down({ctrlKey:true,shiftKey:true});assert.deepEqual(h.context().selected,['old']);h.move({clientX:18,clientY:25});assert.equal(h.overlay.hidden,true);h.move({clientX:110,clientY:70});assert.equal(h.overlay.hidden,false);assert.equal(h.overlay.style.width,'95px');assert.deepEqual(h.marquees,[]);
    h.up({clientX:110,clientY:70});assert.equal(h.marquees.length,1);assert.deepEqual(h.marquees[0],{media_ids:['a','b'],rect:{left:15,right:110,top:25,bottom:70},additive:false,selected:['old'],anchor:'old',project_epoch:'epoch',generation:'7'});assert.deepEqual(h.context().selected,['old'],'the callback owns selection; readonly presentation remains usable');assert.equal(h.overlay.hidden,true);
    assert.equal(h.list.fire('click').defaultPrevented,true,'the trailing click cannot clear the just-published marquee');h.down();h.up({clientX:16,clientY:26});assert.equal(h.marquees.length,1,'an ordinary blank click remains the existing catalog handler responsibility');
  }finally{h.controller.dispose();}
});

test('marquee cancellation preserves old selection and anchor on Escape, capture loss, scroll, blur, disposal and stale context',async t=>{
  for(const action of ['escape','capture','pointercancel','scroll','blur','generation','snapshot','selection','viewport','modal','hidden','dispose'])await t.test(action,()=>{
    const h=harness();try{
      h.down();h.move({clientX:115,clientY:75});
      if(action==='escape')h.doc.fire('keydown',{target:h.list,key:'Escape'});else if(action==='capture')h.list.releasePointerCapture(1);else if(action==='pointercancel')h.doc.fire('pointercancel');else if(action==='scroll')h.doc.fire('scroll');else if(action==='blur')h.window.fire('blur');else if(action==='generation')h.setContext({...h.context(),generation:'8'});else if(action==='snapshot')h.setContext({...h.context(),snapshot:structuredClone(h.context().snapshot)});else if(action==='selection')h.setContext({...h.context(),selected:['a'],anchor:'a'});else if(action==='viewport')h.list.bounds={...h.list.bounds,right:220};else if(action==='modal')h.setModal(true);else if(action==='hidden')h.doc.hidden=true;else h.controller.dispose();
      h.up({clientX:115,clientY:75});assert.deepEqual(h.marquees,[]);assert.deepEqual(h.context().selected,action==='selection'?['a']:['old']);assert.equal(h.context().anchor,action==='selection'?'a':'old');assert.equal(h.overlay.hidden,true);
    }finally{h.controller.dispose();}
  });
});

test('release uses the latest row bounds, ignores folder hits and never starts a marquee from buttons or form controls',()=>{
  const h=harness();try{
    h.down({target:h.a});h.move({clientX:190,clientY:140});h.up({clientX:190,clientY:140});assert.equal(h.marquees.length,0);
    h.down();h.move({clientX:115,clientY:140});h.b.bounds={left:116,top:70,right:180,bottom:100};h.up({clientX:115,clientY:140});assert.deepEqual(h.marquees[0].media_ids,['a']);assert.deepEqual(h.drops,[]);
    const input=h.doc.createElement('input');h.list.append(input);h.down({target:input});h.up({clientX:120,clientY:150});assert.equal(h.marquees.length,1);
  }finally{h.controller.dispose();}
});

test('mouse and keyboard context menus identify native media/folders/background while preserving ordinary text and editor shortcuts',()=>{
  const h=harness({canWrite:false});try{
    const label=h.doc.createElement('span');h.a.append(label);assert.equal(h.root.fire('contextmenu',{target:label,clientX:55,clientY:45}).defaultPrevented,true);assert.equal(h.menus[0].kind,'media');assert.equal(h.menus[0].id,'a');assert.equal(h.menus[0].x,55);
    h.doc.fire('keydown',{target:h.folderButton,key:'F10',shiftKey:true});assert.equal(h.menus[1].kind,'folder');assert.equal(h.menus[1].id,'f');assert.equal(h.menus[1].keyboard,true);h.doc.fire('keydown',{target:h.list,key:'ContextMenu'});assert.equal(h.menus[2].kind,'background');
    const input=h.doc.createElement('input');h.folder.append(input);assert.notEqual(h.root.fire('contextmenu',{target:input}).defaultPrevented,true);h.doc.fire('keydown',{target:input,key:'ContextMenu'});h.doc.fire('keydown',{target:h.a,key:'F10'});h.doc.fire('keydown',{target:h.a,key:'ContextMenu',isComposing:true});assert.equal(h.menus.length,3);assert.deepEqual(h.drops,[]);
  }finally{h.controller.dispose();}
});

test('catalog drop reads protected payload only at drop, maps media/breadcrumb/background to native folders and remains writer-bound',async()=>{
  const h=harness();try{
    const transfer=h.transfer();const over=h.root.fire('dragover',{target:h.a,dataTransfer:transfer});assert.equal(over.defaultPrevented,true);assert.equal(transfer.reads,0);assert.equal(transfer.dropEffect,'move');h.root.fire('drop',{target:h.a,dataTransfer:transfer});await settle();assert.equal(transfer.reads,1);assert.deepEqual(h.drops[0].target,{kind:'media',id:'a',folder_id:null});
    const breadcrumb=h.doc.createElement('button');breadcrumb.dataset.catalogDropFolder='g';h.root.append(breadcrumb);h.root.fire('drop',{target:breadcrumb,dataTransfer:h.transfer()});await settle();assert.deepEqual(h.drops[1].target,{kind:'folder',id:'g',folder_id:'g'});
    h.setContext({...h.context(),backgroundFolder:'f'});h.root.fire('drop',{target:h.list,dataTransfer:h.transfer()});await settle();assert.equal(h.drops[2].target.folder_id,'f');
    h.setWritable(false);h.root.fire('drop',{target:h.folderButton,dataTransfer:h.transfer()});await settle();assert.equal(h.drops.length,3);h.setWritable(true);const foreign=h.transfer(null,['text/plain']);assert.notEqual(h.root.fire('dragover',{target:h.a,dataTransfer:foreign}).defaultPrevented,true);h.root.fire('drop',{target:h.a,dataTransfer:foreign});assert.equal(foreign.reads,0);
    h.root.fire('drop',{target:h.a,dataTransfer:h.transfer(JSON.stringify({...JSON.parse(makeCatalogDrag('media',['a'],h.context())),project_epoch:'foreign'}))});await settle();assert.equal(h.drops.length,3);assert.match(h.notices.at(-1),/changed/);
  }finally{h.controller.dispose();}
});

test('drop callbacks are single flight and recheck the captured project before deferred dispatch',async()=>{
  let release;const h=harness({onDrop:()=>new Promise(resolve=>release=resolve)});try{
    h.root.fire('drop',{target:h.a,dataTransfer:h.transfer()});h.root.fire('drop',{target:h.a,dataTransfer:h.transfer()});await settle();assert.equal(h.drops.length,1);assert.equal(h.drops[0].isCurrent(),true);h.setContext({...h.context(),generation:'8'});assert.equal(h.drops[0].isCurrent(),false);release();await settle();
    h.root.fire('drop',{target:h.a,dataTransfer:h.transfer()});h.setContext({...h.context(),generation:'9'});await settle();assert.equal(h.drops.length,1,'late dispatch cannot move sources in a newer project context');
  }finally{h.controller.dispose();}
});
