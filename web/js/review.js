import {request} from "./api.js";
import {createSourcePlayer} from "./source.js";

export function reviewIdentity(context) {
  const query=context?.query;return query?JSON.stringify([query.project_epoch,query.if_generation,query.timeline_id,query.revision,context.clip?.id || null]):null;
}
export function comparisonTime(seconds,duration) {
  return Number.isFinite(seconds) && Number.isFinite(duration) && duration>0?Math.max(0,Math.min(seconds,Math.max(0,duration-0.001))):null;
}
export function comparisonDuration(media){
  if(media?.is_image || ![media?.duration_frames,media?.fps?.num,media?.fps?.den].every(value=>Number.isSafeInteger(value) && value>0))return null;
  const duration=media.duration_frames*media.fps.den/media.fps.num;
  return Number.isFinite(duration) && duration>0?duration:null;
}
export function comparisonLeader(panes){
  let leader=null;
  for(const pane of panes){
    if(!pane.ready || comparisonDuration(pane.media)===null || (!pane.media.has_video && !pane.media.has_audio))continue;
    if(!leader || BigInt(pane.media.duration_frames)*BigInt(pane.media.fps.den)*BigInt(leader.media.fps.num)>
      BigInt(leader.media.duration_frames)*BigInt(leader.media.fps.den)*BigInt(pane.media.fps.num))leader=pane;
  }
  return leader;
}
function formatKnownMetadata(item) {
  if(!item)return "Generation metadata not supplied";
  return [["Model",item.model],["Seed",item.seed],["Prompt",item.prompt]].filter(([,value])=>value!==null && value!==undefined && value!=="").map(([name,value])=>`${name}: ${value}`).join("\n") || "Generation metadata not supplied";
}
export function knownTakeMetadata(media) {return formatKnownMetadata(media?.shared_origin?.item);}
export function replacementAudioStreams(policy,index,count){
  if(policy==='preserve')return {policy:'preserve'};
  const raw=String(index).trim(),selected=Number(raw);
  if(policy!=='select' || !Number.isSafeInteger(count) || count<=0 || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(selected) || selected>=count)throw Error('Choose an available native B audio stream index, or preserve existing streams');
  return {policy:'select',index:selected};
}
export function replacementAudioChange(change,count,policy){
  const before=change.previous_audio_stream_index,after=change.audio_stream_index;
  if(before===null && after===null)return '';
  if(!Number.isSafeInteger(before) || before<0 || !Number.isSafeInteger(after) || after<0 || !Number.isSafeInteger(count) || after>=count ||
    (policy.policy==='preserve' && before!==after) || (policy.policy==='select' && after!==policy.index))throw Error('Native replacement audio stream plan is inconsistent · refresh review');
  return ` · Audio stream ${before} → ${after} (zero-based)`;
}
export function createReview({root,getContext,canCommit,commit,notice,api=request,sourceFactory=createSourcePlayer}) {
  const find=(selector)=>root.querySelector(selector),form=find("form"),status=find("[data-review-status]"),apply=find("[data-review-apply]"),planButton=find("[data-review-plan]"),changes=find("[data-review-changes]"),refresh=find("[data-review-refresh]"),close=find("[data-review-close]"),play=find("[data-review-play]"),swap=find("[data-review-swap]"),sync=find('[name="sync"]'),listen=find('[name="listen"]');
  let context=null,plan=null,annotations=null,sequence=0,planning=false,applying=false,frameTicket=null,closing=false;
  const panes=["A","B"].map((name)=>{
    const element=find(`[data-review-pane="${name}"]`),pane={name,select:element.querySelector("select"),video:element.querySelector("video"),image:element.querySelector("img"),status:element.querySelector("output"),cancel:element.querySelector("button"),metadata:element.querySelector("pre"),ready:false,media:null};
    pane.player=sourceFactory({video:pane.video,image:pane.image,status:pane.status,cancel:pane.cancel,onReady:()=>{pane.ready=true;controls();}});return pane;
  });
  const audioPolicy=form.elements.audio_streams,audioIndex=form.elements.audio_stream_index,audioNote=find('[data-review-audio-streams]'),selectAudio=find('[data-review-audio-select]');
  const candidate=value=>value?.document?.media.find(media=>media.id===panes[1].select.value);
  const candidateIdentity=value=>{const media=candidate(value);return media?JSON.stringify([media.id,media.content_hash,media.audio_stream_count,media.has_audio]):null;};
  const streamCount=()=>{const count=candidate(context)?.audio_stream_count;return Number.isSafeInteger(count) && count>=0?count:null;};
  const identity=()=>reviewIdentity(context),current=()=>identity()===reviewIdentity(getContext()) && candidateIdentity(context)===candidateIdentity(getContext());
  const settingsIdentity=()=>JSON.stringify([panes[1].select.value,...['source_in','duration','links','attributes','audio_streams','audio_stream_index'].map(name=>form.elements[name].value),candidateIdentity(context),candidateIdentity(getContext())]);
  function resetAudioPolicy(){audioPolicy.value='preserve';audioIndex.value='0';}
  function audioValid(){try{replacementAudioStreams(audioPolicy.value,audioIndex.value,streamCount());return true;}catch{return false;}}
  function controls(){
    const count=streamCount(),available=count!==null && count>0;
    audioPolicy.disabled=applying || !candidate(context);audioIndex.disabled=applying || audioPolicy.value!=='select' || !available;audioIndex.max=available?String(count-1):'0';selectAudio.disabled=!available;
    audioNote.textContent=count===null?'Replacement audio streams · Native B stream count unavailable; refresh review before choosing a stream':`Replacement only · B has ${count} audio stream(s)${available?` · available zero-based indices 0–${count-1}`:''}`;
    for(const pane of panes)if(pane.ready && !pane.media?.is_image && !playable(pane))pane.status.textContent='Comparison unavailable · invalid native source timing; refresh review';
    planButton.disabled=planning || applying || !context?.clip || !current() || !panes[1].select.value || !audioValid();apply.disabled=applying || !plan || !current() || plan.settings!==settingsIdentity() || !canCommit();refresh.disabled=applying;close.disabled=applying;play.disabled=panes.some(pane=>pane.select.value && !pane.ready) || !master();swap.disabled=applying;for(const pane of panes)pane.select.disabled=applying;for(const name of ["source_in","duration","links","attributes"])form.elements[name].disabled=applying;
  }
  function clearPlan(message){sequence++;planning=false;plan=null;changes.replaceChildren();if(message)status.textContent=message;controls();}
  function audioChoice(){for(const pane of panes)pane.video.muted=listen.value!==pane.name;}
  function playable(pane){return comparisonLeader([pane])!==null;}
  function master(){return comparisonLeader(panes);}
  function align(){
    if(!sync.checked || closing)return;const leader=master();if(!leader)return;
    for(const pane of panes){if(pane===leader || !playable(pane))continue;const time=comparisonTime(leader.video.currentTime,pane.video.duration);if(time===null || pane.video.readyState<1)continue;
      if(Math.abs(pane.video.currentTime-time)>0.08)pane.video.currentTime=time;
      if(leader.video.currentTime>=pane.video.duration)pane.video.pause();else if(!leader.video.paused && pane.video.paused)pane.video.play().catch(error=>notice(error.message));
    }
  }
  function cancelFrame(){const old=frameTicket;frameTicket=null;if(old?.id!=null)old.owner.cancelVideoFrameCallback?.(old.id);}
  function schedule(){
    const leader=master();if(!leader || leader.video.paused || closing || !root.open || frameTicket || !leader.video.requestVideoFrameCallback)return;
    const ticket={owner:leader.video,leader,media:leader.media,id:null};frameTicket=ticket;
    ticket.id=ticket.owner.requestVideoFrameCallback(()=>{
      if(frameTicket!==ticket)return;
      frameTicket=null;
      if(closing || !root.open || !current())return;
      if(master()!==ticket.leader || ticket.leader.media!==ticket.media){schedule();return;}
      if(ticket.owner.paused)return;
      align();schedule();
    });
  }
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
    pane.select.addEventListener("change",()=>{if(pane.name==='B')resetAudioPolicy();clearPlan("Take choice changed · preview replacement before applying");cancelFrame();for(const other of panes)other.video.pause();load(pane);});
    for(const event of ["timeupdate","seeking","loadedmetadata"])pane.video.addEventListener(event,()=>{if(pane===master())align();});
    pane.video.addEventListener("play",()=>{if(pane===master()){align();schedule();}});
    for(const event of ['pause','ended'])pane.video.addEventListener(event,()=>{if(pane===master()){cancelFrame();if(sync.checked)for(const other of panes)if(other!==pane)other.video.pause();}});
    pane.video.addEventListener("volumechange",()=>{if(!pane.video.muted && listen.value!==pane.name){listen.value=pane.name;audioChoice();}else if(panes.every(other=>other.video.muted))listen.value="silent";});
    pane.video.addEventListener("ratechange",()=>{if(sync.checked && !closing)for(const other of panes)if(other!==pane && other.video.playbackRate!==pane.video.playbackRate)other.video.playbackRate=pane.video.playbackRate;});
  }
  listen.addEventListener("change",audioChoice);sync.addEventListener("change",()=>{const leader=master();if(sync.checked && leader)for(const pane of panes)pane.video.playbackRate=leader.video.playbackRate;align();});
  play.addEventListener("click",async()=>{const leader=master();if(!leader)return;try{if(!leader.video.paused){for(const pane of panes)pane.video.pause();}else {align();const results=await Promise.allSettled(panes.filter(playable).map(pane=>pane.video.play()));for(const result of results)if(result.status==="rejected")notice(result.reason.message);align();schedule();}}catch(error){notice(error.message);}});
  swap.addEventListener("click",()=>{const old=panes[0].select.value;panes[0].select.value=panes[1].select.value;panes[1].select.value=old;resetAudioPolicy();clearPlan("A/B swapped · preview replacement before applying");cancelFrame();panes.forEach(pane=>pane.video.pause());panes.forEach(load);});
  form.addEventListener("input",()=>clearPlan("Replacement settings changed · preview before applying"));form.addEventListener("change",()=>clearPlan("Replacement settings changed · preview before applying"));
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();if(planButton.disabled || !form.reportValidity())return;
    let streams;try{streams=replacementAudioStreams(audioPolicy.value,audioIndex.value,streamCount());}catch(error){clearPlan(error.message);notice(error.message);return;}
    const replacement={clip_id:context.clip.id,media_id:panes[1].select.value,source_in:Number(form.elements.source_in.value),duration:form.elements.duration.value,links:form.elements.links.value,attributes:form.elements.attributes.value,audio_streams:streams,source_version:null};
    clearPlan();const seq=sequence,bound=identity(),settings=settingsIdentity(),count=streamCount(),query={...context.query};planning=true;controls();status.textContent="Reading native replacement ranges and source identity…";
    try{const result=await api("/review/replace/plan",{query,replacement});if(seq!==sequence)return;if(!current() || identity()!==bound || settings!==settingsIdentity()){clearPlan('Project, B source or replacement settings changed · refresh review before applying');return;}
      if(!Number.isSafeInteger(result.audio_stream_count) || result.audio_stream_count<0 || (count!==null && count!==result.audio_stream_count) || !Array.isArray(result.changes) || !result.changes.length || typeof result.source_version!=='string' || !result.source_version)throw Error('Native B stream metadata changed or is unavailable · refresh review');
      const rows=result.changes.map(change=>{const row=document.createElement("li");row.textContent=`Track ${change.track} · clip ${change.clip_id} · start ${change.start_frame} · ${change.previous_length} → ${change.length} timeline frames · source [${change.source_in}, ${change.source_out})${replacementAudioChange(change,result.audio_stream_count,streams)}`;return row;});changes.replaceChildren(...rows);
      if(result.merged_keys){const warning=document.createElement("li");warning.textContent=`${result.merged_keys} animation key(s) share a frame in the new take and will merge; the first key is kept. Choose Reset effects or cancel if this is unwanted.`;changes.append(warning);}
      plan={replacement:{...replacement,source_version:result.source_version},identity:bound,settings};
      status.textContent=`Native preview · ${result.changes.length} clip(s) · ${result.removed_crossings} crossing transition(s) removed · ${streams.policy==='preserve'?'preserve each affected audio stream':`select B audio stream ${streams.index} (zero-based)`}. Confirm to apply one Undo step.`;
    }catch(error){if(seq===sequence){status.textContent=error.message;notice(error.message);}}finally{if(seq===sequence){planning=false;controls();}}
  });
  apply.addEventListener("click",async()=>{if(apply.disabled || !plan)return;if(!current() || plan.identity!==reviewIdentity(getContext()) || plan.settings!==settingsIdentity()){clearPlan('Project, B source or replacement settings changed · refresh review before applying');return;}applying=true;controls();for(const pane of panes)pane.video.pause();try{await commit({kind:"replace_take",replacement:plan.replacement});dismiss();notice("Take replaced with native policies · one Undo step");}catch(error){status.textContent=error.message;notice(error.message);}finally{applying=false;controls();}});
  function dismiss(){closing=true;cancelFrame();for(const pane of panes){if(!pane.cancel.disabled)pane.cancel.click();pane.player.reset();pane.ready=false;}clearPlan();root.close();closing=false;}
  close.addEventListener("click",()=>{if(!applying)dismiss();});root.addEventListener("cancel",(event)=>{event.preventDefault();if(!applying)dismiss();});
  async function open(options={}){
    cancelFrame();annotations=null;for(const pane of panes){pane.player.reset();pane.video.playbackRate=1;pane.ready=false;}context=getContext();resetAudioPolicy();clearPlan();if(!context){for(const pane of panes){pane.select.replaceChildren();pane.media=null;pane.metadata.textContent="";}status.textContent="Open a saved project first";root.showModal();controls();return;}
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
  return {open,invalidate(){const stale=root.open && !current();if(stale)resetAudioPolicy();clearPlan(stale?"Project, selection or B source changed · refresh review before applying":null);if(root.open && context?.query.project_epoch!==getContext()?.query.project_epoch){cancelFrame();panes.forEach(pane=>pane.player.reset());}}};
}
