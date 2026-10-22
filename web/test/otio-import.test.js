import test from 'node:test';
import assert from 'node:assert/strict';
import {otioImportName,checkedOtioImportJob,createOtioImport,createOtioImportPanel} from '../js/otio-import.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let index=0;index<16;index++)await Promise.resolve();}
function harness({commit,onImported,onChange}={}){
  let context={project_epoch:'epoch',generation:'7',project_name:null},writable=true,source=true;
  const prepares=[],polls=[],pauses=[],deletes=[],writes=[],changes=[],imported=[],calls=[];
  const receipt={command_id:'command-1',project_epoch:'epoch',timeline_ids:['9007199254740993'],media_ids:['9007199254740995'],folder_id:'9007199254740997',warnings:['Native import warning']};
  const job=(state='ready',patch={})=>({id:'otio-1',project_epoch:'epoch',generation:'7',kind:'otio_import',state,error:null,result:state==='ready'?{path_token:'edit.otio',timeline_count:2,media_count:3,warnings:['Missing media retained offline']}:null,...patch});
  const api=(path,body,options={})=>{
    calls.push({path,body,options});
    if(options.method==='DELETE'){deletes.push(path);return Promise.resolve({state:'canceled'});}
    const gate=deferred();(path==='/projects/otio/prepare'?prepares:polls).push(gate);return gate.promise;
  };
  const pause=(ms,signal)=>{
    const gate=deferred(),abort=()=>gate.reject(new DOMException('Canceled','AbortError'));
    pauses.push({...gate,ms,signal});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    return gate.promise.finally(()=>signal.removeEventListener('abort',abort));
  };
  const write=operation=>{writes.push(operation);return commit?commit(operation):Promise.resolve(receipt);};
  const transfer=createOtioImport({getContext:()=>context,canCommit:()=>writable,api,pause,commit:write,
    onChange(state){changes.push(state);onChange?.(state,transfer);},
    onImported(result){imported.push(result);return onImported?.(result);},
  });
  return {transfer,api,pause,write,prepares,polls,pauses,deletes,writes,changes,imported,calls,receipt,job,
    run:()=>transfer.prepare('edit.otio',()=>source),getContext:()=>context,canCommit:()=>writable,
    setContext:value=>{context=value;},setWritable:value=>{writable=value;},setSource:value=>{source=value;}};
}
async function ready(h){const pending=h.run();h.prepares.at(-1).resolve(h.job());await pending;}

test('OTIO names use trimmed native labels with a UTF-8 byte limit',()=>{
  assert.equal(otioImportName('  Edit one  '),'Edit one');assert.equal(otioImportName('é'.repeat(64)),'é'.repeat(64));
  for(const value of ['', '  ', 'é'.repeat(65), 'bad\nname', 'bad\u0085name'])assert.throws(()=>otioImportName(value));
});

test('untitled authoritative Session prepares and polls without applying or changing history',async()=>{
  const h=harness(),pending=h.run();assert.deepEqual(h.calls[0].body,{project_epoch:'epoch',if_generation:'7',path_token:'edit.otio'});
  h.prepares[0].resolve(h.job('queued',{progress:{completed:0,total:0}}));await flush();assert.equal(h.pauses[0].ms,300);assert.equal(h.writes.length,0);assert.doesNotMatch(h.transfer.state().message,/0\/0/);
  h.pauses[0].resolve();await flush();assert.equal(h.calls.at(-1).path,'/projects/otio/jobs/otio-1?project_epoch=epoch');
  h.polls[0].resolve(h.job('running',{progress:{completed:1,total:2}}));await flush();assert.match(h.transfer.state().message,/1\/2 media checked/);h.pauses[1].resolve();await flush();h.polls[1].resolve(h.job());
  assert.deepEqual(await pending,{path_token:'edit.otio',timeline_count:2,media_count:3,warnings:['Missing media retained offline']});
  assert.equal(h.transfer.state().phase,'ready');assert.equal(h.transfer.busy(),true);assert.equal(h.writes.length,0);assert.equal(h.deletes.length,0);
});

test('explicit final choice emits one native merge operation and preserves high IDs',async()=>{
  for(const reuse_existing of [false,true]){
    const h=harness();await ready(h);assert.equal(await h.transfer.apply('  Imported Edit  ',reuse_existing),h.receipt);
    assert.deepEqual(h.writes,[{kind:'import_prepared_otio',job_id:'otio-1',name:'Imported Edit',reuse_existing}]);
    assert.deepEqual(h.imported,[h.receipt]);assert.equal(h.transfer.busy(),false);assert.equal(h.transfer.state().phase,'applied');assert.equal(h.deletes.length,0);
  }
});

