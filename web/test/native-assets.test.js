import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAssetTransfer,nativeAssetIdentity} from '../js/native-assets.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let index=0;index<12;index++)await Promise.resolve();}
const capture={kind:'capture',media_id:'9007199254740993',name:'Nested shot'};
const importing={kind:'import',asset_id:'asset-a',revision:'native-revision'};
function harness(action=capture,{onApplied,onStatus,libraryCommit,projectCommit,pauseGuard}={}){
  let context={project_name:'saved.vvproj',project_epoch:'epoch',generation:'7'},writable=true,sourceValid=true;
  const prepare=deferred(),calls=[],polls=[],pauses=[],deletes=[],libraryWrites=[],projectWrites=[],statuses=[],applied=[];
  const job=(state='ready',patch={})=>({id:'job-1',state,project_epoch:'epoch',generation:'7',kind:action.kind,bytes:0,total_bytes:64,result:action.kind==='import'?{asset_id:action.asset_id,revision:action.revision}:null,...patch});
  const receipt={command_id:'command-once',project_epoch:'epoch',media_ids:['9007199254740995']};
  const transfer=createNativeAssetTransfer({
    getContext:()=>context,canCommit:()=>writable,onStatus:value=>{statuses.push(value);onStatus?.(value,transfer);},
    api(path,body,options={}){
      calls.push({path,body,options});
      if(options.method==='DELETE'){deletes.push({path,options});return Promise.resolve({state:'canceled'});}
      if(path==='/native-assets/prepare')return prepare.promise;
      const pending=deferred();polls.push({...pending,path,options});return pending.promise;
    },
    pause(ms,signal){
      const pending=deferred(),abort=()=>pending.reject(new DOMException('Canceled','AbortError'));
      pauses.push({...pending,ms,signal});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      if(pauseGuard?.(pauses.length))pending.reject(Error('Unexpected polling before identity validation'));
      return pending.promise.then(value=>{signal.removeEventListener('abort',abort);return value;},error=>{signal.removeEventListener('abort',abort);throw error;});
    },
    libraryCommit(operation){libraryWrites.push(operation);return libraryCommit?libraryCommit(operation):Promise.resolve(receipt);},
    projectCommit(operation){projectWrites.push(operation);return projectCommit?projectCommit(operation):Promise.resolve(receipt);},
    async onApplied(value,operation){applied.push({receipt:value,action:operation});await onApplied?.(value,operation);},
  });
  return {transfer,prepare,calls,polls,pauses,deletes,libraryWrites,projectWrites,statuses,applied,job,receipt,
    run:()=>transfer.run(action,()=>sourceValid),context:()=>context,setContext:value=>{context=value;},setWritable:value=>{writable=value;},setSourceValid:value=>{sourceValid=value;}};
}

test('native asset transfer requires an opened project and an available writer before preparing',async()=>{
  assert.equal(nativeAssetIdentity(null),null);
  assert.equal(nativeAssetIdentity({project_epoch:'e',generation:'1'}),null);
  assert.notEqual(nativeAssetIdentity({project_name:'a',project_epoch:'e',generation:'1'}),nativeAssetIdentity({project_name:'a',project_epoch:'e',generation:'2'}));
  for(const unavailable of ['project','writer','selection']){
    const h=harness();if(unavailable==='project')h.setContext(null);if(unavailable==='writer')h.setWritable(false);if(unavailable==='selection')h.setSourceValid(false);
    assert.equal(await h.run(),null);assert.equal(h.calls.length,0);assert.equal(h.transfer.busy(),false);
  }
});

test('capture prepares and polls one foreground job before a single library publication',async()=>{
  const h=harness(),pending=h.run();
  assert.equal(h.transfer.busy(),true);assert.equal(h.transfer.phase(),'preparing');
  assert.deepEqual(h.calls[0].body,{project_epoch:'epoch',if_generation:'7',action:capture});
  h.prepare.resolve(h.job('queued'));await flush();
  assert.equal(h.libraryWrites.length,0);assert.equal(h.pauses[0].ms,300);
  h.pauses[0].resolve();await flush();assert.equal(h.polls[0].path,'/native-assets/jobs/job-1?project_epoch=epoch');
  h.polls[0].resolve(h.job('running',{bytes:32}));await flush();assert.equal(h.pauses.length,2);
  h.pauses[1].resolve();await flush();h.polls[1].resolve(h.job());
  assert.equal(await pending,h.receipt);assert.deepEqual(h.libraryWrites,[{kind:'publish_native_asset',job_id:'job-1'}]);assert.equal(h.projectWrites.length,0);
  assert.deepEqual(h.applied,[{receipt:h.receipt,action:capture}]);assert.equal(h.deletes.length,0);assert.equal(h.transfer.phase(),'idle');assert.equal(h.transfer.busy(),false);
});

