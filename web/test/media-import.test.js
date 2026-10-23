import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_MEDIA_IMPORT,mediaImportTokens,checkedMediaImportJob,createMediaImport,createProjectMediaTransfer,checkedProjectMediaJob,projectMediaSelection,projectRelinkSelection} from '../js/media-import.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let index=0;index<16;index++)await Promise.resolve();}
function harness({commit,onImported,onChange}={}){
  let context={project_epoch:'epoch',generation:'7'},writable=true,source=true;
  const prepare=deferred(),polls=[],pauses=[],deletes=[],writes=[],changes=[],imported=[],calls=[];
  const receipt={command_id:'command-1',project_epoch:'epoch',media_ids:['9007199254740993'],errors:[]};
  const job=(state='ready',patch={})=>({id:'import-1',project_epoch:'epoch',generation:'7',kind:'media_import',state,progress:{completed:state==='ready'?2:0,total:2},result:state==='ready'?{items:[{path_token:'a.mp4',name:'a.mp4',state:'ready'}],errors:[{path_token:'b.wav',name:'b.wav',code:'INVALID_MEDIA',message:'Unreadable audio',status:422}]}:null,...patch});
  const transfer=createMediaImport({getContext:()=>context,canCommit:()=>writable,
    api(path,body,options={}){calls.push({path,body,options});if(options.method==='DELETE'){deletes.push(path);return Promise.resolve({state:'canceled'});}if(path==='/media/imports/prepare')return prepare.promise;const gate=deferred();polls.push(gate);return gate.promise;},
    pause(ms,signal){const gate=deferred(),abort=()=>gate.reject(new DOMException('Canceled','AbortError'));pauses.push({...gate,ms,signal});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();return gate.promise.finally(()=>signal.removeEventListener('abort',abort));},
    commit(operation){writes.push(operation);return commit?commit(operation):Promise.resolve(receipt);},
    onChange(state){changes.push(state);onChange?.(state,transfer);},onImported(ids,result){imported.push({ids,result});return onImported?.(ids,result);},
  });
  return {transfer,prepare,polls,pauses,deletes,writes,changes,imported,calls,receipt,job,run:()=>transfer.run(['a.mp4','b.wav'],()=>source),setContext:value=>{context=value;},setWritable:value=>{writable=value;},setSource:value=>{source=value;}};
}

test('native import selection deduplicates first order and uses its own 256-file bound',()=>{
  assert.equal(MAX_MEDIA_IMPORT,256);assert.deepEqual(mediaImportTokens(['b.wav','a.mp4','b.wav']),['b.wav','a.mp4']);
  assert.equal(mediaImportTokens(Array.from({length:256},(_,index)=>`${index}.tiff`)).length,256);
  for(const values of [[],['../file.mp4'],['.hidden.mp4'],['bad\n.wav'],['x'.repeat(129)],Array.from({length:257},(_,index)=>`${index}.avi`),Array(4097).fill('a.mp4')])assert.throws(()=>mediaImportTokens(values));
  assert.deepEqual(mediaImportTokens(['日本語.tif','file with spaces.m4v']),['日本語.tif','file with spaces.m4v']);
});

test('one Import intent prepares and polls before committing all successes with one command',async()=>{
  const h=harness(),pending=h.run();assert.deepEqual(h.calls[0].body,{project_epoch:'epoch',if_generation:'7',path_tokens:['a.mp4','b.wav']});
  h.prepare.resolve(h.job('queued'));await flush();assert.equal(h.writes.length,0);assert.equal(h.pauses[0].ms,300);
  h.pauses[0].resolve();await flush();assert.equal(h.calls.at(-1).path,'/media/imports/import-1?project_epoch=epoch');h.polls[0].resolve(h.job('running',{progress:{completed:1,total:2}}));await flush();
  h.pauses[1].resolve();await flush();h.polls[1].resolve(h.job());assert.equal(await pending,h.receipt);
  assert.deepEqual(h.writes,[{kind:'import_prepared_media',job_id:'import-1'}]);assert.deepEqual(h.imported,[{ids:['9007199254740993'],result:h.receipt}]);assert.equal(h.transfer.state().phase,'applied');assert.equal(h.deletes.length,0);
});