test('name and reuse policy validation retain the ready preparation for correction',async()=>{
  const h=harness();await ready(h);await assert.rejects(h.transfer.apply('',false));await assert.rejects(h.transfer.apply('Edit',undefined));
  assert.equal(h.writes.length,0);assert.equal(h.transfer.state().phase,'ready');assert.equal(await h.transfer.apply('Edit',false),h.receipt);
});

test('zero native timelines are visible but cannot create an empty Undo step',async()=>{
  const h=harness(),pending=h.run();h.prepares[0].resolve(h.job('ready',{result:{path_token:'edit.otio',timeline_count:0,media_count:0,warnings:[]}}));await pending;
  await assert.rejects(h.transfer.apply('Edit',false),/no timelines/);assert.equal(h.writes.length,0);h.transfer.cancel();await flush();assert.equal(h.deletes.length,1);
});

test('cancel before acknowledgment releases the exact late job before accepting another preparation',async()=>{
  const h=harness(),pending=h.run();assert.equal(h.calls[0].options.signal,undefined);assert.equal(h.transfer.cancel(),true);assert.equal(h.transfer.cancel(),false);assert.equal(await h.run(),null);
  h.prepares[0].resolve(h.job('queued'));assert.equal(await pending,null);assert.deepEqual(h.deletes,['/projects/otio/jobs/otio-1?project_epoch=epoch']);assert.equal(h.writes.length,0);assert.equal(h.transfer.busy(),false);
});

test('canceling ready preparation prevents apply and deletes it once',async()=>{
  const h=harness();await ready(h);h.transfer.cancel();assert.equal(await h.transfer.apply('Edit',false),null);await flush();assert.equal(h.deletes.length,1);assert.equal(h.writes.length,0);assert.equal(h.transfer.state().phase,'idle');
});

test('cancel interrupts polling and ignores an already outstanding late result',async()=>{
  const waiting=harness(),first=waiting.run();waiting.prepares[0].resolve(waiting.job('queued'));await flush();waiting.transfer.cancel();assert.equal(await first,null);assert.equal(waiting.pauses[0].signal.aborted,true);assert.equal(waiting.polls.length,0);
  const h=harness(),pending=h.run();h.prepares[0].resolve(h.job('running'));await flush();h.pauses[0].resolve();await flush();h.transfer.cancel();h.polls[0].resolve(h.job());assert.equal(await pending,null);assert.equal(h.deletes.length,1);assert.equal(h.writes.length,0);
});

test('epoch, generation, writer and dialog selection changes invalidate preparation',async()=>{
  for(const change of ['epoch','generation','writer','source']){
    const h=harness(),pending=h.run();
    if(change==='epoch')h.setContext({project_epoch:'new',generation:'7'});if(change==='generation')h.setContext({project_epoch:'epoch',generation:'8'});if(change==='writer')h.setWritable(false);if(change==='source')h.setSource(false);
    h.transfer.invalidate();h.prepares[0].resolve(h.job());assert.equal(await pending,null,change);assert.equal(await h.transfer.apply('Edit',false),null,change);assert.equal(h.writes.length,0,change);assert.equal(h.deletes.length,1,change);
  }
});

test('native failure is visible and a corrected preparation can be retried without a command',async()=>{
  const h=harness(),first=h.run();h.prepares[0].resolve(h.job('failed',{error:'INVALID_OTIO'}));await assert.rejects(first,/INVALID_OTIO/);
  assert.equal(h.transfer.busy(),false);assert.equal(h.transfer.state().phase,'error');assert.equal(h.writes.length,0);
  const second=h.run();h.prepares[1].resolve(h.job('ready',{id:'otio-2'}));await second;assert.equal(h.transfer.state().phase,'ready');assert.equal(h.deletes.length,1);
});

