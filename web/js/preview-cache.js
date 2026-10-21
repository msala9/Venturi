import { sameComposition } from "./program.js";

export function createPreviewCache({ getState, status, onChange, fetcher = fetch }) {
  let sequence = 0, controller = null, query = null, data = {frames: [], programs: []};
  const empty = () => ({frames: [], programs: []});
  function ranges() { return sameComposition(query, getState()) ? data : empty(); }
  async function refresh() {
    const current = getState(), seq = ++sequence;
    controller?.abort();
    query = null; data = empty(); onChange();
    status.textContent = "Cache · checking";
    if (!current) { status.textContent = "Cache · unavailable"; return; }
    controller = new AbortController();
    try {
      const response = await fetcher(`/api/v1/preview/cache?${new URLSearchParams(current)}`, {cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])});
      if (!response.ok) throw new Error("Cache status unavailable");
      const result = await response.json();
      if (seq !== sequence || !sameComposition(current, getState())) return;
      query = current; data = result;
      status.textContent = `Cache · ${data.frames.length} frames · ${data.programs.length} movies`;
      onChange();
    } catch (error) {
      if (seq === sequence && error.name !== "AbortError") status.textContent = "Cache · unavailable";
    }
  }
  return {ranges, refresh};
}
