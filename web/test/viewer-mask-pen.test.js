import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewerLayerMapping} from '../js/viewer-transform.js';
import {viewerMaskPathOutline} from '../js/viewer-mask.js';
import {viewerMaskPenAvailability,viewerMaskPenGeometry,createViewerMaskPen} from '../js/viewer-mask-pen.js';

const viewport={left:0,top:0,width:1000,height:500};
const corner=point=>({point,in_handle:[0,0],out_handle:[0,0]});
function fixture(){
  const transform={ZoomX:1,ZoomY:1,PositionX:0,PositionY:0,Rotation:0,AnchorX:0,AnchorY:0,CropLeft:0,CropTop:0,CropRight:0,CropBottom:0};
  return {project_epoch:'epoch',if_generation:'1',timeline_id:'timeline',revision:'r1',frame:24,clip_id:'9007199254740993',preview_current:true,timeline_size:[1000,500],detail:{clip_id:'9007199254740993',timeline_frame:24,source_frame:48,source_size:[1000,500],video:true,locked:false,flip:[false,false],masks:{items:[]},transform:Object.entries(transform).map(([param,value])=>({param,value,default:value,key_count:0,min:param.startsWith('Zoom')?Math.fround(0.01):-1_000_000,max:param.startsWith('Zoom')?20:1_000_000}))}};
}
function harness(commit){
  let context=fixture(),view={...viewport},writable=true;const commands=[],ghosts=[],notices=[];
  const pen=createViewerMaskPen({getContext:()=>context,getViewport:()=>view,canCommit:()=>writable,commit:commit || (async operation=>{commands.push(operation);return {command_id:'ack'};}),onGhost:geometry=>ghosts.push(geometry),notice:message=>notices.push(message)});
  return {pen,commands,ghosts,notices,context:()=>context,setContext:value=>context=value,resize:()=>view={...view,width:900},readOnly:()=>writable=false};
}
async function place(pen,point,options){assert.equal(pen.begin(point).kind,'new_vertex');await pen.end(point,options);}
async function triangle(pen){await place(pen,[400,200]);await place(pen,[600,200]);await place(pen,[600,300]);}

test('unfinished zero, one and two-vertex pen drafts never enter the native project',async()=>{
  const h=harness();assert.equal(h.pen.start(),true);assert.equal(h.ghosts.at(-1).pointCount,0);assert.equal(h.ghosts.at(-1).closed,false);
  await h.pen.finish();assert.equal(h.commands.length,0);
  for(const point of [[400,200],[600,200]]){await place(h.pen,point);await h.pen.finish();assert.equal(h.commands.length,0);assert.equal(h.pen.active(),true);}
  assert.equal(h.pen.count(),2);h.pen.cancel();assert.equal(h.pen.active(),false);assert.equal(h.pen.count(),0);assert.equal(h.ghosts.at(-1),null);assert.equal(h.commands.length,0);
});

test('finishing creates exactly one complete static native Path mask and preserves native IDs',async()=>{
  const h=harness(),original=structuredClone(h.context());h.pen.start();await triangle(h.pen);assert.equal(h.commands.length,0);assert.equal(h.ghosts.at(-1).canFinish,true);
  assert.deepEqual(await h.pen.finish(),{command_id:'ack'});
  assert.deepEqual(h.commands,[{kind:'edit_mask',clip_id:'9007199254740993',edit:{action:'add',shape:'Path',path:{points:[corner([-100,50]),corner([100,50]),corner([100,-50])]}}}]);
  assert.deepEqual(h.context(),original);assert.equal(h.pen.active(),false);assert.equal(h.ghosts.at(-1),null);await h.pen.finish();assert.equal(h.commands.length,1);
});

test('clicking the first vertex arms closure and sends the complete mask only on release',async()=>{
  const h=harness();h.pen.start();await triangle(h.pen);assert.equal(h.pen.begin([402,201]).kind,'close');assert.equal(h.commands.length,0);
  await h.pen.end([402,201]);assert.equal(h.commands.length,1);assert.equal(h.commands[0].edit.path.points.length,3);await h.pen.end([400,200]);assert.equal(h.commands.length,1);
});

test('moving away from an armed close cancels that click while retaining the open draft',async()=>{
  const h=harness();h.pen.start();await triangle(h.pen);h.pen.begin([400,200]);await h.pen.end([430,200]);
  assert.equal(h.commands.length,0);assert.equal(h.pen.active(),true);assert.equal(h.pen.count(),3);await h.pen.finish();assert.equal(h.commands.length,1);
});

test('pen dragging pulls native local tangents and Alt restores the unlinked incoming baseline',async()=>{
  const h=harness();h.pen.start();h.pen.begin([400,200]);h.pen.move([430,180]);
  assert.deepEqual(h.ghosts.at(-1).tangents.map(tangent=>tangent.point),[[370,220],[430,180]]);assert.equal(h.commands.length,0);
  h.pen.move([440,170],{alt:true});await h.pen.end([450,160],{alt:true});await place(h.pen,[600,200]);await place(h.pen,[600,300]);await h.pen.finish();
  assert.deepEqual(h.commands[0].edit.path.points[0],{point:[-100,50],in_handle:[0,0],out_handle:[50,40]});
});