test('import binds the prepared native asset revision and commits once through the project adapter',async()=>{
  const h=harness(importing),pending=h.run();h.prepare.resolve(h.job());
  assert.equal(await pending,h.receipt);assert.equal(h.libraryWrites.length,0);
  assert.deepEqual(h.projectWrites,[{kind:'import_native_asset',job_id:'job-1',asset_id:'asset-a',revision:'native-revision'}]);
  assert.equal(h.polls.length,0);assert.equal(h.deletes.length,0);
});

test('cancel before the prepare acknowledgment retains ownership until the late job can be deleted',async()=>{
  const h=harness(),pending=h.run();assert.equal(h.transfer.cancel(),true);assert.equal(h.transfer.busy(),true);
  assert.equal(await h.run(),null);assert.equal(h.calls.length,1);assert.equal(h.deletes.length,0);
  h.prepare.resolve(h.job('queued'));assert.equal(await pending,null);
  assert.deepEqual(h.deletes.map(item=>item.path),['/native-assets/jobs/job-1?project_epoch=epoch']);
  assert.equal(h.libraryWrites.length,0);assert.equal(h.projectWrites.length,0);assert.equal(h.polls.length,0);assert.equal(h.transfer.busy(),false);
});

test('project, generation, selection and writer changes before a late ready acknowledgment never write',async()=>{
  for(const changed of ['project','generation','selection','writer']){
    const h=harness(),pending=h.run();
    if(changed==='project')h.setContext({...h.context(),project_epoch:'replacement'});
    if(changed==='generation')h.setContext({...h.context(),generation:'8'});
    if(changed==='selection')h.setSourceValid(false);
    if(changed==='writer')h.setWritable(false);
    h.transfer.invalidate();h.prepare.resolve(h.job());assert.equal(await pending,null,changed);
    assert.equal(h.libraryWrites.length+h.projectWrites.length,0,changed);assert.equal(h.deletes.length,1,changed);
    assert.equal(h.deletes[0].path,'/native-assets/jobs/job-1?project_epoch=epoch');assert.equal(h.transfer.busy(),false);
  }
});

test('invalidation while waiting between polls aborts the old preparation and deletes only once',async()=>{
  for(const changed of ['generation','selection','writer']){
    const h=harness(),pending=h.run();h.prepare.resolve(h.job('running'));await flush();
    if(changed==='generation')h.setContext({...h.context(),generation:'8'});if(changed==='selection')h.setSourceValid(false);if(changed==='writer')h.setWritable(false);
    h.transfer.invalidate();h.transfer.invalidate();assert.equal(await pending,null);
    assert.equal(h.pauses[0].signal.aborted,true);assert.equal(h.deletes.length,1);assert.equal(h.polls.length,0);assert.equal(h.libraryWrites.length,0);
  }
});

test('cancel status may synchronously invalidate the transfer without recursive cancellation or duplicate DELETE',async()=>{
  const h=harness(capture,{onStatus:(_status,transfer)=>transfer.invalidate()}),pending=h.run();
  h.prepare.resolve(h.job('running'));await flush();h.setSourceValid(false);h.transfer.invalidate();
  assert.equal(await pending,null);assert.equal(h.deletes.length,1);assert.equal(h.libraryWrites.length,0);
  assert.equal(h.statuses.filter(value=>value==='Canceling native asset preparation…').length,1);
  assert.equal(h.transfer.busy(),false);
});

test('a late poll response after cancel cannot publish or import even if the transport ignores abort',async()=>{
  const h=harness(importing),pending=h.run();h.prepare.resolve(h.job('running'));await flush();h.pauses[0].resolve();await flush();
  const poll=h.polls[0];assert.equal(h.transfer.cancel(),true);assert.equal(poll.options.signal.aborted,true);
  poll.resolve(h.job());assert.equal(await pending,null);assert.equal(h.projectWrites.length,0);assert.equal(h.deletes.length,1);
});

test('duplicate attempts during prepare or polling never enqueue a second job',async()=>{
  const h=harness(),pending=h.run();assert.equal(await h.run(),null);h.prepare.resolve(h.job('queued'));await flush();
  assert.equal(await h.run(),null);h.pauses[0].resolve();await flush();assert.equal(await h.run(),null);
  h.polls[0].resolve(h.job());await pending;
  assert.equal(h.calls.filter(call=>call.path==='/native-assets/prepare').length,1);assert.equal(h.libraryWrites.length,1);
});

