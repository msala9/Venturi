import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewerLayerMapping} from '../js/viewer-transform.js';
import {viewerMaskAvailability,viewerMaskGeometry,viewerMaskHit,viewerMaskDraft,createViewerMaskGesture} from '../js/viewer-mask.js';

const viewport={left:0,top:0,width:1000,height:500},close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-4,`${actual} differs from ${expected}`);
const point=point=>({point,in_handle:[0,0],out_handle:[0,0]});
function fixture(shape='Rectangle'){
  const transform={ZoomX:1,ZoomY:1,PositionX:0,PositionY:0,Rotation:0,AnchorX:0,AnchorY:0,CropLeft:0,CropTop:0,CropRight:0,CropBottom:0};
  const values=shape==='Path'?{CenterX:0,CenterY:0,Rotation:0}:{CenterX:0,CenterY:0,Width:200,Height:100,Rotation:0};
  const mask={index:0,shape,enabled:true,path_keyframes:0,evaluated_path:{points:[[-100,50],[100,50],[100,-50],[-100,-50]].map(point)},parameters:Object.entries(values).map(([param,value])=>({param,value,min:['Width','Height'].includes(param)?0:param==='Rotation'?-360:-100_000,max:param==='Rotation'?360:100_000,key_count:0}))};
  return {project_epoch:'epoch',if_generation:'1',timeline_id:'timeline',revision:'r1',frame:24,clip_id:'9007199254740993',mask_index:0,preview_current:true,timeline_size:[1000,500],detail:{clip_id:'9007199254740993',timeline_frame:24,source_frame:48,source_size:[1000,500],video:true,locked:false,flip:[false,false],masks:{items:[mask]},transform:Object.entries(transform).map(([param,value])=>({param,value,min:param.startsWith('Zoom')?Math.fround(0.01):-1_000_000,max:param.startsWith('Zoom')?20:1_000_000,key_count:0}))}};
}
const mask=context=>context.detail.masks.items[0];
const value=(context,param,next)=>mask(context).parameters.find(parameter=>parameter.param===param).value=next;
function gestureFixture(shape='Rectangle'){
  let context=fixture(shape),view={...viewport},writable=true;const commands=[],ghosts=[],notices=[];
  const gesture=createViewerMaskGesture({getContext:()=>context,getViewport:()=>view,canCommit:()=>writable,commit:async operation=>{commands.push(operation);return {command_id:'ack'};},onGhost:geometry=>ghosts.push(geometry),notice:message=>notices.push(message)});
  return {gesture,commands,ghosts,notices,context:()=>context,setContext:next=>context=next,resize:()=>view={...view,width:900},readOnly:()=>writable=false};
}

test('native rectangle and ellipse controls use layer pixels and a fixed 30 CSS-pixel rotation arm',()=>{
  const context=fixture(),geometry=viewerMaskGeometry(context,viewport);
  assert.deepEqual(geometry.outline,[[400,200],[600,200],[600,300],[400,300]]);assert.deepEqual(geometry.center,[500,250]);assert.deepEqual(geometry.knob,[500,170]);
  assert.deepEqual(viewerMaskHit(context,viewport,[500,170]),{kind:'rotate'});assert.deepEqual(viewerMaskHit(context,viewport,[600,200]),{kind:'corner',side:[1,1]});
  assert.deepEqual(viewerMaskHit(context,viewport,[600,250]),{kind:'side',side:[1,0]});assert.deepEqual(viewerMaskHit(context,viewport,[500,250]),{kind:'move'});
  mask(context).shape='Ellipse';assert.equal(viewerMaskGeometry(context,viewport).outline.length,64);assert.deepEqual(viewerMaskHit(context,viewport,[410,210]),{kind:'move'},'Native ellipse movement uses its rectangular control box');
});

test('mask mapping follows the native clip transform but ignores crop and source mirroring',()=>{
  const context=fixture();context.detail.flip=[true,true];
  for(const [param,next] of Object.entries({ZoomX:2,ZoomY:1.5,PositionX:20,PositionY:30,Rotation:90,AnchorX:10,AnchorY:5,CropLeft:200}))context.detail.transform.find(parameter=>parameter.param===param).value=next;
  const mapping=viewerLayerMapping(context,viewport),source=[42,-17],screen=mapping.toScreen(source),roundtrip=mapping.fromScreen(screen);
  close(roundtrip[0],source[0]);close(roundtrip[1],source[1]);
  const mirrored=viewerMaskGeometry(context,viewport);context.detail.flip=[false,false];context.detail.transform.find(parameter=>parameter.param==='CropLeft').value=0;
  assert.deepEqual(viewerMaskGeometry(context,viewport).corners,mirrored.corners);
});

