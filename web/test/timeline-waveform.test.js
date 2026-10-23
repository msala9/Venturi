import test from 'node:test';
import assert from 'node:assert/strict';
import {waveformVisual,waveformDraftChanges,waveformColumns} from '../js/timeline/waveform.js';
import {createDraw,visibleWaveformDemand,visibleAssetDemand} from '../js/timeline/draw.js';
import {timelineLayout,frameToX} from '../js/timeline/geometry.js';

const fps={num:1,den:1};
const clip=(id='a',start=0,length=4)=>({id,media_id:`media-${id}`,start_frame:start,length_frames:length,audio_stream_index:0,linked_group:null,gain_db:0,gain_constant:true,gain_bounds:[-100,30],freeze_source_frame:null,fade_in:0,fade_out:0});
const track=(id,clips)=>({id,kind:'audio',locked:false,clips,crossings:[]});
const timeline=(tracks)=>({id:'tl',revision:'r1',fps,tracks,markers:[]});
const asset=clip=>({mediaId:clip.media_id,contentHash:'hash',audioStreamIndex:0,fps,waveform:{scope:'full_source',duration_seconds:4,peaks:[0,.5,1,1]}});
const presentation=clip=>({clip_id:clip.id,media_id:clip.media_id,audio_stream_index:0,content_hash:'hash',clock:{source_offset_frames:0,speed:{num:1,den:1},timeline_fps:fps,media_fps:fps},coverage:[0,100],state:'ready',gain:{kind:'constant',linear:2}});
const rect={left:10,right:14,top:0,bottom:20},visible={left:0,right:100,top:0,bottom:100};

test('waveform columns use native one-bin sampling, one CSS-pixel steps, silence hairline and strict clipping',()=>{
  const c=clip(),tl=timeline([track('audio',[c])]),p=presentation(c),raw=asset(c),visual=waveformVisual(c,'audio',tl);
  const columns=waveformColumns(visual,raw,p,fps,rect,visible);
  assert.deepEqual(columns,[{x:10,half_height:.5,clipped:false},{x:11,half_height:10,clipped:false},{x:12,half_height:10,clipped:true},{x:13,half_height:10,clipped:true}]);
  assert.deepEqual(waveformColumns(visual,raw,p,fps,rect,{...visible,left:11,right:13}),columns.slice(1,3));
  const shifted={...visual,source_start_frame:-4,source_end_frame:0};assert.ok(waveformColumns(shifted,raw,p,fps,rect,visible).every(column=>column.half_height===.5));
  assert.ok(waveformColumns({...visual,source_start_frame:8,source_end_frame:12},raw,p,fps,rect,visible).every(column=>column.clipped),'Native bin lookup clamps beyond the audio duration to its last bin');
});

test('animated gain is sampled by integer source frame independently of the raw peak bin',()=>{
  const c=clip('a',0,1),tl=timeline([track('audio',[c])]),raw={...asset(c),fps:{num:4,den:1},waveform:{duration_seconds:1,peaks:[.6]}},p={...presentation(c),coverage:[0,4],gain:{kind:'runs',runs:[[0,1,.5],[1,2,1],[2,4,2]]}};
  p.clock={...p.clock,media_fps:raw.fps};
  const columns=waveformColumns(waveformVisual(c,'audio',tl),raw,p,fps,rect,visible);
  assert.deepEqual(columns.map(column=>column.clipped),[false,false,true,true]);
  assert.equal(columns[0].half_height,Math.fround(10*Math.fround(Math.fround(.6)*.5)));assert.equal(columns[1].half_height,Math.fround(10*Math.fround(.6)));
  assert.deepEqual(waveformColumns(waveformVisual(c,'audio',tl),raw,{...p,gain:{kind:'runs',runs:[[0,1,.5],[2,4,2]]}},fps,rect,visible),[],'A missing native gain interval must not be interpolated or replaced by default gain');
});

test('fractional media clock uses exact native speed and offset rather than rounded source in/out',()=>{
  const c={...clip(),source_in_frames:1,source_out_frames:5},tl={...timeline([track('audio',[c])]),fps:{num:30000,den:1001}},raw={...asset(c),fps:{num:24,den:1},waveform:{duration_seconds:1,peaks:Array.from({length:100},(_,index)=>index===3?.75:.1)}},p=presentation(c);
  p.clock={source_offset_frames:1,speed:{num:1000,den:1001},timeline_fps:tl.fps,media_fps:raw.fps};p.gain={kind:'constant',linear:1};
  const columns=waveformColumns(waveformVisual(c,'audio',tl),raw,p,tl.fps,rect,visible);
  assert.equal(columns[0].half_height,7.5);assert.equal(Math.trunc((1/raw.fps.num)*100),4,'The old rounded-source mapping would select a different peak');
  const scrolled=waveformColumns(waveformVisual(c,'audio',tl),raw,p,tl.fps,{...rect,left:9.5,right:13.5},{...visible,left:10.25,right:12.5});assert.deepEqual(scrolled.map(column=>column.x),[10.25,11.25,12.25]);
});

