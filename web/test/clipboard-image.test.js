import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_CLIPBOARD_IMAGE_BYTES,CLIPBOARD_IMAGE_TYPES,clipboardImageName,checkedClipboardImage,clipboardEventImage,readSystemClipboardImage,uploadClipboardImage,createClipboardImage,createClipboardImagePanel} from '../js/clipboard-image.js';
import {bindClipboardEvents} from '../js/clipboard.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let index=0;index<20;index++)await Promise.resolve();}
function harness({commit,onImported,onChange,readImage}={}){
  let context={project_epoch:'epoch',generation:'7',project_name:'Edit.vvproj',owner:'timeline',timeline_id:'11',timeline_revision:'rev',frame:0,clip_ids:['21'],media_ids:[],view_stamp:'view',source_stamp:'program'},writable=true;
  const blob=new Blob([new Uint8Array([1,2,3])],{type:'image/png'}),uploads=[],polls=[],deletes=[],pauses=[],mutations=[],imported=[],changes=[],reads=[];
  const receipt={command_id:'command-image',project_epoch:'epoch',media_ids:['9007199254740993'],errors:[]};
  const job=(state='ready',patch={})=>({id:'image-1',kind:'clipboard_image',project_epoch:'epoch',generation:'7',state,result:state==='ready'?{suggested_name:'Image 001',extension:'png',mime:'image/png',bytes:3,width:2,height:2}:null,...patch});
  const upload=(value,captured)=>{const gate=deferred();uploads.push({...gate,blob:value,context:captured});return gate.promise;};
  const api=(path,body,options={})=>{if(options.method==='DELETE'){deletes.push(path);return Promise.resolve({state:'canceled'});}const gate=deferred();polls.push({...gate,path,options});return gate.promise;};
  const pause=(ms,signal)=>{const gate=deferred(),abort=()=>gate.reject(new DOMException('Canceled','AbortError'));pauses.push({...gate,signal,ms});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();return gate.promise.finally(()=>signal.removeEventListener('abort',abort));};
  const write=operation=>{mutations.push(operation);if(commit)return commit(operation);context={...context,generation:'8',timeline_revision:'new-rev'};return Promise.resolve(receipt);};
  const read=()=>{reads.push(true);return readImage?readImage():Promise.resolve(blob);};
  const controller=createClipboardImage({getContext:()=>context,canCommit:()=>writable,commit:write,upload,api,pause,readImage:read,onImported:(ids,result)=>{imported.push({ids,result});return onImported?.(ids,result);},onChange:state=>{changes.push(state);onChange?.(state,controller);}});
  return {controller,blob,uploads,polls,deletes,pauses,mutations,imported,changes,reads,receipt,job,upload,api,pause,write,read,getContext:()=>context,canCommit:()=>writable,setContext:patch=>{context={...context,...patch};},setWritable:value=>{writable=value;}};
}
async function ready(h){const pending=h.controller.paste(h.blob);h.uploads.at(-1).resolve(h.job());await pending;}

test('six native image MIME types and 32 MiB limit are validated before reading bytes',()=>{
  assert.equal(MAX_CLIPBOARD_IMAGE_BYTES,32*1024*1024);assert.deepEqual(Object.keys(CLIPBOARD_IMAGE_TYPES),['image/png','image/jpeg','image/webp','image/gif','image/bmp','image/tiff']);
  for(const type of Object.keys(CLIPBOARD_IMAGE_TYPES))assert.equal(checkedClipboardImage({type,size:1}).type,type);
  for(const blob of [{type:'image/svg+xml',size:1},{type:'image/jpg',size:1},{type:'image/png',size:0},{type:'image/png',size:MAX_CLIPBOARD_IMAGE_BYTES+1}])assert.throws(()=>checkedClipboardImage(blob));
});

test('native name validation trims and bounds UTF-8 while preserving ordinary Unicode and leading dots',()=>{
  assert.equal(clipboardImageName(' Image 001 '),'Image 001');assert.equal(clipboardImageName('é'.repeat(60)),'é'.repeat(60));assert.equal(clipboardImageName('.still'),'.still');
  for(const name of ['','.','..','a/b','a\\b','a\0b','a\nb','é'.repeat(61)])assert.throws(()=>clipboardImageName(name));
});

test('real paste-event File is obtained synchronously and MIME preference matches native order',()=>{
  const png=new Blob(['png'],{type:'image/png'}),jpeg=new Blob(['jpg'],{type:'image/jpeg'}),reads=[];
  assert.equal(clipboardEventImage({items:[{kind:'file',type:'image/jpeg',getAsFile(){reads.push('jpg');return jpeg;}},{kind:'file',type:'image/png',getAsFile(){reads.push('png');return png;}}]}),png);assert.deepEqual(reads,['png']);
  assert.equal(clipboardEventImage({items:[{kind:'string',type:'image/png'},{kind:'file',type:'text/plain'}]}),null);
  assert.throws(()=>clipboardEventImage({items:[{kind:'file',type:'image/png',getAsFile:()=>({type:'image/png',size:MAX_CLIPBOARD_IMAGE_BYTES+1,arrayBuffer:()=>assert.fail('Do not read oversized files')})}]}));
});

