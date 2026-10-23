import test from "node:test";
import assert from "node:assert/strict";
import {libraryDocument,libraryMatches,sharedItemId,missingSharedUses,libraryCopyEligibility,libraryReferenceEligibility,createLibraryPanel} from "../js/library.js";

test("shared imports follow the captured document generation and preserve large seed strings",()=>{
  assert.equal(libraryDocument(null),null);
  const state={project_name:"saved.vvproj",project_epoch:"e",generation:"2"};
  assert.notEqual(libraryDocument(state),libraryDocument({...state,generation:"3"}));
  assert.notEqual(libraryDocument(state),libraryDocument({...state,project_epoch:"f"}));
  const item={id:"0123456789abcdef",kind:"video",model:"Generator",prompt:"A coastal scene",tool:"video",seed:"18446744073709551615"};
  assert.equal(libraryMatches(item,"18446744073709551615","video"),true);
  assert.equal(libraryMatches(item,"COAST","all"),true);
  assert.equal(libraryMatches(item,"coast","audio"),false);
});

test("shared recovery keeps project media IDs separate and relinks only missing uses of the selected item",()=>{
  const id="0123456789abcdef",name=`ds4-${id}-abcdef0123456789.mp4`;
  assert.equal(sharedItemId({name}),id);assert.equal(sharedItemId({name:"unrelated.mp4"}),null);
  const state={media:[{id:"42",name,offline:true},{id:"43",name,offline:false},{id:"44",name:"a.wav",offline:true,shared_origin:{item:{id}}},{id:"45",name:"unknown.mp4",offline:true}]};
  assert.deepEqual(missingSharedUses(state,id),["42","44"]);
  assert.deepEqual(missingSharedUses(state,"fedcba9876543210"),[]);
});

test('copy eligibility follows the advertised byte boundary and keeps the legacy limit without assuming a configured catalog',()=>{
  const limit=536870912,catalog={configured:true,max_copy_bytes:limit};
  assert.equal(libraryCopyEligibility({bytes:limit},catalog).allowed,true);
  assert.equal(libraryCopyEligibility({bytes:limit+1},catalog).allowed,false);
  assert.match(libraryCopyEligibility({bytes:limit+1},catalog).reason,/512\.0 MiB.*project-copy limit/);
  assert.equal(libraryCopyEligibility({bytes:limit},{configured:true}).allowed,true);
  assert.equal(libraryCopyEligibility({bytes:limit+1},{configured:true}).allowed,false);
  assert.equal(libraryCopyEligibility({bytes:100},{configured:true,max_copy_bytes:99}).allowed,false);
  for(const invalid of [null,0,-1,'536870912',Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(libraryCopyEligibility({bytes:1},{configured:true,max_copy_bytes:invalid}).allowed,false);
  for(const bytes of [undefined,0,-1,NaN,'100',Number.MAX_SAFE_INTEGER+1])assert.equal(libraryCopyEligibility({bytes},catalog).allowed,false);
  assert.equal(libraryCopyEligibility({bytes:1},null).allowed,false);
  assert.equal(libraryCopyEligibility({bytes:1},{configured:false,max_copy_bytes:limit}).allowed,false);
});

test('oversize catalog entries remain searchable and disable both copy actions without preparing a job',async()=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.isConnected=true;this.value='';this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(key,value){this.attributes[key]=value;}
    querySelectorAll(tag){return all(this).filter(node=>node.tag===tag);}
  }
  const all=node=>[node,...node.children.flatMap(all)],previous={document:globalThis.document,Option:globalThis.Option};
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  const large={id:'0123456789abcdef',kind:'video',model:'Large model',prompt:'Large coastal clip',bytes:536870913},small={id:'abcdef0123456789',kind:'image',model:'Small model',prompt:'Small image',bytes:1024};
  const state={project_name:'project.vvproj',project_epoch:'e',generation:'1',media:[{id:'7',offline:true,shared_origin:{item:{id:large.id}}}]},calls=[],writes=[],root=new Element('div');let panel;
  try{
    panel=createLibraryPanel({root,getState:()=>state,canCommit:()=>true,commit:async operation=>writes.push(operation),notice(){},api:async path=>{calls.push(path);return {configured:true,max_copy_bytes:536870912,items:[large,small],archive:{reachable:true,configured:true,retention_days:30}};}});
    await panel.open();const kind=all(root).find(node=>node.tag==='select');kind.value='all';kind.dispatchEvent(new Event('change'));
    const cards=()=>all(root).filter(node=>node.tag==='article'),largeCard=cards().find(node=>all(node).some(child=>String(child.textContent).includes(large.id))),actions=all(largeCard).filter(node=>node.tag==='button');
    assert.equal(cards().length,2);assert.equal(actions.length,2);assert.ok(actions.every(node=>node.disabled));assert.ok(actions.every(node=>node.attributes['aria-describedby']));assert.ok(all(largeCard).some(node=>String(node.textContent).includes('exceeds the 512.0 MiB project-copy limit')));
    for(const action of actions)action.dispatchEvent(new Event('click'));await Promise.resolve();assert.deepEqual(calls,['/library']);assert.deepEqual(writes,[]);
    const query=all(root).find(node=>node.type==='search');query.value='coastal';query.dispatchEvent(new Event('input'));assert.equal(cards().length,1);assert.ok(all(cards()[0]).some(node=>String(node.textContent).includes(large.id)));
    query.value='';query.dispatchEvent(new Event('input'));const smallCard=cards().find(node=>all(node).some(child=>String(child.textContent).includes(small.id)));assert.equal(all(smallCard).find(node=>node.tag==='button').disabled,false);
  }finally{await panel?.cancel();globalThis.document=previous.document;globalThis.Option=previous.Option;}
});