test('native side and corner resizing anchor the opposite side and enforce minimum size',()=>{
  const context=fixture();
  const corner=viewerMaskDraft(context,viewport,{kind:'corner',side:[1,1]},[600,200],[650,150]);assert.deepEqual(corner.state.size,[250,150]);assert.deepEqual(corner.state.center,[25,25]);
  const side=viewerMaskDraft(context,viewport,{kind:'side',side:[1,0]},[600,250],[650,250]);assert.deepEqual(side.state.size,[250,100]);assert.deepEqual(side.state.center,[25,0]);
  const minimum=viewerMaskDraft(context,viewport,{kind:'side',side:[1,0]},[600,250],[400,250]);assert.equal(minimum.state.size[0],1);
  const proportional=viewerMaskDraft(context,viewport,{kind:'corner',side:[1,1]},[600,200],[650,200],{shift:true});assert.deepEqual(proportional.state.size,[250,125]);assert.deepEqual(proportional.state.center,[25,12.5]);
  value(context,'Height',0);const flat=viewerMaskDraft(context,viewport,{kind:'side',side:[1,0]},[600,250],[650,250]);assert.equal(flat.state.size[1],0);assert.equal(flat.operation.parameters.some(parameter=>parameter.param==='Height'),false);
});

test('native mask rotation and clip transform apply in separate coordinate spaces',()=>{
  const context=fixture();value(context,'Rotation',90);value(context,'CenterX',20);value(context,'CenterY',-10);
  const geometry=viewerMaskGeometry(context,viewport);close(geometry.corners[0].point[0],570);close(geometry.corners[0].point[1],160);
  const moved=viewerMaskDraft(context,viewport,{kind:'move'},[500,250],[530,230]);assert.deepEqual(moved.state.center,[50,10]);
  for(const [turned,expected] of [[7.5,15],[-7.5,-15]]){value(context,'Rotation',0);assert.equal(viewerMaskDraft(context,viewport,{kind:'rotate'},[500,170],[500,170],{shift:true,turned}).state.rotation,expected);}
});

test('path outlines consume native evaluated values and selected tangents win hit priority',()=>{
  const context=fixture('Path');mask(context).path={points:[[-1,1],[1,1],[1,-1]].map(point)};
  assert.deepEqual(viewerMaskGeometry(context,viewport).vertices,[[400,200],[600,200],[600,300],[400,300]]);
  assert.equal(viewerMaskGeometry(context,viewport).knob,null);assert.equal(viewerMaskGeometry(context,viewport).top,null);
  assert.deepEqual(viewerMaskHit(context,viewport,[400,200]),{kind:'vertex',index:0});
  assert.deepEqual(viewerMaskHit(context,viewport,[400,200],{selectedVertex:0}),{kind:'tangent_in',index:0});
  mask(context).evaluated_path.points[0].out_handle=[50,20];mask(context).evaluated_path.points[1].in_handle=[-50,0];
  const geometry=viewerMaskGeometry(context,viewport,{selectedVertex:0});assert.equal(geometry.outline.length,15);assert.deepEqual(geometry.tangents[1].point,[450,180]);
  assert.deepEqual(viewerMaskHit(context,viewport,[450,180],{selectedVertex:0}),{kind:'tangent_out',index:0});
});

test('path drags move vertices without moving offsets and mirror tangents unless Alt is held',()=>{
  const context=fixture('Path');mask(context).evaluated_path.points[0].in_handle=[-10,5];mask(context).evaluated_path.points[0].out_handle=[10,-5];
  const vertex=viewerMaskDraft(context,viewport,{kind:'vertex',index:0},[400,200],[390,180]);assert.deepEqual(vertex.operation.path.points[0],{point:[-110,70],in_handle:[-10,5],out_handle:[10,-5]});
  const tangent=viewerMaskDraft(context,viewport,{kind:'tangent_in',index:0},[390,195],[380,190]);assert.deepEqual(tangent.operation.path.points[0].in_handle,[-20,10]);assert.deepEqual(tangent.operation.path.points[0].out_handle,[20,-10]);
  const independent=viewerMaskDraft(context,viewport,{kind:'tangent_in',index:0},[390,195],[380,190],{alt:true});assert.deepEqual(independent.operation.path.points[0].out_handle,[10,-5]);
});

test('native inside-path movement wins and an outside edge click inserts a corner at the pointer',()=>{
  const context=fixture('Path');assert.deepEqual(viewerMaskHit(context,viewport,[500,202]),{kind:'move'});assert.deepEqual(viewerMaskHit(context,viewport,[500,198]),{kind:'insert',index:0});
  const inserted=viewerMaskDraft(context,viewport,{kind:'insert',index:0},[500,198],[510,190]);assert.equal(inserted.operation.path.points.length,5);assert.deepEqual(inserted.operation.path.points[1],point([10,60]));
  assert.equal(inserted.operation.index,0);assert.equal(inserted.operation.clip_id,'9007199254740993');assert.equal(inserted.operation.timeline_frame,24);
  const removed=viewerMaskDraft(context,viewport,{kind:'remove',index:0},[400,200],[400,200]);assert.equal(removed.operation.path.points.length,3);
  mask(context).evaluated_path=removed.operation.path;assert.throws(()=>viewerMaskDraft(context,viewport,{kind:'remove',index:0},[0,0],[0,0]),/at least three/);
});

