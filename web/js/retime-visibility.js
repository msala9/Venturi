export function selectedRetimeClips(timeline, selection) {
  const selected = new Set(selection || []);
  return [...new Set((timeline?.tracks || []).flatMap(track => (track.clips || [])
    .filter(clip => clip.kind === "media" && selected.has(clip.id)).map(clip => clip.id)))];
}

export function retimeVisibilityState(timeline, selection, visible) {
  const ids = selectedRetimeClips(timeline, selection);
  return { ids, disabled: ids.length === 0, pressed: ids.length > 0 && ids.every(id => visible.has(id)), any: visible.size > 0 };
}

export function toggleRetimeVisibility(timeline, selection, visible) {
  const { ids, pressed } = retimeVisibilityState(timeline, selection, visible), next = new Set(visible);
  for (const id of ids) { if (pressed) next.delete(id); else next.add(id); }
  return next;
}

export function retimeProjectVisibility(previousEpoch, nextEpoch, visible) {
  return previousEpoch === nextEpoch ? visible : new Set();
}
