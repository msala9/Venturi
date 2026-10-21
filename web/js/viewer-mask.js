import {viewerTransformAvailability,viewerTransformIdentity,viewerLayerMapping,viewerRotateCW,viewerClockwiseTurn} from './viewer-transform.js';

const corners=[[-1,1],[1,1],[1,-1],[-1,-1]],sides=[[0,1],[1,0],[0,-1],[-1,0]],grab=8.5;
const pair=value=>Array.isArray(value) && value.length===2 && value.every(Number.isFinite);
const add=(a,b)=>a.map((value,axis)=>value+b[axis]),sub=(a,b)=>a.map((value,axis)=>value-b[axis]);
const viewportIdentity=value=>JSON.stringify([value?.left,value?.top,value?.width,value?.height]);
const selectedMask=context=>context?.detail?.masks?.items?.[context.mask_index];
const validPath=path=>Array.isArray(path?.points) && path.points.length>=3 && path.points.length<=21 && path.points.every(point=>point && ['point','in_handle','out_handle'].every(name=>pair(point[name]) && point[name].every(value=>Math.abs(value)<=100_000)));
const fpoint=point=>point.map(Math.fround);
const nativePath=path=>({points:path.points.map(point=>Object.fromEntries(['point','in_handle','out_handle'].map(name=>[name,fpoint(point[name])])))});
const roundAway=value=>value<0?-Math.round(-value):Math.round(value);