test('job DTO validation rejects foreign ownership, unfinished results and oversized summaries',async()=>{
  for(const patch of [{id:'../bad'},{project_epoch:'other'},{generation:'8'},{kind:'other'},{state:'applied'},{result:{path_token:'other.otio',timeline_count:1,media_count:1,warnings:[]}},{result:{path_token:'edit.otio',timeline_count:65,media_count:1,warnings:[]}},{result:{path_token:'edit.otio',timeline_count:1,media_count:10001,warnings:[]}},{result:{path_token:'edit.otio',timeline_count:1,media_count:1,warnings:Array(66).fill('warning')}}]){
    const h=harness(),pending=h.run();h.prepares[0].resolve(h.job('ready',patch));await assert.rejects(pending);assert.equal(h.writes.length,0);
  }
  const h=harness(),owner={job:'otio-1',epoch:'epoch',generation:'7',path_token:'edit.otio'};
  assert.throws(()=>checkedOtioImportJob(h.job('queued',{result:{}}),owner));assert.throws(()=>checkedOtioImportJob(h.job('ready',{id:'otio-2'}),owner));
  assert.doesNotThrow(()=>checkedOtioImportJob(h.job('running'),owner));
  for(const progress of [{completed:2,total:1},{completed:-1,total:2},{completed:0,total:65},{completed:0.5,total:1}])assert.throws(()=>checkedOtioImportJob(h.job('running',{progress}),owner));
});

test('duplicate final clicks, close and own generation refresh never replay the command',async()=>{
  const gate=deferred(),h=harness({commit:()=>gate.promise});await ready(h);const pending=h.transfer.apply('Edit',false);
  assert.equal(h.transfer.cancel(),false);assert.equal(await h.transfer.apply('Edit',true),null);assert.equal(await h.run(),null);
  h.setContext({project_epoch:'epoch',generation:'8'});h.setWritable(false);h.transfer.invalidate();gate.resolve(h.receipt);assert.equal(await pending,h.receipt);assert.equal(h.imported.length,1);assert.equal(h.writes.length,1);assert.equal(h.deletes.length,0);
  const closed=harness({commit:()=>gate.promise});await ready(closed);closed.setSource(false);closed.transfer.invalidate();assert.equal(await closed.transfer.apply('Edit',false),null);
});

test('late applied acknowledgment after close or project replacement does not navigate the new view',async()=>{
  for(const change of ['source','epoch','dispose']){
    const gate=deferred(),h=harness({commit:()=>gate.promise});await ready(h);const pending=h.transfer.apply('Edit',false);
    if(change==='source')h.setSource(false);if(change==='epoch')h.setContext({project_epoch:'next',generation:'8'});if(change==='dispose')h.transfer.dispose();
    gate.resolve(h.receipt);assert.equal(await pending,h.receipt);assert.equal(h.imported.length,0,change);assert.equal(h.deletes.length,0,change);
  }
});

test('applied import with failed navigation stays acknowledged and unknown outcome is never canceled or replayed',async()=>{
  const h=harness({onImported:()=>{throw Error('Refresh disconnected');}});await ready(h);assert.equal(await h.transfer.apply('Edit',false),h.receipt);assert.match(h.transfer.state().message,/applied.*refresh failed.*Do not repeat/);assert.equal(h.writes.length,1);
  const lost=harness({commit:async()=>{throw Error('Response lost');}});await ready(lost);await assert.rejects(lost.transfer.apply('Edit',false),/Response lost/);assert.equal(lost.transfer.state().phase,'uncertain');assert.equal(lost.deletes.length,0);assert.equal(lost.writes.length,1);assert.equal(await lost.transfer.apply('Edit',false),null);
});

test('malformed acknowledged receipt cannot drive timeline or media selection',async()=>{
  const h=harness({commit:async()=>({...h.receipt,timeline_ids:[9007199254740992]})});await ready(h);await assert.rejects(h.transfer.apply('Edit',false),/unexpected result/);assert.equal(h.imported.length,0);assert.equal(h.deletes.length,0);assert.equal(h.writes.length,1);
});

test('reentrant preparation and final status callbacks cannot submit after context changes',async()=>{
  const initial=harness({onChange:state=>{if(state.phase==='preparing')initial.setSource(false);}});assert.equal(await initial.run(),null);assert.equal(initial.calls.length,0);
  const h=harness({onChange:state=>{if(state.phase==='applying')h.setSource(false);}});await ready(h);assert.equal(await h.transfer.apply('Edit',false),null);assert.equal(h.writes.length,0);assert.equal(h.deletes.length,1);
});

