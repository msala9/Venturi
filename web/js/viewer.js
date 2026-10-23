export function matchesFrame(request, current) {
  return (
    !!current &&
    [
      "project_epoch",
      "if_generation",
      "timeline_id",
      "revision",
      "frame",
      "width",
    ].every((key) => request[key] === current[key])
  );
}
export function createViewer({ image, empty, status, getState, matches = matchesFrame, endpoint = (current) => `/api/v1/preview/frame?${new URLSearchParams(current)}` }) {
  let sequence = 0,
    controller = null,
    url = null,
    pendingURL = null,
    displayed = null,
    draft = false,
    draftURL = null,
    destroyed = false;
  function clearPending() {
    if (pendingURL) {
      URL.revokeObjectURL(pendingURL);
      pendingURL = null;
    }
  }
  function clearDraft() {
    const active = draft;
    draft = false;
    if (draftURL) URL.revokeObjectURL(draftURL);
    draftURL = null;
    if (active) {
      image.hidden = true;
      empty.hidden = false;
    }
  }
  function cancelDraft() {
    if (!draft) return;
    sequence++;
    controller?.abort();
    clearPending();
    clearDraft();
    if (!destroyed && url && displayed && matches(displayed, getState())) {
      image.src = url;
      image.hidden = false;
      empty.hidden = true;
      image.classList.remove("stale");
      status.textContent = "CURRENT";
    } else {
      displayed = null;
      image.classList.add("stale");
      status.textContent = "PREVIEW UNAVAILABLE";
    }
  }
  function invalidate() {
    displayed = null;
    sequence++;
    controller?.abort();
    clearPending();
    clearDraft();
    image.classList.add("stale");
    status.textContent = image.hidden
      ? "PREVIEW UNAVAILABLE"
      : "STALE_REVISION";
  }
  async function seek() {
    if (destroyed) return;
    displayed = null;
    const current = getState();
    if (!current) {
      invalidate();
      return;
    }
    const seq = ++sequence;
    controller?.abort();
    clearPending();
    clearDraft();
    controller = new AbortController();
    image.classList.add("stale");
    status.textContent = "SEEKING";
    try {
      const response = await fetch(endpoint(current), {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30_000),
        ]),
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.code || "FRAME_FAILED");
      }
      const blob = await response.blob();
      if (seq !== sequence || !matches(current, getState())) return;
      if (blob.type !== "image/png" || blob.size > 16 * 1024 * 1024)
        throw new Error("INVALID_FRAME");
      const next = URL.createObjectURL(blob);
      pendingURL = next;
      image.src = next;
      await image.decode();
      if (seq !== sequence || !matches(current, getState())) {
        URL.revokeObjectURL(next);
        return;
      }
      if (url) URL.revokeObjectURL(url);
      url = next;
      pendingURL = null;
      image.hidden = false;
      image.classList.remove("stale");
      empty.hidden = true;
      status.textContent = "CURRENT";
      displayed = { ...current };
    } catch (error) {
      if (seq === sequence && error.name !== "AbortError") {
        clearPending();
        status.textContent = `${image.hidden ? "" : "STALE · "}${error.message}`;
      }
    }
  }
  async function previewDraft(body, { isCurrent = () => true, kind = "font" } = {}) {
    const preview = kind === "font"
      ? { path: "/api/v1/preview/title-font", label: "FONT PREVIEW", error: "INVALID_FONT_PREVIEW" }
      : kind === "transition"
        ? { path: "/api/v1/preview/transition", label: "TRANSITION PREVIEW", error: "INVALID_TRANSITION_PREVIEW" }
        : null;
    if (!preview || destroyed || matches !== matchesFrame || !body?.query || !url || !displayed)
      return false;
    let request, encoded;
    try {
      request = structuredClone(body);
      encoded = JSON.stringify(request);
      if (!isCurrent() || !matchesFrame(request.query, displayed)
        || !matchesFrame(request.query, getState())) {
        cancelDraft();
        return false;
      }
    } catch {
      cancelDraft();
      return false;
    }
    const seq = ++sequence;
    controller?.abort();
    clearPending();
    clearDraft();
    image.src = url;
    image.hidden = false;
    empty.hidden = true;
    draft = true;
    controller = new AbortController();
    image.classList.add("stale");
    status.textContent = `${preview.label} · SEEKING`;
    const current = () => seq === sequence && !destroyed
      && matchesFrame(request.query, getState()) && isCurrent();
    try {
      const response = await fetch(preview.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: encoded,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        cache: "no-store",
      });
      if (!current()) {
        if (seq === sequence) cancelDraft();
        return false;
      }
      if (!response.ok || response.headers.get("x-venturi-preview-draft") !== "1"
        || Number(response.headers.get("content-length")) > 16 * 1024 * 1024)
        throw new Error(preview.error);
      const blob = await response.blob();
      if (!current()) {
        if (seq === sequence) cancelDraft();
        return false;
      }
      if (blob.type !== "image/png" || !blob.size || blob.size > 16 * 1024 * 1024)
        throw new Error(preview.error);
      const next = URL.createObjectURL(blob);
      pendingURL = next;
      image.src = next;
      await image.decode();
      if (!current()) {
        if (seq === sequence) cancelDraft();
        return false;
      }
      draftURL = next;
      pendingURL = null;
      image.hidden = false;
      image.classList.remove("stale");
      empty.hidden = true;
      status.textContent = preview.label;
      return true;
    } catch {
      if (seq === sequence) cancelDraft();
      return false;
    }
  }
  return {
    current: () => !draft && displayed && matches(displayed,getState()) ? {...displayed} : null,
    previewDraft,
    cancelDraft,
    seek,
    invalidate,
    destroy() {
      destroyed = true;
      invalidate();
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}
