const identity = media => media && typeof media.epoch === 'string' && media.epoch && typeof media.id === 'string' && media.id && typeof media.content_hash === 'string' && media.content_hash && Number.isSafeInteger(media.duration_frames) && media.duration_frames > 0 && !media.is_image
  ? JSON.stringify([media.epoch, media.id, media.content_hash, media.duration_frames]) : null;
const validFrame = (value, media) => Number.isSafeInteger(value) && value >= 0 && value < media.duration_frames;
const inputFrame = input => String(input.value).trim() === '' ? NaN : Number(input.value);

export function createSourceSeek({range, frame, seek, status, getMedia, getPosition, onSeek, onError}) {
  let scope = null, draft = null, requested = null, pending = null, disposed = false, suppressChange = false;
  const listeners = [];
  function listen(element, name, callback) {
    element.addEventListener(name, callback);
    listeners.push(() => element.removeEventListener(name, callback));
  }
  function verified(media) {
    const position = getPosition();
    return position?.epoch === media.epoch && position.media_id === media.id && validFrame(position.frame, media) ? position.frame : null;
  }
  function display(value, media, suffix = '') {
    range.value = frame.value = String(value);
    status.textContent = `Source frame ${value} / ${media.duration_frames - 1}${suffix}`;
  }
  function sync() {
    if (disposed) return;
    const media = getMedia(), next = identity(media);
    if (scope !== next) {suppressChange = scope !== null; scope = next; draft = requested = pending = null; frame.setCustomValidity?.('');}
    range.disabled = frame.disabled = seek.disabled = !next;
    range.min = frame.min = '0'; range.step = frame.step = '1';
    range.max = frame.max = String(next ? media.duration_frames - 1 : 0);
    if (!next) {
      range.value = frame.value = '0';
      status.textContent = media?.is_image ? 'Still images have no Source frame navigation' : 'Open Source media to seek';
      return;
    }
    if (draft) return;
    if (pending) {display(pending.frame, media, ' · seeking…'); return;}
    const position = verified(media);
    if (position !== null) {display(position, media); return;}
    display(requested?.frame ?? 0, media, requested?.unavailable ? ' · position unavailable; reopen Source or retry' : ' · awaiting verified media');
  }
  function preview(input) {
    if (disposed) return;
    const media = getMedia();
    if (!identity(media) || identity(media) !== scope) {sync(); return;}
    suppressChange = false;
    const value = inputFrame(input);
    draft = {scope, frame: value};
    frame.setCustomValidity?.('');
    if (!validFrame(value, media)) {status.textContent = 'Source frame must be an integer inside the full media'; return;}
    display(value, media, input === range ? ' · release to seek' : ' · Enter or Seek to apply');
  }
  function cancelDraft() {
    if (disposed) return;
    draft = null; suppressChange = true; frame.setCustomValidity?.('');
    const media = getMedia();
    if (identity(media) === scope && scope) {
      const position = verified(media);
      if (position !== null) {display(position, media); return;}
    }
    sync();
  }
  async function commit(input) {
    if (disposed) return;
    const media = getMedia(), current = identity(media);
    if (!current || scope !== current || (draft && draft.scope !== current)) {sync(); return;}
    const value = inputFrame(input);
    if (!validFrame(value, media)) {
      const message = 'Source frame must be an integer inside the full media';
      frame.setCustomValidity?.(message); status.textContent = message; onError?.(message);
      return;
    }
    draft = null; frame.setCustomValidity?.('');
    if (pending?.scope === scope && pending.frame === value) {sync(); return;}
    const owner = {scope, frame: value}; pending = requested = owner;
    display(value, media, ' · seeking…');
    const active = () => !disposed && pending === owner && scope === owner.scope && identity(getMedia()) === owner.scope;
    try {
      await onSeek(value);
      if (!active()) return;
      owner.unavailable = verified(media) === null;
      pending = null; sync();
    } catch (error) {
      if (!active()) return;
      owner.unavailable = true;
      pending = null;
      if (!draft) {sync(); status.textContent = error.message || 'Source seek failed';}
      onError?.(error.message || 'Source seek failed');
    }
  }
  const keyboard = event => {
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation?.(); cancelDraft();}
    if (event.key === 'Enter') {event.preventDefault(); event.stopPropagation?.(); if (!event.repeat) void commit(frame);}
  };
  listen(range, 'input', () => preview(range));
  listen(range, 'change', () => {if (!suppressChange) void commit(range);});
  listen(range, 'pointercancel', cancelDraft);
  listen(range, 'keydown', keyboard);
  listen(frame, 'input', () => preview(frame));
  listen(frame, 'keydown', keyboard);
  listen(seek, 'click', () => {void commit(frame);});
  sync();
  return {
    sync,
    reset(startFrame = 0) {
      if (disposed) return;
      pending = draft = requested = null; suppressChange = true; scope = identity(getMedia()); frame.setCustomValidity?.('');
      sync();
      if (scope) {const media = getMedia(), value = validFrame(startFrame, media) ? startFrame : 0; requested = {scope, frame: value}; display(value, media, ' · awaiting verified media');}
    },
    dispose() {
      if (disposed) return;
      disposed = true; pending = draft = requested = null;
      for (const remove of listeners) remove();
      range.disabled = frame.disabled = seek.disabled = true;
    },
  };
}
