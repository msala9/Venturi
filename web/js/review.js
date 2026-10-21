import {request} from "./api.js";
import {createSourcePlayer} from "./source.js";

export function reviewIdentity(context) {
  const query=context?.query;return query?JSON.stringify([query.project_epoch,query.if_generation,query.timeline_id,query.revision,context.clip?.id || null]):null;
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
export function comparisonFrame(frame,sourceFPS,media){
  if(!Number.isSafeInteger(frame) || frame<0 || comparisonDuration(media)===null || ![sourceFPS?.num,sourceFPS?.den].every(value=>Number.isSafeInteger(value) && value>0))throw Error('Comparison clock is unavailable');
  const mapped=BigInt(frame)*BigInt(sourceFPS.den)*BigInt(media.fps.num)/(BigInt(sourceFPS.num)*BigInt(media.fps.den));
  return Number(mapped>=BigInt(media.duration_frames)?BigInt(media.duration_frames-1):mapped);
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
  const find=(selector)=>root.querySelector(selector),form=find('[data-review-replacement]'),status=find("[data-review-status]"),apply=find("[data-review-apply]"),planButton=find("[data-review-plan]"),changes=find("[data-review-changes]"),refresh=find("[data-review-refresh]"),close=find("[data-review-close]"),play=find("[data-review-play]"),swap=find("[data-review-swap]"),sync=find('[name="sync"]'),listen=find('[name="listen"]');
  let context=null,plan=null,annotations=null,sequence=0,planning=false,applying=false,frameTicket=null,closing=false;
  let transportEpoch=0,intent=null,barrier=null,preparation=Promise.resolve(),releaseQueue=Promise.resolve(),pausedAnchor=null,changingRates=false;
  const transportStatus=find('[data-review-transport-status]');
  const panes=["A","B"].map((name)=>{
    const element=find(`[data-review-pane="${name}"]`),pane={name,select:element.querySelector(`[name="take${name}"]`),audition:element.querySelector('[data-review-audition-stream]'),audioStreamIndex:0,video:element.querySelector("video"),image:element.querySelector("img"),status:element.querySelector('[data-review-source-status]'),cancel:element.querySelector('[data-review-cancel-source]'),metadata:element.querySelector("pre"),seekForm:element.querySelector('[data-review-seek]'),seekInput:element.querySelector('[data-review-frame]'),seekButton:element.querySelector('[data-review-seek-submit]'),clock:element.querySelector('[data-review-clock]'),ready:false,media:null,version:null,generation:0,sourceSequence:0,queued:false,seeking:null,resetting:false,internalPlays:0,rate:1};
    pane.player=sourceFactory({video:pane.video,image:pane.image,status:pane.status,cancel:pane.cancel,windowed:true,onStateChange:value=>sourceState(pane,value),onReady:()=>sourceReady(pane)});return pane;
  });
  const audioPolicy=form.elements.audio_streams,audioIndex=form.elements.audio_stream_index,audioNote=find('[data-review-audio-streams]'),selectAudio=find('[data-review-audio-select]');
  const candidate=value=>value?.document?.media.find(media=>media.id===panes[1].select.value);
  const candidateIdentity=value=>{const media=candidate(value);return media?JSON.stringify([media.id,media.content_hash,media.audio_stream_count,media.has_audio]):null;};
  const playbackIdentity=value=>JSON.stringify(panes.map(pane=>{const media=value?.document?.media.find(media=>media.id===pane.select.value);return media?[media.id,media.content_hash,media.duration_frames,media.fps?.num,media.fps?.den,media.has_video,media.has_audio,media.is_image,media.audio_stream_count]:null;}));
  const streamCount=()=>{const count=candidate(context)?.audio_stream_count;return Number.isSafeInteger(count) && count>=0?count:null;};
  const identity=()=>reviewIdentity(context),current=()=>identity()===reviewIdentity(getContext()) && candidateIdentity(context)===candidateIdentity(getContext()) && playbackIdentity(context)===playbackIdentity(getContext());
  const settingsIdentity=()=>JSON.stringify([panes[1].select.value,...['source_in','duration','links','attributes','audio_streams','audio_stream_index'].map(name=>form.elements[name].value),candidateIdentity(context),candidateIdentity(getContext())]);
  function resetAudioPolicy(){audioPolicy.value='preserve';audioIndex.value='0';}
  function audioValid(){try{replacementAudioStreams(audioPolicy.value,audioIndex.value,streamCount());return true;}catch{return false;}}
  function auditionCount(pane){const count=pane.media?.audio_stream_count;return !pane.media?.is_image && pane.media?.has_audio && Number.isSafeInteger(count) && count>0 && count<=1024?count:0;}
  function renderAudition(pane){
    const count=auditionCount(pane);pane.audition.replaceChildren(...(count?Array.from({length:count},(_,index)=>new Option(`${index}${index===0?' · first stream':''}`,String(index))):[new Option(pane.media?.has_audio && !pane.media?.is_image?'Native stream list unavailable':'No audition audio streams','0')]));pane.audition.value=String(pane.audioStreamIndex);
  }
  function controls(){
    const count=streamCount(),available=count!==null && count>0;
    audioPolicy.disabled=applying || !candidate(context);audioIndex.disabled=applying || audioPolicy.value!=='select' || !available;audioIndex.max=available?String(count-1):'0';selectAudio.disabled=!available;
    audioNote.textContent=count===null?'Replacement audio streams · Native B stream count unavailable; refresh review before choosing a stream':`Replacement only · B has ${count} audio stream(s)${available?` · available zero-based indices 0–${count-1}`:''}`;
    for(const pane of panes){if(pane.media && !pane.media.is_image && comparisonDuration(pane.media)===null)pane.status.textContent='Comparison unavailable · invalid native source timing; refresh review';pane.audition.disabled=applying || !current() || !auditionCount(pane);pane.seekInput.disabled=applying || !current() || !playable(pane);pane.seekButton.disabled=pane.seekInput.disabled;pane.seekInput.max=String(Math.max(0,(pane.media?.duration_frames || 1)-1));updateClock(pane);}
    planButton.disabled=planning || applying || !context?.clip || !current() || !panes[1].select.value || !audioValid();apply.disabled=applying || !plan || !current() || plan.settings!==settingsIdentity() || !canCommit();refresh.disabled=applying;close.disabled=applying;play.disabled=applying || !current() || (!intent && (waiting() || !master()));play.textContent=intent?'Pause A/B':'Play A/B';swap.disabled=applying;for(const pane of panes)pane.select.disabled=applying;for(const name of ["source_in","duration","links","attributes"])form.elements[name].disabled=applying;
  }
  function clearPlan(message){sequence++;planning=false;plan=null;changes.replaceChildren();if(message)status.textContent=message;controls();}
  function audioChoice(){for(const pane of panes)pane.video.muted=listen.value!==pane.name;}
  function playable(pane){return comparisonLeader([{...pane,ready:Boolean(pane.media)}])!==null;}
  function waiting(){return panes.some(pane=>pane.select.value && playable(pane) && (!pane.ready || pane.queued || pane.player.preparing() || !position(pane)));}
  function master(){return intent?.leader || comparisonLeader(panes.filter(pane=>!pane.queued && !pane.player.preparing()));}
  function position(pane){
    if(pane.queued || pane.player.preparing() || !pane.media || pane.media.is_image)return null;
    const value=pane.player.current();
    if(!value || value.epoch!==context?.query.project_epoch || value.media_id!==pane.media.id || value.audio_stream_index!==pane.audioStreamIndex || value.fps?.num!==pane.media.fps?.num || value.fps?.den!==pane.media.fps?.den ||
      ![value.frame,value.start_frame,value.end_frame].every(Number.isSafeInteger) || value.start_frame<0 || value.end_frame>pane.media.duration_frames || value.start_frame>=value.end_frame || value.frame<value.start_frame || value.frame>=value.end_frame ||
      typeof value.source_version!=='string' || !value.source_version || (pane.version!==null && pane.version!==value.source_version))return null;
    pane.version??=value.source_version;return value;
  }
  function updateClock(pane){
    const value=position(pane);
    pane.clock.textContent=value?`${pane.name} · frame ${value.frame} / ${pane.media.duration_frames-1} · ${value.fps.num}/${value.fps.den} fps · window [${value.start_frame}, ${value.end_frame})${pane.media.has_audio?` · audition audio stream ${value.audio_stream_index}`:''}`:pane.media?.is_image?`${pane.name} · Original still`:pane.queued || pane.player.preparing()?`${pane.name} · Paused · preparing native Source window`:`${pane.name} · Absolute source clock unavailable`;
  }
  function hold(pane){pane.player.hold();}
  function stopTransport(message,{cancel=false}={}){
    transportEpoch++;intent=null;pausedAnchor=null;cancelFrame();
    for(const pane of panes){pane.resetting=true;try{if(cancel)pane.player.pause();else hold(pane);}finally{pane.resetting=false;}}
    if(message)transportStatus.textContent=message;controls();
  }
  function owned(value){return intent===value && value.epoch===transportEpoch && root.open && !closing && current();}
  function enqueue(valid,operation){
    const pending=preparation.catch(()=>{}).then(async()=>{if(!valid())return null;return operation();});preparation=pending.catch(()=>{});return pending;
  }
  async function seek(pane,frame,valid,force=true){
    pane.nativeSeek=false;
    const existing=position(pane),tolerance=Math.max(1,Math.floor(.08*pane.media.fps.num/pane.media.fps.den));
    if(existing && existing.frame===frame && !pane.video.ended)return existing;
    if(!force && existing && !pane.video.ended && frame>=existing.start_frame && frame<existing.end_frame && frame!==pane.media.duration_frames-1 && Math.abs(existing.frame-frame)<=tolerance)return existing;
    const task={frame,generation:pane.generation};pane.seeking=task;pane.queued=true;hold(pane);controls();
    try{return await enqueue(valid,async()=>{
      if(!valid() || task.generation!==pane.generation)return null;pane.queued=false;pane.video.defaultPlaybackRate=pane.rate;await pane.player.seekFrame(frame,{retain:true});
      if(!valid() || task.generation!==pane.generation)return null;
      const value=position(pane);if(!value || value.frame!==frame)throw Error(`${pane.name} Source did not verify the requested absolute frame`);pane.ready=true;return value;
    });}finally{if(pane.seeking===task){pane.seeking=null;pane.queued=false;}controls();}
  }
  function anchor(pane,frame){const value=position(pane);return value?{pane,frame:frame??value.frame,fps:{...value.fps},version:value.source_version}:null;}
  async function alignAt(clock,valid,force=true,targets=panes.filter(playable)){
    if(!clock)throw Error('Comparison absolute source clock is unavailable');
    for(const pane of targets){if(!valid())return false;const frame=intent && pane.exhausted?pane.media.duration_frames-1:comparisonFrame(clock.frame,clock.fps,pane.media);await seek(pane,frame,valid,force);if(!valid())return false;}
    return true;
  }
  function release(value){
    const pending=releaseQueue.catch(()=>{}).then(()=>releaseOwned(value));releaseQueue=pending.catch(()=>{});return pending;
  }
  async function releaseOwned(value){
    for(const pane of panes){
      if(!owned(value))return;
      const at=position(pane);if(!value.playing.has(pane) || !at || (value.sync && pane!==value.leader && at.frame===pane.media.duration_frames-1)){hold(pane);continue;}
      if(pane.video.ended && at.frame===at.end_frame-1 && at.end_frame<pane.media.duration_frames){
        hold(pane);if(value.sync && pane!==value.leader)continue;
        void coordinate({pane,frame:at.end_frame,fps:{...at.fps},version:at.source_version},{targets:value.sync?undefined:[pane]});return;
      }
      if(!pane.video.paused)continue;
      pane.internalPlays++;try{await pane.video.play();}catch(error){if(pane.internalPlays)pane.internalPlays--;if(barrier?.intent===value && barrier.next){hold(pane);return;}throw error;}
      if(!owned(value)){hold(pane);return;}
      if(barrier?.intent===value && barrier.next){hold(pane);return;}
      if(pane.video.paused || !position(pane))throw Error(`${pane.name} playback did not start from a verified source window`);
    }
    if(owned(value)){transportStatus.textContent='Playing full-source windows · pauses between prepared windows';schedule();controls();}
  }
  function coordinate(clock,{force=true,targets}={}){
    const value=intent;if(!value)return Promise.resolve();
    if(barrier?.intent===value){if(clock)barrier.next={clock,force,targets};for(const pane of value.sync?panes:targets || [...value.playing])hold(pane);return barrier.promise;}
    const ticket={intent:value,next:{clock,force,targets},promise:null};barrier=ticket;cancelFrame();
    const affected=value.sync?panes:targets || [...value.playing];for(const pane of affected)hold(pane);
    ticket.promise=Promise.resolve().then(async()=>{
      while(owned(value)){
        while(owned(value) && ticket.next){const next=ticket.next;ticket.next=null;const target=next.targets || (value.sync?panes.filter(playable):[...value.playing]);
          if(value.sync){if(!await alignAt(next.clock,()=>owned(value),next.force,target))return;}
          else for(const pane of target){if(!owned(value))return;const frame=next.clock?.pane===pane?next.clock.frame:position(pane)?.frame;if(frame==null)throw Error('Independent comparison clock is unavailable');await seek(pane,frame,()=>owned(value),next.force);}
          if(!owned(value))return;
        }
        if(owned(value))await release(value);
        if(!ticket.next)break;
      }
    }).catch(error=>{if(owned(value)){stopTransport(`${error.message} · comparison paused; press Play after reopening the source`);notice(error.message);}}).finally(()=>{if(barrier===ticket){barrier=null;if(owned(value))schedule();}});return ticket.promise;
  }
  function start(origin=null){
    if((sync.checked || !origin) && waiting()){transportStatus.textContent='Comparison paused · wait for both native source windows to verify, then press Play';return;}
    const leader=comparisonLeader(panes);if(!leader || !current())return;const clock=pausedAnchor || anchor(origin || leader);if(!clock)return;
    const epoch=++transportEpoch;intent={epoch,leader,sync:sync.checked,playing:new Set(sync.checked || !origin?panes.filter(playable):[origin])};pausedAnchor=null;
    if((clock.pane===leader || (!sync.checked && origin)) && clock.frame===clock.pane.media.duration_frames-1){clock.frame=0;for(const pane of sync.checked || !origin?panes:[origin])pane.exhausted=false;}
    void coordinate(clock);controls();
  }
  function sourceReady(pane){
    hold(pane);if(pane.video.playbackRate!==pane.rate)pane.video.playbackRate=pane.rate;
    pane.ready=pane.media?.is_image || Boolean(position(pane));controls();
  }
  function sourceState(pane,value){
    if(pane.resetting || value.item?.id!==pane.media?.id || value.audio_stream_index!==pane.audioStreamIndex || value.epoch!==context?.query.project_epoch || (value.state==='canceled' && value.reason==='reset'))return;
    if(Number.isSafeInteger(value.sequence)){if(value.sequence<pane.sourceSequence)return;pane.sourceSequence=value.sequence;}
    if(value.state==='preparing'){
      pane.ready=false;
      if(value.reason==='native_seek'){
        if(sync.checked || !intent)stopTransport('Comparison paused · finish the local-window seek before pressing Play',{cancel:false});
        else{intent.playing.delete(pane);hold(pane);cancelFrame();if(!intent.playing.size)stopTransport('Comparison paused');else schedule();}
        pane.nativeSeek=true;for(const target of sync.checked?panes:[pane])target.exhausted=false;
      }
      else if(playable(pane) && intent && !pane.seeking && !pane.queued){for(const target of intent.sync?panes:[pane])hold(target);cancelFrame();}
    }else if(value.state==='ready'){
      sourceReady(pane);
      if(pane.nativeSeek && value.reason==='native_seek'){pane.nativeSeek=false;const clock=anchor(pane);if(clock){pausedAnchor=clock;if(sync.checked)void pausedAlign(clock);}}
      else if(pane.nativeSeek)pane.nativeSeek=false;
      else if(playable(pane) && intent && !pane.seeking && !pane.queued){const value=intent;queueMicrotask(()=>{if(owned(value))void coordinate(anchor(pane),{targets:value.sync?undefined:[pane]});});}
    }else if(value.state==='error' || value.state==='canceled'){
      pane.nativeSeek=false;pane.ready=false;if(!closing && playable(pane))stopTransport(`${pane.name} Source ${value.state} · refresh this take before playback`,{cancel:false});
    }
    controls();
  }
  async function pausedAlign(clock){
    const epoch=transportEpoch,valid=()=>epoch===transportEpoch && root.open && !closing && current();for(const pane of panes)hold(pane);
    try{await alignAt(clock,valid,true);if(valid()){pausedAnchor=clock;transportStatus.textContent='Comparison paused at verified absolute source frames';}}
    catch(error){if(valid()){transportStatus.textContent=`${error.message} · comparison paused`;notice(error.message);}}finally{controls();}
  }
  function ended(pane){
    if(!pane.video.ended)return;
    const clock=anchor(pane);hold(pane);if(!clock || !intent || !owned(intent))return;
    if(clock.frame+1>=pane.media.duration_frames){
      pane.exhausted=true;
      intent.playing.delete(pane);
      if(pane===intent.leader && intent.sync){stopTransport('End of the longest source · comparison paused',{cancel:false});return;}
      if(!intent.playing.size){stopTransport('End of comparison',{cancel:false});return;}
      const leaderClock=intent.sync?anchor(intent.leader):clock;void coordinate(leaderClock || clock,{targets:intent.sync?undefined:[pane]});return;
    }
    clock.frame=pane.player.current().end_frame;transportStatus.textContent='Comparison paused · preparing the next source window';void coordinate(clock,{targets:intent.sync?undefined:[pane]});
  }
  function cancelFrame(){const old=frameTicket;frameTicket=null;if(old?.id!=null)old.owner.cancelVideoFrameCallback?.(old.id);}
  function align(){
    for(const pane of panes)updateClock(pane);
    if(!intent?.sync || barrier || !owned(intent))return;
    const clock=anchor(intent.leader);if(!clock)return;
    const drift=panes.filter(playable).some(pane=>{const at=position(pane);if(!at)return true;const target=pane.exhausted?pane.media.duration_frames-1:comparisonFrame(clock.frame,clock.fps,pane.media),limit=Math.max(1,Math.floor(.08*pane.media.fps.num/pane.media.fps.den));return Math.abs(at.frame-target)>limit || (target===pane.media.duration_frames-1 && at.frame!==target);});
    if(drift)void coordinate(clock,{force:false});
  }
  function schedule(){
    const leader=intent?.sync?intent.leader:comparisonLeader(panes.filter(pane=>!pane.video.paused && position(pane)));
    if(!intent || !owned(intent) || barrier || !leader || leader.video.paused || closing || !root.open || frameTicket || !leader.video.requestVideoFrameCallback)return;
    const ticket={owner:leader.video,leader,media:leader.media,id:null};frameTicket=ticket;
    ticket.id=ticket.owner.requestVideoFrameCallback(()=>{
      if(frameTicket!==ticket)return;
      frameTicket=null;
      if(closing || !root.open || !current())return;
      if(ticket.leader.media!==ticket.media || !position(ticket.leader)){schedule();return;}
      if(ticket.owner.paused)return;
      align();schedule();
    });
  }
  function describe(pane){
    const source=pane.media?.is_image?"Original still":pane.media?.fps?`Native source ${pane.media.fps.num}/${pane.media.fps.den} fps · ${pane.media.duration_frames} frames`:"";
    const take=annotations?.items.find(item=>item.media_id===pane.media?.id),label=take?[annotations.shots[take.shot_id],take.label,take.rating!=="unrated"?take.rating:null,take.stale_source?"SOURCE CHANGED · review captured annotations":null].filter(Boolean).join(" · "):"";
    const known=take?formatKnownMetadata(take.metadata):knownTakeMetadata(pane.media);pane.metadata.textContent=[source,label,known].filter(Boolean).join("\n");
  }
  async function load(pane,{audioStreamIndex=0}={}){
    const generation=++pane.generation;pane.ready=false;pane.version=null;pane.nativeSeek=false;pane.exhausted=false;pane.audioStreamIndex=audioStreamIndex;pane.media=context?.document.media.find(media=>media.id===pane.select.value) || null;pane.seekInput.value='0';pane.resetting=true;try{pane.player.reset();}finally{pane.resetting=false;}renderAudition(pane);describe(pane);controls();if(!pane.media)return;
    const media=pane.media,epoch=context.query.project_epoch;pane.queued=true;controls();
    await enqueue(()=>generation===pane.generation && root.open && current(),async()=>{pane.queued=false;pane.video.defaultPlaybackRate=pane.rate;await pane.player.open(media,epoch,"low",0,{audioStreamIndex});if(generation!==pane.generation)return;pane.ready=media.is_image || Boolean(position(pane));});
    if(generation===pane.generation){pane.queued=false;controls();}
  }
  for(const pane of panes){
    pane.select.addEventListener("change",()=>{stopTransport('Comparison paused · take changed');if(pane.name==='B')resetAudioPolicy();clearPlan("Take choice changed · preview replacement before applying");void load(pane);});
    pane.audition.addEventListener('change',()=>{
      const raw=pane.audition.value,index=Number(raw),count=auditionCount(pane);
      if(applying || !root.open || !current() || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(index) || index>=count){pane.audition.value=String(pane.audioStreamIndex);return;}
      if(index===pane.audioStreamIndex)return;stopTransport(`Comparison paused · loading ${pane.name} audition audio stream ${index}`);void load(pane,{audioStreamIndex:index});
    });
    for(const event of ["timeupdate","seeked","loadedmetadata"])pane.video.addEventListener(event,()=>{updateClock(pane);if(pane===master())align();});
    pane.video.addEventListener('ended',()=>ended(pane),{capture:true});
    pane.video.addEventListener("play",()=>{if(pane.internalPlays){pane.internalPlays--;return;}if(pane.video.paused || closing)return;hold(pane);if(intent && !intent.sync){intent.playing.add(pane);void coordinate(anchor(pane),{targets:[pane]});}else start(pane);});
    pane.video.addEventListener('pause',event=>{if(!pane.video.paused || pane.player.internalPause(event) || pane.video.ended || pane.resetting || closing)return;if(intent?.sync)stopTransport('Comparison paused');else if(intent){intent.playing.delete(pane);if(!intent.playing.size)stopTransport('Comparison paused');}controls();});
    pane.video.addEventListener("volumechange",()=>{if(!pane.video.muted && listen.value!==pane.name){listen.value=pane.name;audioChoice();}else if(panes.every(other=>other.video.muted))listen.value="silent";});
    pane.video.addEventListener("ratechange",()=>{if(changingRates || closing || pane.queued || pane.seeking || pane.player.preparing() || !position(pane))return;pane.rate=pane.video.playbackRate;pane.video.defaultPlaybackRate=pane.rate;if(sync.checked){changingRates=true;try{for(const other of panes){other.rate=pane.rate;other.video.defaultPlaybackRate=pane.rate;if(other!==pane && other.video.playbackRate!==pane.rate)other.video.playbackRate=pane.rate;}}finally{changingRates=false;}}});
    pane.seekForm.addEventListener('submit',event=>{event.preventDefault();if(applying || !current() || !playable(pane) || !pane.seekForm.reportValidity())return;const frame=Number(pane.seekInput.value);if(!Number.isSafeInteger(frame) || frame<0 || frame>=pane.media?.duration_frames)return;
      stopTransport('Comparison paused · seeking absolute source frame');for(const target of sync.checked?panes:[pane])target.exhausted=false;const epoch=transportEpoch,valid=()=>epoch===transportEpoch && root.open && !closing && current();
      void (async()=>{try{await seek(pane,frame,valid);if(!valid())return;const clock=anchor(pane);if(sync.checked)await pausedAlign(clock);else pausedAnchor=clock;}catch(error){if(valid()){transportStatus.textContent=`${error.message} · comparison paused`;notice(error.message);}}})();
    });
    pane.cancel.addEventListener('click',()=>{if(!closing)stopTransport('Source preparation canceled · comparison paused');});
  }
  listen.addEventListener("change",audioChoice);sync.addEventListener("change",()=>{stopTransport('Comparison paused · synchronization mode changed');const leader=master();if(sync.checked && leader)for(const pane of panes){pane.rate=leader.video.playbackRate;pane.video.playbackRate=pane.rate;}});
  play.addEventListener("click",()=>{if(intent)stopTransport('Comparison paused');else start();});
  swap.addEventListener("click",()=>{stopTransport('Comparison paused · A/B swapped');const old=panes[0].select.value;panes[0].select.value=panes[1].select.value;panes[1].select.value=old;resetAudioPolicy();clearPlan("A/B swapped · preview replacement before applying");panes.forEach(pane=>{pane.generation++;pane.ready=false;pane.resetting=true;try{pane.player.reset();}finally{pane.resetting=false;}});panes.forEach(pane=>void load(pane));});
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
  apply.addEventListener("click",async()=>{if(apply.disabled || !plan)return;if(!current() || plan.identity!==reviewIdentity(getContext()) || plan.settings!==settingsIdentity()){clearPlan('Project, B source or replacement settings changed · refresh review before applying');return;}applying=true;stopTransport('Comparison paused · applying replacement');controls();try{await commit({kind:"replace_take",replacement:plan.replacement});dismiss();notice("Take replaced with native policies · one Undo step");}catch(error){status.textContent=error.message;notice(error.message);}finally{applying=false;controls();}});
  function dismiss(){closing=true;stopTransport();for(const pane of panes){pane.generation++;pane.resetting=true;try{pane.player.reset();}finally{pane.resetting=false;}pane.ready=false;pane.queued=false;}clearPlan();root.close();closing=false;}
  close.addEventListener("click",()=>{if(!applying)dismiss();});root.addEventListener("cancel",(event)=>{event.preventDefault();if(!applying)dismiss();});
  async function open(options={}){
    stopTransport();annotations=null;for(const pane of panes){pane.generation++;pane.resetting=true;try{pane.player.reset();}finally{pane.resetting=false;}pane.rate=1;pane.audioStreamIndex=0;pane.video.playbackRate=1;pane.ready=false;pane.queued=false;}const next=getContext();context=next?{...next,query:{...next.query},clip:next.clip?{...next.clip}:null,document:{...next.document,media:next.document.media.map(media=>({...media,fps:media.fps?{...media.fps}:undefined}))}}:null;resetAudioPolicy();clearPlan();if(!context){for(const pane of panes){pane.select.replaceChildren();pane.media=null;renderAudition(pane);pane.metadata.textContent="";}status.textContent="Open a saved project first";root.showModal();controls();return;}
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
  return {open,invalidate(){const stale=root.open && !current();if(stale){resetAudioPolicy();stopTransport('Comparison paused · project or selection changed');}clearPlan(stale?"Project, selection or B source changed · refresh review before applying":null);if(root.open && context?.query.project_epoch!==getContext()?.query.project_epoch){for(const pane of panes){pane.generation++;pane.resetting=true;try{pane.player.reset();}finally{pane.resetting=false;}pane.ready=false;}}}};
}
