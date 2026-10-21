import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transitionBodies,selectedTransition,transitionPlacement,hitTest,frameToX,RULER,TRACK} from '../js/timeline/geometry.js';

const fps={num:24,den:1},view={scale:240,origin:0,scrollY:0,tool:'select'},band=RULER+TRACK-14;
const native=(duration=5)=>({kind:'Push',duration,direction:'Down',ease:'InOut',curve:Math.fround(.37)});
function fixture(){
  const left={id:'9007199254740993',kind:'media',start_frame:0,length_frames:20,fade_in:2,fade_out:2,transition_in:null,transition_out:null};
  const right={id:'9007199254740995',kind:'title',start_frame:20,length_frames:10,fade_in:2,fade_out:2,transition_in:null,transition_out:null};
  const track={id:'9007199254740997',kind:'video',locked:false,clips:[left,right],crossings:[]};
  const timeline={id:'timeline',fps,tracks:[track],transition_defaults:[native(40),{...native(12),kind:'CrossDissolve'}, {...native(4),kind:'SmoothCut'}]};
  return {left,right,track,timeline};
}
const at=frame=>[frameToX(frame,view,fps),RULER+30];
function addCrossing(f){f.track.crossings.push({left_clip:f.left.id,right_clip:f.right.id,start_frame:17,end_frame:22,kind:'Push',transition:native()});return f;}

test('crossing body halves select the same left anchor while duration endpoints retain priority',()=>{
  const f=addCrossing(fixture()),bodies=transitionBodies(f.track,view,fps),selection={track_id:f.track.id,clip_id:f.left.id,slot:'cut_after'};
  assert.equal(bodies.length,2);
  for(const body of bodies){assert.deepEqual(body.selection,selection);assert.deepEqual(body.transition,native());assert.notEqual(body.transition,f.track.crossings[0].transition);}
  for(const frame of [18.5,21]){const hit=hitTest(frameToX(frame,view,fps),band,f.timeline,view);assert.equal(hit.kind,'transition_body');assert.deepEqual(hit.selection,selection);}
  assert.equal(hitTest(frameToX(17,view,fps),band,f.timeline,view).kind,'transition');
  assert.equal(hitTest(frameToX(22,view,fps),band,f.timeline,view).kind,'transition');
});

test('body selection stays inside the lower band and leaves fades, move and lower trim available',()=>{
  const f=fixture();f.left.transition_in=native(8);
  assert.equal(hitTest(frameToX(3,view,fps),band,f.timeline,view).kind,'transition_body');
  assert.equal(hitTest(frameToX(2,view,fps),RULER+14,f.timeline,view).kind,'fade');
  assert.equal(hitTest(frameToX(3,view,fps),RULER+30,f.timeline,view).kind,'move');
  assert.equal(hitTest(frameToX(20,view,fps)-2,RULER+TRACK-4,f.timeline,view).kind,'trim_end');
  assert.deepEqual(transitionBodies(f.track,{...view,tool:'slip'},fps),[]);
});

test('the selected transition descriptor is independent of zoom and supports locked read-only inspection',()=>{
  const f=addCrossing(fixture()),selection={track_id:f.track.id,clip_id:f.left.id,slot:'cut_after'};
  f.track.locked=true;
  const selected=selectedTransition(f.timeline,selection);assert.equal(selected.locked,true);assert.equal(selected.max,20);assert.deepEqual(selected.involved_clips.map(clip=>clip.id),[f.left.id,f.right.id]);
  selected.transition.direction='Left';assert.equal(f.track.crossings[0].transition.direction,'Down');
  assert.deepEqual(transitionBodies(f.track,view,fps),[]);assert.equal(transitionPlacement(f.timeline,view,at(20),'Push').operation,null);
  assert.equal(selectedTransition(f.timeline,{...selection,clip_id:f.right.id}),null);
  assert.equal(selectedTransition(f.timeline,{...selection,slot:'out'}),null,'Crossing hides its underlying edge');
});

