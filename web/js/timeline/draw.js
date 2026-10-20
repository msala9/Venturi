import { HEADER, RULER, TRACK, frameToX, visibleRange } from "./geometry.js";
export function createDraw(canvas, getTimeline, view, getAssets = () => new Map(), onPaint) {
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
        ctx.fillStyle = track.kind === "audio" ? "#285247" : "#383554";
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
      }
      for (const crossing of track.crossings || []) {
        const left=frameToX(crossing.start_frame,view,timeline.fps),right=frameToX(crossing.end_frame,view,timeline.fps);
        if (right<HEADER || left>width) continue;
        ctx.fillStyle=color("--violet");ctx.globalAlpha=0.6;ctx.fillRect(left,top+TRACK-12,right-left,5);ctx.globalAlpha=1;
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
        }
      ctx.restore();
      ctx.fillStyle = color("--surface");
      ctx.fillRect(0, top, HEADER, TRACK - 1);
      ctx.fillStyle = color("--muted");
      ctx.fillText(track.label || track.id, 16, top + 22);
      ctx.fillText(
        `${track.kind}${track.locked ? " · LOCKED" : ""}`,
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
      ctx.fillRect(x, 24, 1, 6);
    }
    for (const marker of timeline.markers || []) {
      const x = frameToX(marker.start_frame, view, timeline.fps);
      const right = frameToX(marker.start_frame + marker.duration_frames, view, timeline.fps);
      if (right < HEADER || x > width) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(HEADER,0,width-HEADER,RULER); ctx.clip();
      ctx.fillStyle = marker.rgb ? `rgb(${marker.rgb.join(",")})` : color("--amber");
      ctx.globalAlpha = 0.35; ctx.fillRect(x, 0, Math.max(3,right-x),RULER); ctx.globalAlpha = 1;
      ctx.fillRect(x,0,2,RULER); ctx.fillText(marker.note.slice(0,32),x+4,6); ctx.restore();
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