test('pen coordinates use the native evaluated clip transform without guessing animation or mirroring',async()=>{
  const h=harness(),context=h.context();context.detail.flip=[true,true];
  for(const [param,value] of Object.entries({ZoomX:2,ZoomY:1.5,PositionX:20,PositionY:30,Rotation:90,AnchorX:10,AnchorY:5}))Object.assign(context.detail.transform.find(parameter=>parameter.param===param),{value,key_count:2});
  const mapping=viewerLayerMapping(context,viewport);h.pen.start();for(const point of [[12,34],[120,34],[120,-40]])await place(h.pen,mapping.toScreen(point));await h.pen.finish();
  assert.deepEqual(h.commands[0].edit.path.points.map(point=>point.point),[[12,34],[120,34],[120,-40]]);assert.equal(h.commands[0].edit.path.points.every(point=>point.in_handle.every(value=>value===0)),true);
});

test('open outlines share native spatial flattening without adding a closing segment',()=>{
  const path={points:[{point:[0,0],in_handle:[-20,0],out_handle:[20,30]},corner([100,0])]};
  assert.deepEqual(viewerMaskPathOutline({points:[]},{closed:false}),[]);assert.deepEqual(viewerMaskPathOutline({points:[corner([2,3])]},{closed:false}),[[2,3]]);
  const outline=viewerMaskPathOutline(path,{closed:false});assert.equal(outline.length,13);assert.deepEqual(outline[0],[0,0]);assert.deepEqual(outline.at(-1),[100,0]);
  const geometry=viewerMaskPenGeometry(fixture(),viewport,path);assert.equal(geometry.closed,false);assert.equal(geometry.knob,null);assert.deepEqual(geometry.vertices,[[500,250],[600,250]]);
});

test('the native vertex budget still permits closing the twenty-first point',async()=>{
  const h=harness();h.pen.start();for(let index=0;index<21;index++)await place(h.pen,[500+index*15,250+(index%2)*10]);
  assert.equal(h.pen.count(),21);assert.equal(h.pen.begin([900,300]),null);assert.equal(h.pen.count(),21);assert.equal(h.commands.length,0);
  assert.equal(h.pen.begin([500,250]).kind,'close');await h.pen.end([500,250]);assert.equal(h.commands[0].edit.path.points.length,21);
});

test('native mask count, clip writability and current frame gate starting a new pen draft',()=>{
  const context=fixture();context.detail.masks.items=Array(8).fill({shape:'Rectangle'});assert.match(viewerMaskPenAvailability(context),/eight masks/);
  const h=harness();h.setContext(context);assert.equal(h.pen.start(),false);assert.equal(h.pen.active(),false);
  for(const patch of [{preview_current:false},{detail:{...fixture().detail,locked:true}},{detail:{...fixture().detail,video:false}}]){h.setContext({...fixture(),...patch});assert.equal(h.pen.start(),false);}
  h.setContext(fixture());h.readOnly();assert.equal(h.pen.start(),false);
});

test('stale native identity, viewport and writability cancel the entire uncommitted path',async()=>{
  for(const change of ['epoch','generation','revision','frame','clip','source','viewport','read-only','unavailable']){
    const h=harness();h.pen.start();await triangle(h.pen);let context=h.context();
    if(change==='epoch')h.setContext({...context,project_epoch:'other'});else if(change==='generation')h.setContext({...context,if_generation:'2'});else if(change==='revision')h.setContext({...context,revision:'r2'});else if(change==='frame')h.setContext({...context,frame:25});else if(change==='clip')h.setContext({...context,clip_id:'9007199254740995'});else if(change==='source')h.setContext({...context,detail:{...context.detail,source_frame:49}});else if(change==='viewport')h.resize();else if(change==='read-only')h.readOnly();else h.setContext(null);
    h.pen.invalidate();await h.pen.finish();assert.equal(h.commands.length,0,change);assert.equal(h.pen.active(),false,change);assert.equal(h.ghosts.at(-1),null,change);
  }
});

test('finishing waits for the current pointer and a pending submission prevents duplicate adds',async()=>{
  let resolve,attempts=0;const pending=new Promise(done=>resolve=done),h=harness(async()=>{attempts++;return pending;});h.pen.start();await triangle(h.pen);h.pen.begin([400,300]);await h.pen.finish();assert.equal(attempts,0);
  await h.pen.end([400,300]);const submission=h.pen.finish();assert.equal(attempts,1);assert.equal(h.pen.pending(),true);assert.equal(h.pen.start(),false);assert.equal(h.pen.begin([500,250]),null);await h.pen.finish();assert.equal(attempts,1);
  resolve({command_id:'ack'});assert.deepEqual(await submission,{command_id:'ack'});assert.equal(h.pen.pending(),false);
});

test('rejected submissions never repeat automatically and invalid coordinates never reach the backend',async()=>{
  let attempts=0;const h=harness(async()=>{attempts++;throw Error('Outcome unknown');});h.pen.start();assert.equal(h.pen.begin([1e9,1e9]),null);assert.equal(h.pen.count(),0);await triangle(h.pen);await h.pen.finish();await h.pen.finish();
  assert.equal(attempts,1);assert.equal(h.pen.active(),false);assert.match(h.notices.at(-1),/verify the mask list/);
});