test('trim and Roll use their own clamped display bounds while Slip shifts the native timeline offset',()=>{
  const a=clip('a',100,48),b=clip('b',148,48),tl=timeline([track('audio',[a,b])]);
  const trim={kind:'trim_group',target:104,changes:[{clip_id:'a',to_track:'audio',to_start_frame:104,length_frames:44}]};
  assert.deepEqual(waveformVisual(a,'audio',tl,trim),{clip:a,clip_id:'a',track_id:'audio',to_new_track:undefined,start_frame:104,length_frames:44,source_start_frame:104,source_end_frame:148,gain_db:null,drafted:true});
  const roll={kind:'trim_group',changes:[{clip_id:'a',to_track:'audio',to_start_frame:100,length_frames:52},{clip_id:'b',to_track:'audio',to_start_frame:152,length_frames:44}]};
  assert.equal(waveformVisual(a,'audio',tl,roll).source_end_frame,152);assert.equal(waveformVisual(b,'audio',tl,roll).source_start_frame,152);assert.equal(waveformVisual(b,'audio',tl,roll).source_end_frame,196);
  const slip={kind:'slip',target:-4,changes:[{clip_id:'a',to_track:'audio',to_start_frame:100,length_frames:48}]},shown=waveformVisual(a,'audio',tl,slip);
  assert.equal(shown.start_frame,100);assert.equal(shown.source_start_frame,96);assert.equal(shown.source_end_frame,144);assert.equal(a.start_frame,100);
});

test('moves and copies preserve source span and retime previews all linked lengths without changing native operations',()=>{
  const a={...clip('a',10,3),linked_group:'pair'},b={...clip('b',10,5),linked_group:'pair'},other=clip('other',30,4),tl=timeline([track('audio',[a]),track('audio2',[b,other])]);
  const move={kind:'move',duplicate:true,changes:[{clip_id:'a',to_track:'audio2',to_start_frame:300,length_frames:3}]},shown=waveformVisual(a,'audio',tl,move);
  assert.equal(shown.track_id,'audio2');assert.equal(shown.start_frame,300);assert.deepEqual([shown.source_start_frame,shown.source_end_frame],[10,13]);
  const retime={kind:'retime',clip_id:'a',length_frames:6,changes:[{clip_id:'a',to_track:'audio',to_start_frame:10,length_frames:6}],operation:{kind:'retime_clip',clip_id:'a',end_frame:16,overwrite:false}},before=structuredClone(retime),changes=waveformDraftChanges(tl,retime);
  assert.deepEqual(changes.map(change=>[change.clip_id,change.length_frames]),[['a',6],['b',10]]);assert.deepEqual(retime,before);
  const follower=waveformVisual(b,'audio2',tl,retime,changes);assert.equal(follower.length_frames,10);assert.deepEqual([follower.source_start_frame,follower.source_end_frame],[10,15]);assert.equal(waveformVisual(other,'audio2',tl,retime,changes).drafted,false);
});

test('gain draft is local display conversion and missing, frozen, unavailable or foreign native data draws no false waveform',()=>{
  const c=clip(),tl=timeline([track('audio',[c])]),raw=asset(c),p=presentation(c),draft={kind:'gain',clip_id:'a',gain_db:-20},visual=waveformVisual(c,'audio',tl,draft);
  const columns=waveformColumns(visual,raw,p,fps,rect,visible);assert.ok(columns.every(column=>!column.clipped));assert.equal(columns[2].half_height,1);assert.equal(p.gain.linear,2);
  for(const [entry,source,native] of [[visual,raw,null],[visual,null,p],[{...visual,clip:{...c,freeze_source_frame:0}},raw,p],[visual,raw,{...p,state:'hidden',reason:'frozen'}],[visual,raw,{...p,state:'unavailable',reason:'gain_lookup_budget'}],[visual,raw,{...p,content_hash:'old'}],[visual,raw,{...p,audio_stream_index:1}],[visual,raw,{...p,clock:{...p.clock,media_fps:{num:25,den:1}}}]])assert.deepEqual(waveformColumns(entry,source,native,fps,rect,visible),[]);
  assert.deepEqual(waveformColumns(visual,raw,p,fps,rect,{...visible,top:30}),[]);assert.deepEqual(waveformColumns(visual,raw,p,fps,rect,{...visible,left:20}),[]);
});

