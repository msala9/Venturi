# Proposed HTTP API contract v1 (NOT upstream endpoints)

The implemented M2 subset and its deliberate schema deltas are documented in
[RUNNING.md](RUNNING.md#actual-api-deltas-from-the-proposal). In particular,
project epoch is now a string and every mutation also requires client ownership
and project history generation. The JSON schemas reflect implemented timeline
DTOs and the safe move/trim/split request subset, rather than the earlier examples
below. Unimplemented routes in this design table must not be assumed available.

All endpoints below are **new** `vv-web` routes to implement. Do not say Venturi already exposes REST. `vv-app mcp` is a stdio tool server; use it only as a temporary proof-of-concept backend.

## Common conventions

- Prefix `/api/v1`.
- JSON UTF-8, IDs are opaque **strings** copied from real engine results. Client never generates `clip_id`, `media_id`, `timeline_id`.
- Timeline positions are integer frames. Frame rate is `{num, den}` rational, `den>0`. Ranges `[start,end)` end exclusive; media source frames follow `vv-core` conventions.
- State includes `project_epoch` plus per-timeline opaque `revision` returned by `Session::timeline_revision` (do not assume UUID/string hash stable across reload). Version snapshots, never compare timeline frames as float seconds.
- Mutating calls require `command_id` generated once per user operation, `project_epoch`, and current `if_revision` when a timeline is affected. Do not retry a timed-out mutation under a **new** command id without checking status.
- All file selectors use server-issued `path_token` or media ids rooted in allowed dirs; never permit arbitrary absolute paths from client in general edit/export endpoints.
- Error object: `{ "error": { "code": "...", "message": "...", "recoverable": true, "details": {} } }`. No filesystem secrets in errors.

## Endpoints (initial subset)

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | liveness, API version, no sensitive hardware info |
| GET | `/projects` | authorized project list |
| POST | `/projects/open` | open allowlisted existing project, refuse unsaved changes unless resolved |
| POST | `/projects/new` | create project in authorized root |
| GET | `/session` | snapshot: epoch, project info, revisions and save state |
| GET | `/timelines/{id}` | normalized timeline tracks/clips/markers, revision |
| GET | `/clips/{id}?timeline_id=...` | complete clip effect/keys snapshot |
| POST | `/timelines/{id}/commands` | one atomic validated command (M2c) |
| GET | `/commands/{command_id}` | lookup completed/failed/unknown to safely handle retry |
| POST | `/project/save` | atomic persist, recovery snapshot strategy |
| GET | `/media/{id}/thumbnail` | server generated/validated thumbnail |
| GET | `/media/{id}/proxy` | browser-compatible proxy with Range support |
| GET | `/preview/frame?timeline_id=...&frame=...&width=...&revision=...` | exact composed frame or explicit pending/error |
| GET | `/events` | SSE: job progress, session changes, preview readiness |
| POST | `/exports` | queue validated export on immutable snapshot |
| GET | `/exports/{id}` | job status |
| POST | `/exports/{id}/cancel` | request cancel, keep explicit partial file status |

Advanced parity routes may be commands through same endpoint. Do not invent a generic string-to-engine operation dispatcher; support an audited explicit command enum, exhaustively mapped to Rust operations.

## Example normalized timeline response

```json
{
  "api_version": 1,
  "project_epoch": 4,
  "timeline_id": "tl-opaque-id",
  "revision": "opaque-revision",
  "fps": {"num": 24000, "den": 1001},
  "resolution": {"width": 1920, "height": 1080},
  "tracks": [{
    "id": "V1", "kind": "video", "locked": false, "muted": false,
    "clips": [{
      "id": "clip-opaque-id", "start_frame": 48, "length_frames": 120,
      "media_id": "media-opaque-id", "source_in_frames": 0,
      "source_out_frames": 120, "linked_group": null,
      "disabled": false
    }]
  }],
  "markers": []
}
```

This is a **web serialization proposal**, not the exact `get_timeline` MCP response format. The adapter MUST derive source in/out correctly from `vv-core` and fps conversion, not copy illustrative fields blindly.

## Example safe move request and results

```json
{
  "command_id": "9d3b0fdc-57cb-4dc2-a3cf-85f1cf1324cd",
  "project_epoch": 4,
  "if_revision": "opaque-revision",
  "operation": {
    "kind": "safe_move",
    "moves": [{"clip_id": "clip-opaque-id", "to_start_frame": 144, "to_track": "V1"}]
  }
}
```

Possible HTTP results:

- `200`: `{ "command_id":"...", "status":"applied", "new_revision":"...", "affected_clips":[...] }`.
- `409 REVISION_CONFLICT`: stale revision; caller fetches latest snapshot and asks user when rebase changes intended meaning.
- `409 OVERLAP`: normal drag would overwrite another clip; no mutation.
- `409 TRACK_LOCKED`: selected or linked track locked; no mutation.
- `409 COMMAND_IN_PROGRESS`: same command_id currently processing; look up status.
- `422 INVALID_FRAME`, `422 INVALID_TARGET`, `422 INVALID_OPERATION`: deterministic invalid request, no mutation.
- `503 GPU_UNAVAILABLE` on GPU-dependent preview, while timeline editing remains possible.

## Commit protocol

1. Browser computes local draft with no remote mutation.
2. Pointer up -> send one unique command_id and preconditions.
3. Host validates token, path permissions, epoch, revision, all linked-clip and collision constraints before executing any command.
4. Apply one `Session::apply` with a command or composite command; record idempotency status in bounded registry / durable journal if needed.
5. Return authoritative affected state and updated revision; UI clears draft.
6. If transport fails after send: query command by same ID. Never blindly replay under fresh id.

## Security and cache headers

Private authenticated/tunneled access only; `Cache-Control: no-store` for project state and mutations, short-lived versioned immutable caches for thumbnails/proxies; CSP disallow untrusted scripts; `X-Content-Type-Options: nosniff`; no dangerous MIME guessing; range requests must be validated and bounded; origin/host checks for unsafe methods. See `SECURITY_DEPLOY.md`.

## Implemented M3b source delivery

- POST `/api/v1/media/{id}/prepare` with `{project_epoch, quality}` creates or
  reuses an ephemeral source job. Quality is low/medium/high. This does not edit
  the project or history. Duplicate identity/quality requests share one job.
- GET `/api/v1/media/{id}/jobs/{job}?project_epoch=...` returns id, state, frames
  and optional error. States: queued, running, ready, failed, canceled.
- DELETE the same job URL requests cancellation; it never deletes source media.
- GET `.../{job}/{source.mp4|thumb.png|waveform.json}?project_epoch=...` serves
  completed assets only. Every request revalidates epoch, media ID and file
  identity. Files are streamed with MIME, Content-Length, Accept-Ranges, ETag,
  single byte ranges and If-Range. Unsatisfiable/multiple ranges return 416.
- The Source proxy contains the first audio stream when present. Source video
  is a preview of originals and does not contain timeline effects. Preparation
  is CPU-only, off the session actor. See RUNNING for explicit duration, cache
  and resource limits. Session capabilities expose source_playback separately
  from Program playback. Native FFmpeg library APIs are used throughout.
- Imported PNG/JPEG jobs return source_asset `source.png` or `source.jpg` and
  serve the original image bytes with the matching fixed MIME. Movie/audio
  jobs return `source.mp4`. Still Source has no media clock. Unsupported still
  signatures are rejected; source images share the bounded media job/cache.

## Implemented Program preparation (hardware acceptance pending)

- POST `/api/v1/preview/program/prepare` takes project_epoch, if_generation,
  timeline_id, revision, start_frame, end_frame and width (default 960).
  Ranges must be nonempty, inside the native timeline and at most five minutes.
- GET `/api/v1/preview/program/{job}` with the same query returns job state,
  native stage progress and the actual output dimensions/fps. DELETE requests
  cancellation, including after the document revision changes.
- GET `/api/v1/preview/program/{job}/program.mp4` with that query streams only
  finalized H.264/AAC native composition with byte Range support. Status and
  delivery reject changed document or media identities. One media job runs,
  with one pending; source and Program share the bounded queue/cache.
- Native desktop export retains its defaults. Web decoding/x264 use two CPU
  threads and explicit AMD Vulkan composition under the shared hardware lock.
  Hardware busy fails promptly. There is no realtime or hardware-encode claim.
