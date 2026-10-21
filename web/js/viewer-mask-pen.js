import {viewerTransformAvailability,viewerTransformIdentity,viewerLayerMapping} from './viewer-transform.js';
import {viewerMaskPathOutline} from './viewer-mask.js';

const pair=value=>Array.isArray(value) && value.length===2 && value.every(Number.isFinite);
const viewportIdentity=value=>JSON.stringify([value?.left,value?.top,value?.width,value?.height]);
const pointClone=point=>Object.fromEntries(['point','in_handle','out_handle'].map(name=>[name,[...point[name]]]));
function nativePoint(value){
  if(!pair(value))throw Error('Choose a valid pen point');
  const point=value.map(Math.fround);if(point.some(value=>!Number.isFinite(value) || Math.abs(value)>100_000))throw Error('Pen coordinates exceed the native mask limits');return point;
}
export function viewerMaskPenAvailability(context){
  const reason=viewerTransformAvailability(context);if(reason)return reason;
  const masks=context.detail.masks?.items;if(!Array.isArray(masks))return 'Read native mask properties before drawing a path';
  if(masks.length>=8)return 'The native clip already has eight masks';return null;
}
export function viewerMaskPenGeometry(context,viewport,path){
  const mapping=viewerLayerMapping(context,viewport),vertices=path.points.map(point=>mapping.toScreen(point.point)),selectedVertex=vertices.length?vertices.length-1:null;
  const tangents=selectedVertex===null?[]:['in_handle','out_handle'].map((name,index)=>({kind:index?'tangent_out':'tangent_in',index:selectedVertex,vertex:vertices[selectedVertex],point:mapping.toScreen(path.points[selectedVertex].point.map((value,axis)=>value+path.points[selectedVertex][name][axis]))}));
  return {shape:'Path',closed:false,outline:viewerMaskPathOutline(path,{closed:false}).map(mapping.toScreen),vertices,tangents,selectedVertex,corners:[],sides:[],center:null,top:null,knob:null,pointCount:vertices.length};
}
export function createViewerMaskPen({getContext,getViewport,canCommit,commit,onGhost,notice}){
  let draft=null,drag=null,pending=false;
  function cancel(){draft=null;drag=null;onGhost(null);}
  function current(){return draft && !pending && canCommit() && !viewerMaskPenAvailability(getContext()) && viewerTransformIdentity(getContext())===viewerTransformIdentity(draft.context) && viewportIdentity(getViewport())===viewportIdentity(draft.viewport);}
  function ensure(){if(!current()){if(draft)cancel();return false;}return true;}
  function geometry(){return viewerMaskPenGeometry(draft.context,draft.viewport,{points:draft.points});}
  function emit(){if(draft){const result=geometry();onGhost({...result,canFinish:draft.points.length>=3 && !drag});return result;}return null;}
  function layer(point){if(!pair(point))throw Error('Choose a valid pen pointer');return nativePoint(viewerLayerMapping(draft.context,draft.viewport).fromScreen(point));}
  function nearFirst(point){const first=geometry().vertices[0];return first && Math.hypot(point[0]-first[0],point[1]-first[1])<=8.5;}
  function move(point,{alt=false}={}){
    if(!drag || !ensure())return null;
    try{
      if(drag.kind==='new_vertex'){
        const target=layer(point),offset=nativePoint(target.map((value,axis)=>value-drag.original.point[axis]));
        draft.points[drag.index]={point:[...drag.original.point],out_handle:offset,in_handle:alt?[...drag.original.in_handle]:offset.map(value=>value===0?0:-value)};
      }
      return emit();
    }catch(error){notice(error.message);return null;}
  }
  async function finish(){
    if(pending || !draft)return null;if(!ensure())return null;
    if(drag){notice('Release the pen point before finishing');return null;}
    if(draft.points.length<3){notice('A closed path needs at least three vertices');return null;}
    const operation={kind:'edit_mask',clip_id:draft.context.clip_id,edit:{action:'add',shape:'Path',path:{points:draft.points.map(pointClone)}}};
    pending=true;draft=null;drag=null;onGhost(null);
    try{return await commit(operation);}catch(error){notice(`${error.message} · verify the mask list before drawing another path`);return null;}finally{pending=false;}
  }
  return {
    start(){
      if(pending || draft || !canCommit())return false;
      const context=getContext(),reason=viewerMaskPenAvailability(context);if(reason){notice(reason);return false;}
      try{const viewport=getViewport();viewerLayerMapping(context,viewport);draft={context:structuredClone(context),viewport:{left:viewport.left,top:viewport.top,width:viewport.width,height:viewport.height},points:[]};emit();return true;}
      catch(error){notice(error.message);return false;}
    },
    begin(point){
      if(drag || !ensure() || !pair(point))return null;
      try{
        if(draft.points.length>=3 && nearFirst(point)){drag={kind:'close'};emit();return {kind:'close'};}
        if(draft.points.length>=21){notice('A closed path supports at most 21 vertices');return null;}
        const vertex={point:layer(point),in_handle:[0,0],out_handle:[0,0]},index=draft.points.length;draft.points.push(vertex);drag={kind:'new_vertex',index,original:pointClone(vertex)};emit();return {kind:'new_vertex',index};
      }catch(error){notice(error.message);return null;}
    },move,
    async end(point,options={}){
      if(!drag || !ensure())return null;
      const kind=drag.kind;
      if(kind==='close'){const close=pair(point) && nearFirst(point);drag=null;if(close)return finish();return emit();}
      move(point,options);drag=null;return emit();
    },finish,cancel,
    invalidate(){if(draft && !current())cancel();},active:()=>Boolean(draft),dragging:()=>Boolean(drag),pending:()=>pending,count:()=>draft?.points.length ?? 0,
  };
}