test('explicit clipboard image read uses user gesture and selects actual browser-supported native MIME',async()=>{
  const png=new Blob(['png'],{type:'image/png'}),gate=deferred();let reads=0;
  const pending=readSystemClipboardImage({clipboard:{read(){reads++;return gate.promise;}}});assert.equal(reads,1);gate.resolve([{types:['image/png'],getType:async type=>{assert.equal(type,'image/png');return png;}}]);assert.equal(await pending,png);
  await assert.rejects(readSystemClipboardImage({clipboard:{read:async()=>[{types:['text/plain']} ]}}),/no supported image/);await assert.rejects(readSystemClipboardImage({clipboard:null}),/unavailable/);
});

test('raw upload transmits the original Blob and MIME without arrayBuffer or transcoding',async()=>{
  const blob={type:'image/png',size:3,arrayBuffer:()=>assert.fail('Upload the Blob directly')},context={project_epoch:'epoch',generation:'7'},calls=[];
  assert.deepEqual(await uploadClipboardImage(blob,context,{fetcher:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>({id:'image-1'})};}}),{id:'image-1'});
  assert.equal(calls[0].path,'/api/v1/clipboard/images/prepare?project_epoch=epoch&if_generation=7');assert.equal(calls[0].options.body,blob);assert.deepEqual(calls[0].options.headers,{'Content-Type':'image/png'});
  await assert.rejects(uploadClipboardImage(blob,context,{fetcher:async()=>({ok:false,status:409,json:async()=>({error:{code:'IMAGE_NAME_TAKEN',message:'Already exists'}})})}),error=>error.code==='IMAGE_NAME_TAKEN');
});

test('saved-project preparation polls and exposes server suggestion without creating a project command',async()=>{
  const h=harness(),pending=h.controller.paste(h.blob);assert.equal(h.uploads[0].blob,h.blob);assert.deepEqual(h.uploads[0].context,{project_epoch:'epoch',generation:'7'});h.uploads[0].resolve(h.job('queued'));await flush();assert.equal(h.pauses[0].ms,300);h.pauses[0].resolve();await flush();assert.equal(h.polls[0].path,'/clipboard/images/jobs/image-1?project_epoch=epoch');h.polls[0].resolve(h.job());
  assert.equal((await pending).suggested_name,'Image 001');assert.equal(h.mutations.length,0);assert.equal(h.controller.state().phase,'ready');assert.equal(h.controller.busy(),true);
});

test('Add sends one explicit native import and allows its own generation refresh callback',async()=>{
  const h=harness();await ready(h);assert.equal(await h.controller.add('  Image custom  '),h.receipt);assert.deepEqual(h.mutations,[{kind:'import_clipboard_image',job_id:'image-1',name:'Image custom'}]);assert.deepEqual(h.imported,[{ids:h.receipt.media_ids,result:h.receipt}]);assert.equal(h.getContext().generation,'8');assert.equal(h.deletes.length,0);assert.equal(h.controller.busy(),false);
});

test('unsaved project explains Save before image read/upload and never falls back to native text paste',async()=>{
  const h=harness();h.setContext({project_name:null});await assert.rejects(h.controller.pasteSystem(),/Save the current project/);await assert.rejects(h.controller.paste(h.blob),/Save the current project/);assert.equal(h.controller.state().phase,'save_required');assert.equal(h.reads.length,0);assert.equal(h.uploads.length,0);assert.equal(h.mutations.length,0);
});

test('image name collision keeps the exact ready job editable for another explicit Add',async()=>{
  let attempts=0;const h=harness({commit:async()=>{if(!attempts++)throw Object.assign(Error('That image name exists'),{code:'IMAGE_NAME_TAKEN'});return h.receipt;}});await ready(h);
  await assert.rejects(h.controller.add('Image 001'),/exists/);assert.equal(h.controller.state().phase,'ready');assert.equal(h.controller.busy(),true);assert.equal(h.deletes.length,0);assert.equal(await h.controller.add('Image renamed'),h.receipt);assert.equal(h.mutations.length,2);assert.equal(h.mutations[1].job_id,'image-1');assert.equal(h.mutations[1].name,'Image renamed');assert.equal(h.uploads.length,1);
});

