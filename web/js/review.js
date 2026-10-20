import {request} from "./api.js";
import {createSourcePlayer} from "./source.js";

export function reviewIdentity(context) {
  const query=context?.query;return query?JSON.stringify([query.project_epoch,query.if_generation,query.timeline_id,query.revision,context.clip?.id || null]):null;
}
export function comparisonTime(seconds,duration) {
  return Number.isFinite(seconds) && Number.isFinite(duration) && duration>0?Math.max(0,Math.min(seconds,Math.max(0,duration-0.001))):null;
}
function formatKnownMetadata(item) {
  if(!item)return "Generation metadata not supplied";
  return [["Model",item.model],["Seed",item.seed],["Prompt",item.prompt]].filter(([,value])=>value!==null && value!==undefined && value!=="").map(([name,value])=>`${name}: ${value}`).join("\n") || "Generation metadata not supplied";
}
export function knownTakeMetadata(media) {return formatKnownMetadata(media?.shared_origin?.item);}
export function createReview({root,getContext,canCommit,commit,notice,api=request,sourceFactory=createSourcePlayer}) {
  const find=(selector)=>root.querySelector(selector),form=find("form"),status=find("[data-review-status]"),apply=find("[data-review-apply]"),planButton=find("[data-review-plan]"),changes=find("[data-review-changes]"),refresh=find("[data-review-refresh]"),close=find("[data-review-close]"),play=find("[data-review-play]"),swap=find("[data-review-swap]"),sync=find('[name="sync"]'),listen=find('[name="listen"]');
  let context=null,plan=null,annotations=null,sequence=0,planning=false,applying=false,frameCallback=null,frameOwner=null,closing=false;
  const panes=["A","B"].map((name)=>{
    const element=find(`[data-review-pane="${name}"]`),pane={name,select:element.querySelector("select"),video:element.querySelector("video"),image:element.querySelector("img"),status:element.querySelector("output"),cancel:element.querySelector("button"),metadata:element.querySelector("pre"),ready:false,media:null};
    pane.player=sourceFactory({video:pane.video,image:pane.image,status:pane.status,cancel:pane.cancel,onReady:()=>{pane.ready=true;controls();}});return pane;
  });
  const identity=()=>reviewIdentity(context),current=()=>identity()===reviewIdentity(getContext());
  function controls(){planButton.disabled=planning || applying || !context?.clip || !current() || !panes[1].select.value;apply.disabled=applying || !plan || !current() || !canCommit();refresh.disabled=applying;close.disabled=applying;play.disabled=panes.some(pane=>pane.select.value && !pane.ready) || !panes.some(pane=>pane.ready && !pane.media?.is_image);swap.disabled=applying;for(const pane of panes)pane.select.disabled=applying;for(const name of ["source_in","duration","links","attributes"])form.elements[name].disabled=applying;}
  function clearPlan(message){sequence++;planning=false;plan=null;changes.replaceChildren();if(message)status.textContent=message;controls();}
  function audioChoice(){for(const pane of panes)pane.video.muted=listen.value!==pane.name;}
  function master(){return panes.find(pane=>pane.ready && !pane.media?.is_image);}
  function align(){
    if(!sync.checked || closing)return;const leader=master();if(!leader)return;
    for(const pane of panes){if(pane===leader || !pane.ready || pane.media?.is_image)continue;const time=comparisonTime(leader.video.currentTime,pane.video.duration);if(time===null || pane.video.readyState<1)continue;
      if(Math.abs(pane.video.currentTime-time)>0.08)pane.video.currentTime=time;
      if(leader.video.currentTime>=pane.video.duration)pane.video.pause();else if(!leader.video.paused && pane.video.paused)pane.video.play().catch(error=>notice(error.message));
    }
  }
  function cancelFrame(){if(frameCallback!==null)frameOwner?.cancelVideoFrameCallback?.(frameCallback);frameCallback=null;frameOwner=null;}
  function schedule(){const leader=master();if(!leader || leader.video.paused || closing || frameCallback!==null || !leader.video.requestVideoFrameCallback)return;frameOwner=leader.video;frameCallback=leader.video.requestVideoFrameCallback(()=>{frameCallback=null;align();schedule();});}
  function describe(pane){
    const source=pane.media?.is_image?"Original still":pane.media?.fps?`Native source ${pane.media.fps.num}/${pane.media.fps.den} fps · ${pane.media.duration_frames} frames`:"";
    const take=annotations?.items.find(item=>item.media_id===pane.media?.id),label=take?[annotations.shots[take.shot_id],take.label,take.rating!=="unrated"?take.rating:null,take.stale_source?"SOURCE CHANGED · review captured annotations":null].filter(Boolean).join(" · "):"";
    const known=take?formatKnownMetadata(take.metadata):knownTakeMetadata(pane.media);pane.metadata.textContent=[source,label,known].filter(Boolean).join("\n");
  }
  async function load(pane){
    pane.ready=false;pane.media=context?.document.media.find(media=>media.id===pane.select.value) || null;describe(pane);controls();if(!pane.media){pane.player.reset();return;}
    await pane.player.open(pane.media,context.query.project_epoch,"low");
  }
  for(const pane of panes){
    pane.select.addEventListener("change",()=>{clearPlan("Take choice changed · preview replacement before applying");cancelFrame();for(const other of panes)other.video.pause();load(pane);});
    for(const event of ["timeupdate","seeking","loadedmetadata"])pane.video.addEventListener(event,()=>{if(pane===master())align();});
    pane.video.addEventListener("play",()=>{if(pane===master()){align();schedule();}});
    pane.video.addEventListener("pause",()=>{if(pane===master()){cancelFrame();if(sync.checked)for(const other of panes)if(other!==pane)other.video.pause();}});
    pane.video.addEventListener("volumechange",()=>{if(!pane.video.muted && listen.value!==pane.name){listen.value=pane.name;audioChoice();}else if(panes.every(other=>other.video.muted))listen.value="silent";});
    pane.video.addEventListener("ratechange",()=>{if(sync.checked && !closing)for(const other of panes)if(other!==pane && other.video.playbackRate!==pane.video.playbackRate)other.video.playbackRate=pane.video.playbackRate;});
  }
  listen.addEventListener("change",audioChoice);sync.addEventListener("change",()=>{const leader=master();if(sync.checked && leader)for(const pane of panes)pane.video.playbackRate=leader.video.playbackRate;align();});
  play.addEventListener("click",async()=>{const leader=master();if(!leader)return;try{if(!leader.video.paused){for(const pane of panes)pane.video.pause();}else {align();const results=await Promise.allSettled(panes.filter(pane=>pane.ready && !pane.media?.is_image).map(pane=>pane.video.play()));for(const result of results)if(result.status==="rejected")notice(result.reason.message);align();schedule();}}catch(error){notice(error.message);}});
  swap.addEventListener("click",()=>{const old=panes[0].select.value;panes[0].select.value=panes[1].select.value;panes[1].select.value=old;clearPlan("A/B swapped · preview replacement before applying");cancelFrame();panes.forEach(pane=>pane.video.pause());panes.forEach(load);});
  form.addEventListener("input",()=>clearPlan("Replacement settings changed · preview before applying"));form.addEventListener("change",()=>clearPlan("Replacement settings changed · preview before applying"));
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();if(planButton.disabled || !form.reportValidity())return;
    const replacement={clip_id:context.clip.id,media_id:panes[1].select.value,source_in:Number(form.elements.source_in.value),duration:form.elements.duration.value,links:form.elements.links.value,attributes:form.elements.attributes.value,source_version:null};
    clearPlan();const seq=sequence,bound=identity(),query={...context.query};planning=true;controls();status.textContent="Reading native replacement ranges and source identity…";
    try{const result=await api("/review/replace/plan",{query,replacement});if(seq!==sequence || !current() || identity()!==bound)return;plan={replacement:{...replacement,source_version:result.source_version},identity:bound};
      for(const change of result.changes){const row=document.createElement("li");row.textContent=`Track ${change.track} · clip ${change.clip_id} · start ${change.start_frame} · ${change.previous_length} → ${change.length} timeline frames · source [${change.source_in}, ${change.source_out})`;changes.append(row);}
      if(result.merged_keys){const warning=document.createElement("li");warning.textContent=`${result.merged_keys} animation key(s) share a frame in the new take and will merge; the first key is kept. Choose Reset effects or cancel if this is unwanted.`;changes.append(warning);}
      status.textContent=`Native preview · ${result.changes.length} clip(s) · ${result.removed_crossings} crossing transition(s) removed. Confirm to apply one Undo step.`;
    }catch(error){if(seq===sequence){status.textContent=error.message;notice(error.message);}}finally{if(seq===sequence){planning=false;controls();}}
  });
  apply.addEventListener("click",async()=>{if(apply.disabled || !plan || plan.identity!==reviewIdentity(getContext()))return;applying=true;controls();for(const pane of panes)pane.video.pause();try{await commit({kind:"replace_take",replacement:plan.replacement});dismiss();notice("Take replaced with native policies · one Undo step");}catch(error){status.textContent=error.message;notice(error.message);}finally{applying=false;controls();}});
  function dismiss(){closing=true;cancelFrame();for(const pane of panes){if(!pane.cancel.disabled)pane.cancel.click();pane.player.reset();pane.ready=false;}clearPlan();root.close();closing=false;}
  close.addEventListener("click",()=>{if(!applying)dismiss();});root.addEventListener("cancel",(event)=>{event.preventDefault();if(!applying)dismiss();});
  async function open(options={}){
    cancelFrame();annotations=null;for(const pane of panes){pane.player.reset();pane.video.playbackRate=1;pane.ready=false;}context=getContext();clearPlan();if(!context){for(const pane of panes){pane.select.replaceChildren();pane.media=null;pane.metadata.textContent="";}status.textContent="Open a saved project first";root.showModal();controls();return;}
    const media=context.document.media.filter(item=>!item.compound_timeline_id),a=context.clip?.media_id || context.selectedMedia || panes[0].select.value;
    for(const pane of panes){const old=pane.select.value;pane.select.replaceChildren(...media.map(item=>new Option(`${item.offline?"OFFLINE · ":""}${item.name}`,item.id)));pane.select.value=media.some(item=>item.id===old)?old:(media[0]?.id || "");}
    if(media.some(item=>item.id===a))panes[0].select.value=a;
    if(panes[1].select.value===panes[0].select.value)panes[1].select.value=media.find(item=>item.id!==panes[0].select.value)?.id || panes[0].select.value;
    if(options.media_id && media.some(item=>item.id===options.media_id))panes[1].select.value=options.media_id;
    find("[data-review-target]").textContent=context.clip?`Replacement target: clip ${context.clip.id} · ${context.clip.name} · start ${context.clip.start_frame} · ${context.clip.length_frames} frames` : "Select a source clip in the timeline to replace it with B; comparison is available without a selection.";
    status.textContent="Compare sources, choose explicit replacement policies, then preview native changes";audioChoice();root.showModal();controls();const wanted=identity();
    const metadata=api(`/review?${new URLSearchParams({project_epoch:context.query.project_epoch})}`).then(value=>{if(root.open && current() && identity()===wanted && value.project_epoch===context.query.project_epoch && value.generation===context.query.if_generation && Array.isArray(value.items)){annotations=value;panes.forEach(describe);}}).catch(()=>{});
    await Promise.all([...panes.map(load),metadata]);
  }
  refresh.addEventListener("click",()=>{open().catch(error=>notice(error.message));});
  return {open,invalidate(){clearPlan(root.open && !current()?"Project or selection changed · refresh review before applying":null);if(root.open && context?.query.project_epoch!==getContext()?.query.project_epoch){cancelFrame();panes.forEach(pane=>pane.player.reset());}}};
}
