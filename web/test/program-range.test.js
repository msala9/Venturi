import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildProgramWindow} from '../js/program-range.js';

function fixture(total=20_000,fps={num:24,den:1}){
  return {document:{project_epoch:'epoch:1',generation:'9007199254740993',capabilities:{playback:true}},timeline:{id:'9007199254740995',revision:'revision:1',fps,tracks:[{clips:[{start_frame:0,length_frames:total}]}]}};
}

test('Program windows contain exactly authorized query fields and retain string identities',()=>{
  const {document,timeline}=fixture(),before=structuredClone({document,timeline});
  assert.deepEqual(buildProgramWindow(document,timeline,15),{project_epoch:'epoch:1',if_generation:'9007199254740993',timeline_id:'9007199254740995',revision:'revision:1',start_frame:15,end_frame:7215,width:960,audio_origin_frame:15});
  assert.deepEqual({document,timeline},before);
});

test('empty, unavailable or malformed timeline snapshots cannot request a Program range',()=>{
  const {document,timeline}=fixture();
  for(const invalid of [null,{}, {...timeline,tracks:[]},{...timeline,tracks:[{clips:[]}]},{...timeline,tracks:null},{...timeline,tracks:[{}]}])assert.equal(buildProgramWindow(document,invalid,0),null);
  for(const state of [null,{}, {...document,capabilities:{playback:false}},{...document,generation:1},{...document,project_epoch:''}])assert.equal(buildProgramWindow(state,timeline,0),null);
  for(const patch of [{id:''},{revision:null}])assert.equal(buildProgramWindow(document,{...timeline,...patch},0),null);
});

test('native rational fps must have positive bounded integer components and support a nonempty five-minute window',()=>{
  const {document,timeline}=fixture();
  for(const fps of [null,{}, {num:0,den:1},{num:24,den:0},{num:-24,den:1},{num:23.976,den:1},{num:24,den:1.5},{num:Infinity,den:1},{num:24,den:NaN},{num:2_147_483_648,den:1},{num:24,den:2_147_483_648},{num:1,den:301}])assert.equal(buildProgramWindow(document,{...timeline,fps},0),null);
  assert.equal(buildProgramWindow(document,{...timeline,fps:{num:1,den:300}},0).end_frame,1);
});

test('fractional fps respects the native 300-second limit with an explicit audio origin',()=>{
  for(const [fps,capacity] of [[{num:30_000,den:1001},8991],[{num:24_000,den:1001},7192],[{num:25,den:2},3750]]){
    const {document,timeline}=fixture(30_000,fps),query=buildProgramWindow(document,timeline,0);
    assert.equal(query.end_frame,capacity);assert.ok((query.end_frame-query.start_frame)/(fps.num/fps.den)<=300);assert.deepEqual(Object.keys(query).sort(),['project_epoch','if_generation','timeline_id','revision','start_frame','end_frame','width','audio_origin_frame'].sort());
  }
});

test('timeline duration is the maximum valid clip end across every track and includes gaps',()=>{
  const {document,timeline}=fixture();timeline.tracks=[{clips:[{start_frame:100,length_frames:10}]},{clips:[{start_frame:10,length_frames:50},{start_frame:900,length_frames:25}]}];
  assert.deepEqual([buildProgramWindow(document,timeline,0).start_frame,buildProgramWindow(document,timeline,0).end_frame],[0,925]);
  for(const clip of [{start_frame:-1,length_frames:1},{start_frame:0.5,length_frames:1},{start_frame:0,length_frames:0},{start_frame:0,length_frames:1.5},{start_frame:NaN,length_frames:5},{start_frame:999_999_999,length_frames:2},{start_frame:1_000_000_000,length_frames:Number.MAX_SAFE_INTEGER},null])assert.equal(buildProgramWindow(document,{...timeline,tracks:[{clips:[clip]}]},0),null);
  const edgeTimeline={...timeline,tracks:[{clips:[{start_frame:999_999_999,length_frames:1}]}]},edge=buildProgramWindow(document,edgeTimeline,999_999_999);assert.equal(edge.start_frame,999_999_999);assert.equal(edge.end_frame,1_000_000_000);assert.equal(buildProgramWindow(document,edgeTimeline,1_000_000_000),null);
});

test('manual Play and explicit continuation both refuse the exclusive timeline end without replaying its last frame',()=>{
  const {document,timeline}=fixture(48);
  assert.deepEqual([buildProgramWindow(document,timeline,47).start_frame,buildProgramWindow(document,timeline,47).end_frame],[47,48]);
  for(const playhead of [48,1000,Number.MAX_SAFE_INTEGER])assert.equal(buildProgramWindow(document,timeline,playhead),null);
  assert.equal(buildProgramWindow(document,timeline,-10).start_frame,0);
  for(const value of [48,49,Number.MAX_SAFE_INTEGER,-1,1.5,null,NaN,Infinity,'12'])assert.equal(buildProgramWindow(document,timeline,0,value),null);
  for(const value of [null,1.5,NaN,Infinity,'12'])assert.equal(buildProgramWindow(document,timeline,value),null);
  assert.equal(buildProgramWindow(document,timeline,47,0).start_frame,0);
});

test('long Program continuation boundaries cover the timeline once with an exact final tail',()=>{
  const {document,timeline}=fixture(14_501),ranges=[];let query=buildProgramWindow(document,timeline,0);
  while(query){ranges.push([query.start_frame,query.end_frame]);assert.equal(query.audio_origin_frame,0);assert.ok(ranges.length<10);query=buildProgramWindow(document,timeline,0,query.end_frame,query.audio_origin_frame);}
  assert.deepEqual(ranges,[[0,7200],[7200,14_400],[14_400,14_501]]);assert.equal(ranges.reduce((sum,[start,end])=>sum+end-start,0),14_501);
  assert.equal(buildProgramWindow(document,timeline,0,14_501),null);
});

test('nonzero and fractional-fps continuation starts retain adjacency and never repeat the final frame',()=>{
  const {document,timeline}=fixture(20_000,{num:30_000,den:1001});
  const first=buildProgramWindow(document,timeline,500),second=buildProgramWindow(document,timeline,123,first.end_frame,first.audio_origin_frame),tail=buildProgramWindow(document,timeline,123,second.end_frame,second.audio_origin_frame);
  assert.deepEqual([first.start_frame,first.end_frame,second.start_frame,second.end_frame,tail.start_frame,tail.end_frame],[500,9491,9491,18_482,18_482,20_000]);
  assert.equal(buildProgramWindow(document,timeline,123,tail.end_frame),null);
});

test('audio render origin is captured on manual Play and bounded across native continuation windows',()=>{
  const {document,timeline}=fixture(20_000,{num:30000,den:1001});
  const first=buildProgramWindow(document,timeline,500),next=buildProgramWindow(document,timeline,0,first.end_frame,first.audio_origin_frame);
  assert.equal(next.audio_origin_frame,500);assert.equal(buildProgramWindow(document,timeline,600).audio_origin_frame,600);
  for(const invalid of [-1,501,NaN,Infinity,1.5,null,'0'])assert.equal(buildProgramWindow(document,timeline,500,undefined,invalid),null);
});