export function viewerMaskIdentity(context){return context?JSON.stringify([viewerTransformIdentity(context),context.mask_index]):null;}
export function viewerMaskAvailability(context){
  const reason=viewerTransformAvailability(context);if(reason)return reason;
  if(!Number.isSafeInteger(context.mask_index) || context.mask_index<0 || context.mask_index>7)return 'Choose a mask in the native Inspector';
  const mask=selectedMask(context);if(!mask || mask.index!==context.mask_index || !['Rectangle','Ellipse','Path'].includes(mask.shape))return 'Read the selected native mask';
  const parameters=mask.shape==='Path'?['CenterX','CenterY','Rotation']:['CenterX','CenterY','Width','Height','Rotation'];
  if(!parameters.every(param=>mask.parameters?.some(parameter=>parameter.param===param && [parameter.value,parameter.min,parameter.max].every(Number.isFinite))))return 'Read the complete native mask values';
  if(mask.shape==='Path' && !validPath(mask.evaluated_path))return 'Read a native evaluated path with 3–21 vertices';
  return null;
}
function nativeState(context){
  const reason=viewerMaskAvailability(context);if(reason)throw Error(reason);
  const mask=selectedMask(context),values=Object.fromEntries(mask.parameters.map(parameter=>[parameter.param,parameter.value]));
  return {shape:mask.shape,center:[values.CenterX,values.CenterY],size:[values.Width ?? 0,values.Height ?? 0],rotation:values.Rotation,path:mask.shape==='Path'?nativePath(mask.evaluated_path):null};
}
const toLayer=(state,point)=>add(state.center,viewerRotateCW(point,state.rotation));
const toLocal=(state,point)=>viewerRotateCW(sub(point,state.center),-state.rotation);
function cubic(path,index,t){const a=path.points[index],b=path.points[(index+1)%path.points.length],controls=[a.point,add(a.point,a.out_handle),add(b.point,b.in_handle),b.point],u=1-t,weights=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];return [0,1].map(axis=>controls.reduce((sum,point,index)=>sum+point[axis]*weights[index],0));}
function flattened(path){return path.points.flatMap((point,index)=>{
  const next=path.points[(index+1)%path.points.length];
  return point.out_handle.every(value=>value===0) && next.in_handle.every(value=>value===0)?[point.point]:Array.from({length:12},(_,sample)=>cubic(path,index,sample/12));
});}
function contains(point,polygon){let inside=false;for(let index=0;index<polygon.length;index++){const a=polygon[index],b=polygon[(index+1)%polygon.length];if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function segmentDistance(point,a,b){const delta=sub(b,a),length=delta[0]**2+delta[1]**2,t=length?Math.max(0,Math.min(1,((point[0]-a[0])*delta[0]+(point[1]-a[1])*delta[1])/length)):0;return Math.hypot(...sub(point,add(a,delta.map(value=>value*t))));}
function nearestEdge(point,state,mapping){
  let best=null;
  for(let index=0;index<state.path.points.length;index++)for(let sample=0;sample<16;sample++){
    const distance=segmentDistance(point,mapping.toScreen(toLayer(state,cubic(state.path,index,sample/16))),mapping.toScreen(toLayer(state,cubic(state.path,index,(sample+1)/16))));
    if(distance<=grab && (!best || distance<best.distance))best={kind:'insert',index,distance};
  }
  return best?{kind:'insert',index:best.index}:null;
}

export function viewerMaskGeometry(context,viewport,{selectedVertex=null,state=nativeState(context)}={}){
  const mapping=viewerLayerMapping(context,viewport),screen=point=>mapping.toScreen(toLayer(state,point));
  const boxPoint=side=>screen(side.map((value,axis)=>value*state.size[axis]/2)),center=mapping.toScreen(state.center),top=boxPoint([0,1]),delta=sub(top,center),length=Math.hypot(...delta),up=length?delta.map(value=>value/length):[0,-1];
  const path=state.shape==='Path',vertices=path?state.path.points.map(point=>screen(point.point)):[],selected=Number.isSafeInteger(selectedVertex) && selectedVertex>=0 && selectedVertex<vertices.length?selectedVertex:null;
  const tangents=selected===null?[]:['in_handle','out_handle'].map((name,index)=>({kind:index?'tangent_out':'tangent_in',index:selected,point:screen(add(state.path.points[selected].point,state.path.points[selected][name])),vertex:vertices[selected]}));
  const outline=path?flattened(state.path).map(screen):state.shape==='Rectangle'?corners.map(boxPoint):Array.from({length:64},(_,index)=>{const angle=index/64*Math.PI*2;return screen([Math.cos(angle)*state.size[0]/2,Math.sin(angle)*state.size[1]/2]);});
  return {shape:state.shape,outline,closed:true,center,top:path?null:top,knob:path?null:add(top,up.map(value=>value*30)),corners:path?[]:corners.map(side=>({side,point:boxPoint(side)})),sides:path?[]:sides.map(side=>({side,point:boxPoint(side)})),vertices,tangents,selectedVertex:selected,state};
}
export function viewerMaskHit(context,viewport,point,{selectedVertex=null}={}){
  if(!pair(point))return null;
  const geometry=viewerMaskGeometry(context,viewport,{selectedVertex});
  const near=value=>Math.hypot(...sub(point,value))<=grab;
  if(geometry.shape==='Path'){
    const tangent=geometry.tangents.find(value=>near(value.point));if(tangent)return {kind:tangent.kind,index:tangent.index};
    const index=geometry.vertices.findIndex(near);if(index>=0)return {kind:'vertex',index};
    if(contains(point,geometry.outline))return {kind:'move'};
    return nearestEdge(point,geometry.state,viewerLayerMapping(context,viewport));
  }
  if(near(geometry.knob))return {kind:'rotate'};
  for(const [kind,handles] of [['corner',geometry.corners],['side',geometry.sides]]){const handle=handles.find(value=>near(value.point));if(handle)return {kind,side:handle.side};}
  return contains(point,geometry.corners.map(handle=>handle.point))?{kind:'move'}:null;
}
function result(context,viewport,state,changed,selectedVertex){
  const mask=selectedMask(context),operation={kind:'edit_viewer_mask',clip_id:context.clip_id,index:context.mask_index,timeline_frame:context.frame,parameters:[]};
  const values={CenterX:state.center[0],CenterY:state.center[1],Width:state.size[0],Height:state.size[1],Rotation:state.rotation};
  for(const param of changed){
    const metadata=mask.parameters.find(parameter=>parameter.param===param);if(!metadata || !Number.isFinite(values[param]))throw Error('The mask gesture exceeds native limits');
    const minimum=['Width','Height'].includes(param)?Math.max(1,metadata.min):metadata.min;
    values[param]=Math.fround(Math.max(Math.fround(minimum),Math.min(Math.fround(metadata.max),values[param])));
    if(values[param]!==Math.fround(metadata.value))operation.parameters.push({param,value:values[param]});
  }
  state.center=[values.CenterX,values.CenterY];state.size=[values.Width,values.Height];state.rotation=values.Rotation;
  if(state.path){
    state.path=nativePath(state.path);if(!validPath(state.path))throw Error('Mask path coordinates exceed the native 3–21 vertex budget or coordinate limits');
    if(JSON.stringify(state.path)!==JSON.stringify(nativePath(mask.evaluated_path)))operation.path=state.path;
  }
  return {state,operation,changed:operation.parameters.length>0 || Boolean(operation.path),geometry:viewerMaskGeometry(context,viewport,{state,selectedVertex})};
}
export function viewerMaskDraft(context,viewport,handle,startPoint,point,{shift=false,alt=false,turned=0,selectedVertex=null}={}){
  if(!pair(point) || !pair(startPoint))throw Error('Choose a valid mask pointer');
  const state=nativeState(context),mapping=viewerLayerMapping(context,viewport),layer=mapping.fromScreen(point),startLayer=mapping.fromScreen(startPoint),local=toLocal(state,layer),startLocal=toLocal(state,startLayer);
  let changed=[];
  if(handle.kind==='move'){state.center=add(state.center,sub(layer,startLayer));changed=['CenterX','CenterY'];}
  else if(handle.kind==='rotate'){state.rotation+=turned;if(shift)state.rotation=roundAway(state.rotation/15)*15;changed=['Rotation'];}
  else if(handle.kind==='corner' || handle.kind==='side'){
    const [sx,sy]=handle.side,opposite=[-sx*state.size[0]/2,-sy*state.size[1]/2],mid=[0,0],original=[...state.size];
    for(const [axis,sign] of [sx,sy].entries())if(sign){state.size[axis]=Math.max(1,Math.abs(local[axis]-opposite[axis]));mid[axis]=(local[axis]+opposite[axis])/2;}
    if(shift && sx && sy && original.every(value=>value>0)){const scale=Math.max(state.size[0]/original[0],state.size[1]/original[1]);state.size=original.map(value=>value*scale);for(const [axis,sign] of [sx,sy].entries())mid[axis]=sign*state.size[axis]/2+opposite[axis];}
    state.center=toLayer(state,mid);changed=['CenterX','CenterY',...(sx?['Width']:[]),...(sy?['Height']:[])];
  }else if(['vertex','tangent_in','tangent_out','insert','remove'].includes(handle.kind)){
    if(state.shape!=='Path' || !Number.isSafeInteger(handle.index) || handle.index<0 || handle.index>=state.path.points.length)throw Error('Choose a native path vertex');
    const vertex=state.path.points[handle.index];
    if(handle.kind==='remove'){if(state.path.points.length<=3)throw Error('A closed path needs at least three vertices');state.path.points.splice(handle.index,1);selectedVertex=null;}
    else if(handle.kind==='insert'){if(state.path.points.length>=21)throw Error('A closed path supports at most 21 vertices');state.path.points.splice(handle.index+1,0,{point:local,in_handle:[0,0],out_handle:[0,0]});selectedVertex=handle.index+1;}
    else if(handle.kind==='vertex')vertex.point=add(vertex.point,sub(local,startLocal));
    else{const name=handle.kind==='tangent_in'?'in_handle':'out_handle',other=name==='in_handle'?'out_handle':'in_handle';vertex[name]=sub(local,vertex.point);if(!alt)vertex[other]=vertex[name].map(value=>-value);}
  }else throw Error('Choose a native mask handle');
  return result(context,viewport,state,changed,selectedVertex);
}

export function createViewerMaskGesture({getContext,getViewport,canCommit,commit,onGhost,notice}){
  let drag=null,pending=false,selected=null,scope=null;
  function cancel(){drag=null;onGhost(null);}
  function synchronize(){
    const context=getContext();if(!context || !Number.isSafeInteger(context.mask_index) || context.mask_index<0 || context.mask_index>7)return;
    const next=JSON.stringify([context.project_epoch,context.timeline_id,context.clip_id,context.mask_index]);
    if(next!==scope){selected=null;scope=next;}
    const mask=selectedMask(context);
    if(mask && (mask.shape!=='Path' || Array.isArray(mask.evaluated_path?.points) && selected!==null && selected>=mask.evaluated_path.points.length))selected=null;
  }
  function current(){const context=getContext();return drag && !pending && canCommit() && !viewerMaskAvailability(context) && viewerMaskIdentity(context)===viewerMaskIdentity(drag.context) && viewportIdentity(getViewport())===viewportIdentity(drag.viewport);}
  function move(point,options={}){
    if(!drag)return null;if(!current()){cancel();synchronize();return null;}
    try{
      if(!drag.moved && point[0]===drag.start[0] && point[1]===drag.start[1] && !['insert','remove'].includes(drag.handle.kind))return null;
      if(point[0]!==drag.start[0] || point[1]!==drag.start[1])drag.moved=true;
      if(drag.handle.kind==='rotate'){const pivot=viewerMaskGeometry(drag.context,drag.viewport).center,vector=value=>[value[0]-pivot[0],pivot[1]-value[1]];drag.turned+=viewerClockwiseTurn(vector(drag.last),vector(point));drag.last=[...point];}
      drag.draft=viewerMaskDraft(drag.context,drag.viewport,drag.handle,drag.start,point,{...options,turned:drag.turned,selectedVertex:selected});onGhost(drag.draft.geometry);return drag.draft;
    }catch(error){cancel();notice(error.message);return null;}
  }
  async function submit(draft){if(!draft.changed){cancel();return null;}pending=true;drag=null;onGhost(null);try{return await commit(draft.operation);}catch(error){notice(error.message);return null;}finally{pending=false;}}
  return {
    begin(point,{alt=false}={}){
      synchronize();if(drag || pending || !canCommit())return null;const context=getContext(),reason=viewerMaskAvailability(context);if(reason){notice(reason);return null;}
      try{
        const viewport=getViewport();let handle=viewerMaskHit(context,viewport,point,{selectedVertex:selected});if(!handle)return null;
        if(handle.kind==='vertex'){selected=handle.index;if(alt){handle={kind:'remove',index:handle.index};if(selectedMask(context).evaluated_path.points.length<=3){notice('A closed path needs at least three vertices');return null;}}}
        if(handle.kind==='insert')selected=handle.index+1;
        drag={context:structuredClone(context),viewport:{left:viewport.left,top:viewport.top,width:viewport.width,height:viewport.height},handle,start:[...point],last:[...point],turned:0,moved:false,draft:null};
        if(['insert','remove'].includes(handle.kind))move(point,{alt});
        else onGhost(viewerMaskGeometry(context,viewport,{selectedVertex:selected}));
        return drag?handle:null;
      }catch(error){cancel();notice(error.message);return null;}
    },move,
    async end(point,options={}){if(!drag)return null;const draft=move(point,options);if(!draft){if(drag)cancel();return null;}selected=draft.geometry.selectedVertex;return submit(draft);},
    async doubleClick(point){
      synchronize();if(pending || !canCommit())return null;cancel();const context=getContext(),reason=viewerMaskAvailability(context);if(reason){notice(reason);return null;}
      try{
        const viewport=getViewport(),state=nativeState(context);if(state.shape!=='Path')return null;
        const geometry=viewerMaskGeometry(context,viewport),index=geometry.vertices.findIndex(vertex=>Math.hypot(...sub(vertex,point))<=grab);if(index<0)return null;
        const vertex=state.path.points[index],points=state.path.points;
        if(vertex.in_handle.every(value=>value===0) && vertex.out_handle.every(value=>value===0)){const previous=points[(index+points.length-1)%points.length].point,next=points[(index+1)%points.length].point;vertex.out_handle=sub(next,previous).map(value=>value/6);vertex.in_handle=vertex.out_handle.map(value=>-value);}
        else vertex.in_handle=vertex.out_handle=[0,0];
        selected=index;return submit(result(context,viewport,state,[],selected));
      }catch(error){notice(error.message);return null;}
    },cancel,
    invalidate(){if(drag && !current())cancel();synchronize();},active(){return Boolean(drag);},selectedVertex(){synchronize();return selected;},
  };
}
