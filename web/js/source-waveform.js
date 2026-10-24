import {sourceAssetKey,nativeSourceIdentity} from './source-assets.js';

const GAP=6,MIN_LANE=44,MAX_STREAMS=128,MAX_PIXELS=16*1024*1024/4;
const integer=value=>Number.isSafeInteger(value) && value>=0;

export function sourceWaveformLayout(count,width,height,scrollTop=0){
  if(!Number.isInteger(count) || count<1 || count>MAX_STREAMS || !Number.isFinite(width) || width<=0 || !Number.isFinite(height) || height<=0)return null;
  const contentHeight=Math.max(height,count*MIN_LANE+(count-1)*GAP),laneHeight=(contentHeight-(count-1)*GAP)/count;
  const scroll=Math.max(0,Math.min(contentHeight-height,Number.isFinite(scrollTop)?scrollTop:0)),lanes=[];
  for(let index=0;index<count;index++){
    const top=index*(laneHeight+GAP)-scroll;
    if(top<height && top+laneHeight>0)lanes.push({index,top,height:laneHeight});
  }
  return {width,height,contentHeight,laneHeight,scroll,lanes};
}

export function sourceWaveformFrameAt(x,left,width,total){
  if(!integer(total) || total<1 || !Number.isFinite(x) || !Number.isFinite(left) || !Number.isFinite(width) || width<=0)return null;
  const fraction=Math.max(0,Math.min(1,Math.fround(Math.fround(x-left)/Math.fround(Math.max(width,1)))));
  return Math.min(total-1,Math.floor(Math.fround(fraction*Math.fround(total))));
}

export function sourceWaveformPeak(waveform,total,fps,column,width){
  const fraction=Math.fround(Math.fround(column)/Math.fround(width));
  const seconds=fraction*(total*fps.den/fps.num);
  const bin=Math.min(waveform.peaks.length-1,Math.max(0,Math.floor(seconds/waveform.duration_seconds*waveform.peaks.length)));
  return waveform.peaks[bin];
}

function contextValue(value){
  const item=value?.item,count=item?.audio_stream_count ?? 1;
  if(!item || item.has_video!==false || item.has_audio!==true || item.compound_timeline_id || typeof item.id!=='string' || !item.id || !integer(item.duration_frames) || item.duration_frames<1 || !Number.isSafeInteger(item.fps?.num) || item.fps.num<=0 || !Number.isSafeInteger(item.fps?.den) || item.fps.den<=0 || !integer(count) || count>MAX_STREAMS || typeof value.epoch!=='string' || !value.epoch || !integer(value.frame))return null;
  const sourceVersion=typeof value.sourceVersion==='string' && value.sourceVersion.length>0 && value.sourceVersion.length<=512?value.sourceVersion:null;
  const nativeIdentity=nativeSourceIdentity(item);
  if(item.native_asset && (!nativeIdentity || item.native_asset.source_version!==sourceVersion))return null;
  const identity=JSON.stringify([value.epoch,item.id,item.content_hash,item.duration_frames,item.fps.num,item.fps.den,Math.max(1,count),sourceVersion,nativeIdentity]);
  const marks=integer(value.marks?.source_in) && integer(value.marks?.source_out) && value.marks.source_out>value.marks.source_in && value.marks.source_out<=item.duration_frames?value.marks:{source_in:0,source_out:item.duration_frames};
  return {...value,marks,sourceVersion,count:Math.max(1,count),identity};
}

