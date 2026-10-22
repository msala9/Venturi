import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedRetimeClips,retimeVisibilityState,toggleRetimeVisibility,retimeProjectVisibility} from '../js/retime-visibility.js';
import {retimeHandles,retimeStrips,hitTest,frameToX,RULER,TRACK,timelineLayout} from '../js/timeline/geometry.js';

function fixture(){
  const media=(id,start,group=null)=>({id,kind:'media',start_frame:start,length_frames:100,linked_group:group,fade_in:5,fade_out:5,
    retime:{source_span:100,min_length:1,max_length:10_000,pitch_correction:false,speed_percent:100}});
  const primary=media('video',0,'pair'),follower=media('audio',0,'pair'),other=media('other',150),locked=media('locked',300);
  const generator={id:'solid',kind:'solid_color',start_frame:450,length_frames:100};
  const timeline={id:'timeline',fps:{num:24,den:1},tracks:[{id:'v',kind:'video',clips:[primary,other,generator]},{id:'a',kind:'audio',clips:[follower]},{id:'locked-track',kind:'video',locked:true,clips:[locked]}]};
  return {timeline,primary,follower,other,locked,generator};
}

test('CtrlR toggles only selected existing native media and never expands linked followers',()=>{
  const {timeline}=fixture(),visible=new Set(['unselected','other-timeline-clip']);
  assert.deepEqual(selectedRetimeClips(timeline,['video','solid','missing','video']),['video']);
  const shown=toggleRetimeVisibility(timeline,['video','solid','missing'],visible);
  assert.deepEqual([...shown].sort(),['other-timeline-clip','unselected','video']);assert.equal(shown.has('audio'),false);
  assert.deepEqual([...visible],['unselected','other-timeline-clip']);
  const hidden=toggleRetimeVisibility(timeline,['video'],shown);assert.deepEqual([...hidden],[...visible]);
});

test('mixed selection extends all selected media first and hides them only when all are visible',()=>{
  const {timeline}=fixture(),visible=new Set(['video','other-timeline-clip']);
  const first=toggleRetimeVisibility(timeline,['video','audio','other','solid'],visible);
  assert.deepEqual([...first].sort(),['audio','other','other-timeline-clip','video']);
  assert.deepEqual(retimeVisibilityState(timeline,['video','audio','other','solid'],first),{ids:['video','other','audio'],disabled:false,pressed:true,any:true});
  const second=toggleRetimeVisibility(timeline,['audio','other','video','solid'],first);
  assert.deepEqual([...second],['other-timeline-clip']);
});

test('empty, deleted, generator-only and absent timelines cannot toggle unrelated visibility',()=>{
  const {timeline}=fixture(),visible=new Set(['video','old-deleted-clip']);
  for(const selection of [[],['solid'],['missing']]){
    assert.deepEqual([...toggleRetimeVisibility(timeline,selection,visible)],[...visible]);
    const state=retimeVisibilityState(timeline,selection,visible);assert.equal(state.disabled,true);assert.equal(state.pressed,false);
  }
  assert.deepEqual([...toggleRetimeVisibility(null,['video'],visible)],[...visible]);
  timeline.tracks[0].clips=timeline.tracks[0].clips.filter(clip=>clip.id!=='video');
  assert.deepEqual(selectedRetimeClips(timeline,['video']),[]);assert.equal(retimeVisibilityState(timeline,['video'],visible).disabled,true);
});

test('locked selected media retains native local visibility toggling while edit handles remain disabled',()=>{
  const {timeline}=fixture(),visible=toggleRetimeVisibility(timeline,['locked'],new Set());
  assert.equal(visible.has('locked'),true);assert.equal(retimeVisibilityState(timeline,['locked'],visible).pressed,true);
  const view={retimeVisible:visible,scale:240,origin:0,scrollY:0};
  assert.deepEqual(retimeHandles(timeline.tracks[2],view,timeline.fps),[]);
  const [strip]=retimeStrips(timeline.tracks[2],view,timeline.fps);assert.equal(strip.interactive,false);assert.equal(strip.metadata.speed_percent,100);
  for(const x of [(strip.menu.left+strip.menu.right)/2,(strip.close.left+strip.close.right)/2,strip.right]){
    assert.equal(['retime','retime_menu','retime_close'].includes(hitTest(x,timelineLayout(timeline,view).trackTop(2)+14,timeline,view).kind),false);
  }
  assert.equal(toggleRetimeVisibility(timeline,['locked'],visible).size,0);
});

test('selection changes preserve shown strips and hidden clips restore their fade interactions',()=>{
  const {timeline,primary,other}=fixture();
  const view={scale:240,origin:0,scrollY:0,tool:'move',selection:[primary.id],retimeVisible:toggleRetimeVisibility(timeline,[primary.id],new Set())};
  assert.deepEqual(retimeHandles(timeline.tracks[0],view,timeline.fps).map(handle=>handle.clip_id),[primary.id]);
  view.selection=[other.id];assert.equal(retimeVisibilityState(timeline,view.selection,view.retimeVisible).pressed,false);
  assert.deepEqual(retimeHandles(timeline.tracks[0],view,timeline.fps).map(handle=>handle.clip_id),[primary.id]);
  assert.equal(hitTest(frameToX(other.start_frame+5,view,timeline.fps),timelineLayout(timeline,view).trackTop(0)+14,timeline,view).kind,'fade');
  view.retimeVisible=toggleRetimeVisibility(timeline,[primary.id],view.retimeVisible);
  assert.equal(hitTest(frameToX(5,view,timeline.fps),timelineLayout(timeline,view).trackTop(0)+14,timeline,view).kind,'fade');
});

test('other timeline visibility remains stored without manufacturing handles in the active timeline',()=>{
  const {timeline}=fixture(),visible=new Set(['other-timeline-clip']),view={scale:240,origin:0,scrollY:0,retimeVisible:visible};
  assert.equal(retimeVisibilityState(timeline,['video'],visible).pressed,false);assert.equal(retimeVisibilityState(timeline,['video'],visible).any,true);
  assert.deepEqual(retimeHandles(timeline.tracks[0],view,timeline.fps),[]);
  const updated=toggleRetimeVisibility(timeline,['video'],visible);assert.equal(updated.has('other-timeline-clip'),true);
  const otherTimeline={tracks:[{clips:[{id:'other-timeline-clip',kind:'media'}]}]};
  assert.equal(retimeVisibilityState(otherTimeline,['other-timeline-clip'],updated).pressed,true);
  assert.equal(toggleRetimeVisibility(otherTimeline,['other-timeline-clip'],updated).has('video'),true);
});

test('project identity changes clear local visibility even when clip identifiers collide',()=>{
  const visible=new Set(['video','other-timeline-clip']);
  assert.equal(retimeProjectVisibility('epoch','epoch',visible),visible);
  const next=retimeProjectVisibility('epoch','replacement',visible);assert.equal(next.size,0);assert.notEqual(next,visible);assert.equal(visible.has('video'),true);
  const {timeline}=fixture();assert.equal(retimeVisibilityState(timeline,['video'],next).pressed,false);
  assert.deepEqual(retimeHandles(timeline.tracks[0],{retimeVisible:next,scale:240,origin:0},timeline.fps),[]);
});
