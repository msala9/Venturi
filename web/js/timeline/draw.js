import { HEADER, RULER, MARKER_TOP, MARKER_BOTTOM, frameToX, visibleRange,fadeHandles,gainLine,slipMediaExtents,transitionHandles,transitionBodies,retimeStrips,retimeSpeedLabel,selectedGap,timelineLayout,trackHeaderButtons,paneScrollbars } from "./geometry.js";
import {sourceAssetKey,mediaThumbnail} from '../source-assets.js';
import {RECORDING_PEAKS_PER_SECOND} from '../capture-buffer.js';
import {waveformVisual,waveformDraftChanges,waveformColumns} from './waveform.js';
export function recordingWaveformColumns(peaks,origin,end,pixelsPerSecond,left,right){
  const columns=[];
  if(!peaks?.length || ![origin,end,pixelsPerSecond,left,right].every(Number.isFinite) || pixelsPerSecond<=0 || right<=left || end<=origin)return columns;
  const binsPerPixel=RECORDING_PEAKS_PER_SECOND/pixelsPerSecond;
  for(let column=Math.max(0,Math.ceil(left-origin));column<Math.min(end,right)-origin;column++){
    const from=Math.floor(column*binsPerPixel);if(from>=peaks.length)break;
    const to=Math.min(peaks.length,Math.max(from+1,Math.floor((column+1)*binsPerPixel)));
    let peak=0;for(let bin=from;bin<to;bin++)if(peaks[bin]>peak)peak=peaks[bin];
    columns.push([origin+column,Math.min(1,peak)]);
  }
  return columns;
}
export function timelineTimecode(frame,fps){
  const nominal=Math.max(1,Math.round(fps.num/fps.den)),value=Math.max(0,Math.round(frame));
  return [Math.floor(value/(nominal*3600)),Math.floor(value/(nominal*60))%60,Math.floor(value/nominal)%60,value%nominal].map(part=>String(part).padStart(2,'0')).join(':');
}
export function visibleAssetDemand(timeline,view,width,height){
  if(!timeline || width<=HEADER || height<=RULER)return [];
  const layout=timelineLayout(timeline,view,height),[first,last]=visibleRange(width,view,timeline.fps),entries=new Map();
  for(const index of layout.rowOrder){
    const track=timeline.tracks[index],top=layout.trackTop(index),pane=layout.pane(index);
    if(top+layout.rowHeight<=pane.top || top>=pane.bottom)continue;
    for(const clip of track.clips){
      if(!clip.media_id || clip.start_frame+clip.length_frames<first || clip.start_frame>last)continue;
      if(track.kind==='audio' && clip.freeze_source_frame!=null)continue;
      const left=frameToX(clip.start_frame,view,timeline.fps),right=Math.max(left+2,frameToX(clip.start_frame+clip.length_frames,view,timeline.fps));
      if(right<=HEADER || left>=width)continue;
      const audio=track.kind==='audio',stream=audio?(clip.audio_stream_index ?? 0):0;
      if(!Number.isSafeInteger(stream) || stream<0)continue;
      const key=sourceAssetKey(clip.media_id,stream);
      if(entries.size>=64 && !entries.has(key))continue;
      if(!entries.has(key) || audio)entries.set(key,{media_id:clip.media_id,audio_stream_index:stream,include_waveform:audio});
    }
  }
  return [...entries.values()];
}
export function visibleWaveformDemand(timeline,view,width,height){
  if(!timeline || width<=HEADER || height<=RULER)return [];
  const layout=timelineLayout(timeline,view,height),changes=waveformDraftChanges(timeline,view.draft),ids=new Set();
  for(const track of timeline.tracks)if(track.kind==='audio')for(const clip of track.clips){
    if(!clip.media_id || clip.freeze_source_frame!=null)continue;
    const visual=waveformVisual(clip,track.id,timeline,view.draft,changes),visuals=view.draft?.duplicate?[waveformVisual(clip,track.id,timeline),visual]:[visual];
    for(const shown of visuals){
      if(!shown)continue;
      const index=timeline.tracks.findIndex(track=>track.id===shown.track_id),target=shown.to_new_track,pane=target?target.kind==='audio'?layout.audioPane:layout.videoPane:layout.pane(index),top=target?layout.newTrackTop(target.kind,target.depth):layout.trackTop(index);
      const left=frameToX(shown.start_frame,view,timeline.fps),right=Math.max(left+2,frameToX(shown.start_frame+shown.length_frames,view,timeline.fps));
      if(!Number.isFinite(top) || !pane || top+layout.rowHeight<=pane.top || top>=pane.bottom || right<=HEADER || left>=width)continue;
      ids.add(clip.id);if(ids.size===64)return [...ids];
    }
  }
  return [...ids];
}
export function createDraw(canvas, getTimeline, view, getAssets = () => new Map(), onPaint, getCache = () => null, getWaveforms = () => new Map()) {
  const ctx = canvas.getContext("2d");
  let queued = false;
  const colors = getComputedStyle(document.documentElement);
  const color = (name) => colors.getPropertyValue(name).trim();
  const paint = () => {
    const started = onPaint ? performance.now() : 0;
    queued = false;
    const width = canvas.clientWidth,
      height = canvas.clientHeight,
      dpr = devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color("--bg");
    ctx.fillRect(0, 0, width, height);
    const timeline = getTimeline();
    if (!timeline) return;
    view.viewportHeight=height;
    const layout=timelineLayout(timeline,view,height),rowHeight=layout.rowHeight;
    const presentations=getWaveforms(),draftChanges=waveformDraftChanges(timeline,view.draft),clips=new Map(timeline.tracks.flatMap(track=>track.clips.map(clip=>[clip.id,{clip,track}])));
    function paintWaveform(visual,rect,pane){
      if(!visual)return;
      const asset=getAssets().get(sourceAssetKey(visual.clip.media_id,visual.clip.audio_stream_index ?? 0)),presentation=presentations?.get(visual.clip_id);
      const columns=waveformColumns(visual,asset,presentation,timeline.fps,rect,{left:HEADER,right:width,top:pane.top,bottom:pane.bottom});
      if(!columns.length)return;
      const middle=Math.fround(Math.fround(Math.fround(rect.top)+Math.fround(rect.bottom))/2);
      ctx.save();ctx.beginPath();ctx.rect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);ctx.clip();ctx.lineWidth=1;
      for(const clipped of [false,true]){
        ctx.strokeStyle=clipped?'rgba(255,90,90,0.7843137254901961)':'rgba(255,255,255,0.5490196078431373)';ctx.beginPath();
        for(const column of columns)if(column.clipped===clipped){ctx.moveTo(column.x,Math.fround(middle-column.half_height));ctx.lineTo(column.x,Math.fround(middle+column.half_height));}
        ctx.stroke();
      }
      ctx.restore();
    }
    view.videoScroll=layout.videoScroll;view.audioScroll=layout.audioScroll;
    const gap=selectedGap(timeline,view);
    const slipExtents=slipMediaExtents(timeline,view);
    const [first, last] = visibleRange(width, view, timeline.fps);
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    for (const index of layout.rowOrder) {
      const track=timeline.tracks[index],top=layout.trackTop(index),pane=layout.pane(index);
      if (top + rowHeight <= pane.top || top >= pane.bottom) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, pane.top, width, pane.bottom-pane.top);
      ctx.clip();
      ctx.fillStyle = color("--surface");
      ctx.fillRect(0, top, width, rowHeight - 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(HEADER, top, width - HEADER, rowHeight);
      ctx.clip();
      if(gap?.track_id===track.id){
        const left=frameToX(gap.start_frame,view,timeline.fps),right=frameToX(gap.start_frame+gap.length_frames,view,timeline.fps);
        ctx.fillStyle=color('--raised');ctx.fillRect(left+1,top+7,Math.max(0,right-left-2),rowHeight-14);
        ctx.strokeStyle=color('--primary');ctx.lineWidth=2;ctx.strokeRect(left+1,top+7,Math.max(0,right-left-2),rowHeight-14);ctx.lineWidth=1;
      }
      const speedStrips=new Map(retimeStrips(track,view,timeline.fps,width).map(strip=>[strip.clip_id,strip])),speedIds=new Set(speedStrips.keys());
      for (const clip of track.clips) {
        if (
          clip.start_frame + clip.length_frames < first ||
          clip.start_frame > last
        )
          continue;
        const x = frameToX(clip.start_frame, view, timeline.fps),
          right = Math.max(x+2,frameToX(
            clip.start_frame + clip.length_frames,
            view,
            timeline.fps,
          ));
        ctx.fillStyle = clip.display_rgb ? `rgb(${clip.display_rgb.join(",")})` : track.kind === "audio" ? "#62b38f" : "#5e90bc";
        ctx.fillRect(x + 1, top + 2, Math.max(1,right-x-2), rowHeight - 4);
        ctx.strokeStyle = view.selection.includes(clip.id)
          ? "#eeeeee"
          : color("--border");
        ctx.strokeRect(x + 0.5, top + 2.5, Math.max(2,right-x)-1, rowHeight - 5);
        ctx.fillStyle = color("--violet");
        if (clip.transition_in) ctx.fillRect(x+2,top+8,Math.min(Math.max(0,right-x-4),clip.transition_in.duration*view.scale*timeline.fps.den/timeline.fps.num),3);
        if (clip.transition_out) {const span=Math.min(Math.max(0,right-x-4),clip.transition_out.duration*view.scale*timeline.fps.den/timeline.fps.num);ctx.fillRect(right-span-2,top+8,span,3);}
        if (clip.disabled) {ctx.fillStyle="#00000088";ctx.fillRect(x+2,top+8,Math.max(0,right-x-4),rowHeight-16);}
        if(track.kind==='audio'){
          const visual=waveformVisual(clip,track.id,timeline,view.draft,draftChanges);
          if(visual && (!visual.drafted || view.draft?.duplicate))paintWaveform(view.draft?.duplicate?waveformVisual(clip,track.id,timeline):visual,{left:x,right,top:top+2,bottom:top+rowHeight-2},pane);
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 5, top + 7, Math.max(0, right - x - 10), rowHeight - 14);
        ctx.clip();
        const asset = track.kind==='audio'?getAssets().get(sourceAssetKey(clip.media_id,clip.audio_stream_index ?? 0)):mediaThumbnail(getAssets(),clip.media_id);
        if (asset?.thumbnail && track.kind === "video") {
          ctx.globalAlpha = 0.35;
          ctx.drawImage(asset.thumbnail, x + 2, top + 8, Math.min(right - x - 4, 80), rowHeight - 16);
          ctx.globalAlpha = 1;
        }
        const darkLabel=clip.display_rgb && clip.display_rgb[0]*.299+clip.display_rgb[1]*.587+clip.display_rgb[2]*.114<110;
        ctx.fillStyle = darkLabel?"#eeeeee":"#121212";
        const labelX=Math.max(x+9,HEADER+5);
        ctx.fillText(clip.name || `Clip ${clip.id}`, labelX, top + Math.min(24,rowHeight*.35));
        ctx.fillStyle = darkLabel?"#dddddd":"#202020";
        if(rowHeight>=60)ctx.fillText(
          `${clip.length_frames} fr${clip.linked_group !== null ? " · linked" : ""}`,
          labelX,
          top + 41,
        );
        ctx.restore();
        const gaining=view.draft?.kind==='gain' && view.draft.clip_id===clip.id;
        const gain=gainLine(gaining?{...clip,gain_db:view.draft.gain_db}:clip,track,view,timeline.fps);
        if(gain){
          const y=top+rowHeight/2-gain.offset*(rowHeight-4)/2;
          ctx.save();ctx.strokeStyle=gaining?color('--primary'):color('--text');ctx.globalAlpha=gaining?0.9:0.5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(right,y);ctx.stroke();ctx.restore();
          if(gaining){ctx.fillStyle=color('--text');ctx.fillText(`${view.draft.gain_db.toFixed(1)} dB`,Math.max(x+8,HEADER+5),top+rowHeight-12);}
        }
        const speed=speedStrips.get(clip.id);
        if(speed){
          const active=view.draft?.kind==='retime' && view.draft.clip_id===clip.id,end=active?view.draft.right:speed.right;
          ctx.fillStyle=active && view.draft.error?color('--danger'):active?color('--primary'):color('--violet');ctx.save();ctx.globalAlpha=0.75;ctx.fillRect(speed.left+1,top+7,Math.max(1,end-speed.left-2),14);ctx.restore();
          ctx.fillStyle=color('--text');
          const menuWidth=speed.menu.right-speed.menu.left;
          if(menuWidth>=24){ctx.save();ctx.beginPath();ctx.rect(speed.menu.left,top+7,menuWidth,14);ctx.clip();ctx.textAlign='center';ctx.fillText(`${retimeSpeedLabel(clip.retime?.speed_percent)} ▾`,(speed.menu.left+speed.menu.right)/2,top+14,Math.max(1,menuWidth-4));ctx.restore();}
          if(speed.close){ctx.save();ctx.textAlign='center';ctx.fillText('×',(speed.close.left+speed.close.right)/2,top+14);ctx.restore();}
          ctx.beginPath();ctx.arc(end-4,top+14,active?5:4,0,Math.PI*2);ctx.fill();
        }
        const fading=view.draft?.kind==='fade' && view.draft.clip_id===clip.id;
        const shown=fading?{...clip,[`fade_${view.draft.edge}`]:view.draft.frames}:clip;
        if(!track.locked && view.tool!=='slip' && !speedIds.has(clip.id))for(const handle of fadeHandles(shown,view,timeline.fps)){
          if(!handle.frames && !fading && !view.selection.includes(clip.id) && view.hoverFadeClip!==clip.id)continue;
          const active=fading && view.draft.edge===handle.edge;
          ctx.strokeStyle=active?color('--primary'):color('--text');ctx.fillStyle=ctx.strokeStyle;
          if(handle.frames){ctx.save();ctx.globalAlpha=0.65;ctx.beginPath();ctx.moveTo(handle.edge==='in'?x:right,top+rowHeight-8);ctx.lineTo(handle.end,top+8);ctx.stroke();ctx.restore();}
          ctx.beginPath();ctx.arc(handle.x,top+14,active?5:4,0,Math.PI*2);ctx.fill();
          if(active){ctx.fillStyle=color('--text');ctx.fillText(`Fade ${handle.edge} ${handle.frames}f`,Math.max(x+8,HEADER+4),top+rowHeight-13);}
        }
      }
      for (const crossing of track.crossings || []) {
        const left=frameToX(crossing.start_frame,view,timeline.fps),right=frameToX(crossing.end_frame,view,timeline.fps);
        if (right<HEADER || left>width) continue;
        ctx.fillStyle=color("--violet");ctx.globalAlpha=0.6;ctx.fillRect(left,top+rowHeight-12,right-left,5);ctx.globalAlpha=1;
      }
      if(!track.locked && view.tool!=='slip'){
        for(const body of transitionBodies(track,view,timeline.fps)){
          if(body.right_x<HEADER || body.left_x>width)continue;
          const selection=view.transitionSelection,selected=selection?.track_id===track.id && selection.clip_id===body.clip_id && selection.slot===body.slot;
          ctx.save();ctx.fillStyle=selected?color('--primary'):color('--violet');ctx.globalAlpha=selected?0.45:0.18;ctx.fillRect(body.left_x,top+rowHeight-21,Math.max(1,body.right_x-body.left_x),14);ctx.restore();
        }
        const draft=view.draft?.kind==='transition' && view.draft.track_id===track.id?view.draft:null;
        let handles=transitionHandles(track,view,timeline.fps);
        if(draft)handles=handles.filter(handle=>handle.clip_id!==draft.clip_id || handle.slot!==draft.slot).concat(draft.handles);
        const windows=new Set();
        for(const handle of handles){
          if(handle.end_x<HEADER || handle.start_x>width)continue;
          const active=Boolean(draft && draft.clip_id===handle.clip_id && draft.slot===handle.slot),key=`${handle.clip_id}:${handle.slot}`;
          const selection=view.transitionSelection,selected=selection?.track_id===track.id && selection.clip_id===handle.clip_id && selection.slot===handle.slot;
          ctx.strokeStyle=active || selected?color('--primary'):color('--violet');ctx.fillStyle=ctx.strokeStyle;
          if(!windows.has(key)){
            windows.add(key);ctx.save();ctx.globalAlpha=active?0.8:0.55;ctx.fillRect(handle.start_x,top+rowHeight-15,Math.max(1,handle.end_x-handle.start_x),3);ctx.restore();
            if(active){const label=`${handle.slot==='cut_after'?'Cross transition':`Transition ${handle.slot}`} ${handle.duration}f`,labelX=Math.max(HEADER+4,handle.start_x+5);ctx.fillStyle=color('--raised');ctx.fillRect(labelX-3,top+rowHeight-34,190,15);ctx.fillStyle=color('--text');ctx.fillText(label,labelX,top+rowHeight-26);}
          }
          ctx.fillStyle=active || selected?color('--primary'):color('--text');ctx.beginPath();ctx.arc(handle.x,top+rowHeight-14,active || selected?5:4,0,Math.PI*2);ctx.fill();
        }
      }
      if(view.draft?.kind==='transition_placement' && view.draft.track_id===track.id){
        const draft=view.draft;ctx.save();ctx.fillStyle=draft.error?color('--danger'):color('--primary');ctx.globalAlpha=0.45;ctx.fillRect(draft.start_x,top+rowHeight-21,Math.max(1,draft.end_x-draft.start_x),14);ctx.globalAlpha=1;ctx.strokeStyle=ctx.fillStyle;ctx.setLineDash([4,3]);ctx.strokeRect(draft.start_x,top+rowHeight-21,Math.max(1,draft.end_x-draft.start_x),14);ctx.setLineDash([]);
        for(const handle of draft.handles){ctx.beginPath();ctx.arc(handle.x,top+rowHeight-14,5,0,Math.PI*2);ctx.fill();}ctx.restore();
      }
      if(view.draft?.kind==='preset_application'){
        ctx.save();ctx.strokeStyle=view.draft.error?color('--danger'):color('--primary');ctx.lineWidth=3;
        for(const outline of view.draft.outlines)if(outline.track_id===track.id)ctx.strokeRect(outline.left+1.5,outline.top+1.5,Math.max(0,outline.right-outline.left-3),Math.max(0,outline.bottom-outline.top-3));
        ctx.restore();
      }
      for (const draft of draftChanges)
        if (draft.to_track === track.id) {
          const x = frameToX(draft.to_start_frame, view, timeline.fps),
            end = frameToX(
              draft.to_start_frame + draft.length_frames,
              view,
              timeline.fps,
            );
          ctx.fillStyle = view.draft.error ? "#ff627440" : "#ff673d50";
          ctx.fillRect(x, top + 5, end - x, rowHeight - 10);
          ctx.strokeStyle = view.draft.error
            ? color("--danger")
            : color("--primary");
          ctx.strokeRect(x, top + 5, end - x, rowHeight - 10);
          const entry=clips.get(draft.clip_id);
          if(entry?.track.kind==='audio')paintWaveform(waveformVisual(entry.clip,entry.track.id,timeline,view.draft,draftChanges),{left:x,right:Math.max(x+2,end),top:top+2,bottom:top+rowHeight-2},pane);
          if(view.draft.kind === "slip"){ctx.fillStyle=color("--text");ctx.fillText(`Slip ${view.draft.target>=0?"+":""}${view.draft.target}f`,x+6,top+rowHeight-15);}
          if(view.draft.kind==='trim_group' || view.draft.duplicate){ctx.fillStyle=color('--text');ctx.fillText(`${view.draft.duplicate?'Duplicate':view.draft.operation?.roll_neighbor_id?'Roll':'Trim'}${view.draft.operation?.overwrite || (view.draft.duplicate && view.retimeOverwrite)?' · OVERWRITE':''}`,Math.max(HEADER+5,x+6),top+rowHeight-15);}
          if(view.draft.kind==='retime'){
            const label=`Speed length ${draft.length_frames}f · end ${view.draft.end_frame}f${view.draft.validation_pending?' · linked validation on release':''}${view.draft.operation.overwrite?' · OVERWRITE':''}${view.draft.error?` · ${view.draft.error}`:''}`,labelX=Math.max(HEADER+5,x+6);
            ctx.fillStyle=color('--raised');ctx.fillRect(labelX-3,top+rowHeight-33,Math.max(180,Math.min(width-labelX,label.length*7)),15);ctx.fillStyle=color('--text');ctx.fillText(label,labelX,top+rowHeight-25);
          }
        }
      if(slipExtents.length){
        ctx.save();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;
        for(const extent of slipExtents)if(extent.track_id===track.id)ctx.strokeRect(extent.left,extent.top,extent.right-extent.left,extent.bottom-extent.top);
        ctx.restore();
      }
      for (const [start,end] of view.silencePreview || []) {
        const x=Math.max(HEADER,frameToX(start,view,timeline.fps)),right=Math.min(width,frameToX(end,view,timeline.fps));
        if(right<=x)continue;
        ctx.fillStyle=color("--danger");ctx.globalAlpha=0.28;ctx.fillRect(x,top,right-x,rowHeight-1);ctx.globalAlpha=1;
        ctx.strokeStyle=color("--danger");ctx.strokeRect(x,top+1,right-x,rowHeight-3);
      }
      if(view.recording?.timeline_id===timeline.id && view.recording.revision===timeline.revision && track.kind==='audio' && view.recording.tracks.includes(track.id) && view.recording.seconds>0) {
        const x=frameToX(view.recording.start_frame,view,timeline.fps),end=frameToX(view.recording.start_frame+view.recording.length_frames,view,timeline.fps);
        ctx.fillStyle=color("--danger");ctx.globalAlpha=0.4;ctx.fillRect(x,top+5,Math.max(2,end-x),rowHeight-10);ctx.globalAlpha=1;
        ctx.strokeStyle=color('--text');ctx.lineWidth=1;ctx.beginPath();
        const mid=top+rowHeight/2,half=Math.max(0,rowHeight-16)/2;
        for(const [column,peak] of recordingWaveformColumns(view.recording.peaks,x,end,view.scale,HEADER,width)){
          const amplitude=Math.max(.5,peak*half);ctx.moveTo(column,mid-amplitude);ctx.lineTo(column,mid+amplitude);
        }
        ctx.stroke();ctx.fillStyle=color("--text");ctx.fillText("REC",x+6,top+22);
      }
      ctx.restore();
      ctx.fillStyle = color("--surface");
      ctx.fillRect(0, top, HEADER, rowHeight - 1);
      ctx.fillStyle = color("--muted");
      ctx.fillText(track.label || track.id, 6, top + rowHeight/2, 24);
      for(const button of trackHeaderButtons(track)){
        const active=Boolean(track[button.flag]),buttonTop=top+rowHeight/2-13;
        ctx.fillStyle=active?color('--primary'):color('--raised');ctx.fillRect(button.left,buttonTop,button.right-button.left,26);
        ctx.fillStyle=color('--text');ctx.fillText(button.flag==='muted' && track.kind==='video'?(active?'–':'V'):button.label,button.left+8,buttonTop+13);
      }
      ctx.restore();
    }
    for(const draft of draftChanges)if(draft.to_new_track){
      const target=draft.to_new_track,pane=target.kind==='video'?layout.videoPane:layout.audioPane,top=layout.newTrackTop(target.kind,target.depth);
      if(top>=pane.bottom || top+rowHeight<=pane.top)continue;
      const left=frameToX(draft.to_start_frame,view,timeline.fps),right=Math.max(left+2,frameToX(draft.to_start_frame+draft.length_frames,view,timeline.fps));
      ctx.save();ctx.beginPath();ctx.rect(HEADER,pane.top,width-HEADER,pane.bottom-pane.top);ctx.clip();
      ctx.fillStyle=view.draft.error?color('--danger'):color('--primary');ctx.globalAlpha=0.35;ctx.fillRect(left,top+2,right-left,rowHeight-4);ctx.globalAlpha=1;
      ctx.strokeStyle=ctx.fillStyle;ctx.strokeRect(left+0.5,top+2.5,right-left-1,rowHeight-5);
      const entry=clips.get(draft.clip_id);
      if(entry?.track.kind==='audio')paintWaveform(waveformVisual(entry.clip,entry.track.id,timeline,view.draft,draftChanges),{left,right,top:top+2,bottom:top+rowHeight-2},pane);
      ctx.fillStyle=color('--text');ctx.fillText(`New ${target.kind} track ${target.depth}${view.draft.error?` · ${view.draft.error}`:''}`,Math.max(HEADER+5,left+5),top+rowHeight/2);
      ctx.restore();
    }
    if(layout.divider.bottom>layout.divider.top){ctx.fillStyle=color('--border');ctx.fillRect(0,layout.divider.top,width,layout.divider.bottom-layout.divider.top);}
    ctx.fillStyle = color("--raised");
    ctx.fillRect(0, 0, width, RULER);
    ctx.fillStyle = color("--muted");
    const fps = timeline.fps.num / timeline.fps.den,
      step = Math.max(1, Math.ceil(90 / (view.scale / fps)));
    for (
      let frame = Math.ceil(first / step) * step;
      frame <= last;
      frame += step
    ) {
      const x = frameToX(frame, view, timeline.fps);
      ctx.fillText(timelineTimecode(frame,timeline.fps), x + 4, 14);
      ctx.fillRect(x, 18, 1, 6);
    }
    for (const original of timeline.markers || []) {
      const drafting = view.draft?.kind === "marker" && view.draft.marker.id === original.id;
      const marker = drafting ? view.draft.marker : original;
      const x = frameToX(marker.start_frame, view, timeline.fps);
      const right = frameToX(marker.start_frame + marker.duration_frames, view, timeline.fps);
      if (right < HEADER || x > width) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(HEADER,MARKER_TOP,width-HEADER,MARKER_BOTTOM-MARKER_TOP); ctx.clip();
      ctx.fillStyle = marker.rgb ? `rgb(${marker.rgb.join(",")})` : color("--amber");
      ctx.globalAlpha = 0.35; ctx.fillRect(x, MARKER_TOP+2, Math.max(3,right-x),MARKER_BOTTOM-MARKER_TOP-3); ctx.globalAlpha = 1;
      ctx.fillRect(x,MARKER_TOP+2,2,MARKER_BOTTOM-MARKER_TOP-3);
      if(marker.duration_frames)ctx.fillRect(right-1,MARKER_TOP+2,2,MARKER_BOTTOM-MARKER_TOP-3);
      ctx.fillText(`${marker.note.slice(0,24)}${drafting ? ` · ${marker.start_frame}f / ${marker.duration_frames}f` : ""}`,x+5,MARKER_TOP+12);
      if(drafting){ctx.strokeStyle=color("--text");ctx.strokeRect(x-2,MARKER_TOP+1,Math.max(6,right-x+4),MARKER_BOTTOM-MARKER_TOP-2);}
      ctx.restore();
    }
    const cached = getCache();
    if (cached) {
      ctx.save(); ctx.beginPath(); ctx.rect(HEADER, 0, width - HEADER, RULER); ctx.clip();
      ctx.fillStyle = color("--violet");
      for (const frame of cached.frames) {
        const left = frameToX(frame, view, timeline.fps), right = frameToX(frame + 1, view, timeline.fps);
        if (right >= HEADER && left <= width) ctx.fillRect(left, RULER - 6, Math.max(1, right - left), 3);
      }
      ctx.fillStyle = color("--success");
      for (const range of cached.programs) {
        const left = frameToX(range.start_frame, view, timeline.fps), right = frameToX(range.end_frame, view, timeline.fps);
        if (right >= HEADER && left <= width) ctx.fillRect(left, RULER - 3, right - left, 3);
      }
      ctx.restore();
    }
    const x = frameToX(view.playhead, view, timeline.fps);
    if (x >= HEADER) {
      ctx.fillStyle = color("--primary");
      ctx.fillRect(x, 0, 2, height);
    }
    if (view.lasso) {
      const b = view.lasso;
      ctx.fillStyle = "#9b59ff22";
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeStyle = color("--violet");
      ctx.strokeRect(b.x, b.y, b.width, b.height);
    }
    if(view.draft?.kind==='transition_placement'){
      const draft=view.draft,label=draft.error?`Transition blocked · ${draft.error}`:draft.noop?'Transition already identical · no edit':`${draft.transition.kind} · ${draft.duration}f · ${draft.slot==='cut_after'?'crossing':'single edge'}${draft.replacement?' · REPLACE enabled · Undo restores':''} · release to apply`;
      const x=HEADER+8,y=Math.max(RULER+16,height-16);ctx.fillStyle=color('--raised');ctx.fillRect(x-4,y-8,Math.max(1,width-x),17);ctx.fillStyle=draft.error?color('--danger'):color('--text');ctx.fillText(label,x,y,Math.max(1,width-x-4));
    }
    if(['native_asset_placement','source_media_placement','project_media_placement','effect_generator_placement','effect_filter_placement'].includes(view.draft?.kind)){
      const draft=view.draft;ctx.save();ctx.fillStyle=draft.error?color('--danger'):color('--primary');ctx.strokeStyle=ctx.fillStyle;ctx.setLineDash([4,3]);
      for(const rect of draft.outlines){ctx.globalAlpha=.25;ctx.fillRect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);ctx.globalAlpha=1;ctx.strokeRect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);ctx.fillText(rect.name,rect.left+4,rect.top+14,Math.max(1,rect.right-rect.left-8));}
      ctx.setLineDash([]);const source=draft.kind==='source_media_placement',pool=draft.kind==='project_media_placement',effect=draft.effect,label=draft.error?`${effect?'Effect':source?'Source':pool?'Media':'Asset'} drop blocked · ${draft.error}`:effect?`${effect.name}${draft.length_frames?` · ${draft.length_frames}f`:''}${draft.overwrite?' · OVERWRITE':''} · release to apply with one Undo`:`${source?'Marked Source range':pool?`${draft.media_ids.length} project media`:`${draft.assets.length} native asset(s)`} · ${draft.length_frames}f${draft.overwrite?' · OVERWRITE':''} · release to insert with one Undo`;
      ctx.fillStyle=color('--raised');ctx.fillRect(HEADER+4,height-24,Math.max(1,width-HEADER-8),20);ctx.fillStyle=draft.error?color('--danger'):color('--text');ctx.fillText(label,HEADER+8,height-10,Math.max(1,width-HEADER-16));ctx.restore();
    }
    if(view.draft?.kind==='preset_application'){
      const draft=view.draft,label=`Preset ${draft.name} · ${draft.count} clip(s)${draft.error?` · blocked: ${draft.error}`:' · release to apply with one Undo'}`;
      const x=HEADER+8,y=Math.max(RULER+16,height-16);ctx.fillStyle=color('--raised');ctx.fillRect(x-4,y-8,Math.max(1,width-x),17);ctx.fillStyle=draft.error?color('--danger'):color('--text');ctx.fillText(label,x,y,Math.max(1,width-x-4));
    }
    for(const bar of paneScrollbars(timeline,view,width,height)){
      ctx.fillStyle='#0000005a';ctx.fillRect(bar.left,bar.top,bar.right-bar.left,bar.bottom-bar.top);
      ctx.fillStyle='#aaa';ctx.fillRect(bar.left+1,bar.thumbTop+1,bar.right-bar.left-2,Math.max(0,bar.thumbHeight-2));
    }
    onPaint?.(performance.now() - started,{timeline_id:timeline.id,revision:timeline.revision,items:visibleAssetDemand(timeline,view,width,height),waveform_clip_ids:visibleWaveformDemand(timeline,view,width,height)});
  };
  const invalidate = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(paint);
    }
  };
  const observer = new ResizeObserver(invalidate);
  observer.observe(canvas);
  invalidate();
  return {
    invalidate,
    destroy() {
      observer.disconnect();
    },
  };
}
