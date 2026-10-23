const unique=ids=>[...new Set(ids)];
const targetKinds=new Set(['clip','track','ruler','background','marker']);
const frame=value=>Number.isSafeInteger(value) && value>=0 && value<=1_000_000_000;

export function buildTimelineContext({document:state,timeline,selection,target,playhead,writable,viewIdentity,retimeVisible=[],overwrite=false}){
  if(!state || !timeline || timeline.id==='fixture' || !targetKinds.has(target?.kind) || !frame(playhead) || !Array.isArray(selection) || selection.length>4096 || unique(selection).length!==selection.length)return null;
  const entries=timeline.tracks.flatMap(track=>track.clips.map(clip=>({track_id:track.id,track_kind:track.kind,locked:track.locked,clip})));
  const chosen=entries.filter(entry=>selection.includes(entry.clip.id));
  if(chosen.length!==selection.length)return null;
  const clicked=target.kind==='clip'?entries.find(entry=>entry.clip.id===target.clip_id && (!target.track_id || entry.track_id===target.track_id)):null;
  const track=timeline.tracks.find(item=>item.id===(clicked?.track_id ?? target.track_id));
  const marker=target.kind==='marker'?timeline.markers.find(item=>item.id===target.marker_id):null;
  if(target.kind==='clip' && !clicked || target.kind==='track' && !track || target.kind==='marker' && !marker)return null;
  const expand=ids=>{
    const groups=new Set(entries.filter(entry=>ids.includes(entry.clip.id) && entry.clip.linked_group!=null).map(entry=>entry.clip.linked_group));
    return entries.filter(entry=>ids.includes(entry.clip.id) || entry.clip.linked_group!=null && groups.has(entry.clip.linked_group)).map(entry=>entry.clip.id);
  };
  const selectionIds=chosen.map(entry=>entry.clip.id),clickedIds=clicked?[clicked.clip.id]:[];
  const own=clicked && selection.includes(clicked.clip.id)?selectionIds:clickedIds;
  const mediaIds=expand(own).filter(id=>entries.find(entry=>entry.clip.id===id).clip.kind==='media');
  const colorIds=expand(own),compoundIds=expand(selectionIds.length?selectionIds:clickedIds);
  const unlocked=ids=>ids.length>0 && ids.every(id=>!entries.find(entry=>entry.clip.id===id)?.locked);
  const write=Boolean(writable && !clicked?.locked);
  const result={target:{kind:target.kind,clip_id:clicked?.clip.id,track_id:track?.id,marker_id:marker?.id,pane:target.pane},
    project_epoch:state.project_epoch,generation:state.generation,timeline_id:timeline.id,revision:timeline.revision,
    playhead,selection:selectionIds,clicked:clicked?.clip ?? null,track:track?{id:track.id,kind:track.kind,locked:track.locked,muted:track.muted,solo:track.solo,armed:track.armed,label:track.label}:null,
    marker:marker ?? null,save_ids:own,color_ids:colorIds,media_ids:mediaIds,compound_ids:compoundIds,
    unlink_ids:clicked?.clip.linked_group!=null?expand(clickedIds):[],
    write,selection_writable:write && unlocked(expand(selectionIds)),save_writable:write && unlocked(own),unlink_writable:write && unlocked(expand(clickedIds)),
    color_writable:write && unlocked(colorIds),media_writable:write && unlocked(expand(own)),compound_writable:write && unlocked(compoundIds),
    has_audio:mediaIds.some(id=>entries.find(entry=>entry.clip.id===id).track_kind==='audio'),
    reveal:clicked?.clip.kind==='media' && state.media.some(item=>item.id===clicked.clip.media_id),
    clipboard:Boolean(state.clipboard_count && state.clipboard_revision),saved:Boolean(state.project_name),
    marker_exists:timeline.markers.some(item=>item.start_frame===playhead),
    can_remove_track:Boolean(track && !track.locked && timeline.tracks.filter(item=>item.kind===track.kind).length>1),
    colors:[...(timeline.marker_colors || [])],palette:timeline.clip_colors?.map(({color,rgb})=>({color,rgb:[...rgb]})) ?? null,retime_shown:Boolean(clicked && retimeVisible.includes(clicked.clip.id)),overwrite:Boolean(overwrite),
    roles:{video:entries.some(entry=>own.includes(entry.clip.id) && entry.track_kind==='video'),audio:entries.some(entry=>own.includes(entry.clip.id) && entry.track_kind==='audio')},
  };
  result.identity=JSON.stringify([state.project_epoch,state.generation,timeline.id,timeline.revision,selection,playhead,viewIdentity,result.target,Boolean(writable),retimeVisible,overwrite,state.clipboard_revision]);
  return result;
}

