import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_CLIPBOARD_BYTES,clipboardAction,clipboardBlocked,clipboardIdentity,createClipboard,writeSystemClipboard,bindClipboardEvents} from '../js/clipboard.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let index=0;index<20;index++)await Promise.resolve();}
function harness({commit,writeText,readText,onChange,onPasted}={}){
  let context={project_epoch:'epoch',generation:'7',owner:'timeline',timeline_id:'11',timeline_revision:'timeline-rev',frame:100,clip_ids:['21','22'],media_ids:['31'],view_stamp:'view',source_stamp:'program',clipboard_revision:null},writable=true;
  const mutations=[],reads=[],prepares=[],polls=[],deletes=[],pauses=[],systemCalls=[],systemWrites=[],systemReads=[],changes=[],pasted=[];
  const receipt={command_id:'command-1',project_epoch:'epoch',media_ids:[],clip_ids:['9007199254740993'],changed:true};
  const copyValue=(patch={})=>({project_epoch:'epoch',generation:'7',clipboard_revision:'copy-rev',text:'venturi-clipboard/1\nOpaque native RON',clip_count:context.owner==='pool'?0:2,media_count:context.owner==='pool'?1:0,...patch});
  const job=(state='ready',patch={})=>({id:'clipboard-job',kind:'clipboard_import',project_epoch:'epoch',generation:'7',state,result:state==='ready'?{clip_count:2,media_count:0,warnings:[]}:null,...patch});
  const controller=createClipboard({getContext:()=>context,canCommit:()=>writable,
    api(path,body,options={}){
      if(options.method==='DELETE'){deletes.push({path,options});return Promise.resolve({state:'canceled'});}
      const gate=deferred();if(path.startsWith('/clipboard?'))reads.push({...gate,path});else if(path==='/clipboard/prepare')prepares.push({...gate,body,options});else polls.push({...gate,path,options});return gate.promise;
    },
    commit(operation,project){mutations.push({operation,project});if(commit)return commit(operation,project);if(operation.kind.startsWith('copy_')){context={...context,clipboard_revision:'copy-rev'};return Promise.resolve({command_id:'copy-1',project_epoch:'epoch'});}if(operation.kind==='paste_prepared_clipboard')context={...context,generation:'8',timeline_revision:'new-rev'};return Promise.resolve(receipt);},
    writeText(promise){systemCalls.push(promise);return writeText?writeText(promise):Promise.resolve(promise).then(text=>{systemWrites.push(text);});},
    readText(){systemReads.push(true);return readText?readText():Promise.resolve('System native text');},
    pause(ms,signal){const gate=deferred(),abort=()=>gate.reject(new DOMException('Canceled','AbortError'));pauses.push({...gate,signal,ms});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();return gate.promise.finally(()=>signal.removeEventListener('abort',abort));},
    onChange(state){changes.push(state);onChange?.(state,controller);},onPasted(value,target){pasted.push({value,target});return onPasted?.(value,target);},
  });
  return {controller,mutations,reads,prepares,polls,deletes,pauses,systemCalls,systemWrites,systemReads,changes,pasted,receipt,copyValue,job,getContext:()=>context,setContext:value=>{context={...context,...value};},setWritable:value=>{writable=value;}};
}
async function copied(h,options){const pending=h.controller.copy(options);await flush();h.reads.at(-1).resolve(h.copyValue());return pending;}

test('clipboard routing preserves native paste event and excludes unsafe keyboard variants',()=>{
  const event={type:'keydown',key:'c',ctrlKey:true,target:{closest:()=>null}};
  assert.equal(clipboardAction(event),'copy');assert.equal(clipboardAction({...event,key:'x'},{owner:'timeline'}),'cut');assert.equal(clipboardAction({...event,key:'x'},{owner:'pool'}),null);
  assert.equal(clipboardAction({...event,key:'v'}),null);assert.equal(clipboardAction({...event,type:'paste',key:undefined}),'paste');
  assert.equal(clipboardAction({...event,type:'copy',ctrlKey:false,key:undefined},{owner:'pool'}),'copy');assert.equal(clipboardAction({...event,type:'cut',ctrlKey:false,key:undefined},{owner:'timeline'}),'cut');assert.equal(clipboardAction({...event,type:'cut'},{owner:'pool'}),null);
  for(const patch of [{repeat:true},{isComposing:true},{altKey:true},{shiftKey:true},{metaKey:true},{defaultPrevented:true},{getModifierState:()=>true}])assert.equal(clipboardAction({...event,...patch}),null);
  assert.equal(clipboardAction(event,{dialogOpen:true}),null);assert.equal(clipboardAction({...event,ctrlKey:false,metaKey:true}),'copy');
});

