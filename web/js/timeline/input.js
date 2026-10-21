import {
  HEADER,
  RULER,
  TRACK,
  xToFrame,
  snapFrame,
  hitTest,
  linkedSelection,
  validateDraft,
  markerDraft,
  fadeDraft,
  transitionDraft,
  retimeDraft,
} from "./geometry.js";
import {isTextTarget} from '../ui.js';

export function isRetimeShortcut(event,{dialogOpen=false}={}){
  return !dialogOpen && !event.defaultPrevented && !event.repeat && !event.isComposing && !event.altKey && !event.shiftKey && Boolean(event.ctrlKey)!==Boolean(event.metaKey) && event.key?.toLowerCase()==='r' && !isTextTarget(event.target);
}

export function createInput({
  canvas,
  getTimeline,
  view,
  invalidate,
  onSelect,
  onSeek,
  onCommand,
  onNotice,
  onSlip = () => {},
  canEdit = () => true,
  onMarkerEdit = () => {},
}) {
  let gesture = null,
    waiting = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const transitionContext=timeline=>{
    const rect=canvas.getBoundingClientRect();
    return JSON.stringify([timeline?.id,timeline?.revision,timeline?.fps.num,timeline?.fps.den,view.scale,view.origin,view.scrollY,view.tool,view.snap,view.retime,view.retimeOverwrite,[...view.selection].sort(),rect.left,rect.top,rect.width,rect.height]);
  };
  const transitionCurrent=g=>{const timeline=getTimeline();return timeline===g.timeline && !timeline.tracks[g.track]?.locked && transitionContext(timeline)===g.context && canEdit();};
  const cancel = () => {
    const slipping = gesture?.kind === "slip";
    const pointerId=gesture?.pointerId;
    gesture = null;
    view.draft = null;
    view.lasso = null;
    if(slipping)onSlip({phase:"cancel"});
    if(pointerId!==undefined && canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);
    invalidate();
  };
  const down = (event) => {
    if (waiting || gesture) return;
    const timeline = getTimeline();
    if (!timeline) return;
    canvas.focus();
    const [x, y] = point(event);
    const hit = hitTest(x, y, timeline, view);
    if (event.button === 0 && hit.kind === "marker") {
      gesture = {kind:"marker",marker:hit.marker,mode:hit.edge || (event.altKey && !hit.marker.duration_frames ? "extend" : "move"),frame:xToFrame(x,view,timeline.fps),x,y,moved:false,editable:canEdit()};
    } else if (event.button === 1 || event.altKey) {
      gesture = {
        kind: "pan",
        x,
        y,
        origin: view.origin,
        scrollY: view.scrollY,
      };
    } else if (event.button !== 0) return;
    else if(['transition','retime'].includes(hit.kind)){
      if(!canEdit()){onNotice('A writable idle session is required to edit this handle');return;}
      gesture={...hit,x,y,moved:false,pointerId:event.pointerId,timeline,context:transitionContext(timeline)};
    } else if (hit.clip) {
      if (event.ctrlKey && view.selection.includes(hit.clip.id)) {
        const group = linkedSelection(timeline, [hit.clip.id]);
        view.selection = view.selection.filter((id) => !group.includes(id));
        onSelect();
        invalidate();
        return;
      }
      let ids = view.selection.includes(hit.clip.id)
        ? view.selection
        : event.ctrlKey || event.shiftKey
          ? [...view.selection, hit.clip.id]
          : [hit.clip.id];
      view.selection = linkedSelection(timeline, ids);
      onSelect();
      gesture = {
        ...hit,
        x,
        y,
        frame: xToFrame(x, view, timeline.fps),
        moved: false,
      };
      if(hit.kind==='fade'){
        if(!canEdit()){gesture=null;onNotice('A writable idle session is required to edit a fade');return;}
        gesture.timeline=timeline;
        gesture.pointerId=event.pointerId;
      }
      if(view.tool === "slip") {
        const linked=linkedSelection(timeline,[hit.clip.id]);
        const affected=timeline.tracks.flatMap((track)=>track.clips.filter((clip)=>linked.includes(clip.id)).map((clip)=>({track,clip})));
        if(affected.some(({track,clip})=>track.locked || !clip.slip_range)) {gesture=null;onNotice("Slip requires unlocked source clips and their linked handles");return;}
        gesture.kind="slip";
        gesture.min=Math.max(...affected.map(({clip})=>clip.slip_range[0]));gesture.max=Math.min(...affected.map(({clip})=>clip.slip_range[1]));
        onSlip({phase:"begin",clip_id:hit.clip.id,delta:0});
      }
    } else if (hit.kind === "scrub") {
      gesture = { kind: "scrub" };
      view.playhead = xToFrame(x, view, timeline.fps);
      onSeek(false);
    } else if (hit.kind === "blank") {
      if (!event.ctrlKey) view.selection = [];
      gesture = { kind: "lasso", x, y };
      onSelect();
    } else return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    invalidate();
  };
  const move = (event) => {
    if (!gesture) {
      const timeline = getTimeline(); if (!timeline) return;
      const [x,y] = point(event), hit = hitTest(x,y,timeline,view);
      canvas.title = hit.marker ? `${hit.marker.note || "Marker"} · ${hit.marker.start_frame}f · drag to move, range edges resize, Alt+drag a point to extend, double-click to edit` : hit.kind==='retime' ? `Speed handle · drag the right endpoint to resize at native speed${view.retimeOverwrite?' · OVERWRITE clips enabled':''}` : hit.kind==='transition' ? `${hit.slot==='cut_after'?'Cross transition':`Transition ${hit.slot}`} · ${hit.duration}f · drag to change duration` : hit.kind==='fade' ? `Fade ${hit.edge} · ${hit.clip[`fade_${hit.edge}`]}f · drag to change this clip's fade` : '';
      if(canvas.style)canvas.style.cursor = ['fade','transition','retime'].includes(hit.kind) ? 'ew-resize' : hit.marker ? hit.edge ? "ew-resize" : "grab" : "";
      const hover=hit.clip?.id ?? null;if(view.hoverFadeClip!==hover){view.hoverFadeClip=hover;invalidate();}
      return;
    }
    const timeline = getTimeline(),
      [x, y] = point(event),
      g = gesture;
    if(g.kind==='transition' || g.kind==='retime'){
      if(event.pointerId!==g.pointerId)return;
      if(!transitionCurrent(g)){cancel();onNotice('Duration gesture cancelled because the editing session or viewport changed');return;}
      if(event.buttons!==undefined && !(event.buttons&1)){cancel();return;}
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      view.draft={...(g.kind==='retime'?retimeDraft(g,x-g.x,timeline,view):transitionDraft(g,x-g.x,view,timeline.fps)),track_id:timeline.tracks[g.track].id};
    } else if(g.kind==='fade'){
      if(event.pointerId!==g.pointerId)return;
      if(timeline!==g.timeline || !canEdit()){cancel();onNotice('Fade gesture cancelled because the editing session changed');return;}
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      view.draft=fadeDraft(g.clip,g.edge,Math.round((x-g.x)*timeline.fps.num/(view.scale*timeline.fps.den)));
    } else if (g.kind === "pan") {
      view.origin = Math.max(
        0,
        g.origin -
          (x - g.x) / ((view.scale * timeline.fps.den) / timeline.fps.num),
      );
      view.scrollY = Math.max(
        0,
        Math.min(timeline.tracks.length * TRACK, g.scrollY - (y - g.y)),
      );
    } else if (g.kind === "scrub") {
      view.playhead = xToFrame(x, view, timeline.fps);
      onSeek(false);
    } else if (g.kind === "marker") {
      if (!g.editable || (Math.hypot(x-g.x,y-g.y)<4 && !g.moved)) return;
      g.moved = true;
      const candidates = [view.playhead,...timeline.tracks.flatMap(track=>track.clips.flatMap(clip=>[clip.start_frame,clip.start_frame+clip.length_frames]))];
      view.draft = {kind:"marker",marker:markerDraft(g.marker,g.mode,xToFrame(x,view,timeline.fps),g.frame,candidates,view,timeline.fps)};
    } else if (g.kind === "lasso") {
      view.lasso = {
        x: Math.min(g.x, x),
        y: Math.min(g.y, y),
        width: Math.abs(x - g.x),
        height: Math.abs(y - g.y),
      };
    } else if(g.kind === "slip") {
      if(Math.hypot(x-g.x,y-g.y)<4 && !g.moved)return;g.moved=true;
      const delta=Math.max(g.min,Math.min(g.max,Math.round((x-g.x)*timeline.fps.num/(view.scale*timeline.fps.den))));
      const ids=linkedSelection(timeline,[g.clip.id]);
      view.draft={kind:"slip",target:delta,error:null,changes:timeline.tracks.flatMap((track)=>track.clips.filter((clip)=>ids.includes(clip.id)).map((clip)=>({clip_id:clip.id,to_track:track.id,to_start_frame:clip.start_frame,length_frames:clip.length_frames})))};
      onSlip({phase:"draft",clip_id:g.clip.id,delta});
    } else {
      if (Math.hypot(x - g.x, y - g.y) < 4 && !g.moved) return;
      g.moved = true;
      let frame = xToFrame(x, view, timeline.fps);
      const candidates = [
        view.playhead,
        ...(timeline.markers || []).map((marker) => marker.start_frame),
      ];
      for (const track of timeline.tracks)
        for (const clip of track.clips)
          if (!view.selection.includes(clip.id))
            candidates.push(
              clip.start_frame,
              clip.start_frame + clip.length_frames,
            );
      const original =
        g.kind === "move"
          ? g.clip.start_frame
          : g.kind === "trim_start"
            ? g.clip.start_frame
            : g.clip.start_frame + g.clip.length_frames;
      let target = Math.max(0, original + frame - g.frame);
      if (view.snap) target = snapFrame(target, candidates, view, timeline.fps);
      const delta = target - original;
      const changes = [];
      const affected =
        g.kind === "move"
          ? view.selection
          : linkedSelection(timeline, [g.clip.id]);
      for (const [index, track] of timeline.tracks.entries())
        for (const clip of track.clips)
          if (affected.includes(clip.id)) {
            const destination =
              g.kind === "move" && view.selection.length === 1
                ? Math.max(0, Math.floor((y - RULER + view.scrollY) / TRACK))
                : index;
            const start =
              g.kind === "trim_end"
                ? clip.start_frame
                : clip.start_frame + delta;
            const length =
              clip.length_frames +
              (g.kind === "trim_start"
                ? -delta
                : g.kind === "trim_end"
                  ? delta
                  : 0);
            changes.push({
              clip_id: clip.id,
              to_track: timeline.tracks[destination]?.id,
              to_start_frame: start,
              length_frames: length,
            });
          }
      view.draft = {
        changes,
        error: validateDraft(timeline, changes),
        kind: g.kind,
        target,
      };
    }
    invalidate();
  };
  const up = async (event) => {
    if (!gesture) return;
    const g = gesture,
      timeline = getTimeline();
    if(g.kind==='transition' || g.kind==='retime'){
      if(event.pointerId!==g.pointerId || event.button!==0)return;
      if(!transitionCurrent(g)){cancel();onNotice('Duration gesture cancelled because the editing session or viewport changed');return;}
      const [x,y]=point(event);
      if(g.moved || Math.hypot(x-g.x,y-g.y)>=4){g.moved=true;view.draft={...(g.kind==='retime'?retimeDraft(g,x-g.x,timeline,view):transitionDraft(g,x-g.x,view,timeline.fps)),track_id:timeline.tracks[g.track].id};}
    }
    const draft=view.draft;
    if(g.kind==='fade' && event.pointerId!==g.pointerId)return;
    if(g.kind==='fade' && (timeline!==g.timeline || !canEdit())){cancel();onNotice('Fade gesture cancelled because the editing session changed');return;}
    if (g.kind === "lasso" && view.lasso) {
      const box = view.lasso;
      const start = xToFrame(box.x, view, timeline.fps),
        end = xToFrame(box.x + box.width, view, timeline.fps);
      timeline.tracks.forEach((track, index) => {
        const top = RULER + index * TRACK - view.scrollY;
        if (track.locked || top > box.y + box.height || top + TRACK < box.y)
          return;
        for (const clip of track.clips)
          if (
            clip.start_frame < end &&
            clip.start_frame + clip.length_frames > start
          )
            view.selection.push(clip.id);
      });
      view.selection = linkedSelection(timeline, [...new Set(view.selection)]);
      onSelect();
    }
    gesture = null;
    view.lasso = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (g.kind === "scrub") onSeek(true);
    if (g.kind === "marker" && !g.moved) { view.playhead=g.marker.start_frame;onSeek(true); }
    const markerChanged = g.kind !== "marker" || (draft && (draft.marker.start_frame!==g.marker.start_frame || draft.marker.duration_frames!==g.marker.duration_frames));
    if (draft && g.moved && markerChanged && !(g.kind === "slip" && draft.target === 0) && !(g.kind==='fade' && draft.frames===draft.original) && !(g.kind==='transition' && draft.duration===g.duration) && !(g.kind==='retime' && draft.end_frame===g.end_frame)) {
      if (draft.error) onNotice(draft.error);
      else {
        waiting = true;
        try {
          const operation =
            ['transition','retime'].includes(g.kind) ? draft.operation : g.kind==='fade' ? {kind:'set_properties',clip_id:g.clip.id,patch:{[`fade_${g.edge}`]:draft.frames}} : g.kind === "marker" ? {kind:"move_marker",marker_id:g.marker.id,start_frame:draft.marker.start_frame,duration_frames:draft.marker.duration_frames} : g.kind === "move"
              ? {
                  kind: "safe_move",
                  moves: draft.changes.map(
                    ({ clip_id, to_track, to_start_frame }) => ({
                      clip_id,
                      to_track,
                      to_start_frame,
                    }),
                  ),
                }
              : g.kind === "slip" ? {kind:"slip",clip_ids:linkedSelection(timeline,[g.clip.id]),delta_frames:draft.target} : {
                  kind: "trim",
                  clip_id: g.clip.id,
                  edge: g.kind === "trim_start" ? "start" : "end",
                  frame: draft.target,
                };
          await onCommand(operation);
        } catch (error) {
          onNotice(error.message);
        } finally {
          waiting = false;
        }
      }
    }
    view.draft = null;
    if(g.kind === "slip")onSlip({phase:"end"});
    invalidate();
  };
  const wheel = (event) => {
    if(['fade','transition','retime'].includes(gesture?.kind))cancel();
    const timeline = getTimeline();
    if (!timeline) return;
    event.preventDefault();
    const [x] = point(event);
    if (event.ctrlKey || event.metaKey) {
      const anchor = xToFrame(x, view, timeline.fps);
      view.scale = Math.max(
        3,
        Math.min(2000, view.scale * Math.exp(-event.deltaY * 0.004)),
      );
      view.origin = Math.max(
        0,
        anchor -
          (x - HEADER) / ((view.scale * timeline.fps.den) / timeline.fps.num),
      );
    } else if (event.shiftKey)
      view.scrollY = Math.max(
        0,
        Math.min(timeline.tracks.length * TRACK, view.scrollY + event.deltaY),
      );
    else
      view.origin = Math.max(
        0,
        view.origin +
          (event.deltaX + event.deltaY) /
            ((view.scale * timeline.fps.den) / timeline.fps.num),
      );
    invalidate();
  };
  const key = (event) => {
    if (event.key === "Escape") {if(['transition','retime'].includes(gesture?.kind)){event.preventDefault?.();event.stopPropagation?.();}cancel();}
  };
  const pointerAbort=event=>{if(['transition','retime'].includes(gesture?.kind) && event?.pointerId!==undefined && event.pointerId!==gesture.pointerId)return;cancel();};
  const viewportChanged=()=>{if(['transition','retime'].includes(gesture?.kind))cancel();};
  const documentRef=canvas.ownerDocument ?? window.document;
  const visibilityChanged=()=>{if(documentRef?.hidden)viewportChanged();};
  const doubleClick = event => {
    const timeline = getTimeline(); if (!timeline || waiting) return;
    const hit = hitTest(...point(event),timeline,view);
    if(hit.marker)onMarkerEdit(hit.marker.id);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", pointerAbort);
  canvas.addEventListener("lostpointercapture", pointerAbort);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("keydown", key);
  canvas.addEventListener("dblclick", doubleClick);
  window.addEventListener("blur", cancel);
  window.addEventListener('resize',viewportChanged);
  window.addEventListener('scroll',viewportChanged,true);
  documentRef?.addEventListener('visibilitychange',visibilityChanged);
  return {
    cancel,
    destroy() {
      cancel();
      for (const [event, fn] of [
        ["pointerdown", down],
        ["pointermove", move],
        ["pointerup", up],
        ["pointercancel", pointerAbort],
        ["lostpointercapture", pointerAbort],
        ["wheel", wheel],
        ["keydown", key],
        ["dblclick", doubleClick],
      ])
        canvas.removeEventListener(event, fn);
      window.removeEventListener("blur", cancel);
      window.removeEventListener('resize',viewportChanged);
      window.removeEventListener('scroll',viewportChanged,true);
      documentRef?.removeEventListener('visibilitychange',visibilityChanged);
    },
  };
}
