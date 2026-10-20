export const HEADER = 150, RULER = 30, TRACK = 62, MAX_FRAME = 1_000_000_000;
export function pixelsPerFrame(view, fps) {
  if (!(fps.num > 0 && fps.den > 0 && view.scale > 0)) throw new RangeError('Invalid frame scale');
  return view.scale * fps.den / fps.num;
}
export const frameToX = (frame, view, fps) => HEADER + (frame - view.origin) * pixelsPerFrame(view, fps);
export const xToFrame = (x, view, fps) => Math.max(0, Math.min(MAX_FRAME, Math.round(view.origin + (x - HEADER) / pixelsPerFrame(view, fps))));
export const visibleRange = (width, view, fps) => [view.origin, xToFrame(width, view, fps)];
export function snapFrame(frame, candidates, view, fps, threshold = 8) {
  const limit = threshold / pixelsPerFrame(view, fps);
  let best = frame, distance = limit + Number.EPSILON;
  for (const candidate of candidates) {
    if (Math.abs(candidate - frame) <= distance) { best = candidate; distance = Math.abs(candidate - frame); }
  }
  return Math.max(0, best);
}
export function hitTest(x, y, timeline, view) {
  if (y < RULER) return {kind:'scrub'};
  const track = Math.floor((y - RULER + view.scrollY) / TRACK);
  if (!timeline.tracks[track]) return {kind:'blank'};
  if (x < HEADER) return {kind:'header',track};
  for (const clip of timeline.tracks[track].clips) {
    const left = frameToX(clip.start_frame,view,timeline.fps);
    const right = frameToX(clip.start_frame+clip.length_frames,view,timeline.fps);
    if (x >= left && x <= right) return {kind:x-left < 8 ? 'trim_start' : right-x < 8 ? 'trim_end' : 'move',track,clip};
  }
  return {kind:'blank',track};
}
export function linkedSelection(timeline, ids) {
  const clips = timeline.tracks.flatMap(track => track.clips);
  const groups = new Set(clips.filter(clip => ids.includes(clip.id) && clip.linked_group !== null).map(clip => clip.linked_group));
  return clips.filter(clip => ids.includes(clip.id) || (clip.linked_group !== null && groups.has(clip.linked_group))).map(clip => clip.id);
}
export function validateDraft(timeline, changes) {
  const ids = new Set(changes.map(change => change.clip_id));
  for (const change of changes) {
    const target = timeline.tracks.find(track => track.id === change.to_track);
    const source = timeline.tracks.find(track => track.clips.some(clip => clip.id === change.clip_id));
    if (!target || !source || target.locked || source.locked || source.kind !== target.kind) return 'Track locked or incompatible';
    const start = change.to_start_frame, length = change.length_frames;
    if (!Number.isSafeInteger(start) || start < 0 || length < 1 || start+length > MAX_FRAME) return 'Invalid frame range';
    if (target.clips.some(clip => !ids.has(clip.id) && start < clip.start_frame+clip.length_frames && start+length > clip.start_frame)) return 'Overlap · safe move blocked';
    if (changes.some(other => other !== change && other.to_track === change.to_track && start < other.to_start_frame+other.length_frames && start+length > other.to_start_frame)) return 'Selected clips overlap';
  }
  return null;
}