test('text fields, implicit/plaintext contenteditable, dialogs and media controls retain their own clipboard',()=>{
  for(const selector of ['input,textarea,select,video,audio,dialog','[contenteditable]']){
    const target={closest:value=>value===selector?{getAttribute:()=>''}:null};assert.equal(Boolean(clipboardBlocked({target})),true);
  }
  assert.equal(Boolean(clipboardBlocked({target:{isContentEditable:true}})),true);
  assert.equal(Boolean(clipboardBlocked({target:{closest:selector=>selector==='[contenteditable]'?{getAttribute:()=> 'false'}:null}})),false);
});

test('clipboard identity captures target, selected IDs, playhead, viewport and source without system text',()=>{
  const h=harness(),context=h.getContext(),stamp=clipboardIdentity(context);
  for(const patch of [{owner:'pool'},{generation:'8'},{project_epoch:'other'},{timeline_id:'12'},{timeline_revision:'changed'},{frame:101},{clip_ids:['22']},{media_ids:['32']},{view_stamp:'resized'},{source_stamp:'source'}])assert.notEqual(clipboardIdentity({...context,...patch}),stamp);
  assert.equal(clipboardIdentity({...context,clip_ids:['22','21'],clipboard_revision:'new-copy'}),stamp);assert.equal(clipboardIdentity(null),null);
});

test('copy invokes the system clipboard adapter in the user gesture and reads exact native revision',async()=>{
  const gate=deferred(),h=harness({commit:()=>gate.promise}),pending=h.controller.copy();
  assert.equal(h.systemCalls.length,1);assert.equal(h.reads.length,0);h.setContext({clipboard_revision:'copy-rev'});gate.resolve({clipboard_revision:'copy-rev'});await flush();
  assert.equal(h.reads[0].path,'/clipboard?project_epoch=epoch&if_generation=7&clipboard_revision=copy-rev');h.reads[0].resolve(h.copyValue());assert.deepEqual(await pending,{copied:true,system:true});
  assert.deepEqual(h.mutations,[{operation:{kind:'copy_clips',clip_ids:['21','22']},project:false}]);assert.equal(h.systemWrites[0],h.copyValue().text);assert.equal(h.deletes.length,0);
});

test('pool copy uses native selected media instead of stale timeline selection and rejects Cut',async()=>{
  const h=harness();h.setContext({owner:'pool',timeline_id:null,timeline_revision:null,clip_ids:['stale']});assert.equal(await h.controller.copy({cut:true}),null);
  assert.deepEqual(await copied(h),{copied:true,system:true});assert.deepEqual(h.mutations,[{operation:{kind:'copy_media',media_ids:['31']},project:true}]);
});

test('confirmed system clipboard write precedes sole native Cut delete mutation',async()=>{
  const written=deferred(),h=harness({writeText:promise=>Promise.resolve(promise).then(()=>written.promise)}),pending=h.controller.copy({cut:true});await flush();h.reads[0].resolve(h.copyValue());await flush();assert.equal(h.mutations.length,1);
  written.resolve();assert.deepEqual(await pending,{copied:true,system:true});assert.deepEqual(h.mutations[1],{operation:{kind:'cut_clips',clip_ids:['21','22'],clipboard_revision:'copy-rev'},project:false});assert.equal(h.deletes.length,0);
});

