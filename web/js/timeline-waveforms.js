const id=value=>typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<=18_446_744_073_709_551_615n;
const rational=value=>value && ['num','den'].every(key=>Number.isSafeInteger(value[key]) && value[key]>0 && value[key]<=2_147_483_647);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const stamp=context=>{
  const query=context?.query;
  return query && ['project_epoch','if_generation','timeline_id','revision'].every(key=>typeof query[key]==='string' && query[key]) && query.timeline_id===context.timeline?.id && query.revision===context.timeline.revision?JSON.stringify([query.project_epoch,query.if_generation,query.timeline_id,query.revision]):null;
};
const clips=context=>new Map((context?.timeline?.tracks || []).filter(track=>track.kind==='audio').flatMap(track=>track.clips.map(clip=>[clip.id,clip])));
const validLinear=value=>Number.isFinite(value) && value>=0 && Number.isFinite(Math.fround(value));

export function checkedWaveformPresentation(value,context,ids){
  const query=context.query,available=clips(context),media=new Map(context.media.map(item=>[item.id,item]));
  if(!value || !same([value.project_epoch,value.generation,value.timeline_id,value.revision],[query.project_epoch,query.if_generation,query.timeline_id,query.revision]) || !Array.isArray(value.clips) || value.clips.length!==ids.length)throw Error('Native waveform presentation no longer matches this timeline');
  let totalRuns=0;
  return new Map(value.clips.map((row,index)=>{
    const clip=available.get(ids[index]),item=media.get(clip?.media_id);
    if(!clip || row?.clip_id!==ids[index] || !['ready','hidden','unavailable'].includes(row.state))throw Error('Native waveform clip ownership changed');
    if(row.state!=='ready')return [row.clip_id,row];
    const clock=row.clock,coverage=row.coverage;
    if(!item || row.media_id!==clip.media_id || row.audio_stream_index!==(clip.audio_stream_index ?? 0) || row.content_hash!==item.content_hash || !clock || !Number.isSafeInteger(clock.source_offset_frames) || !rational(clock.speed) || !same(clock.timeline_fps,context.timeline.fps) || !rational(clock.media_fps) || !same(clock.media_fps,item.fps) || !Array.isArray(coverage) || coverage.length!==2 || !coverage.every(Number.isSafeInteger) || coverage[0]>0 || coverage[1]<item.duration_frames || coverage[1]<=coverage[0])throw Error('Native waveform source clock changed');
    const gain=row.gain;
    if(gain?.kind==='constant'){
      if(!validLinear(gain.linear))throw Error('Native waveform gain is invalid');
    }else if(gain?.kind==='runs'){
      if(!Array.isArray(gain.runs) || !gain.runs.length || (totalRuns+=gain.runs.length)>65_536)throw Error('Native waveform gain exceeds its presentation budget');
      let end=coverage[0];
      for(const run of gain.runs){
        if(!Array.isArray(run) || run.length!==3 || !Number.isSafeInteger(run[0]) || !Number.isSafeInteger(run[1]) || run[0]!==end || run[1]<=run[0] || run[1]>coverage[1] || !validLinear(run[2]))throw Error('Native waveform gain coverage is invalid');
        end=run[1];
      }
      if(end!==coverage[1])throw Error('Native waveform gain coverage is incomplete');
    }else throw Error('Native waveform gain is unavailable');
    return [row.clip_id,row];
  }));
}

export function createTimelineWaveforms({getContext,canRead,read,onChange=()=>{},notice=()=>{},schedule=fn=>setTimeout(fn,60),unschedule=clearTimeout}){
  let identity=null,wanted=[],active=null,timer=null,disposed=false;
  const cache=new Map(),failed=new Set(),announced=new Set();
  const abort=()=>{if(timer!==null){unschedule(timer);timer=null;}active?.controller.abort();};
  function capture(){
    const context=getContext(),next=stamp(context);
    if(next!==identity){identity=next;abort();wanted=[];cache.clear();failed.clear();announced.clear();}
    return context;
  }
  function trim(){
    const size=()=>[...cache.values()].reduce((sum,row)=>sum+(row.gain?.runs?.length || 0),0);
    while(cache.size>64 || size()>65_536){
      const outside=[...cache.keys()].find(key=>!wanted.includes(key));
      if(outside!==undefined){cache.delete(outside);continue;}
      const oldest=[...cache.keys()].find(key=>cache.get(key).gain?.runs?.length);
      if(oldest===undefined)break;
      cache.set(oldest,{...cache.get(oldest),state:'unavailable',reason:'client_gain_lookup_budget',gain:null});
      if(!announced.has(oldest)){announced.add(oldest);notice('Animated waveforms exceed the visible presentation budget; editing remains available');}
    }
  }
  const current=ticket=>!disposed && !ticket.controller.signal.aborted && ticket.identity===stamp(getContext());
  function queue(){if(!disposed && identity && !active && timer===null && canRead() && wanted.some(key=>!cache.has(key) && !failed.has(key)))timer=schedule(drain);}
  function drain(){
    timer=null;const context=capture();if(disposed || active || !identity || !canRead())return;
    const ids=wanted.filter(key=>!cache.has(key) && !failed.has(key));if(!ids.length)return;
    const ticket={identity,ids,context,controller:new AbortController()};active=ticket;
    Promise.resolve().then(()=>{if(!current(ticket) || !canRead())throw new DOMException('Waveform context changed','AbortError');return read(context.query,ids,{signal:ticket.controller.signal});}).then(value=>{
      if(!current(ticket) || !canRead())return;
      for(const [key,row] of checkedWaveformPresentation(value,context,ids)){
        cache.delete(key);cache.set(key,row);
        if(row.state==='unavailable' && !announced.has(key)){announced.add(key);notice('Animated waveform exceeds the native presentation budget; editing remains available');}
      }
      trim();onChange();
    }).catch(error=>{
      if(current(ticket) && error.name!=='AbortError'){for(const key of ids)failed.add(key);notice(error.message);onChange();}
    }).finally(()=>{if(active===ticket)active=null;queue();});
  }
  function demand(ids=[]){
    const context=capture(),available=clips(context);
    const next=[...new Set(ids.filter(key=>id(key) && available.has(key)))].slice(0,64);
    if(!same(next,wanted))for(const [key,row] of cache)if(row.state==='unavailable')cache.delete(key);
    wanted=next;
    if(!canRead())abort();queue();
  }
  return {
    demand,
    refresh(){capture();if(!canRead())abort();queue();},
    retry(){failed.clear();announced.clear();capture();for(const [key,row] of cache)if(row.state==='unavailable')cache.delete(key);queue();},
    presentations(){capture();return cache;},
    pending:()=>Boolean(active || timer!==null),
    dispose(){disposed=true;abort();cache.clear();failed.clear();announced.clear();wanted=[];},
  };
}