test('all file failures remain visible without a project command or Undo',async()=>{
  const h=harness(),pending=h.run(),errors=['a.mp4','b.wav'].map(path_token=>({path_token,name:path_token,code:'MEDIA_IMPORT_BUDGET',message:'Not checked within this import',status:422}));
  h.prepare.resolve(h.job('ready',{result:{items:[],errors}}));assert.equal(await pending,null);assert.equal(h.writes.length,0);assert.equal(h.transfer.state().job.result.errors.length,2);assert.match(h.transfer.state().message,/No selected files/);
});

test('cancel before acknowledgment holds the intent until its late job is canceled exactly once',async()=>{
  const h=harness(),pending=h.run();assert.equal(h.transfer.cancel(),true);assert.equal(h.transfer.cancel(),false);assert.equal(await h.run(),null);assert.equal(h.calls.length,1);
  h.prepare.resolve(h.job('queued'));assert.equal(await pending,null);assert.deepEqual(h.deletes,['/media/imports/import-1?project_epoch=epoch']);assert.equal(h.writes.length,0);assert.equal(h.transfer.busy(),false);
});

test('epoch, generation, writer and closed selection changes never auto-import a late ready job',async()=>{
  for(const change of ['epoch','generation','writer','source']){
    const h=harness(),pending=h.run();if(change==='epoch')h.setContext({project_epoch:'new',generation:'7'});if(change==='generation')h.setContext({project_epoch:'epoch',generation:'8'});if(change==='writer')h.setWritable(false);if(change==='source')h.setSource(false);
    h.transfer.invalidate();h.prepare.resolve(h.job());assert.equal(await pending,null,change);assert.equal(h.writes.length,0,change);assert.equal(h.deletes.length,1,change);
  }
});

test('cancel aborts the poll wait and an ignored late poll response cannot commit',async()=>{
  const h=harness(),pending=h.run();h.prepare.resolve(h.job('running'));await flush();h.pauses[0].resolve();await flush();h.transfer.cancel();h.polls[0].resolve(h.job());assert.equal(await pending,null);assert.equal(h.writes.length,0);assert.equal(h.deletes.length,1);
  const waiting=harness(),second=waiting.run();waiting.prepare.resolve(waiting.job('queued'));await flush();waiting.transfer.cancel();assert.equal(await second,null);assert.equal(waiting.pauses[0].signal.aborted,true);assert.equal(waiting.polls.length,0);
});

test('foreign job identities and nonexhaustive or duplicate file results fail before committing',async()=>{
  for(const patch of [{id:'../bad'},{project_epoch:'foreign'},{generation:'8'},{kind:'other'},{progress:{completed:3,total:2}},{result:{items:[],errors:[]}},{result:{items:[{path_token:'a.mp4',name:'a.mp4',state:'ready'},{path_token:'a.mp4',name:'a.mp4',state:'ready'}],errors:[]}}]){
    const h=harness(),pending=h.run();h.prepare.resolve(h.job('ready',patch));await assert.rejects(pending);assert.equal(h.writes.length,0);assert.equal(h.pauses.length,0);
  }
});

test('per-partition ordering and job identity on each poll are authoritative',async()=>{
  const owner={tokens:['a.mp4','b.wav'],epoch:'epoch',generation:'7',job:'import-1'},h=harness();
  assert.throws(()=>checkedMediaImportJob(h.job('ready',{result:{items:[{path_token:'b.wav',name:'b.wav',state:'ready'},{path_token:'a.mp4',name:'a.mp4',state:'ready'}],errors:[]}}),owner));
  const pending=h.run();h.prepare.resolve(h.job('queued'));await flush();h.pauses[0].resolve();await flush();h.polls[0].resolve(h.job('ready',{id:'another-job'}));await assert.rejects(pending);assert.equal(h.writes.length,0);assert.equal(h.deletes.length,1);
});

