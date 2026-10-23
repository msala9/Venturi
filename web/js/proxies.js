import {request} from './api.js';

const qualities=['low','medium','high'];
const activeStates=new Set(['queued','generating']);
const text=(value,max=256)=>typeof value==='string' && value.length>0 && value.length<=max;
const apiRequest=(path,body,{method,signal}={})=>request(path,body,(url,init)=>fetch(url,{...init,method:method || init.method,signal:signal?AbortSignal.any([init.signal,signal]):init.signal}));

export function checkedProxyCatalog(value,epoch){
  const settings=value?.settings;
  if(!text(epoch) || value?.project_epoch!==epoch || typeof settings?.enabled!=='boolean' || !qualities.includes(settings.quality) || typeof settings.paused!=='boolean' || !Array.isArray(value.jobs) || value.jobs.length>32)throw Error('The proxy settings no longer match this project');
  const seen=new Set(),jobs=value.jobs.map(job=>{
    if(!text(job?.media_id,80) || seen.has(job.media_id) || !['queued','generating','ready','failed','canceled'].includes(job.state) || !Number.isSafeInteger(job.progress) || job.progress<0 || !Number.isSafeInteger(job.total) || job.total<1 || job.progress>job.total || !qualities.includes(job.quality) || !text(job.source_version,1024) || !(job.error===null || text(job.error,2048)) || job.id!==undefined && !text(job.id,80))throw Error('The native proxy job status is invalid');
    seen.add(job.media_id);return {id:job.id,media_id:job.media_id,state:job.state,progress:job.progress,total:job.total,error:job.error,quality:job.quality,source_version:job.source_version};
  });
  if(value.suspended!==undefined && typeof value.suspended!=='boolean')throw Error('The proxy suspension status is invalid');
  const legacy=value.cache===undefined,cache=legacy?{available:true,error:null}:value.cache;
  if(!cache || typeof cache!=='object' || Array.isArray(cache) || Object.keys(cache).length!==2 || typeof cache.available!=='boolean' || !Object.hasOwn(cache,'error') || (cache.available?cache.error!==null:!cache.error || typeof cache.error!=='object' || Array.isArray(cache.error) || Object.keys(cache.error).length!==2 || !text(cache.error.code,80) || !text(cache.error.message,2048)))throw Error('The native proxy cache status is invalid');
  const capacity=value.capacity;
  if(!legacy && (cache.available?!capacity:capacity!==null))throw Error('The proxy cache capacity does not match its availability');
  if(capacity && (!['max_jobs','max_bytes','max_job_bytes','charged_bytes','used_jobs'].every(key=>Number.isSafeInteger(capacity[key]) && capacity[key]>=0) || capacity.used_jobs>capacity.max_jobs || capacity.charged_bytes>capacity.max_bytes))throw Error('The proxy queue capacity is invalid');
  return {project_epoch:epoch,settings:{enabled:settings.enabled,quality:settings.quality,paused:settings.paused},jobs:cache.available?jobs:jobs.filter(job=>job.state!=='ready'),capacity:capacity?{...capacity}:null,cache:{available:cache.available,error:cache.error?{code:cache.error.code,message:cache.error.message}:null},suspended:value.suspended===true};
}

