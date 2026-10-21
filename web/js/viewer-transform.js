const corners=[[-1,1],[1,1],[1,-1],[-1,-1]];
const required=['ZoomX','ZoomY','PositionX','PositionY','Rotation','AnchorX','AnchorY','CropLeft','CropTop','CropRight','CropBottom'];
const pair=value=>Array.isArray(value) && value.length===2 && value.every(Number.isFinite);
const dimensions=value=>pair(value) && value.every(value=>value>0);
const viewportIdentity=viewport=>JSON.stringify([viewport?.left,viewport?.top,viewport?.width,viewport?.height]);
const rotate=(point,degrees)=>{
  const angle=degrees*Math.PI/180,sine=Math.sin(angle),cosine=Math.cos(angle);
  return [point[0]*cosine+point[1]*sine,-point[0]*sine+point[1]*cosine];
};

export function viewerTransformIdentity(context){
  if(!context)return null;
  return JSON.stringify([context.project_epoch,context.if_generation,context.timeline_id,context.revision,context.frame,context.clip_id,context.detail?.source_frame]);
}

export function viewerTransformAvailability(context){
  if(!context || !context.preview_current)return 'Wait for a current stopped Program frame';
  if(!context.clip_id || context.detail?.clip_id!==context.clip_id)return 'Select one video clip';
  if(!context.detail.video || context.detail.locked)return 'Select an unlocked video clip';
  if(context.detail.timeline_frame!==context.frame || !Number.isSafeInteger(context.detail.source_frame))return 'Read native clip properties at the current frame';
  if(!dimensions(context.timeline_size) || !dimensions(context.detail.source_size))return 'Native source and timeline dimensions are required for viewer handles';
  if(!required.every(name=>context.detail.transform?.some(parameter=>parameter.param===name && Number.isFinite(parameter.value) && Number.isFinite(parameter.min) && Number.isFinite(parameter.max))))return 'Read the complete native transform at the current frame';
  if(!Array.isArray(context.detail.flip) || context.detail.flip.length!==2)return 'Read the native mirror state';
  if(context.detail.transform.some(parameter=>['ZoomX','ZoomY'].includes(parameter.param) && (parameter.value<=0 || parameter.min<=0)))return 'Viewer handles require positive native scale values';
  return null;
}

export function viewerFrameRect(viewport,timelineSize){
  if(!dimensions(timelineSize) || !viewport || ![viewport.left,viewport.top,viewport.width,viewport.height].every(Number.isFinite) || viewport.width<=0 || viewport.height<=0)throw Error('Choose a visible viewer viewport');
  const scale=Math.min(viewport.width/timelineSize[0],viewport.height/timelineSize[1]);
  const width=timelineSize[0]*scale,height=timelineSize[1]*scale;
  return {left:viewport.left+(viewport.width-width)/2,top:viewport.top+(viewport.height-height)/2,width,height,scale};
}

function nativeState(context){
  const reason=viewerTransformAvailability(context);if(reason)throw Error(reason);
  const values=Object.fromEntries(context.detail.transform.map(parameter=>[parameter.param,parameter.value]));
  return {zoom:[values.ZoomX,values.ZoomY],position:[values.PositionX,values.PositionY],rotation:values.Rotation,anchor:[values.AnchorX,values.AnchorY],crop:[values.CropLeft,values.CropTop,values.CropRight,values.CropBottom],flip:[...context.detail.flip]};
}

function clipBox(context,transform){
  const [tw,th]=context.timeline_size,[sw,sh]=context.detail.source_size,fit=Math.min(tw/sw,th/sh);
  let left=-sw*fit/2+transform.crop[0]*fit,right=sw*fit/2-transform.crop[2]*fit,top=sh*fit/2-transform.crop[1]*fit,bottom=-sh*fit/2+transform.crop[3]*fit;
  if(transform.flip[0])[left,right]=[-right,-left];
  if(transform.flip[1])[bottom,top]=[-top,-bottom];
  if(right<=left || top<=bottom)throw Error('The cropped clip has no visible transform rectangle');
  return {left,right,bottom,top,fit,source:[sw,sh]};
}

function clipPoint(box,corner){const pick=(value,low,high)=>value<0?low:value>0?high:(low+high)/2;return [pick(corner[0],box.left,box.right),pick(corner[1],box.bottom,box.top)];}
function toFrame(transform,point){
  const rotated=rotate(point.map((value,axis)=>transform.zoom[axis]*(value-transform.anchor[axis])),transform.rotation);
  return rotated.map((value,axis)=>transform.position[axis]+transform.anchor[axis]+value);
}
function toScreen(frame,point){return [frame.left+frame.width/2+point[0]*frame.scale,frame.top+frame.height/2-point[1]*frame.scale];}
function toClip(transform,point){
  const rotated=rotate(point.map((value,axis)=>value-transform.position[axis]-transform.anchor[axis]),-transform.rotation);
  return rotated.map((value,axis)=>value/transform.zoom[axis]+transform.anchor[axis]);
}

