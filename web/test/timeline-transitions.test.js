import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transitionHandles,transitionDraft,hitTest,frameToX,RULER,TRACK} from '../js/timeline/geometry.js';

const fps={num:24,den:1},view={scale:240,origin:0,scrollY:0,tool:'select'};
const transition=duration=>({kind:'Push',duration,direction:'Up',ease:'Out',curve:Math.fround(0.3)});
function fixture(){
  const left={id:'9007199254740993',kind:'media',start_frame:0,length_frames:20,fade_in:2,fade_out:2,transition_in:transition(4),transition_out:transition(6)};
  const right={id:'9007199254740995',kind:'solid_color',start_frame:20,length_frames:10,fade_in:2,fade_out:2,transition_in:transition(4),transition_out:transition(3)};
  const crossing={left_clip:left.id,right_clip:right.id,start_frame:17,end_frame:22,kind:'Push',transition:transition(5)};
  const track={id:'video',kind:'video',locked:false,clips:[left,right],crossings:[crossing]};
  return {left,right,crossing,track,timeline:{id:'timeline',fps,tracks:[track]}};
}
const band=RULER+TRACK-14;

test('transition handles retain native payloads and crossing edges suppress hidden single-edge transitions',()=>{
  const {track,left,right,crossing}=fixture(),handles=transitionHandles(track,view,fps);
  assert.equal(handles.length,4);assert.deepEqual(handles.map(handle=>[handle.clip.id,handle.slot,handle.edge]),[[left.id,'in','in'],[left.id,'cut_after','out'],[right.id,'cut_after','in'],[right.id,'out','out']]);
  assert.deepEqual(handles[1].transition,crossing.transition);assert.notEqual(handles[1].transition,crossing.transition);
  assert.equal(handles[1].clip_id,left.id);assert.equal(handles[2].clip_id,left.id);assert.equal(handles[1].duration,5);assert.equal(handles[2].duration,5);
});

test('odd crossing durations give the extra frame to the left and expose both endpoint handles',()=>{
  const {track}=fixture(),handles=transitionHandles(track,view,fps).filter(handle=>handle.slot==='cut_after');
  assert.deepEqual(handles.map(handle=>handle.x),[frameToX(17,view,fps),frameToX(22,view,fps)]);
  for(const handle of handles){assert.equal(handle.start_frame,17);assert.equal(handle.end_frame,22);assert.equal(handle.max,20);assert.equal(handle.min,1);}
  const grown=transitionDraft(handles[1],10,view,fps);assert.equal(grown.duration,7);assert.equal(grown.start_frame,16);assert.equal(grown.end_frame,23);assert.equal(grown.handles.length,2);
  assert.deepEqual(grown.handles.map(handle=>handle.x),[frameToX(16,view,fps),frameToX(23,view,fps)]);
});

test('crossing drags grow symmetrically from either end and preserve every other transition field',()=>{
  const {track,crossing,left}=fixture(),[a,b]=transitionHandles(track,view,fps).filter(handle=>handle.slot==='cut_after'),original=structuredClone(track);
  const fromLeft=transitionDraft(a,-10,view,fps),fromRight=transitionDraft(b,10,view,fps);
  assert.equal(fromLeft.duration,7);assert.deepEqual(fromLeft.operation,fromRight.operation);
  assert.deepEqual(fromLeft.operation,{kind:'set_transition',clip_id:left.id,slot:'cut_after',transition:{...crossing.transition,duration:7}});
  assert.deepEqual(track,original);fromLeft.operation.transition.direction='Down';assert.equal(crossing.transition.direction,'Up');assert.equal(fromLeft.transition.direction,'Up');
});

test('single-edge duration changes use native direction, integer rounding and clip-length clamps',()=>{
  const {track}=fixture(),input=transitionHandles(track,view,fps).find(handle=>handle.slot==='in'),output=transitionHandles(track,view,fps).find(handle=>handle.slot==='out');
  assert.equal(transitionDraft(input,5,view,fps).duration,5,'Positive half-frame ties round away from zero');
  assert.equal(transitionDraft(input,-10000,view,fps).duration,1);assert.equal(transitionDraft(input,10000,view,fps).duration,20);
  assert.equal(transitionDraft(output,-10,view,fps).duration,4);assert.equal(transitionDraft(output,10000,view,fps).duration,1);assert.equal(transitionDraft(output,-10000,view,fps).duration,10);
  const draft=transitionDraft({...input,track:2},10,view,fps);assert.equal(draft.track,2);assert.equal(draft.original,4);assert.equal(draft.start_frame,0);assert.equal(draft.end_frame,5);
});

