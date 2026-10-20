import {request} from "./api.js";

export function speechIdentity(target,params) {
  return target ? JSON.stringify([target.query.project_epoch,target.query.if_generation,target.query.timeline_id,target.query.revision,[...target.clip_ids].sort(),params]) : null;
}
export function speechOperation(result) {
  const operation=result?.operation;
  if(operation?.kind!=="remove_silences" || !Array.isArray(operation.ranges) || !operation.ranges.length || operation.ranges.length>4096 || operation.ranges.some((range)=>!Array.isArray(range) || range.length!==2 || !range.every(Number.isSafeInteger) || range[0]<0 || range[1]<=range[0]))throw new Error("Native speech analysis did not return valid timeline cuts");
  return operation;
}
function wait(signal) {return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException("Canceled","AbortError"));};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},300);signal.addEventListener("abort",abort,{once:true});});}

export function createSilencePanel({root,getTarget,canCommit,commit,notice,preview=()=>{},api=request,fetcher=fetch}) {
  const form=root.querySelector("form"),status=root.querySelector("output"),list=root.querySelector("ol"),start=root.querySelector("[data-speech-analyze]"),cancel=root.querySelector("[data-speech-cancel]"),apply=root.querySelector("[data-speech-apply]");
  let controller=null,sequence=0,jobPath=null,result=null,identity=null,running=false;
  const params=()=>({threshold:Number(form.elements.threshold.value)/100,min_silence_secs:Number(form.elements.pause.value)/1000,head_secs:Number(form.elements.head.value)/1000,tail_secs:Number(form.elements.tail.value)/1000});
  const current=()=>identity && identity===speechIdentity(getTarget(),params());
  const updateApply=()=>{apply.disabled=running || !canCommit() || !current() || !result?.ranges?.length;preview(current() && result ? result.ranges : []);};
  async function stop(message="Speech analysis canceled") {
    sequence++;controller?.abort();controller=null;running=false;start.disabled=false;cancel.disabled=true;result=null;updateApply();
    status.textContent=message;
    const path=jobPath;jobPath=null;if(path)await fetcher(`/api/v1${path}`,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
  async function analyze() {
    if(running || !form.reportValidity())return;
    const target=getTarget();if(!target){status.textContent="Select source audio clips or their linked video clips first";return;}
    const settings=params(),key=speechIdentity(target,settings),seq=++sequence;
    identity=key;result=null;running=true;start.disabled=true;cancel.disabled=false;updateApply();list.replaceChildren();controller=new AbortController();const signal=controller.signal;
    try {
      let job=await api("/analysis/silence",{...target,params:settings});
      const path=`/analysis/silence/${encodeURIComponent(job.id)}?${new URLSearchParams(target.query)}`;
      if(seq!==sequence){await fetcher(`/api/v1${path}`,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});return;}
      jobPath=path;
      while(["queued","running"].includes(job.state)) {
        status.textContent=`Native Silero VAD · ${job.state} · ${Number(job.analyzed_seconds).toFixed(1)} / ${Number(job.total_seconds).toFixed(1)} source seconds`;
        await wait(signal);job=await api(jobPath);if(seq!==sequence)return;
      }
      if(job.state!=="ready")throw new Error(job.error || `Speech analysis ${job.state}`);
      if(!current()){status.textContent="STALE · selection, parameters or project changed; analyze again";return;}
      result=job.result;
      if(result.ranges.length)speechOperation(result);
      status.textContent=`${result.ranges.length} detected pauses · ${result.removed_frames} timeline frames · applying ripples every track`;
      for(const [first,last] of result.ranges.slice(0,200)){const item=document.createElement("li");item.textContent=`${first}–${last} (exclusive end)`;list.append(item);}
      if(result.ranges.length>200){const item=document.createElement("li");item.textContent=`${result.ranges.length-200} further ranges included`;list.append(item);}
    }catch(error){if(seq===sequence && error.name!=="AbortError")status.textContent=error.message;}
    finally{if(seq===sequence){running=false;start.disabled=false;cancel.disabled=true;updateApply();}}
  }
  form.addEventListener("submit",(event)=>{event.preventDefault();analyze();});form.addEventListener("input",updateApply);
  cancel.addEventListener("click",()=>stop());
  apply.addEventListener("click",async()=>{
    if(!canCommit() || !current() || running)return;apply.disabled=true;
    try{await commit(speechOperation(result));result=null;root.close();notice("Native silence cuts applied · one Undo step");}catch(error){notice(error.message);status.textContent=error.message;}finally{updateApply();}
  });
  root.querySelector("[data-speech-close]").addEventListener("click",()=>{stop();root.close();});
  root.addEventListener("cancel",()=>{stop();});
  return {open(){root.showModal();status.textContent="Analyze selected audio or linked video; review pauses before applying global ripple cuts";updateApply();},invalidate(){if(!current()){apply.disabled=true;preview([]);if(result)status.textContent="STALE · project or selection changed; analyze again";}}};
}