test('path insertion is bounded to the native vertex count and invalid evaluated paths are refused',()=>{
  const context=fixture('Path');mask(context).evaluated_path={points:Array.from({length:21},(_,index)=>point([index,index%2]))};
  assert.throws(()=>viewerMaskDraft(context,viewport,{kind:'insert',index:0},[500,250],[500,250]),/at most 21/);
  delete mask(context).evaluated_path;assert.match(viewerMaskAvailability(context),/evaluated path/);
});

test('pointer moves stay local and a box or topology release submits only one native command',async()=>{
  const s=gestureFixture();assert.equal(s.gesture.begin([500,250]).kind,'move');s.gesture.move([520,240]);assert.equal(s.commands.length,0);await s.gesture.end([530,230]);
  assert.deepEqual(s.commands[0],{kind:'edit_viewer_mask',clip_id:'9007199254740993',index:0,timeline_frame:24,parameters:[{param:'CenterX',value:30},{param:'CenterY',value:20}]});await s.gesture.end([540,220]);assert.equal(s.commands.length,1);
  const p=gestureFixture('Path');assert.equal(p.gesture.begin([500,198]).kind,'insert');assert.equal(p.commands.length,0);await p.gesture.end([510,190]);assert.equal(p.commands.length,1);assert.equal(p.commands[0].path.points.length,5);
});

test('a motionless click near a handle never changes its geometry or adds a native Undo',async()=>{
  const s=gestureFixture();assert.equal(s.gesture.begin([605,200]).kind,'corner');await s.gesture.end([605,200]);assert.equal(s.commands.length,0);assert.equal(s.gesture.active(),false);
  const p=gestureFixture('Path');p.gesture.begin([400,200]);await p.gesture.end([400,200]);assert.equal(p.gesture.selectedVertex(),0);
  assert.equal(p.gesture.begin([405,200]).kind,'tangent_in');await p.gesture.end([405,200]);assert.equal(p.commands.length,0);assert.equal(p.gesture.active(),false);
});

test('Alt vertex removal and double-click smooth or corner each use one guarded native edit',async()=>{
  const s=gestureFixture('Path');assert.equal(s.gesture.begin([400,200],{alt:true}).kind,'remove');assert.equal(s.commands.length,0);await s.gesture.end([400,200]);assert.equal(s.commands[0].path.points.length,3);
  const p=gestureFixture('Path');await p.gesture.doubleClick([400,200]);assert.equal(p.commands.length,1);const smooth=p.commands[0].path.points[0];close(smooth.out_handle[0],200/6);close(smooth.out_handle[1],100/6);close(smooth.in_handle[0],-200/6);
  mask(p.context()).evaluated_path=p.commands[0].path;await p.gesture.doubleClick([400,200]);assert.deepEqual(p.commands[1].path.points[0].in_handle,[0,0]);assert.deepEqual(p.commands[1].path.points[0].out_handle,[0,0]);
});

test('vertex selection survives an own edit and transient frame refresh but resets for another mask',async()=>{
  const s=gestureFixture('Path'),original=s.context();s.gesture.begin([400,200]);s.gesture.move([390,190]);await s.gesture.end([390,190]);assert.equal(s.gesture.selectedVertex(),0);
  s.setContext(null);s.gesture.invalidate();assert.equal(s.gesture.selectedVertex(),0);
  s.setContext({...original,if_generation:'2',revision:'r2',mask_index:null});s.gesture.invalidate();assert.equal(s.gesture.selectedVertex(),0);
  const updated=structuredClone(original);updated.if_generation='2';updated.revision='r2';updated.frame=25;updated.detail.timeline_frame=25;updated.detail.source_frame=49;mask(updated).evaluated_path=s.commands[0].path;
  s.setContext(updated);s.gesture.invalidate();assert.equal(s.gesture.selectedVertex(),0);
  s.setContext({...updated,mask_index:1});s.gesture.invalidate();assert.equal(s.gesture.selectedVertex(),null);assert.equal(s.commands.length,1);
});

test('rotation accumulates a full turn even when release returns to the original knob',async()=>{
  const s=gestureFixture();assert.equal(s.gesture.begin([500,170]).kind,'rotate');
  for(const point of [[580,250],[500,330],[420,250]])s.gesture.move(point);
  assert.equal(s.commands.length,0);await s.gesture.end([500,170]);assert.deepEqual(s.commands[0].parameters,[{param:'Rotation',value:360}]);
});

test('cancel, identity changes, viewport changes, read-only state and f32 no-ops never submit',async()=>{
  for(const change of ['cancel','revision','mask','resize','read-only']){
    const s=gestureFixture();s.gesture.begin([500,250]);s.gesture.move([520,240]);
    if(change==='cancel')s.gesture.cancel();else if(change==='revision')s.setContext({...s.context(),revision:'r2'});else if(change==='mask')s.setContext({...s.context(),mask_index:null});else if(change==='resize')s.resize();else s.readOnly();
    s.gesture.invalidate();await s.gesture.end([530,230]);assert.equal(s.commands.length,0,change);assert.equal(s.gesture.active(),false);
  }
  const s=gestureFixture();value(s.context(),'CenterX',99_999);s.gesture.begin([100_499,250]);await s.gesture.end([100_499.001,250]);assert.equal(s.commands.length,0);
});