export function createProxyControls({root,getContext,canWrite,api=apiRequest,onChange=()=>{},onPrepare,notice=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,canObserve=()=>!globalThis.document?.hidden && !globalThis.document?.querySelector?.('dialog[open]')}){
  const ownerDocument=root.ownerDocument || document;
  let disposed=false,shown=true,epoch=null,catalog=null,reader=null,writer=null,preparing=null,timer=null,sequence=0,failure=null;
  const enabledLabel=document.createElement('label');enabledLabel.className='proxy-setting';const enabled=document.createElement('input');enabled.type='checkbox';enabled.setAttribute('aria-label','Use proxies');enabledLabel.append(enabled,document.createTextNode('Use proxies'));
  const qualityLabel=document.createElement('label');qualityLabel.className='proxy-setting';qualityLabel.textContent='Proxy quality';const quality=document.createElement('select');quality.setAttribute('aria-label','Proxy quality');for(const [value,label]of [['low','Low · 640 px'],['medium','Medium · 960 px'],['high','High · 1920 px']])quality.append(new Option(label,value));qualityLabel.append(quality);
  const pause=document.createElement('button');pause.type='button';const refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.textContent='Refresh proxy status';
  const generate=document.createElement('button');generate.type='button';generate.textContent='Generate missing proxies';generate.hidden=typeof onPrepare!=='function';
  const status=document.createElement('p');status.className='proxy-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const jobsDetails=document.createElement('details'),summary=document.createElement('summary'),jobsList=document.createElement('ul');jobsDetails.className='proxy-jobs';jobsList.setAttribute('aria-label','Native proxy jobs');jobsDetails.append(summary,jobsList);
  const explanation=document.createElement('details'),explanationTitle=document.createElement('summary'),note=document.createElement('p');explanationTitle.textContent='About proxies';note.textContent='Proxy quality is shared by Source and Program. Export always uses original media.';explanation.append(explanationTitle,note);
  root.classList.add('proxy-controls');root.append(enabledLabel,qualityLabel,pause,generate,refreshButton,status,jobsDetails,explanation);
  const contextEpoch=()=>{const value=getContext()?.project_epoch;return text(value)?value:null;};
  const current=bound=>!disposed && root.isConnected!==false && text(bound) && contextEpoch()===bound;
  const observable=()=>shown && current(epoch) && canObserve();
  const clearPoll=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  const stopRead=()=>{sequence++;reader?.controller.abort();reader=null;clearPoll();};
  const jobLabel=job=>{
    const state=activeStates.has(job.state) && catalog?.settings.paused?'Paused':activeStates.has(job.state) && catalog?.suspended?'Suspended':job.state==='generating'?'Generating':job.state[0].toUpperCase()+job.state.slice(1);
    return `${catalog?.cache.available===false?'Cache unavailable · ':''}${state}${activeStates.has(job.state)?` · ${job.progress}/${job.total} frames`:''}${job.error?` · ${job.error}`:''}${failure?' · last known status':''}`;
  };
  function render(){
    if(disposed)return;
    const live=current(epoch),settings=live?catalog?.settings:null,busy=Boolean(writer || preparing);
    enabled.checked=settings?.enabled===true;quality.value=settings?.quality || 'medium';enabled.disabled=quality.disabled=pause.disabled=!settings || !canWrite() || busy || !shown || !canObserve() || Boolean(failure);
    pause.textContent=settings?.paused?'Resume proxy generation':'Pause proxy generation';pause.setAttribute('aria-pressed',String(settings?.paused===true));refreshButton.disabled=!contextEpoch() || busy || Boolean(reader);
    generate.disabled=enabled.disabled || !settings?.enabled || catalog?.cache.available===false || Boolean(reader) || typeof onPrepare!=='function';
    const jobs=live?catalog?.jobs || []:[],names=new Map((getContext()?.media || []).map(item=>[item.id,item.name]));
    summary.textContent=`Proxy jobs · ${jobs.length}`;jobsList.replaceChildren(...jobs.map(job=>{const row=document.createElement('li');row.textContent=`${names.get(job.media_id) || job.media_id} · ${jobLabel(job)}`;return row;}));
    const warning=live && catalog?.cache.available===false?` · Proxy cache unavailable · ${catalog.cache.error.code}: ${catalog.cache.error.message}`:'';
    status.textContent=failure || (preparing?'Queuing proxy generation…':writer?'Saving proxy settings…':reader?'Reading proxy status…':!settings?'Read proxy settings for this project':`${settings.enabled?'Proxies enabled':'Proxies disabled'}${settings.paused?' · generation paused':''}${catalog.suspended?' · background generation suspended':''}${catalog.cache.available?` · ${jobs.filter(job=>job.state==='ready').length} ready`:''} · ${jobs.filter(job=>job.state==='failed').length} failed`)+warning;
  }
  const publish=next=>{const preferencesChanged=!catalog || ['enabled','quality','paused'].some(key=>catalog.settings[key]!==next.settings[key]);catalog=next;failure=null;render();onChange({...next.settings},{project_epoch:next.project_epoch,jobs:next.jobs.map(job=>({...job})),capacity:next.capacity?{...next.capacity}:null,cache:{available:next.cache.available,error:next.cache.error?{...next.cache.error}:null},suspended:next.suspended,preferencesChanged});};
  function schedule(){clearPoll();if(observable() && !reader && !writer && !preparing && !failure && catalog?.cache.available && catalog.jobs.some(job=>activeStates.has(job.state)))timer=setTimer(()=>{timer=null;void refresh();},1000);}
  function refresh(){
    if(disposed)return Promise.resolve(null);
    const nextEpoch=contextEpoch();
    if(nextEpoch!==epoch){stopRead();epoch=nextEpoch;catalog=null;failure=null;}
    if(!observable()){stopRead();render();return Promise.resolve(null);}
    if(writer)return writer.promise;
    if(reader)return reader.promise;
    clearPoll();const ticket={epoch,sequence:++sequence,controller:new AbortController(),promise:null};reader=ticket;render();
    ticket.promise=(async()=>{
      try{const value=await api(`/media/proxies?${new URLSearchParams({project_epoch:ticket.epoch})}`,undefined,{signal:ticket.controller.signal});if(reader!==ticket || ticket.controller.signal.aborted || ticket.sequence!==sequence || !current(ticket.epoch) || !observable())return null;const next=checkedProxyCatalog(value,ticket.epoch);publish(next);return next;}
      catch(error){if(reader===ticket && !ticket.controller.signal.aborted && current(ticket.epoch)){failure=error.message;render();notice(error.message);}return null;}
      finally{if(reader===ticket){reader=null;render();schedule();}}
    })();return ticket.promise;
  }
  async function configure(patch){
    if(disposed || writer || preparing || failure || !shown || !canObserve() || !catalog || !current(epoch) || !canWrite()){render();return null;}
    const settings={...catalog.settings,...patch};if(!qualities.includes(settings.quality))return null;
    stopRead();failure=null;const ticket={epoch,promise:null};writer=ticket;render();
    ticket.promise=(async()=>{
      try{if(!current(ticket.epoch) || !canWrite())return null;const value=await api('/media/proxies',{project_epoch:ticket.epoch,...settings},{method:'PUT'});if(writer!==ticket || !current(ticket.epoch))return null;const next=checkedProxyCatalog(value,ticket.epoch);publish(next);return next;}
      catch(error){if(writer===ticket && current(ticket.epoch)){failure=`Proxy settings were not confirmed: ${error.message}. Refresh before repeating the change.`;render();notice(failure);}return null;}
      finally{if(writer===ticket){writer=null;render();if(contextEpoch()!==ticket.epoch && shown)void refresh();else schedule();}}
    })();return ticket.promise;
  }
  async function prepare(){
    if(disposed || writer || reader || preparing || failure || !shown || !canObserve() || !catalog?.settings.enabled || !catalog.cache.available || !current(epoch) || !canWrite() || typeof onPrepare!=='function')return;
    const ticket={epoch,quality:catalog.settings.quality};preparing=ticket;clearPoll();render();
    try{await onPrepare({project_epoch:ticket.epoch,settings:{...catalog.settings}},()=>current(ticket.epoch) && canWrite() && catalog?.cache.available===true && catalog.settings.quality===ticket.quality);}
    catch(error){if(preparing===ticket && current(ticket.epoch)){failure=error.message;render();notice(error.message);}}
    finally{if(preparing===ticket){preparing=null;render();if(!failure && shown)void refresh();}}
  }
  enabled.addEventListener('change',()=>{void configure({enabled:enabled.checked});});quality.addEventListener('change',()=>{void configure({quality:quality.value});});pause.addEventListener('click',()=>{void configure({paused:!catalog?.settings.paused});});refreshButton.addEventListener('click',()=>{void refresh();});
  generate.addEventListener('click',()=>{void prepare();});
  const visibility=()=>{if(!canObserve()){stopRead();render();}else if(shown)void refresh();};ownerDocument.addEventListener?.('visibilitychange',visibility);
  render();
  return {refresh,visible(value){shown=Boolean(value);if(!shown){stopRead();render();return Promise.resolve(null);}return refresh();},statusFor(mediaId){if(!current(epoch) || catalog?.cache.available===false)return null;const job=catalog?.jobs.find(job=>job.media_id===mediaId && job.quality===catalog.settings.quality);return job?{...job,label:jobLabel(job),stale:Boolean(failure)}:null;},settings:()=>current(epoch) && catalog?{...catalog.settings}:null,dispose(){if(disposed)return;stopRead();disposed=true;ownerDocument.removeEventListener?.('visibilitychange',visibility);for(const node of [enabled,quality,pause,generate,refreshButton])node.disabled=true;catalog=null;}};
}