test('duplicate Import clicks cannot create extra jobs or repeat a committing command',async()=>{
  const committing=deferred(),h=harness({commit:()=>committing.promise}),pending=h.run();assert.equal(await h.run(),null);h.prepare.resolve(h.job());await flush();assert.equal(h.writes.length,1);assert.equal(h.transfer.cancel(),false);assert.equal(await h.run(),null);
  h.setSource(false);h.transfer.invalidate();committing.resolve(h.receipt);assert.equal(await pending,h.receipt);assert.equal(h.writes.length,1);assert.equal(h.imported.length,0);assert.equal(h.deletes.length,0);
});

test('own command generation changes do not cancel its imported-media selection callback',async()=>{
  const h=harness({commit:async()=>{h.setContext({project_epoch:'epoch',generation:'8'});h.setWritable(false);h.transfer.invalidate();return h.receipt;}}),pending=h.run();h.prepare.resolve(h.job());assert.equal(await pending,h.receipt);assert.equal(h.imported.length,1);assert.equal(h.deletes.length,0);
});

test('commit success followed by failed refresh remains acknowledged and is never replayed',async()=>{
  const h=harness({onImported:()=>{throw Error('Refresh disconnected');}}),pending=h.run();h.prepare.resolve(h.job());assert.equal(await pending,h.receipt);assert.match(h.transfer.state().message,/Import applied.*refresh failed.*do not repeat/);assert.equal(h.transfer.state().phase,'applied');assert.equal(h.writes.length,1);assert.equal(h.deletes.length,0);
});

test('unknown commit outcome is retained without canceling or replaying the command',async()=>{
  const h=harness({commit:async()=>{throw Error('Connection dropped');}}),pending=h.run();h.prepare.resolve(h.job());await assert.rejects(pending,/Connection dropped/);assert.equal(h.transfer.state().phase,'uncertain');assert.equal(h.writes.length,1);assert.equal(h.deletes.length,0);
});

test('reentrant context change from the committing status callback is checked before sending a command',async()=>{
  const h=harness({onChange:state=>{if(state.phase==='committing')h.setSource(false);}}),pending=h.run();h.prepare.resolve(h.job());assert.equal(await pending,null);assert.equal(h.writes.length,0);assert.equal(h.deletes.length,1);
});

test('unavailable project or writer does not prepare media',async()=>{
  const h=harness();h.setContext(null);assert.equal(await h.run(),null);h.setContext({project_epoch:'epoch',generation:'7'});h.setWritable(false);assert.equal(await h.run(),null);assert.equal(h.calls.length,0);
});