test('crossing maximum is twice the shorter clip and fractional pointer rounding matches native duration math',()=>{
  const {track}=fixture(),[a,b]=transitionHandles(track,view,fps).filter(handle=>handle.slot==='cut_after');
  assert.equal(transitionDraft(a,-10000,view,fps).duration,20);assert.equal(transitionDraft(b,10000,view,fps).duration,20);
  assert.equal(transitionDraft(a,10000,view,fps).duration,1);assert.equal(transitionDraft(b,-10000,view,fps).duration,1);
  assert.equal(transitionDraft(b,2.5,view,fps).duration,6);assert.equal(transitionDraft(a,-2.5,view,fps).duration,6);
  assert.equal(transitionDraft(b,-2.5,view,fps).duration,5);assert.equal(transitionDraft(b,-7.5,view,fps).duration,4);
});

test('bottom-band transition hits leave upper fades, ordinary body moves and lower trims available',()=>{
  const {timeline}=fixture();
  assert.equal(hitTest(frameToX(4,view,fps),band,timeline,view).kind,'transition');
  assert.equal(hitTest(frameToX(2,view,fps),RULER+14,timeline,view).kind,'fade');
  assert.equal(hitTest(frameToX(4,view,fps),RULER+30,timeline,view).kind,'move');
  assert.equal(hitTest(frameToX(20,view,fps)-2,RULER+TRACK-4,timeline,view).kind,'trim_end');
  assert.notEqual(hitTest(frameToX(4,view,fps),band,timeline,{...view,tool:'slip'}).kind,'transition');
});

test('the zero-length right half of a one-frame crossing remains selectable at the shared cut',()=>{
  const {track,timeline,crossing,left}=fixture();crossing.transition.duration=1;crossing.start_frame=19;crossing.end_frame=20;
  const hit=hitTest(frameToX(20,view,fps),band,timeline,view);assert.equal(hit.kind,'transition');assert.equal(hit.slot,'cut_after');assert.equal(hit.dragSide,'right');assert.equal(hit.clip_id,left.id);
  assert.equal(transitionDraft(hit,10,view,fps).duration,3);assert.equal(transitionHandles(track,view,fps).length,4);
});

test('native in-handle priority resolves overlapping endpoints without selecting another transition',()=>{
  const {track,timeline}=fixture();track.crossings=[];track.clips=track.clips.slice(0,1);track.clips[0].transition_in=transition(10);track.clips[0].transition_out=transition(10);
  const hit=hitTest(frameToX(10,view,fps),band,timeline,view);assert.equal(hit.kind,'transition');assert.equal(hit.slot,'in');
});

test('locked, nonvideo, adjustment and tiny clips cannot expose editable transition handles',()=>{
  const {track}=fixture();assert.deepEqual(transitionHandles({...track,locked:true},view,fps),[]);assert.deepEqual(transitionHandles({...track,kind:'audio'},view,fps),[]);
  assert.deepEqual(transitionHandles(track,{...view,scale:12},fps),[]);assert.deepEqual(transitionHandles(track,{...view,tool:'slip'},fps),[]);
  assert.deepEqual(transitionHandles({...track,clips:track.clips.map(clip=>({...clip,kind:'adjustment'}))},view,fps),[]);
});

test('incomplete or inconsistent crossing snapshots hide occupied cut edges instead of exposing hidden edge settings',()=>{
  for(const patch of [{transition:undefined},{transition:{kind:'Push',duration:5}},{start_frame:16},{end_frame:23},{transition:transition(21)}]){
    const {track,crossing}=fixture();Object.assign(crossing,patch);const handles=transitionHandles(track,view,fps);assert.deepEqual(handles.map(handle=>handle.slot),['in','out']);
  }
  const {track,right}=fixture();right.start_frame=21;assert.deepEqual(transitionHandles(track,view,fps).map(handle=>handle.slot),['in','out']);
});

test('invalid edge payloads and pointer deltas are refused and zero displacement preserves native bytes',()=>{
  const {track}=fixture();track.crossings=[];track.clips[0].transition_in={kind:'Push',duration:4};track.clips[0].transition_out=transition(0);track.clips[1].transition_in=transition(11);
  assert.deepEqual(transitionHandles(track,view,fps).map(handle=>handle.slot),['out']);
  const handle=transitionHandles(fixture().track,view,fps)[0];assert.throws(()=>transitionDraft(handle,Infinity,view,fps));assert.throws(()=>transitionDraft({...handle,transition:{duration:3}},1,view,fps));
  const unchanged=transitionDraft(handle,0,view,fps);assert.equal(unchanged.duration,handle.duration);assert.deepEqual(unchanged.operation.transition,handle.transition);
});

test('fractional fps, scrolling and CSS scaling affect geometry without altering native frame authority',()=>{
  const {track}=fixture(),fractional={num:24000,den:1001},scrolled={...view,origin:3,scale:120,scrollY:62};
  const handle=transitionHandles(track,scrolled,fractional)[0];assert.equal(handle.x,frameToX(4,scrolled,fractional));
  const oneFrame=scrolled.scale*fractional.den/fractional.num,draft=transitionDraft(handle,oneFrame,scrolled,fractional);assert.equal(draft.duration,5);assert.equal(draft.operation.clip_id,'9007199254740993');
});