test('shared-original eligibility requires configured archive access and a safe relative locator, independently of copy size',()=>{
  const catalog={configured:true,shared_originals:true,max_copy_bytes:536870912},item={archived:true,archive_rel:'2026-10/video/clip.mp4',bytes:1073741824};
  assert.equal(libraryCopyEligibility(item,catalog).allowed,false);assert.equal(libraryReferenceEligibility(item,catalog).allowed,true);
  for(const archive_rel of ['',undefined,'/absolute.mp4','C:/absolute.mp4','C:relative.mp4','folder\\clip.mp4','../clip.mp4','folder/../clip.mp4','folder/./clip.mp4','folder//clip.mp4','folder/','folder/clip\0.mp4'])assert.equal(libraryReferenceEligibility({...item,archive_rel},catalog).allowed,false,String(archive_rel));
  for(const bytes of [0,-1,undefined,NaN,Number.MAX_SAFE_INTEGER+1])assert.equal(libraryReferenceEligibility({...item,bytes},catalog).allowed,false);
  for(const archived of [false,undefined,'true'])assert.equal(libraryReferenceEligibility({...item,archived},catalog).allowed,false);
  for(const configured of [{configured:true},{configured:true,shared_originals:false},{configured:false,shared_originals:true},null])assert.equal(libraryReferenceEligibility(item,configured).allowed,false);
});

test('explicit shared-original actions send reference mode and retain the token without fallback on refusal or project changes',async t=>{
  class Element extends EventTarget{
    constructor(tag){super();this.tag=tag;this.children=[];this.attributes={};this.isConnected=true;this.value='';this.disabled=false;}
    append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(key,value){this.attributes[key]=value;}
    querySelectorAll(tag){return all(this).filter(node=>node.tag===tag);}
  }
  const all=node=>[node,...node.children.flatMap(all)],previous={document:globalThis.document,Option:globalThis.Option};
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  try{for(const action of ['import','relink','failed','wrong-token','changed'])await t.test(action,async()=>{
    const item={id:'0123456789abcdef',kind:'video',model:'Model',prompt:'Archived clip',bytes:1073741824,archived:true,archive_rel:'2026-10/clip.mp4'},token='library://ds4/2026-10/clip.mp4';
    const state={project_name:'project.vvproj',project_epoch:'epoch',generation:'1',media:[{id:'7',offline:true,shared_origin:{item:{id:item.id}}}]},calls=[],writes=[],root=new Element('div');let resolve,reject,panel;
    try{
      panel=createLibraryPanel({root,getState:()=>state,canCommit:()=>true,commit:async operation=>writes.push(operation),notice(){},api:(path,body)=>{calls.push({path,body});return path==='/library'?Promise.resolve({configured:true,shared_originals:true,max_copy_bytes:536870912,items:[item],archive:{reachable:true,configured:true,retention_days:30}}):new Promise((done,failed)=>{resolve=done;reject=failed;});}});
      await panel.open();const kind=all(root).find(node=>node.tag==='select');kind.value='all';kind.dispatchEvent(new Event('change'));
      const nodes=all(root),status=nodes.find(node=>node.attributes.role==='status'),copy=nodes.find(node=>node.textContent==='Import project copy');assert.equal(copy.disabled,true);
      const reference=nodes.find(node=>node.textContent===(action==='relink'?'Relink 1 missing project uses to shared original':'Reference shared original'));assert.equal(reference.disabled,false);reference.dispatchEvent(new Event('click'));
      assert.match(status.textContent,/Checking shared original/);assert.deepEqual(calls[1],{path:`/library/items/${item.id}/prepare`,body:{project_epoch:'epoch',mode:'reference'}});
      if(action==='changed')state.generation='2';
      if(action==='failed')reject(new Error('SOURCE_CHANGED · shared original changed'));else resolve({id:'reference-job',state:'ready',result:{path_token:action==='wrong-token'?'local-copy.mp4':token}});
      await new Promise(done=>setImmediate(done));assert.equal(calls.length,2,'Reference checks never fall back to a copy prepare');
      if(action==='import')assert.deepEqual(writes,[{kind:'import_media',path_token:token}]);
      else if(action==='relink')assert.deepEqual(writes,[{kind:'edit_catalog',edit:{kind:'relink',items:[{media_id:'7',path_token:token}]}}]);
      else{assert.deepEqual(writes,[]);assert.doesNotMatch(status.textContent,/prepared project copy|server media picker/);}
    }finally{await panel?.cancel();}
  });}finally{globalThis.document=previous.document;globalThis.Option=previous.Option;}
});
