import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retimeHandles,retimeStrips,retimeDraft,hitTest,frameToX,RULER,TRACK,MAX_FRAME} from '../js/timeline/geometry.js';

const fps={num:24,den:1},view={scale:240,origin:0,scrollY:0,playhead:0,tool:'select',retimeVisible:new Set(['9007199254740993']),snap:false};
function fixture(){
  const clip={id:'9007199254740993',kind:'media',media_id:'9007199254740997',start_frame:20,length_frames:40,linked_group:null,source_in_frames:100,source_out_frames:180,freeze_source_frame:3,fade_in:2,fade_out:2,retime:{source_span:80,min_length:1,max_length:8000,pitch_correction:true}};
  const neighbor={id:'9007199254740995',kind:'media',start_frame:100,length_frames:40,linked_group:null,retime:null};
  const track={id:'video',kind:'video',locked:false,clips:[clip,neighbor],crossings:[]},timeline={id:'timeline',fps,tracks:[track]};
  return {clip,neighbor,track,timeline,handle:retimeHandles(track,view,fps)[0]};
}

test('speed strips require explicit per-clip visibility and complete authoritative native media metadata',()=>{
  const {clip,track,handle}=fixture();assert.equal(handle.kind,'retime');assert.equal(handle.clip_id,'9007199254740993');assert.equal(handle.end_frame,60);assert.equal(handle.x,frameToX(60,view,fps));
  assert.deepEqual(handle.metadata,clip.retime);assert.notEqual(handle.metadata,clip.retime);assert.equal(handle.topOffset,7);assert.equal(handle.bottomOffset,21);
  for(const changed of [{retimeVisible:new Set()},{retimeVisible:undefined,retime:true},{retimeVisible:['9007199254740993']},{tool:'slip'}])assert.deepEqual(retimeHandles(track,{...view,...changed},fps),[]);
  for(const changed of [{locked:true},{kind:'unknown'}])assert.deepEqual(retimeHandles({...track,...changed},view,fps),[]);
  assert.equal(retimeHandles({...track,kind:'audio'},view,fps).length,1);assert.deepEqual(retimeHandles(track,{...view,scale:1},fps),[]);
});

test('unsupported or imprecise snapshots never fabricate a speed handle',()=>{
  for(const changed of [null,{source_span:'80',min_length:1,max_length:8000,pitch_correction:true},{source_span:0,min_length:1,max_length:1,pitch_correction:true},{source_span:80,min_length:0,max_length:8000,pitch_correction:true},{source_span:80,min_length:2,max_length:1,pitch_correction:true},{source_span:80,min_length:1,max_length:MAX_FRAME,pitch_correction:true},{source_span:80,min_length:1,max_length:8000,pitch_correction:null}]){
    const {clip,track}=fixture();clip.retime=changed;assert.deepEqual(retimeHandles(track,view,fps),[]);
  }
  for(const kind of ['solid_color','title','adjustment']){const {clip,track}=fixture();clip.kind=kind;assert.deepEqual(retimeHandles(track,view,fps),[]);}
});

test('a speed draft changes only an exact integer end point and leaves source, pitch and freeze authority native',()=>{
  const {handle,timeline,clip}=fixture(),before=structuredClone(clip),draft=retimeDraft(handle,50,timeline,view);
  assert.equal(draft.end_frame,65);assert.equal(draft.length_frames,45);assert.equal(draft.original,60);assert.equal(draft.x,frameToX(65,view,fps));
  assert.deepEqual(draft.operation,{kind:'retime_clip',clip_id:'9007199254740993',end_frame:65,overwrite:false});assert.deepEqual(clip,before);
  assert.deepEqual(draft.changes,[{clip_id:clip.id,to_track:'video',to_start_frame:20,length_frames:45}]);assert.equal(draft.error,null);assert.equal(draft.validation_pending,false);
});

