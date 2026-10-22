const round=value=>value<0?-Math.floor(-value+.5):Math.floor(value+.5);
const f=Math.fround;
const targetId=target=>JSON.stringify(Object.keys(target??{}).sort().map(key=>[key,target[key]]));
export function nativeCurveTimeViewport(range,full,axis,{zoom=1,pan=0,x=axis.left+axis.plotWidth/2}={}){
  const total=full.source_end-full.source_start;if(total<=0)return {...range,source_start:full.source_start,source_end:full.source_end};
  const old=Math.max(1,range.source_end-range.source_start),width=f(Math.max(1,axis.plotWidth)),first=range.source_start;
  const anchor=round(f(f(first)+f(f(f(x-axis.left)/width)*f(old))));
  const span=Math.min(total,Math.max(Math.min(2,total),round(f(f(old)/f(zoom)))));
  const delta=round(f(f(f(pan)/width)*f(old))),offset=round(f(f(f(anchor-first)*f(span))/f(old)));
  const start=span>=total?full.source_start:Math.max(full.source_start,Math.min(full.source_end-span,anchor-offset-delta));
  return {...range,source_start:start,source_end:start+span};
}

export function checkedCurveViewport(value,detail,query){
  if(!['project_epoch','generation','timeline_id','revision','clip_id'].every(key=>typeof detail[key]==='string' && value?.[key]===detail[key]) || targetId(value.target)!==targetId(query.target) || !['source_start','source_end','points'].every(key=>value[key]===query[key]) || !Array.isArray(value.samples) || value.samples.length!==query.points || value.samples.some((sample,index)=>!Array.isArray(sample) || sample.length!==2 || !sample.every(Number.isFinite) || sample[0]<query.source_start || sample[0]>query.source_end || index>0 && sample[0]<value.samples[index-1][0]))throw Error('The native curve viewport no longer matches this Inspector');
  return value;
}

export function createCurveViewportReader({detail,read,canRead,onChange=()=>{},notice=()=>{},schedule=fn=>setTimeout(fn,70),unschedule=clearTimeout}){
  let disposed=false,wanted=null,active=null,timer=null,result=null,failed=null;
  const valid=()=>!disposed && canRead();
  function pause(){if(timer!==null){unschedule(timer);timer=null;}if(active)active.controller.abort();}
  function cancel(){wanted=null;result=null;failed=null;if(timer!==null){unschedule(timer);timer=null;}if(active)active.controller.abort();}
  function drain(){
    timer=null;if(active || !wanted || !valid())return;
    const ticket={...wanted,controller:new AbortController()};active=ticket;
    Promise.resolve().then(()=>{if(!valid() || wanted?.key!==ticket.key || ticket.controller.signal.aborted)throw new DOMException('Curve viewport changed','AbortError');return read(ticket.query,{signal:ticket.controller.signal});}).then(value=>{
      if(valid() && wanted?.key===ticket.key && !ticket.controller.signal.aborted){result={key:ticket.key,value:checkedCurveViewport(value,detail,ticket.query)};onChange();}
    }).catch(error=>{if(!disposed && wanted?.key===ticket.key && !ticket.controller.signal.aborted){failed=ticket.key;if(error.name!=='AbortError')notice(error.message);onChange();}}).finally(()=>{if(active===ticket)active=null;if(!disposed && wanted && (wanted.key!==ticket.key || ticket.controller.signal.aborted) && timer===null)timer=schedule(drain);});
  }
  function request(query,identity){
    if(!valid()){cancel();return null;}
    const key=JSON.stringify([query,identity]);
    if(wanted?.key!==key){wanted={query:structuredClone(query),key};result=null;failed=null;if(active)active.controller.abort();if(timer!==null)unschedule(timer);timer=schedule(drain);}
    else if(!active && timer===null && result?.key!==key && failed!==key)timer=schedule(drain);
    return result?.key===key?result.value:null;
  }
  return {request,cancel,pause,peek(query,identity){return !disposed && result?.key===JSON.stringify([query,identity])?result.value:null;},pending:()=>Boolean(wanted && result?.key!==wanted.key && failed!==wanted.key),dispose(){disposed=true;cancel();}};
}