test('Cancel during upload retains ownership until exact late acknowledgment is deleted once',async()=>{
  const h=harness(),pending=h.controller.paste(h.blob);assert.equal(h.controller.cancel(),true);assert.equal(await h.controller.paste(h.blob),null);h.uploads[0].resolve(h.job('queued'));assert.equal(await pending,null);assert.deepEqual(h.deletes,['/clipboard/images/jobs/image-1?project_epoch=epoch']);assert.equal(h.mutations.length,0);assert.equal(h.controller.busy(),false);
});

test('Cancel interrupts polling and prevents a ready job from being added',async()=>{
  const h=harness(),pending=h.controller.paste(h.blob);h.uploads[0].resolve(h.job('running'));await flush();h.controller.cancel();assert.equal(await pending,null);assert.equal(h.pauses[0].signal.aborted,true);assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);
  const prepared=harness();await ready(prepared);prepared.controller.cancel();assert.equal(await prepared.controller.add('Image 001'),null);await flush();assert.equal(prepared.deletes.length,1);assert.equal(prepared.mutations.length,0);
});

test('epoch/generation/selection/viewport/source/path changes and writer loss reject late preparation',async()=>{
  for(const patch of [{project_epoch:'next'},{generation:'8'},{clip_ids:[]},{media_ids:['other']},{view_stamp:'resize'},{source_stamp:'source'},{project_name:'Save_as.vvproj'},{writer:false}]){
    const h=harness(),pending=h.controller.paste(h.blob);if(patch.writer===false)h.setWritable(false);else h.setContext(patch);h.controller.invalidate();h.uploads[0].resolve(h.job());assert.equal(await pending,null,JSON.stringify(patch));assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);
  }
});

test('system permission denial or late read after Cancel never uploads or writes project data',async()=>{
  const denied=harness({readImage:async()=>{throw Error('Permission denied');}});await assert.rejects(denied.controller.pasteSystem(),/Permission denied/);assert.equal(denied.uploads.length,0);assert.equal(denied.controller.busy(),false);
  const gate=deferred(),h=harness({readImage:()=>gate.promise}),pending=h.controller.pasteSystem();assert.equal(h.reads.length,1);h.controller.cancel();gate.resolve(h.blob);assert.equal(await pending,null);assert.equal(h.uploads.length,0);assert.equal(h.mutations.length,0);
});

test('foreign IDs/epoch, metadata mismatch and oversized native dimensions cannot enable Add',async()=>{
  for(const patch of [{id:'../bad'},{kind:'other'},{project_epoch:'next'},{generation:'8'},{result:{suggested_name:'Image 001',extension:'jpg',mime:'image/jpeg',bytes:3,width:2,height:2}},{result:{suggested_name:'Image 001',extension:'png',mime:'image/png',bytes:4,width:2,height:2}},{result:{suggested_name:'Image 001',extension:'png',mime:'image/png',bytes:3,width:32769,height:2}}]){
    const h=harness(),pending=h.controller.paste(h.blob);h.uploads[0].resolve(h.job('ready',patch));await assert.rejects(pending);assert.equal(h.mutations.length,0);assert.equal(await h.controller.add('Image 001'),null);assert.equal(h.deletes.length,patch.result?1:0);
  }
});

test('duplicate Add, Cancel and new image requests cannot repeat a committing mutation',async()=>{
  const gate=deferred(),h=harness({commit:()=>gate.promise});await ready(h);const pending=h.controller.add('Image 001');assert.equal(await h.controller.add('Image again'),null);assert.equal(h.controller.cancel(),false);assert.equal(await h.controller.paste(h.blob),null);gate.resolve(h.receipt);assert.equal(await pending,h.receipt);assert.equal(h.mutations.length,1);assert.equal(h.deletes.length,0);
});

test('unknown Add outcome never releases or replays the submitted job',async()=>{
  const h=harness({commit:async()=>{throw Object.assign(Error('Response lost'),{code:'OUTCOME_UNKNOWN'});}});await ready(h);await assert.rejects(h.controller.add('Image 001'),/Response lost/);assert.equal(h.controller.state().phase,'uncertain');assert.equal(h.deletes.length,0);assert.equal(h.mutations.length,1);assert.equal(await h.controller.add('Image again'),null);
});

test('late Add acknowledgment after project replacement does not select/open media in another project',async()=>{
  for(const patch of [{project_epoch:'next'},{timeline_id:'12'},{clip_ids:[]},{owner:'pool'},{view_stamp:'resized'},{source_stamp:'new-source'}]){const gate=deferred(),h=harness({commit:()=>gate.promise});await ready(h);const pending=h.controller.add('Image 001');h.setContext(patch);gate.resolve(h.receipt);await pending;assert.equal(h.imported.length,0,JSON.stringify(patch));assert.equal(h.deletes.length,0);}
});

