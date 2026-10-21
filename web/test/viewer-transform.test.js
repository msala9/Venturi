import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewerFrameRect,viewerTransformAvailability,viewerTransformGeometry,viewerTransformHit,viewerTransformDraft,createViewerTransformGesture} from '../js/viewer-transform.js';

const viewport={left:0,top:0,width:1000,height:1000};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} differs from ${expected}`);
function fixture(){
  const values={ZoomX:1,ZoomY:1,PositionX:0,PositionY:0,Rotation:0,AnchorX:0,AnchorY:0,CropLeft:0,CropTop:0,CropRight:0,CropBottom:0};
  return {project_epoch:'e',if_generation:'3',timeline_id:'1',revision:'r',frame:24,clip_id:'9007199254740993',preview_current:true,timeline_size:[1920,1080],detail:{clip_id:'9007199254740993',timeline_frame:24,source_frame:48,source_size:[1920,1080],video:true,locked:false,flip:[false,false],transform:Object.entries(values).map(([param,value])=>({param,value,default:value,key_count:0,min:param.startsWith('Zoom')?0.01:-1_000_000,max:param.startsWith('Zoom')?20:1_000_000}))}};
}
function value(context,param,next){context.detail.transform.find(item=>item.param===param).value=next;}

test('viewer coordinates account for composed frame letterboxing and CSS scale',()=>{
  const frame=viewerFrameRect({...viewport,left:10,top:20},[1920,1080]);
  for(const [key,expected] of Object.entries({left:10,top:238.75,width:1000,height:562.5,scale:1000/1920}))close(frame[key],expected);
  const context=fixture(),draft=viewerTransformDraft(context,viewport,{kind:'move'},[500,500],[600,450]);
  close(draft.transform.position[0],192);close(draft.transform.position[1],96);
  assert.equal(draft.operation.clip_id,'9007199254740993');
  assert.deepEqual(draft.operation.patch.transform.map(item=>item.param),['PositionX','PositionY']);
});

test('native fitted source rectangle preserves asymmetric crop, flip, pivot and clockwise rotation',()=>{
  const context=fixture();context.timeline_size=context.detail.source_size=[1000,500];context.detail.flip=[true,false];
  for(const [param,next] of Object.entries({ZoomX:2,PositionX:10,PositionY:20,AnchorX:30,AnchorY:40,Rotation:90,CropLeft:100,CropTop:20}))value(context,param,next);
  const view={left:0,top:0,width:1000,height:500},geometry=viewerTransformGeometry(context,view);
  close(geometry.corners[0][0],730);close(geometry.corners[0][1],-870);
  assert.deepEqual(viewerTransformHit(context,view,geometry.corners[0]),{kind:'scale',corner:[-1,1]});
  assert.deepEqual(viewerTransformHit(context,view,[500,130]),{kind:'move'});
  context.detail.source_size=[500,1000];context.detail.flip=[false,false];
  for(const parameter of context.detail.transform)parameter.value=parameter.param.startsWith('Zoom')?1:0;
  const portrait=viewerTransformGeometry(context,view);
  assert.deepEqual(portrait.corners,[[375,0],[625,0],[625,500],[375,500]]);
});

test('corner scale uses native proportional projection and Shift independent axes',()=>{
  const context=fixture(),view={left:0,top:0,width:1920,height:1080};
  const corner=viewerTransformGeometry(context,view).corners[1],to=[corner[0]+960,corner[1]];
  const free=viewerTransformDraft(context,view,{kind:'scale',corner:[1,1]},corner,to,{free:true});
  close(free.transform.zoom[0],2);close(free.transform.zoom[1],1);
  const proportional=viewerTransformDraft(context,view,{kind:'scale',corner:[1,1]},corner,to);
  close(proportional.transform.zoom[0],proportional.transform.zoom[1]);
  assert.ok(proportional.transform.zoom[0]>1 && proportional.transform.zoom[0]<2);
});

test('viewer gestures refuse guessed dimensions and animated affected axes',()=>{
  const context=fixture();delete context.detail.source_size;
  assert.match(viewerTransformAvailability(context),/Native source/);
  context.detail.source_size=[1920,1080];context.detail.transform.find(parameter=>parameter.param==='PositionX').key_count=1;
  assert.throws(()=>viewerTransformDraft(context,viewport,{kind:'move'},[500,500],[510,510]),/Animated position/);
  assert.doesNotThrow(()=>viewerTransformDraft(context,viewport,{kind:'scale',corner:[1,1]},[1000,218.75],[1001,218.75]));
});

test('native f32 scale minimum remains usable and clamps the draft consistently',()=>{
  const context=fixture(),minimum=Math.fround(0.01);
  value(context,'ZoomX',minimum);value(context,'ZoomY',minimum);
  assert.equal(viewerTransformAvailability(context),null);
  const geometry=viewerTransformGeometry(context,viewport),start=geometry.corners[1];
  const draft=viewerTransformDraft(context,viewport,{kind:'scale',corner:[1,1]},start,[start[0]-100,start[1]+100]);
  assert.deepEqual(draft.transform.zoom,[minimum,minimum]);
  assert.deepEqual(draft.operation.patch.transform.map(parameter=>parameter.value),[minimum,minimum]);
  assert.deepEqual(draft.geometry.transform.zoom,[minimum,minimum]);
});

test('sub-ULP pointer motion produces no native default edit or Undo step',async()=>{
  const context=fixture(),commands=[],view={left:0,top:0,width:1920,height:1080};value(context,'PositionX',1_000_000);
  const start=[1_000_960,540],end=[start[0]+0.01,start[1]];
  const draft=viewerTransformDraft(context,view,{kind:'move'},start,end);
  assert.equal(draft.transform.position[0],1_000_000);assert.equal(draft.operation.patch.transform[0].value,1_000_000);
  const gesture=createViewerTransformGesture({getContext:()=>context,getViewport:()=>view,canCommit:()=>true,commit:async operation=>commands.push(operation),onGhost:()=>{},notice:message=>assert.fail(message)});
  assert.equal(gesture.begin(start).kind,'move');
  await gesture.end(end);assert.deepEqual(commands,[]);
});

test('pointer moves stay local and releasing submits exactly one native command',async()=>{
  const context=fixture(),commands=[],ghosts=[];
  const gesture=createViewerTransformGesture({getContext:()=>context,getViewport:()=>viewport,canCommit:()=>true,commit:async operation=>{commands.push(operation);return {command_id:'ack'};},onGhost:geometry=>ghosts.push(geometry),notice:message=>assert.fail(message)});
  assert.equal(gesture.begin([500,500]).kind,'move');
  gesture.move([510,490]);gesture.move([520,480]);
  assert.equal(commands.length,0);assert.equal(gesture.active(),true);
  assert.deepEqual(await gesture.end([530,470]),{command_id:'ack'});
  assert.equal(commands.length,1);assert.equal(ghosts.at(-1),null);
  await gesture.end([540,460]);assert.equal(commands.length,1);
});

test('cancel, no movement, changed source frame and resized viewer never submit',async()=>{
  let context=fixture(),view={...viewport};const commands=[];
  const gesture=createViewerTransformGesture({getContext:()=>context,getViewport:()=>view,canCommit:()=>true,commit:async operation=>commands.push(operation),onGhost:()=>{},notice:message=>assert.fail(message)});
  gesture.begin([500,500]);gesture.move([510,490]);gesture.cancel();await gesture.end([520,480]);
  gesture.begin([500,500]);await gesture.end([500,500]);
  gesture.begin([500,500]);context={...context,frame:25};gesture.invalidate();await gesture.end([520,480]);
  context=fixture();gesture.begin([500,500]);view={...viewport,width:900};gesture.move([520,480]);await gesture.end([520,480]);
  assert.deepEqual(commands,[]);assert.equal(gesture.active(),false);
});
