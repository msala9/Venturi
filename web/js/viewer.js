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
export function createViewer({ image, empty, status, getState }) {
  let sequence = 0,
    controller = null,
    url = null,
    pendingURL = null;
  function clearPending() {
    if (pendingURL) {
      URL.revokeObjectURL(pendingURL);
      pendingURL = null;
    }
  }
  function invalidate() {
    sequence++;
    controller?.abort();
    clearPending();
    image.classList.add("stale");
    status.textContent = image.hidden
      ? "PREVIEW UNAVAILABLE"
      : "STALE_REVISION";
  }
  async function seek() {
    const current = getState();
    if (!current) {
      invalidate();
      return;
    }
    const seq = ++sequence;
    controller?.abort();
    clearPending();
    controller = new AbortController();
    image.classList.add("stale");
    status.textContent = "SEEKING";
    try {
      const query = new URLSearchParams(
        Object.entries(current).map(([key, value]) => [key, String(value)]),
      );
      const response = await fetch(`/api/v1/preview/frame?${query}`, {
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
      if (seq !== sequence || !matchesFrame(current, getState())) return;
      if (blob.type !== "image/png" || blob.size > 16 * 1024 * 1024)
        throw new Error("INVALID_FRAME");
      const next = URL.createObjectURL(blob);
      pendingURL = next;
      image.src = next;
      await image.decode();
      if (seq !== sequence || !matchesFrame(current, getState())) {
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
    } catch (error) {
      if (seq === sequence && error.name !== "AbortError") {
        clearPending();
        status.textContent = `${image.hidden ? "" : "STALE · "}${error.message}`;
      }
    }
  }
  return {
    seek,
    invalidate,
    destroy() {
      invalidate();
      if (url) URL.revokeObjectURL(url);
    },
  };
}
