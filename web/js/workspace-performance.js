const contextValid=value=>typeof value==='string' && value.length>0;
const numeric=value=>typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
const outcomes=['success','http_error','invalid_json','aborted','network_error'];

export function createWorkspacePerformance({limit=128}={}) {
  const capacity=Number.isSafeInteger(limit) && limit>0 ? Math.min(limit,128) : 128;
  const rings=Object.fromEntries(['draw','rpc','input'].map(key=>[key,{values:new Array(capacity),next:0,count:0}]));
  let context=null;
  function record(kind,duration,contextString,outcome) {
    if(!contextValid(contextString))return false;
    if(contextString!==context){
      context=contextString;
      for(const ring of Object.values(rings)){ring.next=0;ring.count=0;}
    }
    if(numeric(duration)===null)return false;
    const ring=rings[kind];
    ring.values[ring.next]=kind==='rpc' ? {duration,outcome} : duration;
    ring.next=(ring.next+1)%capacity;ring.count=Math.min(ring.count+1,capacity);
    return true;
  }
  function snapshot(contextString,cacheStats={}) {
    const current=contextValid(contextString) && contextString===context;
    function metrics(kind){
      const ring=rings[kind],samples=[],counts=Object.fromEntries(outcomes.map(key=>[key,0]));
      if(current)for(let i=0;i<ring.count;i++){
        const value=ring.values[(ring.next-ring.count+i+capacity)%capacity];
        samples.push(kind==='rpc' ? value.duration : value);
        if(kind==='rpc')counts[value.outcome]++;
      }
      const sorted=[...samples].sort((a,b)=>a-b);
      const percentile=p=>sorted.length ? sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] : null;
      const result={samples,count:samples.length,p50_ms:percentile(.5),p95_ms:percentile(.95),max_ms:sorted.at(-1) ?? null};
      if(kind==='rpc')result.outcomes=counts;
      return result;
    }
    const cache={};
    for(const key of ['entries','bytes','max_entries','max_bytes'])cache[key]=numeric(cacheStats?.[key]);
    return {draw:metrics('draw'),cache,rpc:metrics('rpc'),input:metrics('input')};
  }
  return {recordPaint:(duration,ctx)=>record('draw',duration,ctx),recordInput:(duration,ctx)=>record('input',duration,ctx),recordRequest:(request,ctx)=>outcomes.includes(request?.outcome) ? record('rpc',request.duration_ms,ctx,request.outcome) : false,snapshot};
}

const milliseconds=value=>numeric(value)===null ? '—' : value.toFixed(2);
const items=value=>numeric(value)===null ? '—' : String(value);
const mib=value=>numeric(value)===null ? '—' : (value/1048576).toFixed(2);
function summary(snapshot) {
  const cache=snapshot?.cache || {};
  const timing=(label,value={})=>`${label} · p50 ${milliseconds(value.p50_ms)} ms · p95 ${milliseconds(value.p95_ms)} ms · max ${milliseconds(value.max_ms)} ms · sample window ${items(value.count)}`;
  const rpc=snapshot?.rpc || {};
  return [timing('Timeline draw CPU',snapshot?.draw),timing('RPC JSON roundtrip (excludes direct fetch/media)',rpc),`RPC outcomes · ${outcomes.map(key=>`${key} ${items(rpc.outcomes?.[key])}`).join(' · ')}`,timing('Software input dispatch → Canvas callback (not hardware/display latency)',snapshot?.input),`Accounted media cache · ${mib(cache.bytes)} / ${mib(cache.max_bytes)} MiB · ${items(cache.entries)} / ${items(cache.max_entries)} items`,'Authoritative frame queue / cache hits / VRAM: unavailable'].join('\n');
}

export function createWorkspaceInputTiming({target,documentRef,windowRef,getContext,onSample,now=()=>performance.now()}) {
  let active=null,pending=null,context=null,disposed=false;
  const listeners=[];
  function cancel(){active=null;pending=null;context=null;}
  function current(){
    if(disposed || documentRef?.hidden || documentRef?.visibilityState==='hidden'){cancel();return null;}
    let value;try{value=getContext();}catch{cancel();return null;}
    if(!contextValid(value)){cancel();return null;}
    if(value!==context){cancel();context=value;}
    return value;
  }
  function clock(){try{return numeric(now());}catch{return null;}}
  function begin(event){
    active=null;
    const ctx=current(),start=clock();
    if(ctx===null || start===null)return;
    active={start,ctx,event};
  }
  function navigationChanged(){
    const ctx=current();
    if(!active || ctx===null || active.ctx!==ctx || !(active.event?.eventPhase>0) || active.event.currentTarget!==target)return false;
    pending ??= {start:active.start,ctx:active.ctx};
    return true;
  }
  function painted(contextString){
    active=null;
    const ctx=current();
    if(ctx===null || ctx!==contextString){pending=null;return false;}
    const owner=pending;pending=null;
    if(!owner || owner.ctx!==ctx)return false;
    const end=clock(),duration=end===null ? null : end-owner.start;
    if(numeric(duration)===null)return false;
    try{onSample(duration,ctx);}catch{/* Diagnostics must not interrupt input or painting. */}
    return true;
  }
  function listen(node,type,callback){
    if(!node?.addEventListener)return;
    node.addEventListener(type,callback,true);listeners.push([node,type,callback]);
  }
  for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown','dblclick','contextmenu','drop'])listen(target,type,begin);
  for(const type of ['pointercancel','lostpointercapture'])listen(target,type,cancel);
  listen(documentRef,'visibilitychange',cancel);listen(windowRef,'blur',cancel);
  function dispose(){if(disposed)return;disposed=true;cancel();for(const [node,type,callback] of listeners)node.removeEventListener(type,callback,true);listeners.length=0;}
  return {navigationChanged,painted,dispose};
}

export function createWorkspacePerformancePanel({root,output,getSnapshot,isVisible,eventTargets=[root],setTimer=setTimeout,clearTimer=clearTimeout,interval=1000}) {
  const targets=[...new Set(eventTargets)].filter(target=>target?.addEventListener);
  const delay=Number.isFinite(interval) && interval>0 ? interval : 1000;
  let timer=null, sequence=0, disposed=false;
  function stop(){
    sequence++;
    if(timer!==null){clearTimer(timer);timer=null;}
  }
  function refresh(){
    if(disposed)return;
    stop();
    if(!isVisible())return;
    const owner=sequence, value=getSnapshot();
    if(disposed || owner!==sequence || !isVisible())return;
    output.textContent=summary(value);
    timer=setTimer(()=>{
      if(disposed || owner!==sequence)return;
      timer=null;refresh();
    },delay);
  }
  function dispose(){
    if(disposed)return;
    disposed=true;stop();
    for(const target of targets){target.removeEventListener('toggle',refresh);target.removeEventListener('visibilitychange',refresh);}
  }
  for(const target of targets){target.addEventListener('toggle',refresh);target.addEventListener('visibilitychange',refresh);}
  refresh();
  return {refresh,dispose};
}