export function createSourceWaveform({root,canvas,content,getContext,getAssets,onDemand=()=>{},onSeek=()=>{},onError=()=>{},requestFrame,cancelFrame,resizeObserver,devicePixelRatio}={}){
  const document=root.ownerDocument,window=document.defaultView;
  requestFrame ??= callback=>window.requestAnimationFrame(callback);
  cancelFrame ??= id=>window.cancelAnimationFrame(id);
  resizeObserver ??= window.ResizeObserver;
  devicePixelRatio ??= ()=>window.devicePixelRatio || 1;
  let disposed=false,raf=null,pending=null,verifiedIdentity=null,demandKey=null,demandEpoch=null,identity=null;
  const listeners=[];
  const listen=(node,type,callback,options)=>{node.addEventListener(type,callback,options);listeners.push(()=>node.removeEventListener(type,callback,options));};
  root.tabIndex=0;root.setAttribute('role','group');root.setAttribute('aria-label','Source audio waveform');
  canvas.setAttribute('aria-hidden','true');canvas.style.position='sticky';canvas.style.top='0px';canvas.style.display='block';
  function visible(){return root.isConnected!==false && !document.hidden && !document.querySelector('dialog[open]');}
  function geometry(){const rect=root.getBoundingClientRect();return {left:rect.left,top:rect.top,width:root.clientWidth ?? rect.width,height:root.clientHeight ?? rect.height,boundsWidth:rect.width,boundsHeight:rect.height,scroll:root.scrollTop || 0};}
  function stamp(value=contextValue(getContext())){
    if(!value)return null;
    return JSON.stringify([value.identity,value.marks.source_in,value.marks.source_out,Boolean(value.preparing),value.verified===true,geometry()]);
  }
  function cancelInput(){pending=null;}
  function publish(entries,epoch){
    const key=JSON.stringify([epoch,entries.map(entry=>[entry.item.id,entry.item.content_hash,entry.audioStreamIndex,entry.sourceVersion])]);
    if(key===demandKey)return;
    demandKey=key;demandEpoch=epoch;onDemand(entries,epoch);
  }
  function clear(){
    cancelInput();verifiedIdentity=null;identity=null;root.hidden=true;root.setAttribute('aria-busy','false');root.dataset.state='empty';root.dataset.loadedStreams='0';root.dataset.visibleStreams='0';content.style.height='0px';canvas.width=1;canvas.height=1;publish([],demandEpoch);
  }
  function schedule(){if(!disposed && raf===null)raf=requestFrame(()=>{raf=null;paint();});}
  function refresh(){
    if(disposed)return;
    const value=contextValue(getContext());
    if(pending && (!visible() || pending.stamp!==stamp(value)))cancelInput();
    if(!value){if(raf!==null){cancelFrame(raf);raf=null;}clear();return;}
    root.hidden=false;root.setAttribute('aria-busy',String(value.preparing===true || value.verified!==true));
    if(identity!==value.identity)publish([],value.epoch);
    if(!visible()){if(raf!==null){cancelFrame(raf);raf=null;}publish([],value.epoch);return;}
    schedule();
  }
  function paint(){
    if(disposed)return;
    const value=contextValue(getContext());if(!value){clear();return;}
    if(identity!==value.identity){identity=value.identity;verifiedIdentity=null;cancelInput();}
    const isVisible=visible(),area=geometry(),layout=sourceWaveformLayout(value.count,area.width,area.height,area.scroll);
    if(value.verified===true && value.sourceVersion)verifiedIdentity=value.identity;
    const verified=Boolean(value.sourceVersion && value.identity===verifiedIdentity && (value.verified===true || value.preparing===true));
    root.hidden=false;root.dataset.state=value.preparing?'preparing':verified?'ready':'unverified';root.setAttribute('aria-busy',String(value.preparing===true || !verified));
    if(!layout || !isVisible){cancelInput();publish([],value.epoch);return;}
    content.style.height=`${layout.contentHeight}px`;
    const entries=verified && value.verified===true && !value.preparing?layout.lanes.slice(0,64).map(lane=>({item:value.item,audioStreamIndex:lane.index,includeWaveform:true,sourceVersion:value.sourceVersion})):[];
    publish(entries,value.epoch);
    const dpr=devicePixelRatio(),scale=Math.min(Number.isFinite(dpr) && dpr>0?dpr:1,Math.sqrt(MAX_PIXELS/(layout.width*layout.height)),8192/layout.width,8192/layout.height);
    const width=Math.max(1,Math.floor(layout.width*scale)),height=Math.max(1,Math.floor(layout.height*scale));
    if(canvas.width!==width || canvas.height!==height){canvas.width=1;canvas.height=1;canvas.width=width;canvas.height=height;}
    canvas.style.width=`${layout.width}px`;canvas.style.height=`${layout.height}px`;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const colors=window.getComputedStyle?.(root),background=colors?.getPropertyValue('--bg').trim() || '#191919',head=colors?.getPropertyValue('--primary').trim() || '#dc7029';
    ctx.setTransform(width/layout.width,0,0,height/layout.height,0,0);ctx.clearRect(0,0,layout.width,layout.height);ctx.fillStyle=background;ctx.fillRect(0,0,layout.width,layout.height);
    const assets=getAssets(),total=value.item.duration_frames;
    ctx.lineWidth=1;ctx.font='11px "Segoe UI", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    let loaded=0;
    for(const lane of layout.lanes){
      const asset=verified?assets?.get(sourceAssetKey(value.item.id,lane.index)):null,wave=asset?.waveform;
      const valid=asset?.mediaId===value.item.id && asset.contentHash===value.item.content_hash && asset.sourceVersion===value.sourceVersion && (!value.item.native_asset || asset.epoch===value.epoch && nativeSourceIdentity({native_asset:asset.nativeAsset})===nativeSourceIdentity(value.item)) && wave?.scope==='full_source' && Array.isArray(wave.peaks) && wave.peaks.length>0 && wave.peaks.length<=65_536 && Number.isFinite(wave.duration_seconds) && wave.duration_seconds>0;
      if(valid){
        loaded++;
        ctx.strokeStyle='rgba(255,255,255,0.54902)';ctx.beginPath();
        for(let x=0;x<layout.width;x++){
          const peak=sourceWaveformPeak(wave,total,value.item.fps,x,layout.width);
          if(!Number.isFinite(peak) || peak<0 || peak>1)continue;
          const half=Math.max(.5,lane.height/2*peak),center=lane.top+lane.height/2;
          ctx.moveTo(x,center-half);ctx.lineTo(x,center+half);
        }
        ctx.stroke();
      }else{ctx.fillStyle='rgba(255,255,255,0.6)';ctx.fillText(value.preparing?'Preparing source…':!verified?'Waiting for verified source…':`Analyzing stream ${lane.index+1}…`,layout.width/2,lane.top+lane.height/2,Math.max(1,layout.width-8));}
    }
    ctx.fillStyle='rgba(0,0,0,0.54902)';const inX=layout.width*value.marks.source_in/total,outX=layout.width*value.marks.source_out/total;
    ctx.fillRect(0,0,inX,layout.height);ctx.fillRect(outX,0,layout.width-outX,layout.height);
    const x=layout.width*Math.min(total-1,value.frame)/total;ctx.strokeStyle=head;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,layout.height);ctx.stroke();
    const analyzing=loaded<layout.lanes.length;
    root.dataset.state=value.preparing?'preparing':!verified?'unverified':analyzing?'analyzing':'ready';
    root.dataset.loadedStreams=String(loaded);root.dataset.visibleStreams=String(layout.lanes.length);root.setAttribute('aria-busy',String(Boolean(value.preparing || !verified || analyzing)));
    root.setAttribute('aria-label',`Source audio waveform · ${value.count} ${value.count===1?'stream':'streams'} · frame ${Math.min(total-1,value.frame)} of ${total}${value.preparing?' · Preparing source':analyzing?' · Analyzing visible streams':''}`);
    if(value.preparing && loaded){const width=Math.min(180,layout.width);ctx.fillStyle='rgba(0,0,0,0.8)';ctx.fillRect((layout.width-width)/2,Math.max(0,layout.height/2-11),width,22);ctx.fillStyle='white';ctx.fillText('Preparing source…',layout.width/2,layout.height/2,Math.max(1,width-8));}
    if(value.playing===true && value.verified===true && verified && !value.preparing)schedule();
  }
  function interactive(){const value=contextValue(getContext());return !disposed && !root.hidden && visible() && value?.sourceVersion && value.verified===true && !value.preparing?value:null;}
  function seek(frame){
    const owner=stamp();try{Promise.resolve(onSeek(frame)).catch(error=>{if(!disposed && owner===stamp())onError(error);});}catch(error){onError(error);}
  }
  listen(root,'pointerdown',event=>{
    cancelInput();const value=interactive(),area=geometry();
    if(!value || event.defaultPrevented || event.button!==0 || event.isPrimary===false || event.target?.closest?.('input,textarea,select,button,[contenteditable="true"]') || event.clientX<area.left || event.clientX>area.left+area.width || event.clientY<area.top || event.clientY>area.top+area.height)return;
    pending={id:event.pointerId,x:event.clientX,y:event.clientY,stamp:stamp(value)};root.focus?.({preventScroll:true});
  });
  listen(window,'pointermove',event=>{if(pending && event.pointerId===pending.id && (event.buttons===0 || Math.hypot(event.clientX-pending.x,event.clientY-pending.y)>5 || !interactive() || pending.stamp!==stamp()))cancelInput();});
  listen(window,'pointerup',event=>{
    const previous=pending;if(!previous || previous.id!==event.pointerId)return;cancelInput();
    const value=interactive(),area=geometry();
    if(!value || previous.stamp!==stamp(value) || event.button!==0 || Math.hypot(event.clientX-previous.x,event.clientY-previous.y)>5 || event.clientX<area.left || event.clientX>area.left+area.width || event.clientY<area.top || event.clientY>area.top+area.height)return;
    const frame=sourceWaveformFrameAt(event.clientX,area.left,area.width,value.item.duration_frames);if(frame!==null)seek(frame);
  });
  for(const event of ['pointercancel','lostpointercapture'])listen(window,event,cancelInput);
  for(const event of ['dragstart','dragend'])listen(root,event,cancelInput);
  listen(window,'blur',cancelInput);
  listen(root,'scroll',()=>{cancelInput();refresh();},{passive:true});
  listen(window,'resize',()=>{cancelInput();refresh();});
  for(const event of ['visibilitychange','toggle','fullscreenchange'])listen(document,event,()=>{cancelInput();refresh();},true);
  listen(root,'keydown',event=>{
    if(event.key==='Escape'){cancelInput();return;}
    if(event.target!==root && event.target!==canvas || event.defaultPrevented || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph'))return;
    const value=interactive();if(!value || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();cancelInput();const total=value.item.duration_frames;
    seek(event.key==='Home'?0:event.key==='End'?total-1:Math.max(0,Math.min(total-1,value.frame+(event.key==='ArrowLeft'?-1:1))));
  });
  const observer=resizeObserver?new resizeObserver(()=>{cancelInput();refresh();}):null;observer?.observe(root);
  refresh();
  return {refresh,dispose(){if(disposed)return;disposed=true;if(raf!==null)cancelFrame(raf);raf=null;listeners.forEach(remove=>remove());observer?.disconnect();clear();}};
}