function projectHarness(kind='project_import',{commit,onChange}={}){
  let context={project_epoch:'epoch',generation:'7'},writable=true,current=true;
  const ready=()=>({id:'prepared-1',kind,state:'ready',project_epoch:'epoch',generation:'7',progress:{completed:2,total:2},result:kind==='project_import'?{mode:'files',parent:null,directory_token:null,folders:[],items:[{path_token:'Shots/a.mp4',name:'a.mp4',state:'ready',folder_index:null},{path_token:'Sound/b.wav',name:'b.wav',state:'ready',folder_index:null}],errors:[]}:{mode:'by_name',directory_token:'Replacements',items:[{media_id:'1',path_token:'Replacements/a.mp4',name:'a.mp4',state:'ready'}],errors:[],not_found:['2'],skipped:[],ambiguous_count:1}});
  const receipt=kind==='project_import'?{command_id:'command',project_epoch:'epoch',generation:'8',media_ids:['1','2'],folder_ids:[],errors:[],changed:true}:{command_id:'command',project_epoch:'epoch',generation:'8',relinked_media_ids:['1'],not_found:['2'],skipped:[],errors:[],ambiguous_count:1,changed:true};
  const prepare=deferred(),polls=[],pauses=[],calls=[],deletes=[],writes=[],applied=[],changes=[];
  const transfer=createProjectMediaTransfer({kind,getContext:()=>context,canCommit:()=>writable,commit:async operation=>{writes.push(operation);return commit?commit(operation):receipt;},api:(path,body,options)=>{calls.push({path,body,options});if(options?.method==='DELETE'){deletes.push(path);return Promise.resolve({});}if(body)return prepare.promise;const poll=deferred();polls.push(poll);return poll.promise;},pause:(_ms,signal)=>{const waiting=deferred();pauses.push(waiting);signal.addEventListener('abort',()=>waiting.reject(new DOMException('Canceled','AbortError')),{once:true});return waiting.promise;},onChange:value=>{changes.push(value);onChange?.(value);},onApplied:(value,job)=>applied.push({receipt:value,job})});
  const selection=kind==='project_import'?{path_tokens:['Shots/a.mp4','Sound/b.wav'],parent:null}:{kind:'by_name',directory_token:'Replacements',scope:{kind:'selected',media_ids:['1','2']}};
  return {transfer,ready,receipt,selection,prepare,polls,pauses,calls,deletes,writes,applied,changes,run:()=>transfer.run(selection,()=>current),setCurrent:value=>current=value,setContext:value=>context=value,setWritable:value=>writable=value};
}

test('project media preparation accepts approved nested files or an explicit child tree and preserves native destination IDs',()=>{
  assert.deepEqual(projectMediaSelection({path_tokens:['Shots/a.mp4','Sound/b.wav','Shots/a.mp4'],parent:'9007199254740993'}),{path_tokens:['Shots/a.mp4','Sound/b.wav'],parent:'9007199254740993'});
  assert.deepEqual(projectMediaSelection({directory_token:'Shots/Day 1',parent:null}),{directory_token:'Shots/Day 1',parent:null});
  for(const value of [{directory_token:'',parent:null},{directory_token:'../outside',parent:null},{path_tokens:['/absolute.wav'],parent:null},{path_tokens:[],parent:null},{path_tokens:['valid.wav'],directory_token:'Shots',parent:null},{path_tokens:['valid.wav'],parent:'01'}])assert.throws(()=>projectMediaSelection(value));
  assert.deepEqual(projectRelinkSelection({kind:'chosen',items:[{media_id:'1',path_token:'New/renamed.wav'}]}),{kind:'chosen',items:[{media_id:'1',path_token:'New/renamed.wav'}]});
  assert.throws(()=>projectRelinkSelection({kind:'chosen',items:[{media_id:'1',path_token:'New/a.wav'},{media_id:'1',path_token:'New/b.wav'}]}));
});

test('new project file import uses the typed job route, captured order and one native prepared mutation including reused IDs',async()=>{
  const h=projectHarness(),pending=h.run();assert.deepEqual(h.calls[0].body,{project_epoch:'epoch',if_generation:'7',path_tokens:['Shots/a.mp4','Sound/b.wav'],parent:null});assert.equal(h.calls[0].path,'/media/project-imports/prepare');
  h.prepare.resolve({...h.ready(),state:'queued',result:null,progress:{completed:0,total:2}});await flush();h.pauses[0].resolve();await flush();assert.equal(h.calls.at(-1).path,'/media/jobs/prepared-1?project_epoch=epoch');h.polls[0].resolve(h.ready());assert.equal(await pending,h.receipt);
  assert.deepEqual(h.writes,[{kind:'import_prepared_project_media',job_id:'prepared-1'}]);assert.equal(h.applied[0].receipt.media_ids,h.receipt.media_ids);assert.equal(h.deletes.length,0);
});

