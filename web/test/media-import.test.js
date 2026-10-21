import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_MEDIA_IMPORT,mediaImportTokens,checkedMediaImportJob,createMediaImport} from '../js/media-import.js';

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