test('denied system clipboard preserves native copy, never cuts and retry never deletes',async()=>{
  let denied=true;const h=harness({writeText:promise=>Promise.resolve(promise).then(()=>{if(denied)throw Error('Permission denied');})});
  assert.deepEqual(await copied(h,{cut:true}),{copied:true,system:false});assert.equal(h.mutations.length,1);assert.equal(h.controller.canRetry(),true);assert.match(h.controller.state().message,/Nothing was cut/);
  denied=false;assert.equal(await h.controller.retrySystem(),true);assert.equal(h.mutations.length,1);h.setContext({clipboard_revision:'different-copy'});assert.equal(h.controller.canRetry(),false);assert.equal(await h.controller.retrySystem(),false);
});

test('read-only state forbids copy, paste and retained system retry without requests',async()=>{
  const h=harness();h.setWritable(false);assert.equal(await h.controller.copy(),null);assert.equal(await h.controller.paste('opaque'),null);assert.equal(await h.controller.pasteSystem(),null);assert.equal(h.mutations.length,0);assert.equal(h.prepares.length,0);assert.equal(h.systemCalls.length,0);assert.equal(h.systemReads.length,0);
  h.setWritable(true);await copied(h);h.setWritable(false);assert.equal(h.controller.canRetry(),false);assert.equal(await h.controller.retrySystem(),false);
});

test('selection/frame/viewport/epoch/source changes during asynchronous write prevent Cut',async()=>{
  for(const patch of [{clip_ids:['22']},{frame:101},{view_stamp:'other'},{project_epoch:'new'},{source_stamp:'source'},{owner:'pool'}]){
    const written=deferred(),h=harness({writeText:promise=>Promise.resolve(promise).then(()=>written.promise)}),pending=h.controller.copy({cut:true});await flush();h.reads[0].resolve(h.copyValue());await flush();h.setContext(patch);written.resolve();await pending;assert.equal(h.mutations.length,1,JSON.stringify(patch));
  }
});

test('foreign native GET revision, oversized text and changed generation never reach the system clipboard',async()=>{
  for(const patch of [{project_epoch:'other'},{generation:'8'},{clipboard_revision:'foreign'},{text:'x'.repeat(MAX_CLIPBOARD_BYTES+1)},{clip_count:4097},{media_count:4097}]){
    const h=harness(),pending=h.controller.copy({cut:true});await flush();h.reads[0].resolve(h.copyValue(patch));await assert.rejects(pending);assert.equal(h.mutations.length,1);assert.equal(h.systemWrites.length,0);
  }
});

test('opaque OS text is prepared and polled then pasted to captured native timeline once',async()=>{
  const h=harness(),text='venturi-clipboard/1\nDo not parse or rewrite this native text',pending=h.controller.paste(text);
  assert.deepEqual(h.prepares[0].body,{project_epoch:'epoch',if_generation:'7',text,to_pool:false});h.prepares[0].resolve(h.job('queued'));await flush();assert.equal(h.mutations.length,0);
  h.pauses[0].resolve();await flush();assert.equal(h.polls[0].path,'/clipboard/jobs/clipboard-job?project_epoch=epoch');h.polls[0].resolve(h.job());assert.equal(await pending,h.receipt);
  assert.deepEqual(h.mutations,[{operation:{kind:'paste_prepared_clipboard',job_id:'clipboard-job',to_pool:false,timeline_id:'11',timeline_revision:'timeline-rev',frame:100},project:true}]);
  assert.deepEqual(h.pasted,[{value:h.receipt,target:{to_pool:false,timeline_id:'11'}}]);assert.equal(h.deletes.length,0);
});

test('pool retained paste works without a timeline and native zero-result no-op remains authoritative',async()=>{
  const h=harness({commit:async()=>({...h.receipt,media_ids:['31'],clip_ids:[],changed:false})});h.setContext({owner:'pool',timeline_id:null,timeline_revision:null,clip_ids:[],media_ids:[]});
  const pending=h.controller.paste();assert.deepEqual(h.prepares[0].body,{project_epoch:'epoch',if_generation:'7',text:null,to_pool:true});h.prepares[0].resolve(h.job('ready',{result:{clip_count:0,media_count:0,warnings:[]}}));await pending;
  assert.deepEqual(h.mutations[0].operation,{kind:'paste_prepared_clipboard',job_id:'clipboard-job',to_pool:true,timeline_id:null,timeline_revision:null,frame:0});assert.equal(h.pasted[0].value.changed,false);assert.match(h.controller.state().message,/Nothing to paste/);
});