test('native catalog payloads clamp single-edge and crossing durations without inventing defaults',()=>{
  const f=fixture(),before=structuredClone(f.timeline);
  const single=transitionPlacement(f.timeline,view,at(1),'Push');
  assert.equal(single.slot,'in');assert.equal(single.duration,20);assert.deepEqual(single.operation.transition,{...before.transition_defaults[0],duration:20});
  const crossing=transitionPlacement(f.timeline,view,at(19),'Push');
  assert.equal(crossing.slot,'cut_after');assert.equal(crossing.clip_id,f.left.id);assert.equal(crossing.duration,20);assert.equal(crossing.start_frame,10);assert.equal(crossing.end_frame,30);assert.equal(crossing.handles.length,2);
  assert.deepEqual(f.timeline,before);crossing.operation.transition.curve=.1;assert.equal(crossing.transition.curve,before.transition_defaults[0].curve);
  assert.equal(transitionPlacement({...f.timeline,transition_defaults:[]},view,at(1),'Push').operation,null);
});

test('either side of an adjacent cut resolves the same canonical crossing and odd native window',()=>{
  const f=fixture(),a=transitionPlacement(f.timeline,view,at(19),native()),b=transitionPlacement(f.timeline,view,at(21),native());
  assert.deepEqual(a.operation,b.operation);assert.deepEqual(a.selection,b.selection);assert.equal(a.start_frame,17);assert.equal(a.end_frame,22);
  assert.deepEqual(a.handles.map(handle=>handle.x),[frameToX(17,view,fps),frameToX(22,view,fps)]);
});

test('drop zones use 40 CSS pixels, half-width ties choose In, and gaps or clip centers refuse',()=>{
  const f=fixture();
  assert.equal(transitionPlacement(f.timeline,view,at(4),native()).slot,'in');
  assert.equal(transitionPlacement(f.timeline,view,at(4.01),native()).operation,null);
  assert.equal(transitionPlacement(f.timeline,view,at(10),native()).operation,null);
  f.right.start_frame=25;assert.equal(transitionPlacement(f.timeline,view,at(22),native()).operation,null);
  f.track.clips=[{...f.left,length_frames:4}];const midpoint=transitionPlacement(f.timeline,view,at(2),native());assert.equal(midpoint.slot,'in');assert.equal(midpoint.duration,4);
  assert.equal(transitionPlacement(f.timeline,view,[frameToX(1,view,fps),RULER+3],native()).operation,null);
});

test('only unlocked eligible video targets accept drops and an adjustment neighbor blocks both sides',()=>{
  for(const patch of [{kind:'audio'},{locked:true}]){const f=fixture();Object.assign(f.track,patch);assert.equal(transitionPlacement(f.timeline,view,at(1),native()).operation,null);}
  for(const kind of ['media','solid_color','title']){const f=fixture();f.left.kind=kind;assert.ok(transitionPlacement(f.timeline,view,at(1),native()).operation);}
  const f=fixture();f.right.kind='adjustment';assert.equal(transitionPlacement(f.timeline,view,at(19),native()).operation,null);assert.equal(transitionPlacement(f.timeline,view,at(21),native()).operation,null);
  assert.equal(transitionPlacement(f.timeline,{...view,tool:'slip'},at(1),native()).operation,null);
});

test('existing destination needs explicit replacement while identical native payload is a true no-op',()=>{
  const f=fixture();f.left.transition_in=native(5);
  const refused=transitionPlacement(f.timeline,view,at(1),native(6));assert.equal(refused.replacement,true);assert.match(refused.error,/Replace/);assert.equal(refused.operation,null);assert.equal(refused.handles.length,1);
  assert.equal(transitionPlacement(f.timeline,view,at(1),native(6),{replace:1}).operation,null);
  const replacement=transitionPlacement(f.timeline,view,at(1),native(6),{replace:true});assert.equal(replacement.error,null);assert.equal(replacement.operation.transition.duration,6);
  const identical=transitionPlacement(f.timeline,view,at(1),native());assert.equal(identical.noop,true);assert.equal(identical.operation,null);assert.equal(identical.error,null);
});

