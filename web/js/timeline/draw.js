import { HEADER, RULER, MARKER_TOP, MARKER_BOTTOM, TRACK, frameToX, visibleRange,fadeHandles,transitionHandles,transitionBodies,retimeHandles } from "./geometry.js";
export function createDraw(canvas, getTimeline, view, getAssets = () => new Map(), onPaint, getCache = () => null) {
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
    const [first, last] = visibleRange(width, view, timeline.fps);
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    for (const [index, track] of timeline.tracks.entries()) {
      const top = RULER + index * TRACK - view.scrollY;
      if (top + TRACK < RULER || top > height) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER, width, height - RULER);
      ctx.clip();
      ctx.fillStyle = color("--surface");
      ctx.fillRect(0, top, width, TRACK - 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(HEADER, top, width - HEADER, TRACK);
      ctx.clip();
      const speedHandles=retimeHandles(track,view,timeline.fps),speedIds=new Set(speedHandles.map(handle=>handle.clip_id));
      for (const clip of track.clips) {
        if (
          clip.start_frame + clip.length_frames < first ||
          clip.start_frame > last
        )
          continue;
        const x = frameToX(clip.start_frame, view, timeline.fps),
          right = frameToX(
            clip.start_frame + clip.length_frames,
            view,
            timeline.fps,
          );
        ctx.fillStyle = clip.display_rgb ? `rgb(${clip.display_rgb.join(",")})` : track.kind === "audio" ? "#285247" : "#383554";
        ctx.fillRect(x + 1, top + 7, right - x - 2, TRACK - 14);
        ctx.strokeStyle = view.selection.includes(clip.id)
          ? color("--primary")
          : color("--border");
        ctx.strokeRect(x + 1.5, top + 7.5, right - x - 3, TRACK - 15);
        ctx.fillStyle = color("--violet");
        if (clip.transition_in) ctx.fillRect(x+2,top+8,Math.min(right-x-4,clip.transition_in.duration*view.scale*timeline.fps.den/timeline.fps.num),3);
        if (clip.transition_out) {const span=Math.min(right-x-4,clip.transition_out.duration*view.scale*timeline.fps.den/timeline.fps.num);ctx.fillRect(right-span-2,top+8,span,3);}
        if (clip.disabled) {ctx.fillStyle="#00000088";ctx.fillRect(x+2,top+8,right-x-4,TRACK-16);}
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 5, top + 7, Math.max(0, right - x - 10), TRACK - 14);
        ctx.clip();
        const asset = getAssets().get(clip.media_id);
        if (asset?.thumbnail && track.kind === "video") {
          ctx.globalAlpha = 0.35;
          ctx.drawImage(asset.thumbnail, x + 2, top + 8, Math.min(right - x - 4, 80), TRACK - 16);
          ctx.globalAlpha = 1;
        }
        if (asset?.waveform && track.kind === "audio") {
          const { peaks, duration_seconds: duration } = asset.waveform;
          const fps = asset.fps.num / asset.fps.den;
          ctx.strokeStyle = "#70c8a8";
          ctx.beginPath();
          for (let px = Math.max(x, HEADER); px < Math.min(right, width); px += 2) {
            const fraction = (px - x) / (right - x);
            const seconds = (clip.source_in_frames + fraction * (clip.source_out_frames - clip.source_in_frames)) / fps;
            const peak = peaks[Math.floor(seconds / duration * peaks.length)] || 0;
            ctx.moveTo(px, top + 42 - peak * 12);
            ctx.lineTo(px, top + 42 + peak * 12);
          }
          ctx.stroke();
        }
        ctx.fillStyle = color("--text");
        ctx.fillText(clip.name || `Clip ${clip.id}`, x + 9, top + 24);
        ctx.fillStyle = color("--muted");
        ctx.fillText(
          `${clip.length_frames} fr${clip.linked_group !== null ? " · linked" : ""}`,
          x + 9,
          top + 41,
        );
        ctx.restore();
        const speed=speedHandles.find(handle=>handle.clip_id===clip.id);
        if(speed){
          const active=view.draft?.kind==='retime' && view.draft.clip_id===clip.id,end=active?view.draft.right:speed.right;
          ctx.fillStyle=active && view.draft.error?color('--danger'):active?color('--primary'):color('--violet');ctx.save();ctx.globalAlpha=0.75;ctx.fillRect(speed.left+1,top+7,Math.max(1,end-speed.left-2),14);ctx.restore();
          ctx.fillStyle=color('--text');if(end-speed.left>=70)ctx.fillText('Speed',speed.left+7,top+14);ctx.beginPath();ctx.arc(end-4,top+14,active?5:4,0,Math.PI*2);ctx.fill();
        }
        const fading=view.draft?.kind==='fade' && view.draft.clip_id===clip.id;
        const shown=fading?{...clip,[`fade_${view.draft.edge}`]:view.draft.frames}:clip;
        if(!track.locked && view.tool!=='slip' && !speedIds.has(clip.id))for(const handle of fadeHandles(shown,view,timeline.fps)){
          if(!handle.frames && !fading && !view.selection.includes(clip.id) && view.hoverFadeClip!==clip.id)continue;
          const active=fading && view.draft.edge===handle.edge;
          ctx.strokeStyle=active?color('--primary'):color('--text');ctx.fillStyle=ctx.strokeStyle;
          if(handle.frames){ctx.save();ctx.globalAlpha=0.65;ctx.beginPath();ctx.moveTo(handle.edge==='in'?x:right,top+TRACK-8);ctx.lineTo(handle.end,top+8);ctx.stroke();ctx.restore();}
          ctx.beginPath();ctx.arc(handle.x,top+14,active?5:4,0,Math.PI*2);ctx.fill();
          if(active){ctx.fillStyle=color('--text');ctx.fillText(`Fade ${handle.edge} ${handle.frames}f`,Math.max(x+8,HEADER+4),top+TRACK-13);}
        }
      }
      for (const crossing of track.crossings || []) {
        const left=frameToX(crossing.start_frame,view,timeline.fps),right=frameToX(crossing.end_frame,view,timeline.fps);
        if (right<HEADER || left>width) continue;
        ctx.fillStyle=color("--violet");ctx.globalAlpha=0.6;ctx.fillRect(left,top+TRACK-12,right-left,5);ctx.globalAlpha=1;
      }
      if(!track.locked && view.tool!=='slip'){
        for(const body of transitionBodies(track,view,timeline.fps)){
          if(body.right_x<HEADER || body.left_x>width)continue;
          const selection=view.transitionSelection,selected=selection?.track_id===track.id && selection.clip_id===body.clip_id && selection.slot===body.slot;
          ctx.save();ctx.fillStyle=selected?color('--primary'):color('--violet');ctx.globalAlpha=selected?0.45:0.18;ctx.fillRect(body.left_x,top+TRACK-21,Math.max(1,body.right_x-body.left_x),14);ctx.restore();
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
            windows.add(key);ctx.save();ctx.globalAlpha=active?0.8:0.55;ctx.fillRect(handle.start_x,top+TRACK-15,Math.max(1,handle.end_x-handle.start_x),3);ctx.restore();
            if(active){const label=`${handle.slot==='cut_after'?'Cross transition':`Transition ${handle.slot}`} ${handle.duration}f`,labelX=Math.max(HEADER+4,handle.start_x+5);ctx.fillStyle=color('--raised');ctx.fillRect(labelX-3,top+TRACK-34,190,15);ctx.fillStyle=color('--text');ctx.fillText(label,labelX,top+TRACK-26);}
          }
          ctx.fillStyle=active || selected?color('--primary'):color('--text');ctx.beginPath();ctx.arc(handle.x,top+TRACK-14,active || selected?5:4,0,Math.PI*2);ctx.fill();
        }
      }
      if(view.draft?.kind==='transition_placement' && view.draft.track_id===track.id){
        const draft=view.draft;ctx.save();ctx.fillStyle=draft.error?color('--danger'):color('--primary');ctx.globalAlpha=0.45;ctx.fillRect(draft.start_x,top+TRACK-21,Math.max(1,draft.end_x-draft.start_x),14);ctx.globalAlpha=1;ctx.strokeStyle=ctx.fillStyle;ctx.setLineDash([4,3]);ctx.strokeRect(draft.start_x,top+TRACK-21,Math.max(1,draft.end_x-draft.start_x),14);ctx.setLineDash([]);
        for(const handle of draft.handles){ctx.beginPath();ctx.arc(handle.x,top+TRACK-14,5,0,Math.PI*2);ctx.fill();}ctx.restore();
      }
      for (const draft of view.draft?.changes || [])
        if (draft.to_track === track.id) {
          const x = frameToX(draft.to_start_frame, view, timeline.fps),
            end = frameToX(
              draft.to_start_frame + draft.length_frames,
              view,
              timeline.fps,
            );
          ctx.fillStyle = view.draft.error ? "#ff627440" : "#ff673d50";
          ctx.fillRect(x, top + 5, end - x, TRACK - 10);
          ctx.strokeStyle = view.draft.error
            ? color("--danger")
            : color("--primary");
          ctx.strokeRect(x, top + 5, end - x, TRACK - 10);
          if(view.draft.kind === "slip"){ctx.fillStyle=color("--text");ctx.fillText(`Slip ${view.draft.target>=0?"+":""}${view.draft.target}f`,x+6,top+TRACK-15);}
          if(view.draft.kind==='retime'){
            const label=`Speed length ${draft.length_frames}f · end ${view.draft.end_frame}f${view.draft.validation_pending?' · linked validation on release':''}${view.draft.operation.overwrite?' · OVERWRITE':''}${view.draft.error?` · ${view.draft.error}`:''}`,labelX=Math.max(HEADER+5,x+6);
            ctx.fillStyle=color('--raised');ctx.fillRect(labelX-3,top+TRACK-33,Math.max(180,Math.min(width-labelX,label.length*7)),15);ctx.fillStyle=color('--text');ctx.fillText(label,labelX,top+TRACK-25);
          }
        }
      for (const [start,end] of view.silencePreview || []) {
        const x=Math.max(HEADER,frameToX(start,view,timeline.fps)),right=Math.min(width,frameToX(end,view,timeline.fps));
        if(right<=x)continue;
        ctx.fillStyle=color("--danger");ctx.globalAlpha=0.28;ctx.fillRect(x,top,right-x,TRACK-1);ctx.globalAlpha=1;
        ctx.strokeStyle=color("--danger");ctx.strokeRect(x,top+1,right-x,TRACK-3);
      }
      if(view.recording?.tracks.includes(track.id)) {
        const x=frameToX(view.recording.start_frame,view,timeline.fps),end=frameToX(view.recording.start_frame+view.recording.length_frames,view,timeline.fps);
        ctx.fillStyle=color("--danger");ctx.globalAlpha=0.4;ctx.fillRect(x,top+5,Math.max(2,end-x),TRACK-10);ctx.globalAlpha=1;ctx.fillStyle=color("--text");ctx.fillText("REC",x+6,top+22);
      }
      ctx.restore();
      ctx.fillStyle = color("--surface");
      ctx.fillRect(0, top, HEADER, TRACK - 1);
      ctx.fillStyle = color("--muted");
      ctx.fillText(track.label || track.id, 16, top + 22);
      ctx.fillText(
        `${track.kind}${track.locked ? " · LOCKED" : ""}${track.armed ? " · REC" : ""}`,
        16,
        top + 41,
      );
      ctx.restore();
    }
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
      ctx.fillText(`${frame}f`, x + 4, 14);
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
    onPaint?.(performance.now() - started);
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
