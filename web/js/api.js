export class ApiFailure extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function persistentClientId(storage = sessionStorage, uuid = () => crypto.randomUUID()) {
  try {
    let id = storage.getItem("venturi-writer-client");
    if (!id) { id = uuid(); storage.setItem("venturi-writer-client",id); }
    return id;
  } catch { return uuid(); }
}
let requestObserver = null;

export function observeRequests(begin, { now = () => performance.now() } = {}) {
  const owner = { begin, now };
  requestObserver = owner;
  return () => { if (requestObserver === owner) requestObserver = null; };
}

function requestObservation() {
  const owner = requestObserver;
  if (!owner) return null;
  let finish, started;
  try {
    finish = owner.begin();
    started = owner.now();
  } catch { return null; }
  if (typeof finish !== "function" || !Number.isFinite(started)) return null;
  return (method, outcome) => {
    if (requestObserver !== owner) return;
    try {
      const ended = owner.now();
      if (requestObserver !== owner || !Number.isFinite(ended)) return;
      finish({ duration_ms: Math.max(0, ended - started), method, outcome });
    } catch { /* Diagnostics cannot change request outcomes. */ }
  };
}

function requestAborted(error) {
  try { return error?.name === "AbortError" || error?.name === "TimeoutError"; }
  catch { return false; }
}

export async function request(path, body, fetcher = fetch) {
  const observed = requestObservation();
  const method = body === undefined ? "GET" : "POST";
  let outcome = "network_error";
  try {
    const replaceTake = body !== undefined && (path === "/review/replace/plan" ||
      /^\/timelines\/(?:0|[1-9][0-9]*)\/commands$/.test(path) && body?.operation?.kind === "replace_take");
    const response = await fetcher(`/api/v1${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(replaceTake ? 30_000 : 20_000),
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      outcome = requestAborted(error) ? "aborted" : "invalid_json";
      throw new ApiFailure(
        "The server returned an invalid response",
        "INVALID_RESPONSE",
        response.status,
      );
    }
    if (!response.ok) {
      outcome = "http_error";
      throw new ApiFailure(
        data.error?.message || "Request failed",
        data.error?.code || "REQUEST_FAILED",
        response.status,
      );
    }
    outcome = "success";
    return data;
  } catch (error) {
    if (outcome === "network_error" && requestAborted(error)) outcome = "aborted";
    throw error;
  } finally {
    observed?.(method, outcome);
  }
}
export async function sendMutation(path, body, fetcher = fetch) {
  try {
    return await request(path, body, fetcher);
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    try {
      return await request(
        `/commands/${encodeURIComponent(body.command_id)}`,
        undefined,
        fetcher,
      );
    } catch (lookup) {
      if (lookup instanceof ApiFailure && lookup.status !== 404) throw lookup;
      throw new ApiFailure(
        `Command ${body.command_id}: outcome unknown. Reconnect before editing.`,
        "OUTCOME_UNKNOWN",
      );
    }
  }
}
