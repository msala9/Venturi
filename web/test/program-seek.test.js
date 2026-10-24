import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgramSeek} from '../js/program-seek.js';

function fixture() {
  const state={context:'project/timeline/revision/1x',frame:24,playing:true},calls=[];
  let pauses=0,handler=async()=>{};
  const control=createProgramSeek({getContext:()=>state.context,getFrame:()=>state.frame,isPlaying:()=>state.playing,
    pause:()=>{pauses++;state.playing=false;},onSeek:async(frame,options)=>{calls.push({frame,...options});await handler();},onError:message=>calls.push({error:message})});
  return {state,calls,control,pauses:()=>pauses,handle:callback=>handler=callback};
}

test('Program ruler drafts retain 1x playback intent and seek only at the final frame',async()=>{
  const f=fixture();f.control.begin();
  for(const frame of [25,100,48]){f.state.frame=frame;f.control.begin();}
  assert.deepEqual(f.calls,[]);assert.equal(f.pauses(),1);
  assert.equal(await f.control.finish(),true);
  assert.deepEqual(f.calls,[{frame:48,resume:true}]);
  assert.equal(await f.control.finish(),false);
});

test('a paused Program seek remains paused',async()=>{
  const f=fixture();f.state.playing=false;f.control.begin();await f.control.finish();
  assert.deepEqual(f.calls,[{frame:24,resume:false}]);
});

test('Play cancels a paused still seek without treating it as a running playback cancellation',async()=>{
  for(const playing of [false,true]){
    const f=fixture();f.state.playing=playing;let finish;f.handle(()=>new Promise(resolve=>finish=resolve));
    f.control.begin();const pending=f.control.finish();
    assert.equal(f.control.resuming(),playing);
    f.control.cancel();assert.equal(f.control.resuming(),false);
    finish();assert.equal(await pending,false);
  }
});

test('cancel and context changes cannot resume an obsolete ruler gesture',async()=>{
  for(const reason of ['cancel','project','timeline','revision','rate','source']){
    const f=fixture();f.control.begin();
    if(reason==='cancel')f.control.cancel();else f.state.context=reason==='source'?null:reason;
    assert.equal(await f.control.finish(),false);assert.deepEqual(f.calls,[]);
  }
});

test('starting another seek revokes only the previous pending completion',async()=>{
  const f=fixture(),pending=[];f.handle(()=>new Promise(resolve=>pending.push(resolve)));
  f.control.begin();const first=f.control.finish();
  f.state.playing=true;f.state.frame=96;f.control.begin();const second=f.control.finish();
  pending[0]();assert.equal(await first,false);
  pending[1]();assert.equal(await second,true);
  assert.deepEqual(f.calls,[{frame:24,resume:true},{frame:96,resume:true}]);
});

test('blur or explicit Stop can cancel a preparation without late success or error',async()=>{
  const f=fixture();let reject;f.handle(()=>new Promise((_,fail)=>reject=fail));
  f.control.begin();const pending=f.control.finish();assert.equal(f.control.cancel(),true);
  reject(Error('obsolete failure'));assert.equal(await pending,false);
  assert.deepEqual(f.calls,[{frame:24,resume:true}]);
});

test('only a current seek failure is surfaced and malformed frames do not prepare playback',async()=>{
  const f=fixture();f.handle(async()=>{throw Error('GPU_BUSY');});
  f.control.begin();assert.equal(await f.control.finish(),false);
  assert.deepEqual(f.calls,[{frame:24,resume:true},{error:'GPU_BUSY'}]);
  for(const frame of [-1,NaN,1.5]){f.state.frame=frame;f.control.begin();assert.equal(await f.control.finish(),false);}
  assert.equal(f.calls.length,2);
});