function drawHarness(t){
  const names=['document','getComputedStyle','devicePixelRatio','requestAnimationFrame','ResizeObserver'],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const [name,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  const frames=[],paths=[],demand=[];
  const context={path:[],beginPath(){this.path=[];},moveTo(x,y){this.path.push([x,y]);},lineTo(x,y){this.path.push([x,y]);},stroke(){if(this.strokeStyle?.startsWith('rgba(') && this.path.length)paths.push({points:this.path,style:this.strokeStyle});}};
  const ctx=new Proxy(context,{get:(target,key)=>target[key] ?? (()=>{})});
  globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:()=> '#fff'});globalThis.devicePixelRatio=1.25;globalThis.requestAnimationFrame=callback=>frames.push(callback);globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const c=clip(),tl=timeline([track('audio',[c]),track('audio2',[])]),view={origin:0,scale:4,selection:[],playhead:0,retimeVisible:new Set()},raw=asset(c),native=presentation(c),presentations=new Map([['a',native]]),assets=new Map([[JSON.stringify([c.media_id,0]),raw]]);
  const draw=createDraw({clientWidth:450,clientHeight:220,getContext:()=>ctx},()=>tl,view,()=>assets,(_elapsed,value)=>demand.push(value),()=>null,()=>presentations);
  const paint=()=>{paths.length=0;for(const callback of frames.splice(0))callback();return paths.flatMap(path=>path.points.filter((_,index)=>index%2===0).map(([x,y],index)=>({x,mid:(y+path.points[index*2+1][1])/2})));};
  t.after(()=>draw.destroy());return {c,tl,view,paths,demand,presentations,draw,paint};
}

test('actual draw removes the old waveform while trimming or moving and copies keep both source-aligned visuals',t=>{
  const h=drawHarness(t),initial=h.paint();assert.equal(initial.length,16);assert.deepEqual(h.demand[0].waveform_clip_ids,['a']);
  h.view.draft={kind:'trim_group',changes:[{clip_id:'a',to_track:'audio',to_start_frame:2,length_frames:2}]};h.draw.invalidate();const trimmed=h.paint();assert.equal(trimmed.length,8);assert.ok(trimmed.every(column=>column.x>=158));
  h.view.draft={kind:'move',changes:[{clip_id:'a',to_track:'audio2',to_start_frame:10,length_frames:4}]};h.draw.invalidate();const moved=h.paint(),layout=timelineLayout(h.tl,h.view,220),expected=layout.trackTop(1)+layout.rowHeight/2;
  assert.equal(moved.length,16);assert.ok(moved.every(column=>column.x>=190 && column.mid===expected));
  h.view.draft.duplicate=true;h.draw.invalidate();assert.equal(h.paint().length,32);
  h.view.draft=null;h.presentations.clear();h.draw.invalidate();assert.deepEqual(h.paint(),[],'Raw peaks alone must not masquerade as gain-aware presentation');
});

test('waveform demand follows visible draft rows and source clips, is bounded and ignores playhead',()=>{
  const c=clip('a',1000,4),tl=timeline([track('audio',[c]),track('audio2',[])]),view={origin:0,scale:4,playhead:0};
  assert.deepEqual(visibleWaveformDemand(tl,view,450,220),[]);
  view.draft={kind:'move',changes:[{clip_id:'a',to_track:'audio2',to_start_frame:0,length_frames:4}]};assert.deepEqual(visibleWaveformDemand(tl,view,450,220),['a']);view.playhead=100;assert.deepEqual(visibleWaveformDemand(tl,view,450,220),['a']);
  const many=timeline([track('audio',Array.from({length:70},(_,index)=>clip(String(index))))]);assert.deepEqual(visibleWaveformDemand(many,{origin:0,scale:4},450,220),Array.from({length:64},(_,index)=>String(index)));
  assert.deepEqual(visibleWaveformDemand(many,{origin:0,scale:4,audioScroll:10000},450,48),[]);
  assert.equal(frameToX(0,{origin:0,scale:4},fps),150);
  const frozen=clip('frozen');frozen.freeze_source_frame=0;
  const held=timeline([track('audio',[frozen])]);
  assert.deepEqual(visibleWaveformDemand(held,{origin:0,scale:4},450,220),[]);
  assert.deepEqual(visibleAssetDemand(held,{origin:0,scale:4},450,220),[],'Silent frozen audio must not schedule waveform analysis');
});