export function viewerTransformGeometry(context,viewport,transform=nativeState(context)){
  const frame=viewerFrameRect(viewport,context.timeline_size),box=clipBox(context,transform);
  const points=corners.map(corner=>toScreen(frame,toFrame(transform,clipPoint(box,corner)))),pivot=toScreen(frame,transform.position.map((value,axis)=>value+transform.anchor[axis])),angle=transform.rotation*Math.PI/180;
  const crop_bars=[[0,1],[1,0],[0,-1],[-1,0]].map((side,index)=>{
    const center=toScreen(frame,toFrame(transform,clipPoint(box,side))),next=points[(index+1)%4],current=points[index],length=Math.hypot(next[0]-current[0],next[1]-current[1]);
    const along=length?[ (next[0]-current[0])/length,(next[1]-current[1])/length ]:[1,0];
    return {side,segment:[center.map((value,axis)=>value-along[axis]*9),center.map((value,axis)=>value+along[axis]*9)]};
  });
  return {frame,box,corners:points,pivot,knob:[pivot[0]+Math.sin(angle)*100,pivot[1]-Math.cos(angle)*100],crop_bars,transform};
}

function segmentDistance(point,[a,b]){const delta=b.map((value,axis)=>value-a[axis]),length=delta[0]**2+delta[1]**2,t=length?Math.max(0,Math.min(1,((point[0]-a[0])*delta[0]+(point[1]-a[1])*delta[1])/length)):0;return Math.hypot(point[0]-a[0]-t*delta[0],point[1]-a[1]-t*delta[1]);}
export function viewerTransformHit(context,viewport,point,radius=8.5){
  if(!pair(point) || !Number.isFinite(radius) || radius<=0)return null;
  const geometry=viewerTransformGeometry(context,viewport);
  if(Math.hypot(geometry.pivot[0]-point[0],geometry.pivot[1]-point[1])<=10.5)return {kind:'anchor'};
  if(Math.hypot(geometry.knob[0]-point[0],geometry.knob[1]-point[1])<=radius)return {kind:'rotate'};
  const index=geometry.corners.findIndex(corner=>Math.hypot(corner[0]-point[0],corner[1]-point[1])<=radius);
  if(index>=0)return {kind:'scale',corner:corners[index]};
  const bar=geometry.crop_bars.find(bar=>segmentDistance(point,bar.segment)<=6.5);if(bar)return {kind:'crop',side:bar.side};
  const framePoint=[(point[0]-geometry.frame.left-geometry.frame.width/2)/geometry.frame.scale,-(point[1]-geometry.frame.top-geometry.frame.height/2)/geometry.frame.scale];
  const local=toClip(geometry.transform,framePoint),box=geometry.box;
  return local[0]>=box.left && local[0]<=box.right && local[1]>=box.bottom && local[1]<=box.top?{kind:'move'}:null;
}