test('missing authoritative Session or writer refuses preparation but unsaved Session is valid',async()=>{
  const h=harness();h.setContext(null);assert.equal(await h.run(),null);h.setContext({project_epoch:'epoch',generation:''});assert.equal(await h.run(),null);h.setContext({project_epoch:'epoch',generation:'7'});h.setWritable(false);assert.equal(await h.run(),null);assert.equal(h.calls.length,0);
  h.setWritable(true);const pending=h.run();h.prepares[0].resolve(h.job());await pending;assert.equal(h.transfer.state().phase,'ready');
});

class Node {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this._value='';this.disabled=false;this.textContent='';}
  get value(){return this._value || (this.tagName==='SELECT'?this.children[0]?.value || '':'');}
  set value(value){this._value=value;}
  get options(){return this.children;}
  append(node){this.children.push(node);}
  replaceChildren(...nodes){this.children=nodes;this._value='';}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  fire(type){this.listeners.get(type)?.({target:this});}
}
function panelHarness(options={}){
  const h=harness(options),nodes=new Map(['file','name','reuse','prepare','apply','cancel','status','warnings'].map(key=>[key,new Node(key==='file' || key==='reuse'?'select':'div')]));let visible=true;
  nodes.get('reuse').value='import';const root={querySelector:selector=>nodes.get(selector.slice(11,-1))};
  const panel=createOtioImportPanel({root,isVisible:()=>visible,getContext:h.getContext,canCommit:h.canCommit,api:h.api,pause:h.pause,commit:h.write,onImported:result=>h.imported.push(result),notice:()=>{}});
  return {...h,panel,nodes,setVisible:value=>{visible=value;}};
}

test('panel renders safe ready warnings and submits explicit native reuse policy',async()=>{
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
  try{
    const h=panelHarness();h.panel.setFiles([{path_token:'edit.otio',name:'<script>edit</script>'}]);assert.equal(h.nodes.get('prepare').disabled,false);assert.equal(h.nodes.get('name').value,'edit');assert.equal(h.nodes.get('file').options[0].textContent,'<script>edit</script>');
    h.nodes.get('prepare').fire('click');h.prepares[0].resolve(h.job());await flush();assert.equal(h.nodes.get('apply').disabled,false);assert.equal(h.writes.length,0);assert.equal(h.nodes.get('warnings').children[0].textContent,'Missing media retained offline');
    h.nodes.get('reuse').value='reuse';h.nodes.get('name').value='Chosen name';h.nodes.get('apply').fire('click');await flush();assert.deepEqual(h.writes,[{kind:'import_prepared_otio',job_id:'otio-1',name:'Chosen name',reuse_existing:true}]);
  }finally{globalThis.document=previous;}
});

test('panel file change cancels obsolete ready job and resets the explicit policy and stem',async()=>{
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
  try{
    const h=panelHarness();h.panel.setFiles([{path_token:'edit.otio',name:'edit.otio'},{path_token:'other.otio',name:'other.otio'}]);h.nodes.get('prepare').fire('click');h.prepares[0].resolve(h.job());await flush();h.nodes.get('reuse').value='reuse';
    h.nodes.get('file').value='other.otio';h.nodes.get('file').fire('change');await flush();assert.equal(h.nodes.get('name').value,'other');assert.equal(h.nodes.get('reuse').value,'import');assert.equal(h.nodes.get('apply').disabled,true);assert.equal(h.deletes.length,1);assert.equal(h.writes.length,0);
  }finally{globalThis.document=previous;}
});

test('reopening same file cannot give a late prior-session acknowledgment permission to navigate',async()=>{
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
  try{
    const gate=deferred(),h=panelHarness({commit:()=>gate.promise});h.panel.setFiles([{path_token:'edit.otio',name:'edit.otio'}]);h.nodes.get('prepare').fire('click');h.prepares[0].resolve(h.job());await flush();h.nodes.get('apply').fire('click');
    h.panel.hide();h.panel.setFiles([{path_token:'edit.otio',name:'edit.otio'}]);gate.resolve(h.receipt);await flush();assert.equal(h.imported.length,0);assert.equal(h.writes.length,1);assert.equal(h.deletes.length,0);
  }finally{globalThis.document=previous;}
});

test('closed dialog rejects a late file listing as permission to start preparation',()=>{
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};
  try{
    const h=panelHarness();h.panel.hide();h.setVisible(false);h.panel.setFiles([{path_token:'edit.otio',name:'edit.otio'}]);h.nodes.get('prepare').fire('click');assert.equal(h.prepares.length,0);assert.equal(h.writes.length,0);
  }finally{globalThis.document=previous;}
});