test('crossing destination replacement checks both occupied edge settings and stored crossings',()=>{
  const f=fixture();f.right.transition_in=native(3);
  assert.equal(transitionPlacement(f.timeline,view,at(19),native()).operation,null);
  assert.ok(transitionPlacement(f.timeline,view,at(19),native(),{replace:true}).operation);
  addCrossing(f);const identical=transitionPlacement(f.timeline,view,at(19),native());assert.equal(identical.noop,true);assert.equal(identical.error,null);
  assert.equal(transitionPlacement(f.timeline,view,at(19),native(7)).operation,null);
});

test('Alt duplication preserves every native field and leaves source unchanged after target duration clamp',()=>{
  const f=fixture();f.left.transition_in=native(15);const source={track_id:f.track.id,clip_id:f.left.id,slot:'in'},before=structuredClone(f.timeline);
  const copy=transitionPlacement(f.timeline,view,at(29),f.left.transition_in,{source});assert.equal(copy.operation.slot,'out');assert.deepEqual(copy.operation.transition,{...native(15),duration:10});assert.deepEqual(f.timeline,before);
  const changed={...f.left.transition_in,curve:.5};assert.equal(transitionPlacement(f.timeline,view,at(29),changed,{source}).operation,null);
  const targetTrack={...f.track,id:'other',clips:[{...f.right,start_frame:50}],crossings:[]};f.timeline.tracks.push(targetTrack);f.track.locked=true;
  assert.equal(transitionPlacement(f.timeline,view,[frameToX(59,view,fps),RULER+TRACK+30],native(15),{source}).operation,null);
});

test('incomplete, inconsistent, missing-neighbor and ambiguous crossing snapshots cannot be selected or replaced',()=>{
  for(const patch of [{transition:undefined},{start_frame:16},{end_frame:23},{right_clip:'missing'},{transition:native(21)}]){
    const f=addCrossing(fixture());Object.assign(f.track.crossings[0],patch);const selection={track_id:f.track.id,clip_id:f.left.id,slot:'cut_after'};
    assert.equal(selectedTransition(f.timeline,selection),null);assert.deepEqual(transitionBodies(f.track,view,fps),[]);assert.equal(transitionPlacement(f.timeline,view,at(19),native(),{replace:true}).operation,null);
  }
  const f=addCrossing(fixture());f.track.crossings.push(structuredClone(f.track.crossings[0]));assert.equal(transitionPlacement(f.timeline,view,at(19),native(),{replace:true}).operation,null);
});

test('incomplete single-edge snapshots never become destructive replacement targets',()=>{
  for(const payload of [{kind:'Push',duration:5},native(21)]){const f=fixture();f.left.transition_in=payload;assert.equal(transitionPlacement(f.timeline,view,at(1),native(),{replace:true}).operation,null);}
  const f=fixture();assert.equal(transitionPlacement(f.timeline,view,at(1),{kind:'Push',duration:3}).operation,null);assert.equal(transitionPlacement(f.timeline,view,[NaN,band],native()).operation,null);
});

test('fractional fps, scrolling and pan change hit coordinates but never native IDs or frame duration',()=>{
  const f=fixture(),scrolled={...view,scale:120,origin:3,scrollY:TRACK},fractional={num:24000,den:1001};
  f.timeline.fps=fractional;f.timeline.tracks.unshift({id:'empty',kind:'audio',clips:[]});
  const draft=transitionPlacement(f.timeline,scrolled,[frameToX(19,scrolled,fractional),RULER+30],native());assert.equal(draft.track,1);assert.equal(draft.clip_id,'9007199254740993');assert.equal(draft.duration,5);assert.equal(draft.start_frame,17);assert.equal(draft.end_frame,22);
});