export function viewerClockwiseTurn(from,to){const degrees=(Math.atan2(from[1],from[0])-Math.atan2(to[1],to[0]))*180/Math.PI;return ((degrees+180)%360+360)%360-180;}
function rustRound(value){return value<0?-Math.round(-value):Math.round(value);}
export function viewerTransformDraft(context,viewport,handle,startPoint,point,{free=false,turned}={}){
  if(!pair(startPoint) || !pair(point) || !handle || !['move','scale','anchor','rotate','crop'].includes(handle.kind))throw Error('Choose a valid viewer gesture');
  const transform=nativeState(context),frame=viewerFrameRect(viewport,context.timeline_size),delta=[(point[0]-startPoint[0])/frame.scale,-(point[1]-startPoint[1])/frame.scale];
  let parameters=handle.kind==='move'?['PositionX','PositionY']:handle.kind==='anchor'?['AnchorX','AnchorY']:handle.kind==='rotate'?['Rotation']:['ZoomX','ZoomY'];
  let raw;
  if(handle.kind==='move')transform.position=transform.position.map((value,axis)=>value+delta[axis]);
  else if(handle.kind==='anchor')transform.anchor=transform.anchor.map((value,axis)=>value+delta[axis]);
  else if(handle.kind==='rotate'){
    const pivot=viewerTransformGeometry(context,viewport,transform).pivot,vector=value=>[value[0]-pivot[0],pivot[1]-value[1]];
    transform.rotation+=turned ?? viewerClockwiseTurn(vector(startPoint),vector(point));
    if(free)transform.rotation=rustRound(transform.rotation/15)*15;
  }else if(handle.kind==='crop'){
    if(!pair(handle.side) || ![[0,1],[1,0],[0,-1],[-1,0]].some(side=>side.every((value,axis)=>value===handle.side[axis])))throw Error('Choose a valid crop side');
    const [sx,sy]=handle.side,axis=sx?0:1,outward=sx || sy,box=clipBox(context,transform),moved=rotate(delta,-transform.rotation);
    const index=sx?((sx<0)!==transform.flip[0]?0:2):((sy>0)!==transform.flip[1]?1:3),opposite=transform.crop[(index+2)%4];
    transform.crop[index]=Math.max(0,Math.min(Math.max(0,box.source[axis]-1-opposite),transform.crop[index]-outward*moved[axis]/Math.max(Math.fround(0.01),Math.abs(transform.zoom[axis]))/box.fit));
    parameters=[['CropLeft','CropTop','CropRight','CropBottom'][index]];raw=[transform.crop[index]];
  }else{
    if(!pair(handle.corner) || !handle.corner.every(value=>value===-1 || value===1))throw Error('Choose a valid scale corner');
    const point=clipPoint(clipBox(context,transform),handle.corner),from=point.map((value,axis)=>transform.zoom[axis]*(value-transform.anchor[axis]));
    const moved=rotate(delta,-transform.rotation),to=from.map((value,axis)=>value+moved[axis]);
    if(free)transform.zoom=transform.zoom.map((value,axis)=>Math.abs(from[axis])>1e-3?value*to[axis]/from[axis]:value);
    else{
      const length=from[0]**2+from[1]**2;
      if(length>1e-6){const ratio=(to[0]*from[0]+to[1]*from[1])/length;transform.zoom=transform.zoom.map(value=>value*ratio);}
    }
  }
  raw ??= handle.kind==='move'?transform.position:handle.kind==='anchor'?transform.anchor:handle.kind==='rotate'?[transform.rotation]:transform.zoom;
  const metadata=parameters.map(name=>context.detail.transform.find(parameter=>parameter.param===name));
  if(raw.some(value=>!Number.isFinite(value)))throw Error('The gesture exceeds native transform limits');
  const values=raw.map((value,axis)=>Math.fround(Math.max(Math.fround(metadata[axis].min),Math.min(Math.fround(metadata[axis].max),value))));
  if(handle.kind==='move')transform.position=values;else if(handle.kind==='anchor')transform.anchor=values;else if(handle.kind==='rotate')transform.rotation=values[0];else if(handle.kind==='crop')transform.crop[['CropLeft','CropTop','CropRight','CropBottom'].indexOf(parameters[0])]=values[0];else transform.zoom=values;
  return {transform,operation:{kind:'edit_viewer_transform',clip_id:context.clip_id,timeline_frame:context.frame,transform:parameters.map((param,axis)=>({param,value:values[axis]}))},geometry:viewerTransformGeometry(context,viewport,transform)};
}

export function createViewerTransformGesture({getContext,getViewport,canCommit,commit,onGhost,notice}){
  let drag=null,pending=false;
  function cancel(){drag=null;onGhost(null);}
  function current(){const context=getContext();return drag && !pending && canCommit() && !viewerTransformAvailability(context) && viewerTransformIdentity(drag.context)===viewerTransformIdentity(context) && viewportIdentity(drag.viewport)===viewportIdentity(getViewport());}
  function move(point,options){
    if(!drag)return null;
    if(!current()){cancel();return null;}
    try{
      if(drag.handle.kind==='rotate'){
        const pivot=viewerTransformGeometry(drag.context,drag.viewport).pivot,vector=value=>[value[0]-pivot[0],pivot[1]-value[1]];
        drag.turned+=viewerClockwiseTurn(vector(drag.last),vector(point));drag.last=[...point];
      }
      drag.draft=viewerTransformDraft(drag.context,drag.viewport,drag.handle,drag.start,point,{...options,turned:drag.turned});onGhost(drag.draft.geometry);return drag.draft;
    }
    catch(error){cancel();notice(error.message);return null;}
  }
  return {
    begin(point){
      if(drag || pending || !canCommit())return null;
      const context=getContext(),reason=viewerTransformAvailability(context);if(reason){notice(reason);return null;}
      try{
        const viewport=getViewport(),handle=viewerTransformHit(context,viewport,point);if(!handle)return null;
        viewerTransformDraft(context,viewport,handle,point,point);
        drag={context:structuredClone(context),viewport:{left:viewport.left,top:viewport.top,width:viewport.width,height:viewport.height},handle,start:[...point],last:[...point],turned:0,draft:null};return handle;
      }catch(error){notice(error.message);return null;}
    },
    move,
    async end(point,options){
      if(!drag)return null;
      const draft=move(point,options);if(!draft)return null;
      const context=drag.context,changed=draft.operation.transform.some(parameter=>parameter.value!==Math.fround(context.detail.transform.find(value=>value.param===parameter.param).value));
      if(!changed){cancel();return null;}
      pending=true;drag=null;onGhost(null);
      try{return await commit(draft.operation);}
      catch(error){notice(error.message);return null;}
      finally{pending=false;}
    },
    cancel,
    invalidate(){if(drag && !current())cancel();},
    active(){return Boolean(drag);},
  };
}
