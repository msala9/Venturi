const f=Math.fround,clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const nativeRound=value=>f(Math.sign(value)*Math.round(Math.abs(value)));
const tenth=value=>f(nativeRound(f(value*10))/10);
export function audioFrequencyPosition(value,range){return f(f(Math.log(f(value/range[0])))/f(Math.log(f(range[1]/range[0]))));}
export function audioFrequencyAt(position,range){return f(range[0]*f(f(range[1]/range[0])**f(clamp(position,0,1))));}
export function audioGraphHandles(kind,parameters,metadata){
  const x=value=>audioFrequencyPosition(value,metadata.frequency_hz),y=value=>f(f(metadata.display_db[1]-value)/f(metadata.display_db[1]-metadata.display_db[0]));
  if(kind==='Equalizer')return parameters.bands.map((band,index)=>({kind:'eq',index,x:x(band.freq_hz),y:y(metadata.shape_has_gain[band.shape]?band.gain_db:0),enabled:band.enabled,label:`EQ band ${index+1}: ${band.freq_hz} Hz, ${metadata.shape_has_gain[band.shape]?band.gain_db:0} dB, Q ${band.q}${band.enabled?'':' · off'}`}));
  const edges=[metadata.frequency_hz[0],...parameters.crossovers_hz,metadata.frequency_hz[1]];
  return [...parameters.crossovers_hz.map((hz,index)=>{const blocked=index===0?f(parameters.crossovers_hz[1]/f(metadata.min_crossover_ratio))<metadata.frequency_hz[0]:f(parameters.crossovers_hz[0]*f(metadata.min_crossover_ratio))>metadata.frequency_hz[1];return {kind:'crossover',index,x:x(hz),y:0,blocked,label:`Crossover ${index+1}: ${hz} Hz${blocked?' · adjust the other crossover first':''}`};}),...parameters.bands.map((band,index)=>({kind:'makeup',index,x:x(f(Math.sqrt(f(edges[index]*edges[index+1])))),y:y(band.makeup_db),label:`${['Low','Mid','High'][index]} band makeup: ${band.makeup_db} dB`}))];
}
export function audioGraphDraft(kind,parameters,handle,point,metadata,catalog){
  const next=structuredClone(parameters),freq=audioFrequencyAt(point[0],metadata.frequency_hz),db=f(metadata.display_db[1]-f(f(point[1])*f(metadata.display_db[1]-metadata.display_db[0])));
  if(handle.kind==='eq'){
    const band=next.bands[handle.index];band.freq_hz=nativeRound(clamp(freq,...catalog.freq_hz));
    if(metadata.shape_has_gain[band.shape])band.gain_db=tenth(clamp(db,...catalog.gain_db));band.enabled=true;
  }else if(handle.kind==='crossover'){
    const [low,high]=next.crossovers_hz,ratio=f(metadata.min_crossover_ratio),range=handle.index===0?[metadata.frequency_hz[0],f(high/ratio)]:[f(low*ratio),metadata.frequency_hz[1]];
    if(range[0]>range[1])return next;
    next.crossovers_hz[handle.index]=nativeRound(clamp(freq,...range));
  }else next.bands[handle.index].makeup_db=tenth(clamp(db,...catalog.makeup_db));
  return next;
}
export function audioGraphWheel(parameters,index,direction,metadata,catalog){
  const next=structuredClone(parameters),band=next.bands[index];
  band.q=f(nativeRound(f(clamp(f(band.q*f(f(metadata.q_wheel_factor)**direction)),...catalog.q)*100))/100);band.enabled=true;return next;
}
function graphMetadata(value,kind){
  const range=value=>Array.isArray(value) && value.length===2 && value.every(Number.isFinite) && value[1]>value[0];
  return value && range(value.frequency_hz) && value.frequency_hz[0]>0 && range(value.display_db) && (kind==='Equalizer'?value.shape_has_gain && Number.isFinite(value.q_wheel_factor):value.min_crossover_ratio>1);
}
const compressorIdentity=value=>{
  const keys=['threshold_db','ratio','attack_ms','release_ms','makeup_db'];
  if(!Array.isArray(value?.crossovers_hz) || value.crossovers_hz.length!==2 || !value.crossovers_hz.every(Number.isFinite) || !Array.isArray(value.bands) || value.bands.length!==3 || !value.bands.every(band=>band && keys.every(key=>Number.isFinite(band[key]))))return null;
  return JSON.stringify([value.crossovers_hz,value.bands.map(band=>keys.map(key=>band[key]))]);
};
export function compressorActivitySample(result,{channel,index,parameters}){
  const insert=result?.insert,activity=insert?.sample_activity ?? insert,vector=value=>Array.isArray(value) && value.length===3 && value.every(Number.isFinite);
  if(!compressorIdentity(parameters) || !result?.telemetry || result.sample_rate!==48000 || !Number.isSafeInteger(result.end_sample) || result.end_sample<0 || insert?.kind!=='MultibandCompressor' || insert.channel!==channel || insert.index!==index || !vector(activity?.band_level) || activity.band_level.some(value=>value<0) || !vector(activity.reduction_db) || activity.reduction_db.some(value=>value<0) || !Array.isArray(result.spectrum_hz) || result.spectrum_hz.length!==128 || result.spectrum_hz.some(value=>!Number.isFinite(value)) || ['before_db','after_db'].some(key=>!Array.isArray(insert[key]) || insert[key].length!==128 || insert[key].some(value=>!Number.isFinite(value))))return null;
  const response=insert.response;
  if(response && (response.sample_rate!==48000 || response.response_kind!=='native_activity' || compressorIdentity(response.parameters)!==compressorIdentity(parameters) || !Array.isArray(response.points) || response.points.length!==241 || response.points.some((point,i)=>!Array.isArray(point) || point.length!==3 || !point.every(Number.isFinite) || point[0]<20 || point[0]>20000 || i>0 && point[0]<=response.points[i-1][0])))return null;
  return {parameters:structuredClone(parameters),response,band_level:[...activity.band_level],reduction_db:[...activity.reduction_db],spectrum_hz:result.spectrum_hz,before_db:insert.before_db,after_db:insert.after_db,end_sample:result.end_sample,frozen:result.frozen===true,inactive:insert.inactive===true,error:insert.response_error || ''};
}
export function createAudioGraph({root,kind,label,getParameters,getEnabled=()=>null,defaults,catalog,canInteract,isCurrent=()=>true,isValid=()=>true,getContext=()=>null,onCommit,onDraft=()=>{},readResponse,notice=()=>{},windowRef=globalThis.window,documentRef=globalThis.document}){
  const metadata=catalog.graph,host=documentRef.createElement('div');host.className='audio-graph';root.append(host);
  const status=documentRef.createElement('p');status.className='audio-graph-status';status.setAttribute('role','status');
  if(!graphMetadata(metadata,kind)){status.textContent='Native graph metadata unavailable · use the numeric controls';host.append(status);return {sync(){},cancel(){},refresh(){},resetBand(){},setActivity(){},dispose(){}};}
  const stage=documentRef.createElement('div');stage.className='audio-graph-stage';host.append(stage,status);
  const svgElement=name=>documentRef.createElementNS?.('http://www.w3.org/2000/svg',name) ?? documentRef.createElement(name);
  const svg=svgElement('svg');svg.setAttribute('viewBox','0 0 480 230');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');stage.append(svg);
  const grid=svgElement('path');grid.classList?.add('audio-graph-grid');let gridPath='';
  const axisText=(text,x,y,anchor='end')=>{const node=svgElement('text');node.setAttribute('class','audio-graph-axis');node.setAttribute('x',String(x));node.setAttribute('y',String(y));node.setAttribute('text-anchor',anchor);node.textContent=text;svg.append(node);};
  for(let db=Math.ceil(metadata.display_db[0]/6)*6;db<=metadata.display_db[1];db+=6){const y=(metadata.display_db[1]-db)/(metadata.display_db[1]-metadata.display_db[0])*230;gridPath+=`M0 ${y}H480 `;if(y>=12 && y<=220)axisText(`${db} dB`,476,y-2);}
  for(const hz of [100,1000,10000]){const x=audioFrequencyPosition(hz,metadata.frequency_hz)*480;gridPath+=`M${x} 0V230 `;axisText(hz>=1000?`${hz/1000}k`:String(hz),x-3,226);}
  grid.setAttribute('d',gridPath);svg.append(grid);const curve=svgElement('polyline');curve.classList?.add('audio-graph-response');svg.append(curve);
  const activityLines=kind==='MultibandCompressor'?['pre','post','active'].map(name=>{const line=svgElement('polyline');line.setAttribute('class',`audio-graph-${name}`);line.setAttribute('fill','none');line.setAttribute('stroke',name==='pre'?'var(--violet)':name==='post'?'var(--success)':'var(--primary)');line.setAttribute('stroke-width',name==='active'?'2':'1');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);return line;}):[];
  const toolbar=documentRef.createElement('div');toolbar.className='audio-graph-tools';const reset=documentRef.createElement('button');reset.type='button';reset.textContent='Reset all';reset.setAttribute('aria-label',`Reset ${label} parameters`);toolbar.append(reset);host.append(toolbar);
  const help=documentRef.createElement('p');help.className='audio-graph-help';help.textContent=kind==='Equalizer'?'Drag a band for Hz/gain; wheel or Page Up/Down changes Q. Double-click or Enter toggles a band. Arrow keys adjust Hz/gain.':'Drag crossovers and makeup nodes; arrows adjust Hz/0.1 dB. Amber: committed makeup. Prepared audio adds native active response and pre/post spectra.';host.append(help);
  let parameters=structuredClone(getParameters()),committed=structuredClone(parameters),committedEnabled=getEnabled(),gesture=null,waiting=false,disposed=false,readSequence=0,response=null,responseParameters=null,responseError='',activity=null,activityError='',activityContext=null;
  const listeners=[],buttons=[];
  const listen=(target,type,callback,options)=>{target?.addEventListener?.(type,callback,options);listeners.push(()=>target?.removeEventListener?.(type,callback,options));};
  const live=()=>!disposed && !waiting && host.isConnected!==false && isCurrent() && canInteract();
  const rectKey=rect=>JSON.stringify([rect.left,rect.top,rect.width,rect.height]);
  function paint(){
    const handles=audioGraphHandles(kind,parameters,metadata);
    for(const [index,handle] of handles.entries()){
      const button=buttons[index];if(!button)continue;button.style?.setProperty('left',`${clamp(handle.x,0,1)*100}%`);button.style?.setProperty('top',`${clamp(handle.y,0,1)*100}%`);button.setAttribute('aria-label',`${label} ${handle.label}`);button.title=handle.label;button.disabled=!live() || Boolean(handle.blocked);button.setAttribute('aria-pressed',String(handle.enabled!==false));
    }
    reset.disabled=!live();const dirty=!same(parameters,committed) || getEnabled()!==committedEnabled;
    if(activity && (disposed || !isCurrent() || activityContext!==getContext() || documentRef?.hidden || gesture || waiting || dirty || compressorIdentity(activity.parameters)!==compressorIdentity(getParameters())))activity=null;
    if(activityLines.length){
      const x=hz=>audioFrequencyPosition(hz,metadata.frequency_hz)*480;
      for(const [i,key] of ['before_db','after_db'].entries())activityLines[i].setAttribute('points',activity?activity.spectrum_hz.map((hz,index)=>[hz,activity[key][index]]).filter(([hz])=>hz>=20 && hz<=20000).map(([hz,db])=>`${x(hz)},${-clamp(db,-96,0)/96*230}`).join(' '):'');
      activityLines[2].setAttribute('points',activity?.response?activity.response.points.map(([hz,,db])=>`${x(hz)},${(metadata.display_db[1]-clamp(db,...metadata.display_db))/(metadata.display_db[1]-metadata.display_db[0])*230}`).join(' '):'');
    }
    const activityText=activity?`${activity.frozen?'Frozen prepared sample':'Prepared audio sample'} ${activity.end_sample}${activity.inactive?' · insert inactive':''} · native pre/post spectra${activity.response?' · native activity response':` · ${activity.error || 'Activity response unavailable'}`}`:`makeup only · ${activityError || 'no current activity sample'}`;
    status.textContent=`${dirty?'Local parameter draft · ':''}${response?(same(responseParameters,committed)?'Committed native response':'Previous committed response · refresh required'):'Native response unavailable'}${response?.enabled===false?' · insert bypassed':''}${kind==='MultibandCompressor'?` · ${activityText}`:''}${waiting?' · applying…':''}${responseError?` · ${responseError}`:''}`;
  }
  function release(owner){try{if(owner.button.hasPointerCapture?.(owner.id))owner.button.releasePointerCapture(owner.id);}catch{}}
  function cancel(){if(!gesture)return;const owner=gesture;gesture=null;parameters=owner.before;release(owner);paint();}
  function sync(){cancel();if(!disposed){parameters=structuredClone(getParameters());paint();}}
  const valid=owner=>live() && owner.context===getContext() && same(owner.source,getParameters()) && owner.rect===rectKey(stage.getBoundingClientRect());
  async function refresh(){
    const sequence=++readSequence,context=getContext(),nativeParameters=structuredClone(committed);if(disposed || !isCurrent())return;responseError='';
    try{
      const next=await readResponse();if(disposed || sequence!==readSequence || context!==getContext() || !isCurrent())return;
      if(!Array.isArray(next.points) || next.points.length<2 || next.points.length>512 || next.points.some(point=>!Array.isArray(point) || point.length!==2 || !point.every(Number.isFinite) || point[0]<metadata.frequency_hz[0] || point[0]>metadata.frequency_hz[1]))throw Error('Invalid native response');
      if(kind==='MultibandCompressor' && (next.response_kind!=='makeup_only' || next.activity!==null))throw Error('Unexpected native compressor response');
      response=next;responseParameters=nativeParameters;curve.setAttribute('points',next.points.map(([hz,db])=>`${audioFrequencyPosition(hz,metadata.frequency_hz)*480},${(metadata.display_db[1]-clamp(db,...metadata.display_db))/(metadata.display_db[1]-metadata.display_db[0])*230}`).join(' '));paint();
    }catch(error){if(!disposed && sequence===readSequence && context===getContext() && isCurrent()){responseError=error.message;paint();}}
  }
  async function commit(next,before,context){
    if(same(next,before)){parameters=before;paint();return;}
    if(!live() || context!==getContext() || !isValid()){sync();return;}
    waiting=true;parameters=next;onDraft();host.setAttribute('aria-busy','true');paint();
    try{await onCommit(structuredClone(next));committed=structuredClone(next);committedEnabled=getEnabled();if(!disposed){parameters=structuredClone(getParameters());waiting=false;paint();await refresh();}}
    catch(error){notice(error.message);if(!disposed)parameters=structuredClone(getParameters());}
    finally{waiting=false;if(!disposed){host.setAttribute('aria-busy','false');paint();}}
  }
  const point=event=>{const rect=stage.getBoundingClientRect();return [f((event.clientX-rect.left)/rect.width),f((event.clientY-rect.top)/rect.height)];};
  function move(event,releaseEvent=false){
    const owner=gesture;if(!owner || event.pointerId!==owner.id)return;
    if(!valid(owner) || (!releaseEvent && event.buttons!==undefined && !(event.buttons&1))){cancel();return;}
    if(!owner.moved && event.clientX===owner.x && event.clientY===owner.y)return;
    owner.moved=true;parameters=audioGraphDraft(kind,owner.before,owner.handle,point(event),metadata,catalog);onDraft();paint();
  }
  const handles=audioGraphHandles(kind,parameters,metadata);
  for(const [index,handle] of handles.entries()){
    const button=documentRef.createElement('button');button.type='button';button.className=`audio-graph-handle audio-graph-${handle.kind}`;button.dataset.audioGraphHandle=handle.kind;button.textContent=handle.kind==='eq'?String(handle.index+1):handle.kind==='makeup'?['L','M','H'][handle.index]:'';buttons.push(button);stage.append(button);
    listen(button,'pointerdown',event=>{
      if(button.disabled || event.button!==0 || event.isPrimary===false || gesture || !live() || !isValid())return;
      const rect=stage.getBoundingClientRect();if(!(rect.width>0 && rect.height>0))return;
      event.preventDefault();button.focus();parameters=structuredClone(getParameters());
      gesture={id:event.pointerId,button,handle:audioGraphHandles(kind,parameters,metadata)[index],before:structuredClone(parameters),source:structuredClone(getParameters()),context:getContext(),rect:rectKey(rect),x:event.clientX,y:event.clientY,moved:false};
      try{button.setPointerCapture(event.pointerId);}catch{cancel();}
    });
    listen(button,'pointermove',move);
    listen(button,'pointerup',event=>{if(!gesture || gesture.button!==button || gesture.id!==event.pointerId || event.button!==0)return;move(event,true);if(!gesture)return;const owner=gesture;gesture=null;release(owner);void commit(parameters,owner.before,owner.context);});
    for(const type of ['pointercancel','lostpointercapture'])listen(button,type,event=>{if(gesture?.id===event.pointerId && gesture.button===button)cancel();});
    listen(button,'blur',cancel);
    const toggle=()=>{if(handle.kind!=='eq' || !live())return;cancel();const before=structuredClone(getParameters()),next=structuredClone(before);next.bands[handle.index].enabled=!next.bands[handle.index].enabled;void commit(next,before,getContext());};
    listen(button,'dblclick',event=>{event.preventDefault();toggle();});
    listen(button,'wheel',event=>{if(handle.kind!=='eq' || !event.deltaY || !live() || gesture)return;event.preventDefault();event.stopPropagation();const before=structuredClone(getParameters());void commit(audioGraphWheel(before,handle.index,-Math.sign(event.deltaY),metadata,catalog),before,getContext());},{passive:false});
    listen(button,'keydown',event=>{
      if(!['Escape','Enter',' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();if(event.key==='Escape'){cancel();return;}if(button.disabled || !live() || gesture)return;
      if(event.key==='Enter' || event.key===' '){toggle();return;}
      const before=structuredClone(getParameters()),next=structuredClone(before),index=handle.index,direction=['ArrowRight','ArrowUp','PageUp'].includes(event.key)?1:-1;
      if(handle.kind==='eq'){
        const band=next.bands[index];
        if(event.key.startsWith('Page'))return void commit(audioGraphWheel(before,index,direction,metadata,catalog),before,getContext());
        if(['ArrowLeft','ArrowRight'].includes(event.key))band.freq_hz=nativeRound(clamp(band.freq_hz+direction,...catalog.freq_hz));
        else if(metadata.shape_has_gain[band.shape])band.gain_db=tenth(clamp(f(band.gain_db+f(direction*.1)),...catalog.gain_db));else return;
        band.enabled=true;
      }else if(handle.kind==='crossover'){
        if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
        const desired=audioFrequencyPosition(next.crossovers_hz[index]+direction,metadata.frequency_hz);return void commit(audioGraphDraft(kind,before,handle,[desired,0],metadata,catalog),before,getContext());
      }else{if(!['ArrowUp','ArrowDown'].includes(event.key))return;next.bands[index].makeup_db=tenth(clamp(f(next.bands[index].makeup_db+f(direction*.1)),...catalog.makeup_db));}
      void commit(next,before,getContext());
    });
  }
  function resetBand(index){if(kind!=='Equalizer' || !live())return;cancel();const before=structuredClone(getParameters()),next=structuredClone(before);next.bands[index]=structuredClone(defaults.bands[index]);void commit(next,before,getContext());}
  listen(reset,'click',()=>{if(!live())return;cancel();void commit(structuredClone(defaults),structuredClone(getParameters()),getContext());});
  listen(windowRef,'blur',cancel);listen(windowRef,'resize',cancel);listen(windowRef,'scroll',cancel,true);listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  paint();void refresh();
  return {sync,cancel,refresh,resetBand,setActivity(value,message=''){if(disposed)return;activity=value;activityContext=getContext();activityError=message;paint();},dispose(){cancel();disposed=true;activity=null;readSequence++;paint();for(const remove of listeners)remove();}};
}