test('ordinary text passes unchanged to Rust and native warnings remain visible',async()=>{
  const h=harness(),pending=h.controller.paste('ordinary notes');assert.equal(h.prepares[0].body.text,'ordinary notes');h.prepares[0].resolve(h.job('ready',{result:{clip_count:1,media_count:0,warnings:['Native fallback used']}}));await pending;assert.match(h.controller.state().message,/Native fallback used/);
});

test('cancel before prepare acknowledgment waits for exact late job release and never pastes',async()=>{
  const h=harness(),pending=h.controller.paste('text');assert.equal(h.controller.cancel(),true);assert.equal(await h.controller.paste('second'),null);h.prepares[0].resolve(h.job('queued'));assert.equal(await pending,null);
  assert.deepEqual(h.deletes.map(item=>item.path),['/clipboard/jobs/clipboard-job?project_epoch=epoch']);assert.equal(h.mutations.length,0);assert.equal(h.controller.busy(),false);
});

test('cancel interrupts wait and an outstanding ignored response cannot apply',async()=>{
  const waiting=harness(),first=waiting.controller.paste();waiting.prepares[0].resolve(waiting.job('running'));await flush();waiting.controller.cancel();assert.equal(await first,null);assert.equal(waiting.pauses[0].signal.aborted,true);assert.equal(waiting.polls.length,0);
  const h=harness(),pending=h.controller.paste();h.prepares[0].resolve(h.job('queued'));await flush();h.pauses[0].resolve();await flush();h.controller.cancel();h.polls[0].resolve(h.job());assert.equal(await pending,null);assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);
});

test('paste context changes cancel native preparation before any mutation',async()=>{
  for(const patch of [{project_epoch:'new'},{generation:'8'},{timeline_id:'12'},{timeline_revision:'new-rev'},{frame:101},{clip_ids:[]},{media_ids:[]},{owner:'pool'},{view_stamp:'resized'},{source_stamp:'source'}]){
    const h=harness(),pending=h.controller.paste();h.setContext(patch);h.controller.invalidate();h.prepares[0].resolve(h.job());assert.equal(await pending,null,JSON.stringify(patch));assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);
  }
});

test('malformed/foreign ready jobs and changed job IDs fail before native application',async()=>{
  for(const patch of [{id:'../bad'},{kind:'other'},{project_epoch:'other'},{generation:'8'},{state:'applied'},{result:{clip_count:4097,media_count:0,warnings:[]}},{result:{clip_count:1,media_count:0,warnings:[3]}}]){
    const h=harness(),pending=h.controller.paste();h.prepares[0].resolve(h.job('ready',patch));await assert.rejects(pending);assert.equal(h.mutations.length,0);
  }
  const h=harness(),pending=h.controller.paste();h.prepares[0].resolve(h.job('queued'));await flush();h.pauses[0].resolve();await flush();h.polls[0].resolve(h.job('ready',{id:'foreign-job'}));await assert.rejects(pending);assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);
});

test('native worker failure releases preparation and allows a new explicit attempt',async()=>{
  const h=harness(),first=h.controller.paste();h.prepares[0].resolve(h.job('failed',{error:'CLIPBOARD_MALFORMED'}));await assert.rejects(first,/CLIPBOARD_MALFORMED/);assert.equal(h.controller.busy(),false);assert.equal(h.deletes.length,1);
  const second=h.controller.paste('corrected');h.prepares[1].resolve(h.job('ready',{id:'second-job'}));await second;assert.equal(h.mutations.length,1);
});

test('duplicate Paste and cancellation during final command cannot create or delete another job',async()=>{
  const gate=deferred(),h=harness({commit:()=>gate.promise}),pending=h.controller.paste();h.prepares[0].resolve(h.job());await flush();assert.equal(h.mutations.length,1);assert.equal(h.controller.cancel(),false);assert.equal(await h.controller.paste(),null);gate.resolve(h.receipt);await pending;assert.equal(h.mutations.length,1);assert.equal(h.deletes.length,0);
});

