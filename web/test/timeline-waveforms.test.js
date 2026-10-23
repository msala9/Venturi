import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedWaveformPresentation,createTimelineWaveforms} from '../js/timeline-waveforms.js';

const context=()=>({query:{project_epoch:'p:1',if_generation:'2',timeline_id:'1',revision:'r2',frame:0,width:960},timeline:{id:'1',revision:'r2',fps:{num:24,den:1},tracks:[{kind:'audio',clips:[{id:'0',media_id:'3',audio_stream_index:1},{id:'1',media_id:'3',audio_stream_index:0}]}]},media:[{id:'3',content_hash:'77',fps:{num:30000,den:1001},duration_frames:300}]});
function ready(id='0',ctx=context()){
  const clip=ctx.timeline.tracks[0].clips.find(clip=>clip.id===id);
  return {clip_id:id,state:'ready',media_id:'3',content_hash:'77',audio_stream_index:clip.audio_stream_index,clock:{source_offset_frames:12,speed:{num:3,den:2},timeline_fps:{num:24,den:1},media_fps:{num:30000,den:1001}},coverage:[0,302],gain:{kind:'constant',linear:1}};
}
const response=(ctx,ids=['0'])=>({project_epoch:ctx.query.project_epoch,generation:ctx.query.if_generation,timeline_id:ctx.query.timeline_id,revision:ctx.query.revision,clips:ids.map(id=>ready(id,ctx))});
function harness(){
  let ctx=context(),idle=true,changes=0;
  const timers=new Map(),calls=[],notices=[];let serial=0;
  const controller=createTimelineWaveforms({getContext:()=>ctx,canRead:()=>idle,schedule:fn=>{const id=++serial;timers.set(id,fn);return id;},unschedule:id=>timers.delete(id),read:(query,ids,options)=>new Promise((resolve,reject)=>calls.push({query,ids,options,resolve,reject})),onChange:()=>changes++,notice:message=>notices.push(message)});
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  return {controller,calls,timers,notices,context:()=>ctx,setContext:value=>{ctx=value;},setIdle:value=>{idle=value;},changes:()=>changes,flush,async drain(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}await flush();}};
}

test('waveform presentation binds ordered native clips, audio streams, source clocks and gap-free native gain runs',()=>{
  const ctx=context(),data=response(ctx);data.clips[0].gain={kind:'runs',runs:[[0,20,1],[20,302,2]]};
  assert.equal(checkedWaveformPresentation(data,ctx,['0']).get('0'),data.clips[0]);
  for(const change of [v=>{v.generation='old';},v=>{v.clips[0].audio_stream_index=0;},v=>{v.clips[0].content_hash='other';},v=>{v.clips[0].clock.media_fps.num=25;},v=>{v.clips[0].gain.runs[1][0]=21;},v=>{v.clips[0].gain.runs[1][1]=301;},v=>{v.clips[0].gain.runs[0][2]=NaN;},v=>{v.clips.push(ready('1'));}]){
    const changed=structuredClone(data);change(changed);assert.throws(()=>checkedWaveformPresentation(changed,ctx,['0']));
  }
  const hidden=response(ctx);hidden.clips=[{clip_id:'0',state:'hidden',reason:'frozen'}];assert.equal(checkedWaveformPresentation(hidden,ctx,['0']).get('0').state,'hidden');
  const overshoot=response(ctx);overshoot.clips[0].gain.linear=1e15;
  assert.equal(checkedWaveformPresentation(overshoot,ctx,['0']).get('0').gain.linear,1e15,'Finite native Bezier overshoot draws clipped instead of rejecting the batch');
});

test('long constant media stays bounded without imposing a timeline-frame limit on native source offsets',()=>{
  const ctx=context();ctx.media[0].duration_frames=1_000_000_000_000;
  const data=response(ctx);data.clips[0].coverage=[0,1_000_000_000_002];data.clips[0].clock.source_offset_frames=2_000_000_000_000;
  assert.equal(checkedWaveformPresentation(data,ctx,['0']).get('0').gain.linear,1);
});

test('visible waveform demand deduplicates one read and retains exact native data throughout local draft movement',async()=>{
  const h=harness();try{
    h.controller.demand(['0','0','foreign']);h.controller.demand(['0']);assert.equal(h.timers.size,1);await h.drain();assert.equal(h.calls.length,1);
    h.calls[0].resolve(response(h.context()));await h.flush();assert.equal(h.changes(),1);assert.equal(h.controller.presentations().get('0').gain.linear,1);
    h.setIdle(false);for(let i=0;i<20;i++){h.controller.refresh();h.controller.demand(['0']);}
    await h.drain();assert.equal(h.calls.length,1,'Pointer movement schedules no HTTP');assert.ok(h.controller.presentations().has('0'));
    h.setIdle(true);h.controller.refresh();await h.drain();assert.equal(h.calls.length,1,'A settled draft can reuse native source-frame data');
  }finally{h.controller.dispose();}
});

