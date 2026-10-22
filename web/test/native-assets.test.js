import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAssetTransfer,nativeAssetIdentity,nativeAssetMutation,checkedNativeTreeReport} from '../js/native-assets.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let index=0;index<12;index++)await Promise.resolve();}
const capture={kind:'capture',media_id:'9007199254740993',name:'Nested shot'};
const importing={kind:'import',asset_id:'asset-a',revision:'native-revision'};
const placing={kind:'import_set',assets:[{asset_id:'asset-b',revision:'revision-b'},{asset_id:'asset-a',revision:'revision-a'}]};
const placement={start_frame:72,target:{kind:'track',track_id:'9007199254740997'},overwrite:false};
const relinking={kind:'relink',asset_id:'asset-a',revision:'native-revision',path_tokens:['Shot.mov']};
const importTree={kind:'import_tree',directory_token:'Takes',parent:null,folders_revision:'absent'};
const relinkFolder={kind:'relink_folder',asset_id:'asset-a',revision:'native-revision',directory_token:'Takes'};
const treeSummary=()=>({imported_assets:1,skipped_files:2,error_count:1,created_folders:2,root_folder_id:'import-root',folders_revision:'f'.repeat(64)});
const treeErrors=()=>[{path_token:'Takes/bad.mov',code:'INVALID_MEDIA',message:'The native engine could not read this media'}];
function harness(action=capture,{onApplied,onStatus,libraryCommit,projectCommit,timelineCommit,placement,pauseGuard}={}){
  let context={project_name:'saved.vvproj',project_epoch:'epoch',generation:'7',command_epoch:'commands'},writable=true,sourceValid=true;
  const prepare=deferred(),calls=[],polls=[],pauses=[],deletes=[],libraryWrites=[],preparedWrites=[],projectWrites=[],timelineWrites=[],statuses=[],applied=[];
  const prepared=['relink','relink_folder','import_tree'].includes(action.kind),relink=['relink','relink_folder'].includes(action.kind);
  const job=(state='ready',patch={})=>({id:'job-1',state,project_epoch:'epoch',generation:'7',kind:prepared?'library_edit':action.kind,bytes:0,total_bytes:64,result:action.kind==='import_tree'?{...treeSummary(),errors:treeErrors()}:relink?{asset_id:action.asset_id,revision:action.revision,missing_count:1,relinked_files:2}:action.kind==='import'?{asset_id:action.asset_id,revision:action.revision}:null,...patch});
  const receipt={command_id:'command-once',project_epoch:'epoch',...(action.kind==='import_tree'?treeSummary():{media_ids:['9007199254740995']}),...(relink?{missing_count:1,relinked_files:2}:{})};
  const transfer=createNativeAssetTransfer({
    getContext:()=>context,canCommit:()=>writable,onStatus:value=>{statuses.push(value);onStatus?.(value,transfer);},
    api(path,body,options={}){
      calls.push({path,body,options});
      if(options.method==='DELETE'){deletes.push({path,options});return Promise.resolve({state:'canceled'});}
      if(path==='/native-assets/prepare' || path==='/native-assets/commands/prepare')return prepare.promise;
      const pending=deferred();polls.push({...pending,path,options});return pending.promise;
    },
    pause(ms,signal){
      const pending=deferred(),abort=()=>pending.reject(new DOMException('Canceled','AbortError'));
      pauses.push({...pending,ms,signal});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      if(pauseGuard?.(pauses.length))pending.reject(Error('Unexpected polling before identity validation'));
      return pending.promise.then(value=>{signal.removeEventListener('abort',abort);return value;},error=>{signal.removeEventListener('abort',abort);throw error;});
    },
    makeLibraryMutation:operation=>nativeAssetMutation(context,'client',operation,'command-once'),
    libraryCommit(operation,mutation){libraryWrites.push(operation);if(mutation)preparedWrites.push(mutation);return libraryCommit?libraryCommit(operation,mutation):Promise.resolve(receipt);},
    projectCommit(operation){projectWrites.push(operation);return projectCommit?projectCommit(operation):Promise.resolve(receipt);},
    timelineCommit(operation){timelineWrites.push(operation);return timelineCommit?timelineCommit(operation):Promise.resolve(receipt);},
    async onApplied(value,operation,report){applied.push({receipt:value,action:operation,...(report===undefined?{}:{report})});await onApplied?.(value,operation,report);},
  });
  return {transfer,prepare,calls,polls,pauses,deletes,libraryWrites,preparedWrites,projectWrites,timelineWrites,statuses,applied,job,receipt,
    run:()=>transfer.run(action,()=>sourceValid,placement),context:()=>context,setContext:value=>{context=value;},setWritable:value=>{writable=value;},setSourceValid:value=>{sourceValid=value;}};
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

test('ordered native assets use one strict import-set prepare and one atomic timeline command',async()=>{
  const h=harness(placing,{placement}),pending=h.run();
  assert.deepEqual(h.calls[0].body,{project_epoch:'epoch',if_generation:'7',action:placing});assert.equal(h.calls[0].body.action.target,undefined);
  h.prepare.resolve(h.job('ready',{result:{assets:placing.assets.map(item=>({...item,name:'Native asset'}))}}));assert.equal(await pending,h.receipt);
  assert.deepEqual(h.timelineWrites,[{kind:'place_native_assets',job_id:'job-1',assets:placing.assets,start_frame:72,target:placement.target,overwrite:false}]);assert.deepEqual(h.projectWrites,[]);assert.deepEqual(h.libraryWrites,[]);assert.deepEqual(h.deletes,[]);
});

test('reordered, stale or incomplete ready asset sets refuse the whole placement',async()=>{
  for(const assets of [[...placing.assets].reverse(),placing.assets.slice(0,1),[{...placing.assets[0],revision:'stale'},placing.assets[1]]]){
    const h=harness(placing,{placement}),pending=h.run();h.prepare.resolve(h.job('ready',{result:{assets}}));await assert.rejects(pending,/asset set or order changed/);assert.deepEqual(h.timelineWrites,[]);assert.equal(h.deletes.length,1);
  }
});

test('stale target cancels an import set after its late ready acknowledgment with no project mutation',async()=>{
  const h=harness(placing,{placement}),pending=h.run();h.setSourceValid(false);h.transfer.invalidate();
  h.prepare.resolve(h.job('ready',{result:{assets:placing.assets}}));assert.equal(await pending,null);assert.equal(h.deletes.length,1);assert.deepEqual(h.timelineWrites,[]);assert.deepEqual(h.projectWrites,[]);
});

test('placement keeps captured overwrite and never cancels or replays an uncertain final command',async()=>{
  const gate=deferred(),intent={...placement,overwrite:true},h=harness(placing,{placement:intent,timelineCommit:()=>gate.promise}),pending=h.run();
  intent.start_frame=400;intent.overwrite=false;h.prepare.resolve(h.job('ready',{result:{assets:placing.assets}}));await flush();assert.equal(h.timelineWrites[0].start_frame,72);assert.equal(h.timelineWrites[0].overwrite,true);assert.equal(h.transfer.phase(),'committing');
  h.setSourceValid(false);h.transfer.invalidate();assert.equal(h.transfer.cancel(),false);assert.equal(await h.run(),null);
  const error=Object.assign(Error('Command outcome unknown'),{code:'OUTCOME_UNKNOWN'});gate.reject(error);await assert.rejects(pending,/outcome unknown/);assert.equal(h.timelineWrites.length,1);assert.equal(h.deletes.length,0);assert.match(h.statuses.at(-1),/Check command status/);
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

test('Relink prepares and commits the identical guarded Mutation and reports native missing counts',async()=>{
  const h=harness(relinking),pending=h.run(),body=h.calls[0].body;
  assert.equal(h.calls[0].path,'/native-assets/commands/prepare');assert.deepEqual(body,nativeAssetMutation(h.context(),'client',{kind:'edit_native_asset_library',edit:{action:'relink',id:'asset-a',revision:'native-revision',path_tokens:['Shot.mov']}},'command-once'));
  h.prepare.resolve(h.job());assert.equal(await pending,h.receipt);assert.deepEqual(h.preparedWrites,[body]);assert.equal(h.preparedWrites[0],body);assert.deepEqual(h.libraryWrites,[body.operation]);assert.equal(h.projectWrites.length,0);assert.equal(h.deletes.length,0);
  assert.ok(h.statuses.some(value=>/2 files restored.*1 still missing.*timeline unchanged/.test(value)));
});

test('Relink cancellation, retired command epoch and wrong ready revision never cross the commit boundary',async()=>{
  for(const mode of ['cancel','command_epoch','revision','report']){
    const h=harness(relinking),pending=h.run();
    if(mode==='cancel')h.transfer.cancel();if(mode==='command_epoch'){h.setContext({...h.context(),command_epoch:'retired'});h.transfer.invalidate();}
    const rejected=['revision','report'].includes(mode)?assert.rejects(pending,/relink revision or report/):pending;
    h.prepare.resolve(h.job('ready',mode==='revision'?{result:{asset_id:'asset-a',revision:'new',missing_count:0,relinked_files:1}}:mode==='report'?{result:{asset_id:'asset-a',revision:'native-revision',missing_count:-1,relinked_files:1}}:{}));await rejected;
    assert.equal(h.libraryWrites.length,0,mode);assert.equal(h.deletes.length,1,mode);
  }
});

test('already-applied Relink preparation reconciles its receipt without a second commit or DELETE',async()=>{
  const h=harness(relinking),pending=h.run();h.prepare.resolve({state:'applied',receipt:h.receipt});assert.equal(await pending,h.receipt);
  assert.equal(h.libraryWrites.length+h.projectWrites.length,0);assert.equal(h.deletes.length,0);assert.equal(h.applied.length,1);
});

test('an unknown Relink commit outcome is never canceled or replayed',async()=>{
  const h=harness(relinking,{libraryCommit:()=>Promise.reject(Object.assign(Error('Relink outcome unknown'),{code:'OUTCOME_UNKNOWN'}))}),pending=h.run(),rejected=assert.rejects(pending,/outcome unknown/);
  h.prepare.resolve(h.job());await rejected;assert.equal(h.libraryWrites.length,1);assert.equal(h.preparedWrites.length,1);assert.equal(h.deletes.length,0);assert.equal(h.applied.length,0);assert.equal(h.calls.length,1);
});

test('native folder import retains complete ready errors locally while committing only its exact prepared request',async()=>{
  const h=harness(importTree),pending=h.run(),body=h.calls[0].body;assert.deepEqual(body.operation,{kind:'edit_native_asset_library',edit:{action:'import_tree',directory_token:'Takes',parent:null,folders_revision:'absent'}});
  h.prepare.resolve(h.job());assert.equal(await pending,h.receipt);assert.equal(h.preparedWrites[0],body);assert.deepEqual(h.applied[0].report.errors,treeErrors());assert.equal('errors' in h.receipt,false);assert.equal(h.projectWrites.length,0);
  const recovered=harness(importTree),again=recovered.run();recovered.prepare.resolve({state:'applied',receipt:recovered.receipt});await again;assert.equal(recovered.applied[0].report,null);assert.equal(recovered.libraryWrites.length,0);assert.equal(recovered.deletes.length,0);
});

test('recursive folder Relink keeps asset revision binding and honors cancellation before applying',async()=>{
  const h=harness(relinkFolder),pending=h.run();assert.deepEqual(h.calls[0].body.operation.edit,{action:'relink_folder',id:'asset-a',revision:'native-revision',directory_token:'Takes'});h.prepare.resolve(h.job());await pending;assert.equal(h.libraryWrites.length,1);assert.equal(h.projectWrites.length,0);
  const canceled=harness(relinkFolder),stopped=canceled.run();canceled.transfer.cancel();canceled.prepare.resolve(canceled.job());assert.equal(await stopped,null);assert.equal(canceled.libraryWrites.length,0);assert.equal(canceled.deletes.length,1);
});

test('native folder import reports reject incomplete errors, forged counts and unknown folder revisions',()=>{
  const value={...treeSummary(),errors:treeErrors()};assert.equal(checkedNativeTreeReport(value,true),value);
  for(const patch of [{imported_assets:65},{created_folders:129},{root_folder_id:'../outside'},{folders_revision:'invalid'},{errors:[]},{errors:[{path_token:'Takes/bad.mov',code:'BAD',message:''}]}])assert.throws(()=>checkedNativeTreeReport({...value,...patch},true));
  const empty={imported_assets:0,skipped_files:0,error_count:0,created_folders:0,root_folder_id:null,folders_revision:'absent',errors:[]};assert.equal(checkedNativeTreeReport(empty,true),empty);
});
