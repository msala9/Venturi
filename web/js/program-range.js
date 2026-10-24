const MAX_FRAME=1_000_000_000;
const I32_MAX=2_147_483_647;

// A new audio origin starts playback; continuations retain that origin for DSP history.
export function buildProgramWindow(documentState,timeline,playhead,explicitStart,audioOrigin){
  if(documentState?.capabilities?.playback!==true || !timeline || !Array.isArray(timeline.tracks))return null;
  if(![documentState.project_epoch,documentState.generation,timeline.id,timeline.revision].every(value=>typeof value==='string' && value.length>0))return null;
  const fps=timeline.fps;
  if(!fps || ![fps.num,fps.den].every(value=>Number.isSafeInteger(value) && value>0 && value<=I32_MAX))return null;
  const rate=fps.num/fps.den;
  let capacity=Math.floor(300*fps.num/fps.den);
  // Match the native f64 five-minute validation even at a floating-point boundary.
  if(capacity/rate>300)capacity--;
  if(capacity<1)return null;
  let total=0;
  for(const track of timeline.tracks){
    if(!Array.isArray(track?.clips))return null;
    for(const clip of track.clips){
      if(!Number.isSafeInteger(clip?.start_frame) || clip.start_frame<0 || clip.start_frame>MAX_FRAME || !Number.isSafeInteger(clip.length_frames) || clip.length_frames<1 || clip.length_frames>MAX_FRAME-clip.start_frame)return null;
      total=Math.max(total,clip.start_frame+clip.length_frames);
    }
  }
  if(!total)return null;
  const requested=explicitStart===undefined?playhead:explicitStart;
  if(!Number.isSafeInteger(requested))return null;
  if(requested>=total || explicitStart!==undefined && requested<0)return null;
  const start=explicitStart===undefined?Math.max(0,requested):requested;
  const origin=audioOrigin===undefined?start:audioOrigin;
  if(!Number.isSafeInteger(origin) || origin<0 || origin>start)return null;
  const seconds=origin<start?60n:15n;
  capacity=Math.min(capacity,Math.max(1,Number(seconds*BigInt(fps.num)/BigInt(fps.den))));
  return {project_epoch:documentState.project_epoch,if_generation:documentState.generation,timeline_id:timeline.id,revision:timeline.revision,start_frame:start,end_frame:Math.min(total,start+capacity),width:960,audio_origin_frame:origin};
}