test('own command generation refresh still selects pasted entities while late foreign context never does',async()=>{
  const h=harness(),pending=h.controller.paste();h.prepares[0].resolve(h.job());await pending;assert.equal(h.pasted.length,1);assert.equal(h.getContext().generation,'8');
  for(const patch of [{project_epoch:'other'},{timeline_id:'12'},{owner:'pool'}]){
    const gate=deferred(),late=harness({commit:()=>gate.promise}),second=late.controller.paste();late.prepares[0].resolve(late.job());await flush();late.setContext(patch);gate.resolve(late.receipt);await second;assert.equal(late.pasted.length,0);assert.equal(late.deletes.length,0);
  }
});

test('unknown Paste and Cut outcomes never repost or DELETE submitted commands',async()=>{
  const error=Object.assign(Error('Command outcome unknown'),{code:'OUTCOME_UNKNOWN'}),h=harness({commit:async()=>{throw error;}}),pending=h.controller.paste();h.prepares[0].resolve(h.job());await assert.rejects(pending);assert.equal(h.controller.state().phase,'uncertain');assert.equal(h.deletes.length,0);assert.equal(h.mutations.length,1);
  let calls=0;const cut=harness({commit:async operation=>{if(++calls===1){cut.setContext({clipboard_revision:'copy-rev'});return {command_id:'copy-1'};}throw error;}}),cutting=cut.controller.copy({cut:true});await flush();cut.reads[0].resolve(cut.copyValue());await assert.rejects(cutting);assert.equal(cut.controller.state().phase,'uncertain');assert.equal(cut.mutations.length,2);assert.equal(cut.deletes.length,0);
});

test('malformed acknowledged paste cannot select arbitrary IDs or be canceled as unapplied',async()=>{
  const h=harness({commit:async()=>({...h.receipt,clip_ids:[9007199254740992]})}),pending=h.controller.paste();h.prepares[0].resolve(h.job());await assert.rejects(pending,/unexpected result/);assert.equal(h.pasted.length,0);assert.equal(h.deletes.length,0);assert.equal(h.mutations.length,1);
});

test('reentrant status changes are checked immediately before native application',async()=>{
  const h=harness({onChange:state=>{if(state.phase==='committing')h.setContext({frame:999});}}),pending=h.controller.paste();h.prepares[0].resolve(h.job());assert.equal(await pending,null);assert.equal(h.mutations.length,0);assert.equal(h.deletes.length,1);assert.equal(h.controller.state().phase,'canceled');
});

test('text size, missing timeline, empty selection and dispose are bounded before any write',async()=>{
  const h=harness();await assert.rejects(h.controller.paste('x'.repeat(MAX_CLIPBOARD_BYTES+1)));h.setContext({timeline_id:null,clip_ids:[]});assert.equal(await h.controller.copy(),null);assert.equal(await h.controller.paste('opaque'),null);assert.equal(h.prepares.length,0);h.controller.dispose();assert.equal(await h.controller.copy(),null);
});

test('system clipboard adapter uses promised text in original call or falls back to writeText',async()=>{
  const text=deferred(),calls=[];class Item{constructor(data){this.data=data;}}
  const writing=writeSystemClipboard(text.promise,{clipboard:{write:items=>{calls.push(items);return items[0].data['text/plain'].then(blob=>blob.text());}},Item});assert.equal(calls.length,1);text.resolve('opaque');assert.equal(await writing,'opaque');
  const output=[];await writeSystemClipboard(Promise.resolve('native'),{clipboard:{writeText:value=>output.push(value)},Item:null});assert.deepEqual(output,['native']);await assert.rejects(writeSystemClipboard(Promise.resolve('native'),{clipboard:null,Item:null}),/unavailable/);
});