export function timelineContextItems(context){
  if(!context)return [];
  const item=(id,label,enabled=true,checked)=>({id,label,enabled,...(checked===undefined?{}:{checked})}),separator={separator:true};
  const addMarker=item('add_marker','Add marker at playhead',context.write && !context.marker_exists);
  if(context.target.kind==='marker')return [item('edit_marker','Edit marker…',context.write),item('delete_marker','Delete marker',context.write)];
  if(context.target.kind==='ruler')return [addMarker];
  if(context.target.kind==='background')return [addMarker,separator,item('add_video_track','Add video track',context.write),item('add_audio_track','Add audio track',context.write)];
  if(context.target.kind==='track'){
    const track=context.track;
    return [item('track_locked',track.locked?'Unlock track':'Lock track',context.write,track.locked),
      item('track_muted',track.kind==='video'?'Disable track':'Mute track',context.write,track.muted),
      ...(track.kind==='audio'?[item('track_solo','Solo track',context.write,track.solo),item('track_armed','Arm track for recording',context.write && !track.locked && context.saved,track.armed)]:[]),
      separator,item('add_video_track','Add video track',context.write),item('add_audio_track','Add audio track',context.write),
      item('remove_track','Remove track',context.write && context.can_remove_track)];
  }
  const clip=context.clicked,items=[];
  if(clip.linked_group!=null)items.push(item('unlink','Unlink',context.unlink_writable));
  else items.push(item('link','Link selected clips',context.selection_writable && context.selection.length>=2));
  items.push(separator,item('copy','Copy selected clips',context.selection_writable),item('paste_attributes','Paste attributes…',context.selection_writable && context.clipboard),
    item('save_preset','Save as preset…',context.save_writable),
    {id:'color',label:'Clip color',enabled:context.color_writable,...(context.palette?{layout:'swatches'}:{}),children:[
      ...(context.palette?context.palette.map(({color,rgb})=>({...item(`color:${color}`,color,context.color_writable,clip.display_color===color),swatch:[...rgb]})):context.colors.map(color=>item(`color:${color}`,color,context.color_writable,clip.display_color===color))),
      separator,item('color:default','Clear clip color',context.color_writable && clip.display_color!=null)]});
  if(clip.kind==='media'){
    const motion=clip.freeze_source_frame==null;
    items.push(separator,item('reveal_media','Show in Media pool',context.reveal),item('retime_visibility','Retime controls',true,context.retime_shown),
      {id:'speed',label:'Clip speed',enabled:context.media_writable,children:[
        item('freeze','Freeze frame (0%)',context.media_writable,!motion),
        ...[50,100,200].map(percent=>item(`speed:${percent}`,`${percent}%`,context.media_writable,motion && clip.speed_percent===percent)),
        item('advanced_speed','Advanced…',context.media_writable)]},
      item('remove_silence','Remove silences…',context.media_writable && context.has_audio));
  }
  items.push(separator,item('compound',context.selection.length?'Make compound from selection…':'Make compound clip…',context.compound_writable));
  return items;
}

export function timelineContextOperation(id,context){
  const find=items=>{for(const item of items){if(item.id===id)return item;const nested=item.children && find(item.children);if(nested)return nested;}return null;};
  const item=find(timelineContextItems(context));
  if(!item || item.enabled===false)throw Error('This timeline action is unavailable in the captured context');
  if(id==='link' || id==='unlink')return {kind:'link_clips',clip_ids:id==='link'?[...context.selection]:[context.clicked.id],unlink:id==='unlink'};
  if(id.startsWith('color:'))return {kind:'set_display_color',clip_ids:[...context.color_ids],color:id==='color:default'?null:id.slice(6)};
  if(id==='freeze')return context.clicked.freeze_source_frame!=null?null:{kind:'set_freeze',clip_ids:[...context.media_ids],frame:context.playhead};
  if(id.startsWith('speed:')){
    const percent=Number(id.slice(6));if(context.clicked.freeze_source_frame==null && context.clicked.speed_percent===percent)return null;
    return {kind:'context_speed_preset',clip_id:context.clicked.id,clip_ids:[...context.media_ids],percent,overwrite:context.overwrite};
  }
  if(id==='add_video_track' || id==='add_audio_track')return {kind:'add_track',audio:id==='add_audio_track'};
  if(id==='remove_track')return {kind:'remove_track',track:context.track.id};
  if(id.startsWith('track_')){const flag=id.slice(6);if(['locked','muted','solo','armed'].includes(flag))return {kind:'set_track',track:context.track.id,[flag]:!context.track[flag]};}
  if(id==='add_marker')return {kind:'set_marker',marker:{id:null,delete:false,start_frame:context.playhead,duration_frames:0,note:'',color:'Yellow'}};
  if(id==='delete_marker')return {kind:'set_marker',marker:{id:context.marker.id,delete:true,start_frame:context.marker.start_frame,duration_frames:context.marker.duration_frames,note:context.marker.note,color:context.marker.color}};
  return null;
}
