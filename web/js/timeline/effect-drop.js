import {createMediaDrop,mediaRangePlacement} from './asset-drop.js';
import {HEADER,RULER,MAX_FRAME,timelineLayout} from './geometry.js';

export const EFFECT_DRAG_TYPE='application/x-venturi-palette-effect';
const generators={title:'Title',solid:'Solid color',adjustment:'Adjustment clip'};
const filters=['ColorCorrection','Exposure','BoxBlur','GaussianBlur','DropShadow'];

export function effectDragItem(context,entry){
  if(!context || ![context.project_epoch,context.generation].every(value=>typeof value==='string' && value))return null;
  const item={...entry,project_epoch:context.project_epoch,generation:context.generation};
  if(item.kind==='generator' && Object.hasOwn(generators,item.generator))item.name=generators[item.generator];
  else if(item.kind==='filter' && filters.includes(item.filter) && (item.preset==null || item.filter==='ColorCorrection' && item.preset==='BlackAndWhite'))item.name=item.preset==='BlackAndWhite'?'Black and white':item.filter;
  else return null;
  return item;
}

export function effectDragItems(items){
  if(!Array.isArray(items) || items.length!==1)return null;
  const item=effectDragItem(items[0],items[0]);
  return item?[structuredClone(item)]:null;
}

export function effectPlacement(timeline,view,point,width,height,items){
  const effect=effectDragItems(items)?.[0];
  if(!effect)return null;
  if(effect.kind==='generator'){
    if(!Number.isSafeInteger(timeline?.fps?.num) || !Number.isSafeInteger(timeline.fps.den) || timeline.fps.num<=0 || timeline.fps.den<=0)return null;
    const length=Math.round(timeline.fps.num/timeline.fps.den*5);
    if(length<=0 || length>MAX_FRAME)return null;
    const draft=mediaRangePlacement(timeline,view,point,width,height,[{
      name:effect.name,fps:timeline.fps,source_in:0,source_out:length,
      has_video:true,has_audio:false,audio_streams:0,
    }]);
    if(!draft)return null;
    if(draft.target.kind==='new_audio_track')draft.error='Generators require a video track or the new video track zone';
    return {...draft,kind:'effect_generator_placement',effect};
  }
  const [x,y]=point;
  if(!Array.isArray(timeline?.tracks) || ![x,y,width,height].every(Number.isFinite) || x<HEADER || x>=width || y<RULER || y>=height)return null;
  const layout=timelineLayout(timeline,view,height),index=layout.trackAtY(y),track=timeline.tracks[index];
  if(!track)return null;
  const clip=track.clips.find(clip=>{
    const rect=layout.clipRect(index,clip,true);
    return x>=Math.max(HEADER,rect.left) && x<Math.min(width,rect.right) && y>=rect.top && y<rect.bottom;
  });
  if(!clip)return null;
  const rect=layout.clipRect(index,clip,true);
  return {
    kind:'effect_filter_placement',effect,clip_id:clip.id,
    error:track.locked?'The target track is locked':track.kind!=='video'?'Visual filters require a video clip':null,
    outlines:[{left:Math.max(HEADER,rect.left),right:Math.min(width,rect.right),top:rect.top,bottom:rect.bottom,name:effect.name}],
  };
}

export function effectPlacementOperation(draft){
  if(!draft || draft.error || !effectDragItems([draft.effect]))throw Error('Choose a current eligible effect destination');
  if(draft.kind==='effect_generator_placement'){
    if(!Number.isSafeInteger(draft.start_frame) || draft.start_frame<0 || draft.start_frame>MAX_FRAME || !['track','new_video_track'].includes(draft.target?.kind))throw Error('Choose a native video destination');
    return {kind:'place_generator',generator:draft.effect.generator,start_frame:draft.start_frame,target:structuredClone(draft.target),overwrite:Boolean(draft.overwrite)};
  }
  if(draft.kind!=='effect_filter_placement' || typeof draft.clip_id!=='string' || !draft.clip_id)throw Error('Choose a video clip for this filter');
  return {kind:'apply_palette_filter',clip_id:draft.clip_id,filter:draft.effect.filter,...(draft.effect.preset?{preset:draft.effect.preset}:{})};
}

export const createEffectDrop=options=>createMediaDrop({
  ...options,type:EFFECT_DRAG_TYPE,normalizeItems:effectDragItems,
  placement:effectPlacement,itemContext:item=>item,
});