test('native minimum length and remaining frame capacity bound every proposed end',()=>{
  const {clip,track,timeline}=fixture();clip.retime={source_span:401,min_length:5,max_length:40100,pitch_correction:false};
  let handle=retimeHandles(track,view,fps)[0];assert.equal(retimeDraft(handle,-100000,timeline,view).length_frames,5);assert.equal(retimeDraft(handle,10000000,timeline,view).length_frames,40100);
  clip.start_frame=MAX_FRAME-80;clip.retime={source_span:80,min_length:1,max_length:80,pitch_correction:true};track.clips=[clip];handle=retimeHandles(track,view,fps)[0];
  assert.equal(retimeDraft(handle,10000000,timeline,view).end_frame,MAX_FRAME);assert.equal(retimeDraft(handle,-100000,timeline,view).end_frame,clip.start_frame+1);
});

test('endpoint snapping follows other clip edges and playhead while excluding the original clip edges',()=>{
  const {handle,timeline}=fixture(),snapping={...view,scale:24,snap:true};
  assert.equal(retimeDraft(handle,35,timeline,snapping).end_frame,100);
  assert.equal(retimeDraft(handle,16,timeline,{...snapping,playhead:70}).end_frame,70);
  assert.equal(retimeDraft(handle,5,timeline,snapping).end_frame,65,'The original end must not snap a short speed drag back onto itself');
});

test('linked group endpoints do not attract the speed gesture and follower geometry remains native',()=>{
  const {clip,timeline,track}=fixture();clip.linked_group='pair';const follower={...structuredClone(clip),id:'9007199254740999',length_frames:48};
  timeline.tracks.push({id:'audio',kind:'audio',locked:false,clips:[follower]});const handle=retimeHandles(track,view,fps)[0],draft=retimeDraft(handle,5,timeline,{...view,scale:24,snap:true});
  assert.equal(draft.end_frame,65);assert.equal(draft.validation_pending,true);assert.equal(draft.changes.length,1);assert.equal(draft.changes[0].clip_id,clip.id);
  assert.equal(follower.length_frames,48);assert.equal(draft.operation.overwrite,false);
});

test('default single-clip overlap is shown as rejected and overwrite requires an explicit boolean opt-in',()=>{
  const {handle,timeline}=fixture();assert.match(retimeDraft(handle,600,timeline,view).error,/Overlap/);
  const overwrite=retimeDraft(handle,600,timeline,{...view,retimeOverwrite:true});assert.equal(overwrite.error,null);assert.equal(overwrite.operation.overwrite,true);
  assert.equal(retimeDraft(handle,600,timeline,{...view,retimeOverwrite:'true'}).operation.overwrite,false);
});

test('linked resizing retains known primary collisions while unknown follower geometry stays deferred',()=>{
  const {clip,track,timeline}=fixture();clip.linked_group='pair';const follower={...structuredClone(clip),id:'9007199254740999'};
  timeline.tracks.push({id:'audio',kind:'audio',locked:false,clips:[follower]});const handle=retimeHandles(track,view,fps)[0];
  let draft=retimeDraft(handle,600,timeline,view);assert.match(draft.error,/Overlap/);assert.equal(draft.validation_pending,true);
  draft=retimeDraft(handle,50,timeline,view);assert.equal(draft.error,null);assert.equal(draft.validation_pending,true);
  draft=retimeDraft(handle,600,timeline,{...view,retimeOverwrite:true});assert.equal(draft.error,null);assert.equal(draft.operation.overwrite,true);
  timeline.tracks[1].locked=true;draft=retimeDraft(handle,600,timeline,{...view,retimeOverwrite:true});assert.match(draft.error,/locked/);
});

test('visible speed strips route the right edge to retime while fades and transitions retain priority',()=>{
  const {clip,timeline}=fixture();const endX=frameToX(60,view,fps);
  for(const y of [RULER+14,RULER+30,RULER+TRACK-3]){
    const hit=hitTest(endX-2,y,timeline,view);assert.equal(hit.kind,'retime');assert.equal(hit.clip_id,clip.id);assert.deepEqual(hit.metadata,clip.retime);
    assert.deepEqual(retimeDraft(hit,20,timeline,view).operation,{kind:'retime_clip',clip_id:clip.id,end_frame:62,overwrite:false});
  }
  assert.equal(hitTest(frameToX(20,view,fps)+2,RULER+30,timeline,view).kind,'trim_start');
  const fadeX=frameToX(22,view,fps);assert.equal(hitTest(fadeX,RULER+14,timeline,{...view,retimeVisible:new Set()}).kind,'fade');assert.equal(hitTest(fadeX,RULER+14,timeline,view).kind,'move');
  assert.equal(hitTest(frameToX(58,view,fps),RULER+14,timeline,{...view,retimeVisible:new Set()}).kind,'fade');
  clip.transition_out={kind:'Push',duration:4,direction:'Left',ease:'InOut',curve:0.25};assert.equal(hitTest(frameToX(56,view,fps),RULER+TRACK-14,timeline,view).kind,'transition');
  assert.equal(hitTest(endX-2,RULER+TRACK-14,timeline,view).kind,'transition_body');
  clip.transition_out.duration=1;assert.equal(hitTest(endX-2,RULER+TRACK-14,timeline,view).kind,'transition');
});