test('scope changes cancel outstanding reads and never publish an old project result into a new timeline',async()=>{
  const h=harness();try{
    h.controller.demand(['0']);await h.drain();const prior=h.context(),next=structuredClone(prior);next.query.project_epoch='new:1';h.setContext(next);h.controller.refresh();
    assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.controller.presentations().size,0);
    h.controller.demand(['1']);h.calls[0].resolve(response(prior));await h.flush();await h.drain();assert.equal(h.calls.length,2);assert.equal(h.controller.presentations().size,0);
    h.calls[1].resolve(response(next,['1']));await h.flush();assert.deepEqual([...h.controller.presentations().keys()],['1']);
  }finally{h.controller.dispose();}
});

test('queued and active reads stop for a gesture, playback, hidden page or modal and resume only when idle',async()=>{
  const h=harness();try{
    h.controller.demand(['0']);h.setIdle(false);h.controller.refresh();await h.drain();assert.equal(h.calls.length,0);
    h.setIdle(true);h.controller.refresh();await h.drain();h.setIdle(false);h.controller.refresh();assert.equal(h.calls[0].options.signal.aborted,true);
    h.calls[0].resolve(response(h.context()));await h.flush();assert.equal(h.controller.presentations().size,0);assert.equal(h.timers.size,0);
    h.setIdle(true);h.controller.refresh();await h.drain();assert.equal(h.calls.length,2);
  }finally{h.controller.dispose();}
});

test('bad native data reports once, requires explicit retry and never schedules a paint/read failure loop',async()=>{
  const h=harness();try{
    h.controller.demand(['0']);await h.drain();const invalid=response(h.context());invalid.clips[0].content_hash='changed';h.calls[0].resolve(invalid);await h.flush();
    for(let i=0;i<10;i++)h.controller.demand(['0']);await h.drain();assert.equal(h.calls.length,1);assert.equal(h.notices.length,1);assert.equal(h.controller.presentations().size,0);
    h.controller.retry();await h.drain();assert.equal(h.calls.length,2);h.calls[1].resolve(response(h.context()));await h.flush();assert.ok(h.controller.presentations().has('0'));
  }finally{h.controller.dispose();}
});

test('batch gain budgets stay explicit and retry when the visible clip set changes without retaining a false raw waveform',async()=>{
  const h=harness();try{
    h.controller.demand(['0','1']);await h.drain();const limited=response(h.context(),['0','1']);limited.clips[1]={clip_id:'1',state:'unavailable',reason:'gain_lookup_budget'};
    h.calls[0].resolve(limited);await h.flush();assert.equal(h.controller.presentations().get('1').state,'unavailable');assert.equal(h.notices.length,1);
    h.controller.demand(['1']);await h.drain();assert.equal(h.calls.length,2);h.calls[1].resolve(response(h.context(),['1']));await h.flush();assert.equal(h.controller.presentations().get('1').state,'ready');
  }finally{h.controller.dispose();}
});

test('successive visible batches cannot produce a gain-cache eviction and refetch loop',async()=>{
  const h=harness();h.context().media[0].duration_frames=65_534;
  const dense=id=>{const value=response(h.context(),[id]);value.clips[0].coverage=[0,65_536];value.clips[0].gain={kind:'runs',runs:Array.from({length:65_536},(_,frame)=>[frame,frame+1,1+frame/65_536])};return value;};
  try{
    h.controller.demand(['0']);await h.drain();h.calls[0].resolve(dense('0'));await h.flush();
    h.controller.demand(['0','1']);await h.drain();h.calls[1].resolve(dense('1'));await h.flush();
    for(let i=0;i<10;i++){h.controller.demand(['0','1']);h.controller.refresh();await h.drain();}
    assert.equal(h.calls.length,2,'Needed rows evicted for budget remain explicit unavailable entries until the visible set changes');
    assert.equal(h.controller.presentations().get('0').state,'unavailable');assert.equal(h.controller.presentations().get('1').state,'ready');
    assert.equal(h.controller.presentations().get('0').gain,null);assert.equal(h.notices.length,1);
  }finally{h.controller.dispose();}
});