test('native tree folders survive failed media probes and are committed rather than discarded as an empty import',async()=>{
  const receipt={command_id:'folders',project_epoch:'epoch',generation:'8',media_ids:[],folder_ids:['9','10'],errors:[],changed:true},h=projectHarness('project_import',{commit:()=>receipt});
  const pending=h.transfer.run({directory_token:'Shots',parent:'8'}),job=h.ready();job.progress={completed:1,total:1};job.result={mode:'tree',parent:'8',directory_token:'Shots',folders:[{name:'Shots',parent_index:null},{name:'Day 1',parent_index:0}],items:[],errors:[{path_token:'Shots/Day 1/broken.mp4',name:'broken.mp4',code:'INVALID_MEDIA',message:'Native probe failed',status:422}]};h.prepare.resolve(job);
  assert.equal(await pending,receipt);assert.equal(h.writes.length,1);assert.equal(h.applied[0].receipt.folder_ids[1],'10');
});

test('prepared selected/folder relink reports missing and ambiguous matches without browser filename matching',async()=>{
  const h=projectHarness('project_relink'),pending=h.run();assert.deepEqual(h.calls[0].body.action,h.selection);assert.equal(h.calls[0].path,'/media/relinks/prepare');h.prepare.resolve(h.ready());assert.equal(await pending,h.receipt);assert.deepEqual(h.writes,[{kind:'relink_prepared_media',job_id:'prepared-1'}]);assert.equal(h.applied[0].job.result.ambiguous_count,1);
  const owner={kind:'project_relink',epoch:'epoch',generation:'7',selection:{kind:'by_name',directory_token:'Replacements',scope:{kind:'folder',folder_id:'8'}}};assert.equal(checkedProjectMediaJob(h.ready(),owner).result.not_found[0],'2');
});

test('new prepared media jobs reject mismatched source scope, file partitions, native folders and chosen replacement paths',()=>{
  const h=projectHarness(),owner={kind:'project_import',epoch:'epoch',generation:'7',selection:h.selection};
  for(const change of [job=>job.generation='8',job=>job.result.parent='99',job=>job.result.items.reverse(),job=>job.result.items[0].folder_index=0,job=>job.result.errors.push({path_token:'Shots/a.mp4',name:'a',code:'error',message:'error',status:422})]){const job=h.ready();change(job);assert.throws(()=>checkedProjectMediaJob(job,owner));}
  const relink=projectHarness('project_relink'),chosen={kind:'project_relink',epoch:'epoch',generation:'7',selection:{kind:'chosen',items:[{media_id:'1',path_token:'Expected/a.mp4'},{media_id:'2',path_token:'Expected/b.wav'}]}};const result=relink.ready();result.result.mode='chosen';result.result.directory_token=null;assert.throws(()=>checkedProjectMediaJob(result,chosen));
});

test('new project preparation cancels exact late owned jobs on epoch/selection changes and never mutates from stale readiness',async()=>{
  for(const kind of ['project_import','project_relink']){
    const h=projectHarness(kind),pending=h.run();h.setCurrent(false);h.transfer.invalidate();h.prepare.resolve(h.ready());assert.equal(await pending,null);assert.equal(h.writes.length,0);assert.deepEqual(h.deletes,['/media/jobs/prepared-1?project_epoch=epoch']);
  }
});

test('prepared media commit is single flight and unknown outcomes never cancel, replay or steal newer UI ownership',async()=>{
  const committed=deferred(),h=projectHarness('project_relink',{commit:()=>committed.promise}),pending=h.run();h.prepare.resolve(h.ready());await flush();assert.equal(h.transfer.cancel(),false);assert.equal(await h.run(),null);h.setCurrent(false);committed.resolve(h.receipt);assert.equal(await pending,h.receipt);assert.equal(h.applied.length,0);assert.equal(h.deletes.length,0);assert.equal(h.writes.length,1);
  const unknown=projectHarness('project_import',{commit:()=>{throw Object.assign(Error('Outcome unknown'),{code:'OUTCOME_UNKNOWN'});}}),uncertain=unknown.run();unknown.prepare.resolve(unknown.ready());await assert.rejects(uncertain,/unknown/);assert.equal(unknown.transfer.state().phase,'uncertain');assert.equal(unknown.deletes.length,0);assert.equal(unknown.writes.length,1);
});