test('a touching neighbor end roll zone becomes retime without changing the left roll zone',()=>{
  const {clip,neighbor,track,timeline}=fixture();neighbor.start_frame=60;
  for(const distance of [1,6,10]){
    const hit=hitTest(frameToX(60,view,fps)-distance,RULER+30,timeline,view);
    assert.equal(hit.kind,'retime');assert.equal(hit.clip_id,clip.id);assert.equal(hit.roll_neighbor_id,undefined);
  }
  const hidden=hitTest(frameToX(60,view,fps)-1,RULER+30,timeline,{...view,retimeVisible:new Set()});
  assert.equal(hidden.kind,'trim_end');assert.equal(hidden.roll_neighbor_id,neighbor.id);
  neighbor.start_frame=0;neighbor.length_frames=20;track.clips=[clip,neighbor];
  const left=hitTest(frameToX(20,view,fps)+1,RULER+30,timeline,view);
  assert.equal(left.kind,'trim_start');assert.equal(left.roll_neighbor_id,neighbor.id);
});

test('speed edge routing preserves strip menu and close targets and refuses decorative or unavailable strips',()=>{
  const {clip,track,timeline}=fixture(),strip=retimeStrips(track,view,fps)[0],endX=frameToX(60,view,fps);
  assert.equal(hitTest((strip.menu.left+strip.menu.right)/2,RULER+14,timeline,view).kind,'retime_menu');
  assert.equal(hitTest((strip.close.left+strip.close.right)/2,RULER+14,timeline,view).kind,'retime_close');
  for(const changed of [{tool:'slip'},{retimeVisible:new Set()}])for(const y of [RULER+14,RULER+30,RULER+TRACK-3])assert.notEqual(hitTest(endX-2,y,timeline,{...view,...changed}).kind,'retime');
  track.locked=true;assert.equal(retimeStrips(track,view,fps)[0].interactive,false);
  for(const y of [RULER+14,RULER+30,RULER+TRACK-3])assert.notEqual(hitTest(endX-2,y,timeline,view).kind,'retime');
  track.locked=false;clip.retime=null;assert.equal(hitTest(endX-2,RULER+30,timeline,view).kind,'trim_end');
});

test('ineligible clips keep their fade handles even when speed mode is enabled',()=>{
  const {clip,timeline}=fixture();clip.retime=null;assert.equal(hitTest(frameToX(22,view,fps),RULER+14,timeline,view).kind,'fade');
});

test('fractional fps and scrolling retain integer end authority without deriving a browser speed ratio',()=>{
  const {track,timeline}=fixture();timeline.fps={num:24000,den:1001};const shifted={...view,origin:17,scale:120},handle=retimeHandles(track,shifted,timeline.fps)[0],framePixels=shifted.scale*timeline.fps.den/timeline.fps.num;
  const draft=retimeDraft(handle,framePixels,timeline,shifted);assert.equal(draft.end_frame,61);assert.deepEqual(Object.keys(draft.operation).sort(),['clip_id','end_frame','kind','overwrite']);assert.equal(draft.x,frameToX(61,shifted,timeline.fps));
});

test('invalid pointers and removed anchors cannot produce a native speed operation',()=>{
  const {handle,timeline}=fixture();assert.throws(()=>retimeDraft(handle,NaN,timeline,view));assert.throws(()=>retimeDraft(handle,Infinity,timeline,view));assert.throws(()=>retimeDraft({...handle,metadata:null},10,timeline,view));
  assert.throws(()=>retimeDraft(handle,10,{...timeline,tracks:[]},view));assert.equal(retimeDraft(handle,0,timeline,view).end_frame,60);
});