test('foreign prepare identity is rejected before polling or writing',async()=>{
  for(const patch of [{project_epoch:'other'},{generation:'8'},{kind:'import'}]){
    const h=harness(capture,{pauseGuard:()=>true}),pending=h.run(),rejected=assert.rejects(pending,/no longer matches|identity|preparation/i);
    h.prepare.resolve(h.job('queued',patch));await rejected;
    assert.equal(h.pauses.length,0);assert.equal(h.polls.length,0);assert.equal(h.libraryWrites.length,0);
  }
});

test('a changed running job identity fails before another poll and never replaces the owned job ID',async()=>{
  for(const patch of [{id:'job-foreign'},{project_epoch:'other'},{generation:'8'},{kind:'import'}]){
    const h=harness(capture,{pauseGuard:count=>count>1}),pending=h.run(),rejected=assert.rejects(pending,/no longer matches|identity|preparation/i);
    h.prepare.resolve(h.job('running'));await flush();h.pauses[0].resolve();await flush();h.polls[0].resolve(h.job('queued',patch));await rejected;
    assert.equal(h.pauses.length,1);assert.equal(h.polls.length,1);assert.equal(h.libraryWrites.length,0);
    assert(h.deletes.every(item=>item.path==='/native-assets/jobs/job-1?project_epoch=epoch'));
  }
});

test('ready job identity and asset revision mismatches never cross the commit boundary',async()=>{
  for(const patch of [{id:'job-foreign'},{project_epoch:'other'},{generation:'8'},{kind:'capture'},{result:{asset_id:'other',revision:'native-revision'}},{result:{asset_id:'asset-a',revision:'changed'}},{result:null}]){
    const h=harness(importing),pending=h.run(),rejected=assert.rejects(pending);
    h.prepare.resolve(h.job('running'));await flush();h.pauses[0].resolve();await flush();h.polls[0].resolve(h.job('ready',patch));await rejected;
    assert.equal(h.libraryWrites.length+h.projectWrites.length,0);assert.equal(h.transfer.busy(),false);
  }
});

test('invalid preparation IDs and terminal failures refuse publication without automatic retries',async()=>{
  for(const patch of [{id:'../outside'},{id:''},{id:null},{state:'failed',error:'Source changed'},{state:'canceled'},{state:'unsupported'}]){
    const h=harness(),pending=h.run(),rejected=assert.rejects(pending);
    h.prepare.resolve(h.job('ready',patch));await rejected;assert.equal(h.libraryWrites.length,0);assert.equal(h.projectWrites.length,0);
    assert.equal(h.calls.filter(call=>call.path==='/native-assets/prepare').length,1);assert.equal(h.transfer.busy(),false);
  }
});

test('an acknowledged commit stays applied when refresh fails and the controller never replays it',async()=>{
  const h=harness(capture,{onApplied:()=>{throw Error('Library read disconnected');}}),pending=h.run();h.prepare.resolve(h.job());
  assert.equal(await pending,h.receipt);assert.equal(h.libraryWrites.length,1);assert.equal(h.deletes.length,0);assert.equal(h.applied.length,1);
  assert(h.statuses.some(value=>/Command applied.*refresh failed.*do not repeat/i.test(value)));
  assert.equal(h.calls.filter(call=>call.path==='/native-assets/prepare').length,1);assert.equal(h.transfer.busy(),false);
});

test('cancel and context invalidation while committing cannot cancel or replay the native mutation',async()=>{
  const committing=deferred(),h=harness(importing,{projectCommit:()=>committing.promise}),pending=h.run();h.prepare.resolve(h.job());await flush();
  assert.equal(h.transfer.phase(),'committing');assert.equal(h.transfer.cancel(),false);h.setWritable(false);h.setContext({...h.context(),project_epoch:'replacement'});h.transfer.invalidate();
  assert.equal(await h.run(),null);assert.equal(h.deletes.length,0);assert.equal(h.projectWrites.length,1);assert.equal(h.transfer.busy(),true);
  committing.resolve(h.receipt);assert.equal(await pending,h.receipt);assert.equal(h.projectWrites.length,1);assert.equal(h.deletes.length,0);assert.equal(h.transfer.busy(),false);
});

test('commit errors propagate once without deleting a possibly consumed job or automatically retrying',async()=>{
  const h=harness(capture,{libraryCommit:()=>Promise.reject(Error('Command outcome unknown'))}),pending=h.run(),rejected=assert.rejects(pending,/Command outcome unknown/);
  h.prepare.resolve(h.job());await rejected;assert.equal(h.libraryWrites.length,1);assert.equal(h.deletes.length,0);assert.equal(h.applied.length,0);
  assert.equal(h.calls.filter(call=>call.path==='/native-assets/prepare').length,1);assert.equal(h.transfer.phase(),'idle');
});