test('explicit system paste reads in its gesture and forwards the exact opaque text to the captured destination',async()=>{
  const read=deferred(),h=harness({readText:()=>read.promise}),text='venturi-clipboard/1\nOpaque source + unrelated notes',pending=h.controller.pasteSystem();
  assert.equal(h.systemReads.length,1);assert.equal(h.prepares.length,0);assert.equal(h.controller.busy(),true);assert.equal(await h.controller.copy(),null);assert.equal(await h.controller.paste(),null);assert.equal(await h.controller.pasteSystem(),null);
  read.resolve(text);await flush();assert.deepEqual(h.prepares[0].body,{project_epoch:'epoch',if_generation:'7',text,to_pool:false});h.prepares[0].resolve(h.job());assert.equal(await pending,h.receipt);assert.equal(h.mutations.length,1);assert.equal(h.pasted.length,1);
});

test('system read denial never prepares or substitutes the retained Venturi clipboard',async()=>{
  const h=harness({readText:async()=>{throw Error('Permission denied');}});h.setContext({clipboard_revision:'retained-native-copy'});
  await assert.rejects(h.controller.pasteSystem(),/Permission denied/);assert.equal(h.prepares.length,0);assert.equal(h.mutations.length,0);assert.equal(h.controller.state().phase,'error');assert.match(h.controller.state().message,/retained Venturi copy was not pasted/);assert.equal(h.controller.busy(),false);
});

test('system read captures selection, viewport, writer and project before asynchronous permission',async()=>{
  for(const patch of [{project_epoch:'next'},{generation:'8'},{timeline_id:'12'},{frame:101},{clip_ids:[]},{owner:'pool'},{view_stamp:'new-size'},{source_stamp:'source'},{writer:false}]){
    const read=deferred(),h=harness({readText:()=>read.promise}),pending=h.controller.pasteSystem();if(patch.writer===false)h.setWritable(false);else h.setContext(patch);h.controller.invalidate();read.resolve('Do not paste into the new context');assert.equal(await pending,null,JSON.stringify(patch));assert.equal(h.prepares.length,0);assert.equal(h.mutations.length,0);assert.equal(h.controller.busy(),false);
  }
});

test('canceling a pending system read blocks another action and ignores its late permission result',async()=>{
  const read=deferred(),h=harness({readText:()=>read.promise}),pending=h.controller.pasteSystem();assert.equal(h.controller.cancel(),true);assert.equal(await h.controller.pasteSystem(),null);assert.equal(h.systemReads.length,1);read.resolve('Late old clipboard text');assert.equal(await pending,null);assert.equal(h.prepares.length,0);assert.equal(h.mutations.length,0);assert.equal(h.controller.state().phase,'canceled');
});

test('pool system paste needs no timeline or selected media and preserves unrelated OS text',async()=>{
  const h=harness({readText:async()=> 'Ordinary OS notes'});h.setContext({owner:'pool',timeline_id:null,timeline_revision:null,clip_ids:[],media_ids:[]});const pending=h.controller.pasteSystem();await flush();assert.equal(h.prepares[0].body.text,'Ordinary OS notes');assert.equal(h.prepares[0].body.to_pool,true);h.prepares[0].resolve(h.job('ready',{result:{clip_count:0,media_count:0,warnings:[]}}));await pending;assert.equal(h.mutations[0].operation.timeline_id,null);assert.equal(h.mutations[0].operation.frame,0);
});

test('system read validates type/size and preserves unknown native command outcomes after handoff',async()=>{
  for(const text of [null,{},'x'.repeat(MAX_CLIPBOARD_BYTES+1)]){const h=harness({readText:async()=>text});await assert.rejects(h.controller.pasteSystem());assert.equal(h.prepares.length,0);assert.equal(h.controller.state().phase,'error');}
  const h=harness({commit:async()=>{throw Object.assign(Error('Native command unknown'),{code:'OUTCOME_UNKNOWN'});}}),pending=h.controller.pasteSystem();await flush();h.prepares[0].resolve(h.job());await assert.rejects(pending,/Native command unknown/);assert.equal(h.controller.state().phase,'uncertain');assert.equal(h.mutations.length,1);assert.equal(h.deletes.length,0);
});

