const f32=Math.fround;
const integer=Number.isSafeInteger;
const rational=value=>value && integer(value.num) && value.num>0 && integer(value.den) && value.den>0;
const sameRate=(left,right)=>rational(left) && rational(right) && left.num===right.num && left.den===right.den;
const lookups=new WeakMap();

export function waveformDraftChanges(timeline,draft){
  const changes=draft?.changes || [];
  if(draft?.kind!=='retime')return changes;
  const entries=timeline.tracks.flatMap(track=>track.clips.map(clip=>({track,clip}))),primary=entries.find(entry=>entry.clip.id===draft.clip_id)?.clip;
  if(!primary || !integer(draft.length_frames) || draft.length_frames<1 || primary.length_frames<1)return changes;
  const byId=new Map(changes.map(change=>[change.clip_id,change]));
  for(const {track,clip} of entries)if(clip.id===primary.id || typeof primary.linked_group==='string' && clip.linked_group===primary.linked_group){
    byId.set(clip.id,{clip_id:clip.id,to_track:track.id,to_start_frame:clip.start_frame,length_frames:Math.max(1,Math.round(clip.length_frames*draft.length_frames/primary.length_frames))});
  }
  return [...byId.values()];
}

export function waveformVisual(clip,trackId,timeline,draft=null,changes=waveformDraftChanges(timeline,draft)){
  if(!clip || !integer(clip.start_frame) || !integer(clip.length_frames) || clip.length_frames<1)return null;
  const change=changes.find(change=>change.clip_id===clip.id);
  const start=change?.to_start_frame ?? clip.start_frame,length=change?.length_frames ?? clip.length_frames;
  if(!integer(start) || !integer(length) || start<0 || length<1 || !integer(start+length))return null;
  let sourceStart=clip.start_frame,sourceEnd=clip.start_frame+clip.length_frames;
  if(change && ['trim_group','trim_start','trim_end'].includes(draft.kind)){sourceStart=start;sourceEnd=start+length;}
  if(change && draft.kind==='slip'){
    if(!integer(draft.target))return null;
    sourceStart+=draft.target;sourceEnd+=draft.target;
  }
  let gain=null;
  if(draft?.kind==='gain' && draft.clip_id===clip.id){
    if(clip.gain_constant!==true || !Number.isFinite(draft.gain_db) || !Array.isArray(clip.gain_bounds) || clip.gain_bounds.length!==2 || !clip.gain_bounds.every(Number.isFinite) || draft.gain_db<clip.gain_bounds[0] || draft.gain_db>clip.gain_bounds[1])return null;
    gain=draft.gain_db;
  }
  return {clip,clip_id:clip.id,track_id:change?.to_track ?? trackId,to_new_track:change?.to_new_track,start_frame:start,length_frames:length,source_start_frame:sourceStart,source_end_frame:sourceEnd,gain_db:gain,drafted:Boolean(change)};
}

function nativeGain(presentation){
  if(lookups.has(presentation))return lookups.get(presentation);
  let lookup=null;
  const gain=presentation.gain,coverage=presentation.coverage;
  if(Array.isArray(coverage) && coverage.length===2 && coverage.every(integer) && coverage[0]<coverage[1]){
    if(gain?.kind==='constant' && Number.isFinite(gain.linear) && Number.isFinite(f32(gain.linear)) && gain.linear>=0)lookup=()=>f32(gain.linear);
    if(gain?.kind==='runs' && Array.isArray(gain.runs) && gain.runs.length>0 && gain.runs.length<=65536){
      let end=coverage[0],valid=true;
      for(const run of gain.runs){
        if(!Array.isArray(run) || run.length!==3 || !integer(run[0]) || !integer(run[1]) || run[0]!==end || run[1]<=run[0] || !Number.isFinite(run[2]) || !Number.isFinite(f32(run[2])) || run[2]<0){valid=false;break;}
        end=run[1];
      }
      if(valid && end===coverage[1])lookup=frame=>{
        if(frame<coverage[0] || frame>=coverage[1])return null;
        let low=0,high=gain.runs.length;
        while(low<high){const middle=(low+high)>>1;if(gain.runs[middle][1]<=frame)low=middle+1;else high=middle;}
        return f32(gain.runs[low][2]);
      };
    }
  }
  lookups.set(presentation,lookup);return lookup;
}

export function waveformColumns(visual,asset,presentation,timelineFps,rect,visible){
  const columns=[],clip=visual?.clip,clock=presentation?.clock,waveform=asset?.waveform;
  if(!visual || !clip || !asset || clip.freeze_source_frame!=null || presentation?.state!=='ready' || presentation.clip_id!==clip.id || presentation.media_id!==clip.media_id || presentation.audio_stream_index!==(clip.audio_stream_index ?? 0) || typeof presentation.content_hash!=='string' || presentation.content_hash!==asset.contentHash || asset.mediaId!==clip.media_id || (asset.audioStreamIndex ?? 0)!==(clip.audio_stream_index ?? 0) || !sameRate(clock?.timeline_fps,timelineFps) || !sameRate(clock?.media_fps,asset.fps) || !rational(clock?.speed) || !integer(clock?.source_offset_frames) || !waveform?.peaks?.length || waveform.peaks.length>65536 || !Number.isFinite(waveform.duration_seconds) || waveform.duration_seconds<=0)return columns;
  if(!rect || !visible || ![rect.left,rect.right,rect.top,rect.bottom,visible.left,visible.right,visible.top,visible.bottom].every(Number.isFinite))return columns;
  const left=f32(rect.left),right=f32(rect.right),top=f32(rect.top),bottom=f32(rect.bottom),width=f32(right-left),half=f32(f32(bottom-top)/2);
  const first=f32(Math.max(left,visible.left)),last=f32(Math.min(right,visible.right));
  if(![left,right,top,bottom,width,half,first,last].every(Number.isFinite) || width<=0 || half<=0 || first>=last || last-first>65536 || Math.max(top,visible.top)>=Math.min(bottom,visible.bottom))return columns;
  const speed=clock.speed.num/clock.speed.den,fps=timelineFps.num/timelineFps.den,mediaFps=clock.media_fps.num/clock.media_fps.den;
  const seconds=frame=>(frame-clip.start_frame+clock.source_offset_frames)*speed/fps;
  const start=seconds(visual.source_start_frame),end=seconds(visual.source_end_frame);
  if(!Number.isFinite(start) || !Number.isFinite(end) || end<=start)return columns;
  if(visual.gain_db!==null && !Number.isFinite(visual.gain_db))return columns;
  const lookup=visual.gain_db===null?nativeGain(presentation):()=>f32(10**f32(f32(visual.gain_db)/20));
  if(!lookup)return columns;
  for(let x=first;x<last;x=f32(x+1)){
    if(f32(x+1)<=x)return [];
    const fraction=f32(f32(x-left)/width),time=start+fraction*(end-start),sourceFrame=Math.floor(time*mediaFps);
    if(!integer(sourceFrame))return [];
    const multiplier=lookup(sourceFrame),bin=Math.max(0,Math.min(waveform.peaks.length-1,Math.trunc(time/waveform.duration_seconds*waveform.peaks.length))),peak=waveform.peaks[bin];
    if(multiplier===null || !Number.isFinite(peak) || peak<0 || peak>1)return [];
    const amplified=f32(f32(peak)*multiplier),height=f32(Math.max(.5,f32(half*Math.min(amplified,1))));
    columns.push({x,half_height:height,clipped:amplified>1});
  }
  return columns;
}