test('acknowledged Add with failed view refresh remains applied and malformed ACK never selects media',async()=>{
  const h=harness({onImported:()=>{throw Error('Source unavailable');}});await ready(h);assert.equal(await h.controller.add('Image 001'),h.receipt);assert.match(h.controller.state().message,/Image added.*refresh failed.*Do not repeat/);assert.equal(h.deletes.length,0);
  const invalid=harness({commit:async()=>({...invalid.receipt,media_ids:[9007199254740992]})});await ready(invalid);await assert.rejects(invalid.controller.add('Image 001'),/unexpected result/);assert.equal(invalid.imported.length,0);assert.equal(invalid.deletes.length,0);
});

test('reentrant context changes before Add dispatch release the prepared image without a command',async()=>{
  const h=harness({onChange:state=>{if(state.phase==='committing')h.setContext({frame:100});}});await ready(h);assert.equal(await h.controller.add('Image 001'),null);assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);assert.equal(h.controller.state().phase,'canceled');
});

class Node {
  constructor(tag){this.tagName=tag;this.children=[];this.attributes=new Map();this.listeners=new Map();this.value='';this.disabled=false;this.open=false;}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes.set(key,value);}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  fire(type){this.listeners.get(type)?.({preventDefault(){}});}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  focus(){this.focused=true;}
  select(){this.selected=true;}
}
function find(node,predicate){if(predicate(node))return node;for(const child of node.children || []){const match=find(child,predicate);if(match)return match;}return null;}

test('image dialog displays server name, preserves editable name after collision, and Add is explicit',async()=>{
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),body:new Node('body')};
  try{
    let attempts=0;const h=harness({commit:async()=>{if(!attempts++)throw Object.assign(Error('Name exists'),{code:'IMAGE_NAME_TAKEN'});return h.receipt;}}),panel=createClipboardImagePanel({getContext:h.getContext,canCommit:h.canCommit,commit:h.write,upload:h.upload,api:h.api,pause:h.pause,onImported:ids=>h.imported.push(ids)}),pending=panel.paste(h.blob);
    assert.equal(panel.dialog.open,true);h.uploads[0].resolve(h.job());await pending;const name=find(panel.dialog,node=>node.attributes?.get('aria-label')==='Pasted image name'),form=find(panel.dialog,node=>node.tagName==='form'),add=find(panel.dialog,node=>node.textContent==='Add image');assert.equal(name.value,'Image 001');assert.equal(name.selected,true);assert.equal(add.disabled,false);assert.equal(h.mutations.length,0);
    form.fire('submit');await flush();assert.equal(panel.dialog.open,true);assert.equal(name.disabled,false);name.value='Renamed image';name.fire('input');form.fire('submit');await flush();assert.equal(h.mutations.length,2);assert.equal(h.mutations[1].name,'Renamed image');assert.equal(panel.dialog.open,false);assert.equal(h.imported.length,1);
  }finally{globalThis.document=previous;}
});

test('clipboard binding captures bitmap files synchronously only when text/plain is empty',async()=>{
  const listeners=new Map(),calls=[],blob=new Blob(['image'],{type:'image/png'});let alive=true;
  const target={addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type)};
  bindClipboardEvents({target,getOwner:()=> 'pool',copy:()=>{},paste:text=>calls.push({text}),imageFromEvent:data=>{assert.equal(alive,true);return clipboardEventImage(data);},pasteImage:image=>calls.push({image})});
  const fire=text=>{const event={type:'paste',target:{closest:()=>null},clipboardData:{getData:()=>text,items:[{kind:'file',type:'image/png',getAsFile:()=>{assert.equal(alive,true);return blob;}}]},preventDefault(){}};listeners.get('paste')(event);};
  fire('');alive=false;assert.deepEqual(calls,[{image:blob}]);await flush();alive=true;fire('venturi-clipboard/1\nNative clips win');assert.deepEqual(calls.at(-1),{text:'venturi-clipboard/1\nNative clips win'});await flush();fire('Ordinary text wins too');assert.deepEqual(calls.at(-1),{text:'Ordinary text wins too'});
});

test('unsaved image dialog offers normal Save project navigation without importing or replaying the image',async()=>{
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),body:new Node('body')};
  try{
    const h=harness();h.setContext({project_name:null});let saved=0;const panel=createClipboardImagePanel({getContext:h.getContext,canCommit:h.canCommit,commit:h.write,upload:h.upload,readImage:h.read,onSaveRequired:()=>saved++});
    await assert.rejects(panel.pasteSystem(),/Save the current project/);const save=find(panel.dialog,node=>node.textContent==='Save project'),add=find(panel.dialog,node=>node.textContent==='Add image');assert.equal(panel.dialog.open,true);assert.equal(save.hidden,false);assert.equal(add.disabled,true);save.fire('click');assert.equal(panel.dialog.open,false);assert.equal(saved,1);assert.equal(h.reads.length,0);assert.equal(h.uploads.length,0);assert.equal(h.mutations.length,0);
  }finally{globalThis.document=previous;}
});
