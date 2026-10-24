const contextValid=value=>typeof value==='string' && value.length>0;
const numeric=value=>typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;

export function createWorkspacePerformance({limit=128}={}) {
  const capacity=Number.isSafeInteger(limit) && limit>0 ? Math.min(limit,128) : 128;
  const ring=new Array(capacity);
  let context=null, next=0, count=0;
  function recordPaint(duration,contextString) {
    if(!contextValid(contextString))return false;
    if(contextString!==context){context=contextString;next=0;count=0;}
    if(numeric(duration)===null)return false;
    ring[next]=duration;next=(next+1)%capacity;count=Math.min(count+1,capacity);
    return true;
  }
  function snapshot(contextString,cacheStats={}) {
    const samples=[];
    if(contextValid(contextString) && contextString===context){
      for(let i=0;i<count;i++)samples.push(ring[(next-count+i+capacity)%capacity]);
    }
    const sorted=[...samples].sort((a,b)=>a-b);
    const percentile=p=>sorted.length ? sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] : null;
    const cache={};
    for(const key of ['entries','bytes','max_entries','max_bytes'])cache[key]=numeric(cacheStats?.[key]);
    return {draw:{samples,count:samples.length,p50_ms:percentile(.5),p95_ms:percentile(.95),max_ms:sorted.at(-1) ?? null},cache};
  }
  return {recordPaint,snapshot};
}

const milliseconds=value=>numeric(value)===null ? '—' : value.toFixed(2);
const items=value=>numeric(value)===null ? '—' : String(value);
const mib=value=>numeric(value)===null ? '—' : (value/1048576).toFixed(2);
function summary(snapshot) {
  const draw=snapshot?.draw || {}, cache=snapshot?.cache || {};
  return `Timeline draw CPU · p50 ${milliseconds(draw.p50_ms)} ms · p95 ${milliseconds(draw.p95_ms)} ms · max ${milliseconds(draw.max_ms)} ms · sample window ${items(draw.count)}\nAccounted media cache · ${mib(cache.bytes)} / ${mib(cache.max_bytes)} MiB · ${items(cache.entries)} / ${items(cache.max_entries)} items`;
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