test('native media-only OS payload pasted at timeline routes acknowledged selected roots to the pool',async()=>{
  const h=harness({readText:async()=> 'Opaque native media-only payload',commit:async()=>({...h.receipt,clip_ids:[],media_ids:['9007199254740995']})}),pending=h.controller.pasteSystem();await flush();assert.equal(h.prepares[0].body.to_pool,false);h.prepares[0].resolve(h.job('ready',{result:{clip_count:0,media_count:1,warnings:[]}}));await pending;
  assert.equal(h.mutations[0].operation.to_pool,false);assert.deepEqual(h.pasted[0].target,{to_pool:true,timeline_id:'11'});assert.deepEqual(h.pasted[0].value.media_ids,['9007199254740995']);
});

function clipboardTarget(){
  const listeners=new Map();
  return {addEventListener(type,listener){listeners.set(type,listener);},removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},
    fire(type,patch={}){const event={type,target:{closest:()=>null},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...patch};listeners.get(type)?.(event);return event;},size:()=>listeners.size};
}

test('native browser Edit Copy and Cut events invoke controllers without a keydown',async()=>{
  const target=clipboardTarget(),actions=[],binding=bindClipboardEvents({target,getOwner:()=> 'timeline',copy:options=>actions.push(options),paste:()=>assert.fail('No paste requested')});
  assert.equal(target.fire('copy').defaultPrevented,true);assert.deepEqual(actions,[{cut:false}]);await flush();assert.equal(target.fire('cut').defaultPrevented,true);assert.deepEqual(actions,[{cut:false},{cut:true}]);binding.dispose();assert.equal(target.size(),0);target.fire('copy');assert.equal(actions.length,2);
});

test('keydown plus native copy/cut event while native command is pending dispatches only once',async()=>{
  for(const [key,type] of [['c','copy'],['x','cut']]){
    const target=clipboardTarget(),gate=deferred(),calls=[];bindClipboardEvents({target,getOwner:()=> 'timeline',copy:options=>{calls.push(options);return gate.promise;},paste:()=>assert.fail('No paste requested')});
    assert.equal(target.fire('keydown',{key,ctrlKey:true}).defaultPrevented,true);assert.equal(calls.length,1);assert.equal(target.fire(type).defaultPrevented,true);assert.equal(calls.length,1);gate.resolve();await flush();target.fire(type);assert.equal(calls.length,2);
  }
});

test('bound native events preserve text/modal clipboard and route pool Copy without stale timeline Cut',async()=>{
  const target=clipboardTarget(),calls=[];let owner='pool',modal=false;bindClipboardEvents({target,getOwner:()=>owner,isDialogOpen:()=>modal,copy:options=>calls.push({owner,...options}),paste:text=>calls.push({owner,text})});
  assert.equal(target.fire('cut').defaultPrevented,false);assert.equal(calls.length,0);target.fire('copy');assert.deepEqual(calls,[{owner:'pool',cut:false}]);await flush();
  const field={closest:selector=>selector==='input,textarea,select,video,audio,dialog'?{}:null};assert.equal(target.fire('copy',{target:field}).defaultPrevented,false);assert.equal(target.fire('paste',{target:field,clipboardData:{getData:()=> 'Text field value'}}).defaultPrevented,false);
  modal=true;assert.equal(target.fire('cut').defaultPrevented,false);assert.equal(target.fire('copy').defaultPrevented,false);modal=false;owner='timeline';assert.equal(target.fire('keydown',{key:'v',ctrlKey:true}).defaultPrevented,false);const text='Opaque native payload';assert.equal(target.fire('paste',{clipboardData:{getData:type=>{assert.equal(type,'text/plain');return text;}}}).defaultPrevented,true);assert.deepEqual(calls.at(-1),{owner:'timeline',text});
});

test('binding retains original synchronous gesture and recovers from rejected native actions',async()=>{
  const target=clipboardTarget(),errors=[];let calls=0;bindClipboardEvents({target,getOwner:()=> 'timeline',copy:()=>{calls++;return Promise.reject(Error('Native copy failed'));},paste:()=>{},onError:error=>errors.push(error.message)});
  target.fire('copy');assert.equal(calls,1);await flush();assert.deepEqual(errors,['Native copy failed']);target.fire('copy');assert.equal(calls,2);await flush();
});
