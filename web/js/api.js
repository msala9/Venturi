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
export async function request(path, body, fetcher = fetch) {
  const replaceTake = body !== undefined && (path === "/review/replace/plan" ||
    /^\/timelines\/(?:0|[1-9][0-9]*)\/commands$/.test(path) && body?.operation?.kind === "replace_take");
  const response = await fetcher(`/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(replaceTake ? 30_000 : 20_000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiFailure(
      "The server returned an invalid response",
      "INVALID_RESPONSE",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiFailure(
      data.error?.message || "Request failed",
      data.error?.code || "REQUEST_FAILED",
      response.status,
    );
  return data;
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
