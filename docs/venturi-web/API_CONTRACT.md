# Proposed HTTP API contract v1 (NOT upstream endpoints)

Each timeline snapshot includes full native `transition_defaults` for Push,
CrossDissolve and SmoothCut. Desktop FPS rounding, direction, default easing and
curve are computed in Rust; durations are not yet clamped to a destination slot.
Canvas creation and Alt-copy resolve the canonical edge or adjacent left-clip
crossing, then submit the existing `set_transition`. The browser requires an
explicit Replace existing transition option for occupied destinations; the
ordinary mutation revision/generation guards protect that decision. Inspector
updates remain explicit edits of their selected transition. Identical payloads
and absent removals create no command, redo invalidation or compound media
refresh, including after Undo/Redo. Lock, eligibility, adjacency and payload
validation still run before no-op detection.

`edit_mask {clip_id,edit:{action:"add",shape:"Path",path?:MaskPath}}` can add
a complete pen-drawn path through one native Masks command. Omitted path keeps
the existing native shape defaults. Supplied geometry is Path-only and must
satisfy the shared 3–21 vertex, coordinate, eight-mask and flattened-polygon
budgets. Empty and incomplete pen drafts remain client-only.
Each native Path mask detail exposes `path_navigation` with `on_keyframe` and
nullable `previous`/`next` `{source_frame,timeline_frame}` destinations. Native
strict neighbours are found on the entire path track, filtered to the clip's
source interval and mapped by `timeline_frame_at`; the first 16 `path_keys`
remain a preview. The current source clock comes from `source_frame_at` even
when the picture is frozen. The existing `path_key` action sets the evaluated
path with native Linear interpolation or removes an exact source-frame key.

`retime_clip {clip_id,end_frame,overwrite?:false}` uses the ordinary timeline
mutation envelope. Eligible media snapshots expose `retime` with native
`source_span`, `min_length`, `max_length` and `pitch_correction`; unsupported
sources expose null. The endpoint computes an exact native rational speed and
applies `SetClipSpeed` with `ResizeTo`, expanding the primary's linked group.
It preserves the primary pitch flag and native source-frame mapping. A shared
old endpoint must remain shared; source clamps or unrepresentable linked media
results reject the whole operation. Other linked endpoints use native Resize.
An unchanged endpoint creates no history step. Ordinary growth rejects overlaps;
explicit `overwrite:true` uses native make-room trim/delete commands in the same
Undo step. Foreign linked groups must be completely aligned and covered on
every affected track; locked or incomplete groups refuse atomically. Validation
runs on a cloned native project before planning against real ID allocators.
This does not add speed ramps or reverse playback.

`POST /api/v1/timelines/{id}/presets/capture` accepts
`{query:FrameQuery,clip_ids,options:{name,attributes,anchor,append_filters}}`.
It validates snapshot identity and returns `{project_epoch,generation,revision,
preset}` without changing history. Linked clips join the source selection;
the earliest video and audio clips supply the native preset. The v1 JSON fields
match the desktop attribute preset: version, name, attributes, anchor,
append_filters, shortcut, fps, resolution, video and audio. Web capture leaves
shortcut null; the DTO accepts native shortcut metadata without activating bindings.

`POST /api/v1/timelines/{id}/presets/apply` accepts the ordinary mutation envelope
with `operation:{kind:"apply_attribute_preset",clip_ids,preset}` and a 4 MiB body
limit. It refuses other operations. Small preset operations also fit the ordinary
timeline command route, whose 256 KiB limit is unchanged. Lease, epoch,
generation, revision and durable receipt checks remain in the session actor.
Native `Conversion::preset`, attribute merge and speed ripple commands perform
all changes as one ApplyPreset history step. Start/End/Stretch anchors, fps and
pixel scaling, append/replace filters and linked-target validation are retained.
Source IDs do not suppress targets in another project. Invalid key ordering,
unrepresentable coordinate conversion, nonfinite converted values or locked
linked targets reject the complete operation before native session mutation.
Saved library routes are implemented as described below; NAS sharing and GUI
acceptance remain separate qualification work.

`GET /api/v1/presets` and `/presets/pages/{page}` accept
`{project_epoch,search?,archived?}`. Each zero-based source page opens at most 32
preset files, with a 4 MiB per-file limit and 10000-name browsing budget. Search
filters that source page; `pages` and `total` describe source files. The panel
advances through empty search pages with cancellation between reads. Items carry
ID, SHA-256 revision, native options/format, source video/audio presence and
shortcut metadata, without full source clips or numeric native IDs.

`GET /presets/items/{id}?project_epoch=...` reads active metadata;
`GET /presets/items/{id}/download?project_epoch=...` returns native JSON bytes as a
no-store attachment. IDs are bounded ASCII filename tokens, not filesystem paths.

Timeline operations `save_attribute_preset{clip_ids,options}` and
`apply_saved_preset{clip_ids,preset_id,revision}` use ordinary guarded mutation
envelopes. Save uses the command ID as an immutable library ID; apply rejects a
changed preset before editing. `POST /presets/commands` accepts only
`edit_preset_library{edit}` with an 8 MiB envelope budget for escaped native JSON.
Edits are import `{action:"import",json:<raw string>}`, update
`{action:"update",id,revision,options}`, or archive/restore/restore_previous
`{action,id,revision}`. Import parses in Rust; no browser number conversion occurs.
Update retains source clips/shortcut metadata and creates a previous copy;
restore_previous atomically swaps active/previous files. Archive is recoverable.
Library mutations preserve native timeline history and share ordinary lease,
epoch, generation and durable receipt semantics. A changed response after a
successful ACK requires a read refresh, not a new save/import command.

`GET /api/v1/timelines/{id}/clips/{clip}/keys/{page}` takes the existing
FrameQuery and validates its epoch, generation, timeline and revision. Pages
are zero-based and expose up to 256 native keys per parameter, with exact
values, interpolation and source/timeline coordinates. `key_page` contains
`index`, `page_size` and `total_pages` (the maximum page count among parameters,
at least one). An overflowing or out-of-range page is rejected. Reads do not
create history steps. The original clip detail route retains its first-page
scalar/typed limits for existing clients.

Property, filter, mask and title summaries retain at most 16 keys plus the
native `key_count`; complete scalar and typed keys are available through the
key pages. These summaries do not replace native tracks or modify saved files.
The browser retains up to 2048 cross-parameter picks across page/row changes,
reports picks outside the displayed list and provides an explicit clear action.
The all-parameter list is bounded to 2048 options; its parameter filter exposes
each row's complete current page. Native mutation validation rejects a group
containing a removed key rather than silently dropping a hidden pick.

Clip detail includes `source_size:[width,height]`, using native media dimensions
or timeline dimensions for generated sources. Transform `value` remains native
evaluation at the reported source frame. The viewer overlay does not interpolate
in JavaScript. Guarded timeline command
`edit_viewer_transform{clip_id,timeline_frame,transform:[{param,value}]}` accepts
1–11 distinct geometric axes: ZoomX/Y, PositionX/Y, Rotation, AnchorX/Y and the
four Crop sides. The selected video clip must be unlocked and contain the frame.
All values and the resulting evaluated crop pairs are validated before mutation;
each crop axis must retain at least one source pixel. Unchanged f32 values are
skipped. Native constant tracks change defaults; animated tracks upsert a Linear
key at `clip.source_frame_at(timeline_frame)`, including replacement of existing
interpolation, matching desktop handles. Undo restores the exact previous value
and interpolation. Frozen pictures retain native effect-animation time mapping.
Mixed static/animated axes form one native composite; no effective change adds
no history. Existing `set_properties` default-edit semantics remain unchanged.
Displayed-frame, property, project/generation/timeline/revision, playhead and
viewport identities must remain current before a gesture begins or completes.

Scalar `edit_curve_key` and `edit_curve_keys` edits accept optional
`link_zoom:true`. Omitted or false preserves the original request serialization,
including durable receipt fingerprints. For Zoom X/Y, creation adds both keys;
edits of existing keys include only an existing twin at the original source
frame. Both plans are validated before one native composite command is applied.
Single-key edits couple value, time and interpolation. Group time-only edits
preserve each axis's values and outgoing interpolation; group value edits copy
the active axis's resulting values to existing twins while retaining each
axis's outgoing interpolation. Group deletion removes selected existing twins.
Any collision or invalid member rejects the complete edit. Zero group movement
and value delta adds no history step. Other parameters retain their usual behavior.

The inspector's shared Zoom link checkbox also couples default property values
through SetProperties and paired playhead keys through SetKeyframes. Toggling
the checkbox itself changes only browser view state.

`edit_key_selection {clip_id,edit:{picks,link_zoom,action}}` groups keys from
different parameter rows of one clip. Each pick is
`{target,source_frame}` using the existing scalar or RGBA/text/direction target
DTO. Requests contain 1–2048 distinct picks. With `link_zoom:true`, existing
Zoom X/Y twins at the same source frame join the operation; absent twins are
not created. Values remain under native engine control.

Actions are `{kind:"move",delta_source_frames:integer}`, `{kind:"delete"}` or
`{kind:"interpolation",interpolation:<native interpolation>}`. Moves validate
all selected keys and twins, checked integer addition, the visible source range
and collisions with unselected keys before applying native MoveKeyframes.
Delete uses a native RemoveKeyframe composite; interpolation uses native
SetKeyframeInterpolation, including bounded Bezier controls. Every successful
nonzero move, deletion or interpolation operation is one history step. A zero
move adds no step. Missing targets/keys, locked tracks or any invalid member
refuse the whole group. The normal lease, epoch, generation, timeline revision
and durable receipt rules apply. This command does not alter default parameter
values or couple vertical value edits in the separate scalar curve graph.

`GET /api/v1/preview/cache` accepts a normal `FrameQuery` and returns
`{frames:[integer],programs:[{id,start_frame,end_frame}]}` with `no-store`.
Only cached composed frames and ready composed movies matching the current
epoch, generation, timeline, revision, requested width and input identities
are included. Source proxies, scope images, analysis results and exports are
excluded. This reads metadata without requesting a render or GPU ownership.

Program preparation may reuse a ready movie that contains the requested range.
Clients must use the actual `program.start_frame` and `program.end_frame` in
the returned descriptor for status/asset requests and media clock conversion.
Before resuming a retained movie, validate its status again; a stale or evicted
entry must be prepared again. The browser retains one ready movie reference,
seeks relative to its actual origin, and checks source validity before playback.
It waits for metadata and the initial seek to complete before Play, including
on cached ranges. Cancellation also aborts these waits, preventing late media
events from starting obsolete playback or canceling newly prepared fast audio.

`POST /api/v1/preview/audio/meters` accepts `{query:FrameQuery,insert:null}` or
`{query,insert:{channel,index}}`. The optional insert selects an enabled native
EQ/compressor on an audio track or `master`. Replies contain the frame, 48 kHz
sample rate, 4096-sample window, post-fader stereo track/master peaks and dBFS
(`null` for silence), overload flags, native master spectrum/peak bin, and optional
before/after insert spectra with three-band compressor activity. Spectra use
the native 4096-point Hann transform, with 2049 frequency bins.

Rendering uses `vv_session::audio_render::render_offline_metered` and the existing
native mixer taps. File pinning, source identity checks, post-render snapshot
checks, the single CPU audio worker, five-second budget and cancellation also
cover these reads. The browser allows one request in flight, discards obsolete
replies, refreshes after a final seek and polls at most every 250 ms while playing.
This is independent window inspection: dynamic processors start afresh for each
window, and peaks between windows are not held. It does not measure the Windows
output device or browser volume. Continuous output-stream metering remains open.

Audio audition is implemented by `GET /api/v1/preview/audio.wav` with the normal
`FrameQuery`, and `GET /api/v1/media/{id}/audio.wav?project_epoch=...&frame=...`
for a source frame. Each returns exactly 80 ms of 48 kHz stereo PCM16 WAV with
`Cache-Control: no-store`. Program audio uses the native offline mixer, including
its gains, fades, inserts, normalization and compounds. Source audio uses the
same native renderer on an isolated unmodified source, independent of timeline
effects. There is no browser mixer or DSP implementation.

The actor validates snapshot identity and pins root-scoped regular media files;
CPU work runs outside the actor with one non-queued worker and a five-second
cancellation budget. Changed files, stale Program snapshots and removed/replaced
sources are refused. The browser opts in through Audio scrub, coalesces requests,
cancels obsolete output, and plays the last fragment only after a timeline seek
or Source seek. Source pointer seeking defers requests until release; settled
keyboard seeks also audition. Pointer movement never makes an audition request.
Fast-forward audio uses the bounded native window API below.

`POST /api/v1/preview/audio/window` accepts `{query:FrameQuery,window}`;
`POST /api/v1/media/{id}/audio/window` accepts
`{query:{project_epoch,frame},window}`. Window parameters are `start_sample`
(48 kHz integer audio frames), `seconds` (2, 4 or 8), `tempo` (2, 4 or 8),
optional `end_sample` inside the snapshot and optional `source_version`.
The start sample must map to the query's native timeline/source frame. Replies
are PCM WAV plus `X-Audio-Start-Sample`, `X-Audio-End-Sample`, `X-Audio-Tempo`,
`X-Audio-Last` and `X-Audio-Source-Version` headers. Subsequent windows bind the
first returned version, an aggregate of pinned input identities; changed inputs
return `SOURCE_CHANGED`. End limits prevent audio escaping a prepared Movie range.

Native rendering and `vv_audio::stretch_samples` do all mixing and pitch-preserving
stretching. The desktop's 2/4/8-second growth and padded tail window are retained,
with output trimmed to the selected range. The single CPU audio worker, source
checks and cancellation budget also cover these requests. Browser output keeps
at most two native buffers plus one request, uses their audio clock to synchronize
video, and leaves volume/mute controls intact. Pausing, seeking, changing document
or canceling preparation stops old output; returning to 1x restores media audio.
At video EOF the queued native tail completes through its audio completion event.
No timeline DSP is implemented in JavaScript. Voiceover playback stays at 1x and
retains captured audio if an external rate change stops its transport.

Implemented Review annotations use `GET /api/v1/review?project_epoch=...` and
project command `edit_review {project_token,revision,edit}`. The latter retains
the common writer/epoch/generation/idempotency guards. `edit.action` is
`new_shot`, `rename_shot`, `delete_shot`, `set_take` or `restore_previous`.
Shot IDs are client UUID strings; take media IDs are native canonical strings.
`set_take` carries `media_id`, nullable `shot_id`, `label`, `rating`
(`unrated|favorite|rejected`), nullable `metadata {model,prompt,seed}` and optional
`rebind_source`. Seeds are exact unsigned 64-bit decimal strings. Null metadata
inherits captured source provenance; a metadata object with null fields records
explicitly unknown values. Changed source identities require explicit rebinding.
The response includes the sidecar revision, project namespace, shots, resolved
take annotations, stale/offline flags and retained orphan annotations.

Annotations live in the root-scoped version-1 `<project>.vvproj.review.json`
sidecar, bounded to 4 MiB, 1024 shots and 4096 annotated takes. Writes use
descriptor-based atomic publication and a rolling previous version. The native
project and timeline Undo are unchanged; `restore_previous` swaps the last two
annotation states. Save As copies annotations independently, with rollback on
failed native save. Existing sidecars, unknown schemas and links are preserved
and refused when unsafe to edit. Backup recovery copies associated annotations;
removed media remain visible as retained orphan annotations.

Timeline `paste_attributes {clip_ids,clipboard_revision,attributes,keyframes}`
uses the native clip clipboard and shared `vv-core::attributes` conversion.
`clipboard_revision` comes from the session snapshot. Attribute names are the
native serialized enum names (`opacity`, `crop`, `filters`, `masks`, `speed`,
etc.); keyframes are `maintain_timing` or `stretch_to_fit`. The native composite
uses first copied video/audio sources by kind, preserves unchecked properties
and skips copied source clip IDs. Matching timeline FPS is required. Speed uses
native Ripple/pitch behavior. Locked linked targets, stale copies and a ripple
that would separate linked clips refuse before any mutation. The complete
result is validated on a native project clone and applies as one PasteAttributes
Undo step; no editing algorithm runs in JavaScript.

Project `save` also binds the current on-disk file identity and SHA-256 recorded
by validated Open/last Save. Changed/replaced/missing files return 409
`SAVE_CONFLICT` and retain dirty in-memory state/history. Repeating that command
ID returns its original refusal. Use no-replace `save_as` to preserve current
edits, or explicitly reopen the external file after preserving them. The normal
Save path rechecks before backup/publication but does not provide an atomic lock
against arbitrary external writers across the final check/rename interval.

The session snapshot also exposes nullable `persistence_notice`. Successful
project lifecycle operations remember the current token and saved-file SHA-256
in private, version-1 `.venturi-last-project.json` metadata (4 KiB cap). Startup
reopens matching saved content through normal native validation and establishes
a fresh Save baseline. Changed/missing/unsupported files are preserved and
require explicit Open. Auxiliary cursor failures leave successful native project
acknowledgments successful and report the notice separately. This is saved-state
restoration; no unsaved autosave or durable render-job claim is implied.

Unsaved recovery is now implemented separately by `GET /api/v1/recovery` and
project command `recover_autosave {revision,name,open}`. Status is `empty`,
`ready`, `saved`, `pending` or `blocked`, with optional root project token,
snapshot revision, creation time, changed-base flag and resolved-copy token.
The session snapshot also includes this metadata in `autosave`; the full native
snapshot payload is never served by this route. Recovery uses the normal writer,
epoch/generation/idempotency checks and an exact snapshot revision. It creates a
no-replace project plus a source Review sidecar copy. `open:true` refuses dirty
current sessions; `open:false` keeps their project/history and save baseline.

The actor periodically stores dirty native RON in private version-1
`.venturi-autosave.json`, with an 8 MiB RON / 16 MiB record budget, checksums,
NOFOLLOW reads, exclusive temporary writes, fsync and atomic publication. A
previous-session pending record is frozen until a recovery copy is kept. Save/
Save As resolve owned snapshots against saved files; opening a recovery resets
history through native Session installation. Missing backing files still permit
validated recovery to a new name. Unknown/corrupt/linked records remain intact.
The snapshot interval is not durable command acknowledgment or a render queue.

The implemented M2 subset and its deliberate schema deltas are documented in
[RUNNING.md](RUNNING.md#actual-api-deltas-from-the-proposal). In particular,
project epoch is now a string and every mutation also requires client ownership
and project history generation. The JSON schemas reflect implemented timeline
DTOs and the safe move/trim/split request subset, rather than the earlier examples
below. Unimplemented routes in this design table must not be assumed available.

Session snapshots and successful mutation receipts include a string
`command_epoch`, independent of the project epoch. Mutations send that value.
At 4096 retained receipts, the host rotates the command epoch, keeps the boundary
receipt and continues without saving/restarting or resetting model/history/view
identity. Stored request identities are fixed SHA-256 digests. Matching cached
retries return their original result; changed bodies reuse neither the ID nor its
effect. Evicted commands from an earlier receipt epoch return
`COMMAND_EPOCH_EXPIRED` before engine work, even if history generation is unchanged.
Unknown old lookups remain 404. Never refresh the epoch of an unresolved envelope
to replay it. A missing/null command epoch is accepted only in the initial epoch
for legacy clients.

Successful receipts are also appended to a root-local, checksum-checked, synced
JSONL journal (4096 successes / 8 MiB, atomic rotation). The journal retains request
fingerprints and acknowledgments, never request bodies or credentials. Before an
edit ACK, a named dirty project is synchronously checkpointed through the existing
native RON recovery store. ACK `durability.state` is `saved`, `recovery` (with a
checkpoint revision), or `volatile` when recovery is unavailable, blocked or held
for an earlier unresolved project. `receipt_persisted` separately reports journal
success. An auxiliary persistence failure does not disguise an applied edit as a
failed operation. Save current edits when either field reports unavailable safety.

After server restart, retained successful lookup/retries include
`server_restarted: true` and never execute the command again. The normal saved
project is reopened; unsaved native state remains an explicit recovery copy. The
browser warns to check recovery. Historical checkpoint revisions may have been
superseded by later edits or resolved by a later Save. Undo stacks, writer leases,
clipboard contents and transport state are process-local. Receipt lookup confirms
the historical operation, not that its transient UI state was restored. Failed
commands and evicted successes are not persisted; unknown old envelopes still
cannot pass the new project epoch. Incomplete/corrupt/linked journals are preserved,
reported unavailable, and do not prevent recovery or manual Save. This is not a
durable render queue or an exactly-once transaction for external sidecar writes.

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

## Implemented Inspector commands

- GET `/library` reads the configured ds4-appliance catalog off the actor.
  It returns configured/archive reachability, retention, sequence and bounded
  items; archive filesystem paths are omitted. Seeds are strings or null to
  preserve every u64 bit in JavaScript. An unconfigured server returns
  `{configured:false,items:[]}` without contacting any service.
- POST `/library/items/{id}/prepare` with `{project_epoch}` prepares an explicit
  project copy from the authoritative SSD/archive file API. GET/DELETE
  `/library/jobs/{job}?project_epoch=...` reports progress or requests cancel.
  One transfer runs with one queued; eight process-local results are retained.
  Each item is at most 512 MiB with a three-minute HTTP deadline. Catalog reads
  are at most 4 MiB/5000 items and two concurrent requests. Service origin is
  configured only at startup, with no credentials/query/path or HTTP redirects.
- Transfers validate IDs, names, media signatures, native streams/timing and
  byte count before a no-replace publish under the actor's exact root directory
  descriptor. SHA-256 names and .origin.json sidecars retain provenance; an
  existing different file, symlink or changed prepared source is refused.
  Project copies are persistent editing inputs, not evictable proxy cache.
  Existing import_media reuses the native MediaId for the same copy. Missing
  shared uses can be prepared again and relinked in one native catalog command,
  retaining clip IDs, keys and edit geometry. Changes to project epoch/generation
  suppress automatic registration of a late transfer. Source copies remain
  available through the root picker if registration cannot complete.
- PNG/JPEG/WebP Source jobs deliver original image bytes, fixed image MIME and
  native thumbnails. Stills do not use a movie clock or silently transcode.

- `remove_track {track}` reuses native RemoveTrack, including its clips and
  crossings, as one Undo. Locked tracks and the last track of either kind are
  refused. `set_track` additionally accepts `armed`; only saved projects with
  an unlocked audio track can arm recording. Native flag labels now distinguish
  MuteTrack, SoloTrack, LockTrack and ArmTrack. Snapshots include armed state.

- POST `/recordings/{uuid}` accepts little-endian interleaved float32 audio with
  `application/octet-stream`. Query fields: `project_epoch`, `client_id`,
  `sample_rate`, `channels`, native `format` ID. A saved project and writer lease
  are required. One upload runs at a time: 64 MiB, five minutes, one/two channels,
  8–192 kHz and a 120-second body deadline. Native encoding runs off the actor
  into an exclusive descriptor and publishes without replacing existing files.
  Versioned receipts preserve frame count and raw/encoded SHA-256. Identical
  UUID retries return the same receipt; changed captures/saved files are refused.
  GET `/recordings/{uuid}` resolves an uncertain upload; GET
  `/recordings/{uuid}/audio` streams Range audio. Upload never edits the project.
- `place_recording {placement:{recording_id,tracks,start_frame,latency_frames,
  overwrite}}` validates file identity and distinct armed, unlocked audio tracks
  before native import/insert/disarm as one RecordVoiceover Undo. Default overlap
  is refused; explicit overwrite preserves locked linked tracks. Positive latency
  correction moves the start earlier; correction past zero trims the native
  source offset. Native FPS conforming remains authoritative. Fresh commands
  cannot place a take twice; intentional reuse uses the media pool. Document or
  arming changes require explicit rebinding of a retained browser take.
- Browser Start requests microphone permission. Bounded AudioWorklet packets
  preserve short final chunks and perform no editing/DSP. Composed playback is
  prepared before capture. Stop/input loss/programme end/document changes flush
  audio and release input tracks. Upload failure retains a local WAV backup and
  retry action. Unsaved take discard requires confirmation; releasing a saved
  take never deletes server audio. Session `recording_formats` lists encoders.

- POST `/review/replace/plan` takes `{query:FrameQuery,replacement}` and never
  edits the project. Replacement fields: canonical string `clip_id`/`media_id`,
  integer media `source_in`, `duration` (`preserve`/`shorten`), `links`
  (`replace_linked`/`selected_only`), `attributes` (`preserve`/`reset`), nullable
  `source_version`. The native plan returns canonical IDs, before/after lengths,
  native source ranges, removed crossing count, merged animation-key count and
  the current source version.
  Changed imported timing/streams/fingerprint require explicit relink/reimport.
- Timeline `replace_take {replacement}` additionally requires that previewed
  source version. It revalidates epoch/generation/revision, source descriptor,
  locks, streams, linked media/speeds and the complete trial project. Native
  `vv_core::take::plan` supplies one ReplaceTake command: clip IDs, placement and
  existing speed stay; a short take is refused unless shorten was chosen.
  Shortening never ripples following clips and removes affected cross-cut
  transitions within the same Undo. Preserved keyframes follow source FPS/In;
  crop follows the native relink resolution convention. Reset affects clip
  effects/fades, keeping labels/disabled/link/speed state. Media entries and
  source files remain unchanged. Frozen clips and compounds must be handled
  explicitly before take replacement. Review offers two independent bounded
  source players with equal-elapsed-time comparison and exclusive audio
  audition. Replacement always requires a visible native preview followed by
  Confirm. Changing a take, policies or native document invalidates that plan.
  Keys map through native timeline frames; rounding collisions retain the first
  key and their count is shown before confirmation. Shot/Take sidecars are a
  separate pending slice.

- POST `/analysis/silence` accepts `{query: FrameQuery, clip_ids, params}`.
  The actor captures selected audio and audio linked to selected video; native
  Silero VAD runs on a CPU worker without holding the Session. Params are native
  threshold, min_silence_secs, head_secs and tail_secs. GET
  `/analysis/silence/{job}?<FrameQuery>` revalidates the document and source file
  descriptors before returning progress and native integer cuts. DELETE uses
  the original query even after a project edit to cancel remaining work.
  Analysis never edits the project. One worker/one queued job, eight retained
  results, 64 selected clips, 24 hours of distinct source audio, ten minutes of
  execution and a 32 MiB/64-stream LRU bound the work. Parameter changes reuse
  cached native probabilities; no speech detection or cut planning runs in JS.
- Timeline `remove_silences {ranges:[[start,end],...]}` uses native
  `delete_ranges(Ripple)` and one RemoveSilences history entry. Up to 4096 cuts
  are validated on a trial project. Any affected locked track refuses the
  entire operation. Source files stay unchanged; all timeline tracks ripple.
  The command route accepts up to 256 KiB; other JSON routes retain 64 KiB.

- GET `/timelines/{id}/clips/{clip}/slip/{center}` takes the usual FrameQuery.
  It returns linked handle intersection, source FPS, all linked IDs, lock state
  and an exact native `[delta,first,last]` source-frame map. At most 65537
  positions around center are returned; a different center can refresh the
  window explicitly. Descriptor file identity invalidates the local proxy cache
  after source replacement. No project or history mutation occurs on this read.
  The dual viewer uses a bounded 32 MiB local MP4 Blob and never sends HTTP from
  pointer movement. One completed timeline gesture sends the existing `slip`
  command; Escape/capture loss cancels local drafts. Numeric Apply and the
  two-image source display use the same native frame map and command.

- Project commands accept `edit_catalog` with a typed `edit`: `new_folder`,
  `rename_folder`, `move_folder`, `delete_folder`, `move_media`, `remove_media`
  or batch `relink`. Folder IDs and media IDs are canonical strings. Folder
  creation is bounded to 512; media batches contain 1–64 distinct existing IDs.
  All changes use native commands and one Undo. Folder deletion lifts contents
  to its parent; media removal leaves clips offline and never deletes files.
  Relink uses listed file tokens, NOFOLLOW descriptor probing/fingerprinting,
  native FPS/crop/key adaptation and trial project validation. Used streams and
  source ranges must remain available; locked references, compound-file relink,
  folder cycles and partially valid batches are refused. File `content_hash`
  in session snapshots invalidates browser Source and asset caches after relink.

- Clip detail also returns `curves`: visible native source-frame bounds and
  scalar transform, gain, grade, filter and mask tracks. Native `value_at`
  produces at most 769 samples per animated track (two for constants).
  The first 2048 keys include exact source/timeline frames, outgoing
  interpolation and native `control_points`; `key_count` reports truncation.
- `edit_curve_key {clip_id, edit:{target, previous_source_frame, source_frame,
  value, interpolation}}` adds, edits/moves or deletes (`value:null`) one key.
  Exact source coordinates avoid a lossy timeline round trip on conformed
  clips. Existing keys must exist, destinations must be inside the visible
  source range, and another key at the destination returns
  `KEYFRAME_COLLISION`. Hidden keys can be deleted. Target/value/Bezier/track
  lock validation completes before a single native CompositeCommand applies.
  Usual epoch/generation/revision/writer/idempotency guards apply.
- `edit_curve_keys {clip_id, edit:{target,source_frames,delta_source_frames,
  delta_value,delete}}` moves or deletes 1–2048 distinct keys on one native scalar
  track. Moves preserve each key's outgoing interpolation/Bezier controls and
  use one shared frame/value delta. Every destination/value is validated before
  native commands apply. Selected origins may become selected destinations;
  unselected keys are never overwritten. Removes precede inserts in one native
  CompositeCommand, so Undo restores the whole group. Invalid/overflowing/stale
  selections and locked tracks are refused without partial edits. Zero movement
  has no history effect. The browser supports box/additive selection, accessible
  multi-select/delta controls, local drafts and Delete scoped to curve focus.
  Zoom/pan operate on bounded browser viewport state, never the native project.
- Clip detail `event_keys` exposes native RGBA, title-content and blur-direction
  tracks with typed defaults, choices, key counts and the first 1024 source/time
  keys plus outgoing interpolation/control points. RGBA is `{r,g,b,a}` in 0–1;
  text is literal UTF-8 (4096-byte edit budget); direction uses the native enum.
- `edit_event_key {clip_id,edit:{target,previous_source_frame,source_frame,value,
  interpolation}}` inserts/edits/moves or deletes (`value:null`) one typed value
  key. Targets are `{kind:"color"}`, `{kind:"text"}`, or
  `{kind:"direction",filter:"GaussianBlur"}` (also BoxBlur). Validation and
  collision checks complete before a native Upsert/Remove CompositeCommand.
- `edit_event_keys {clip_id,edit:{target,source_frames,delta_source_frames,delete}}`
  moves a group through native MoveKeyframes or deletes it in one native Undo.
  Values and interpolation never pass through a browser evaluator. The same
  distinct-key/range/overflow/lock/conflict rules apply; unselected destinations
  are never overwritten. These are video-track value targets. Both commands use
  normal writer, epoch, generation, timeline revision and idempotency guards.

- GET `/api/v1/timelines/{id}/clips/{clip}` accepts the same revisioned query as
  exact frame preview. Returns native evaluated/default transform and gain,
  source-frame keyframes, bounds, fades, RGBA, blend and matte choices. Reads
  reject stale epoch, generation and revision.
- Timeline command `set_properties {clip_id, patch}` accepts transform entries
  `{param,value}`, flip, gain_db, blend, matte, color, fade_in and fade_out.
  Native enum names are case-sensitive. Matte `None` clears the matte. All
  supplied properties apply in one undo step after complete validation.
  Viewer handles use `edit_viewer_transform` above to choose native default or
  current-source-frame key changes per axis.
- `set_keyframe {clip_id,edit:{target,timeline_frame,value,interpolation}}`
  targets `{kind:transform,param}` or `{kind:gain}`. Native code converts the
  integer timeline frame into a source frame. Null value removes that keyframe;
  a number inserts/replaces. Track kind, locks, clip bounds, numeric ranges and
  interpolation control points are checked before mutation.
- `insert_media` additionally accepts source_in/source_out, in integer source
  frames with exclusive out. Omission preserves full-source/default still
  insertion. Native rate conversion and safe overlap checks remain authoritative.
- `slip {clip_ids,delta_frames}`, `link_clips {clip_ids,unlink}` and
  `set_disabled {clip_ids,disabled}` expand whole linked groups and validate all
  involved tracks before native atomic commands.
- `set_marker {marker:{id,delete,start_frame,duration_frames,note,color}}`
- `move_marker {marker_id,start_frame,duration_frames}` preserves the native ID,
  note and color, validates the integer range and applies one `SetMarker::moved`
  Undo step. An unchanged range creates no history entry. Marker moves use the
  normal project/generation/timeline revision guards.
  creates with null id, edits with an existing ID, or removes with delete=true.
  Palette names use native capitalization; snapshot includes palette RGB.
- `add_generator {track,start_frame,length_frames,generator}` adds title or
  adjustment using native generator defaults and safe overlap checks.
- Properties patch `title` changes validated text/typography/background fields
  while preserving unspecified native attributes and existing text keyframes.
- `set_transition {clip_id,slot,transition}` uses slot in/out/cut_after and a
  native Transition `{kind,duration,direction,ease,curve}` or null for removal.
  Cut-after requires adjacent clips; duration is at most twice their minimum
  length. Edge duration is at most the selected clip length. Single-edge
  SmoothCut follows the native dissolve fallback.
  Timeline crossing snapshots include the full native `transition` object as
  well as existing kind, clip IDs and window bounds. Duration handles preserve
  kind/direction/ease/curve and change only duration through this route. Crossing
  ends grow symmetrically; odd durations put the extra frame on the left, matching
  the native window. Pointer drafts use native rounding and limits, send no HTTP
  during motion and commit once on an owned release. Stale timeline/viewport,
  selection, lock or writer state cancels; unchanged durations add no command.
  Native/API/Save/restart evidence is in
  `evidence/m4-transition-duration-handles.json` (182 Rust/195 JavaScript tests,
  fmt/clippy/build). Transition selection and Alt-drag duplication, GUI/DPI,
  rendered and hardware acceptance remain open.
- Project commands accept undo, redo and `history_jump {position}`. Native
  history positions run from zero through the current label count. All standard
  writer/epoch/generation/idempotency preconditions apply; timeline preconditions
  are unnecessary for these project-wide history operations.
- Project `save_as {name}` writes a new `{name}.vvproj` inside the root with
  atomic no-replace semantics. It then switches the current save path. Existing
  names return FILE_EXISTS and never replace the current path or source file.
- Project `new_timeline {name,fps:{num,den},resolution:[width,height]}` creates
  a native timeline and its compound media entry. FPS must be positive and no
  greater than 240; dimensions are 1–8192, with at most 64 timelines.
- Session media entries expose compound_timeline_id. Native insert_media now
  accepts these entries, validates cycle safety and conforms native source FPS
  to the destination. Source double-click opens that timeline; compound media
  itself uses composed Program playback rather than an original-file proxy.
- `set_mixer {channel,gain_db,pan}` edits native gain/balance on an audio track
  ID or channel `master`. Gain is -100..30dB and balance -1..1; all supplied
  fields validate before one history entry. Track locks apply to track strips.
- `set_audio_effects {channel,effects}` replaces an ordered native insert chain
  (maximum 32), after validating all EQ/compressor/normalization ranges and
  crossovers. Enabled state is preserved in native AudioEffect JSON. One
  composite history entry reverses the entire change.
- Session audio_effects contains native defaults/ranges; timeline master and
  track mix include native effect chains. GET
  `/timelines/{id}/audio/{channel}/eq/{index}` uses the exact-frame identity
  query and returns 128 committed native frequency-response points at 48kHz.
  This read does not require a GPU or create an audio output device.
- `edit_filter {clip_id,edit}` supports actions add/remove/move/set. Each takes
  a native filter kind; move adds to_index, set adds a typed patch. Patches can
  set enabled/radius/direction/amount/shadow fields and grade entries
  `{param,value}`. Native defaults, bounds and existing keys remain server-owned.
- Scalar keyframe targets additionally include grade, filter_radius,
  filter_amount, filter_grow and filter_offset. `set_keyframes {clip_id,edits}`
  prevalidates 1–64 edits and applies one native composite history step.

## Native stopped-frame scopes

GET `/preview/scopes/{clip}/{first}/{second}` takes the guarded FrameQuery.
Kinds are Waveform, Parade, Vectorscope or Histogram. It returns a 1024x256
PNG containing two native 512x256 scope textures. The selected video clip must
contain the playhead; its track is isolated, retaining lower tracks only for
an adjustment clip, matching desktop scope input. Native decoding, crossings,
matte stacking, effects and shader measurements are reused. Source composition
uses the bounded frame resolution. Output uses the same one-running/one-pending
queue and 8-image/16 MiB cache as exact preview, keyed additionally by clip and
scope kinds. Analysis cannot replace a pending Program seek. Native jobs use
the same shared hardware lock or explicit software lock. The document identity
is checked again before delivery. The UI rejects obsolete selections/kinds,
updates only on stopped frames and marks retained scopes stale during scrubbing
and composed playback. There is no browser-side signal measurement.

## Native presets

- `apply_grade_preset {clip_id,preset}` accepts Native GradePreset names Neutral
  or BlackAndWhite from the clip filter catalog. It calls GradeTracks::apply_preset
  in one native filter command. Neutral resets grade tracks/keys; BlackAndWhite
  resets only global Saturation, preserving other grade animation and filters.
- `apply_audio_preset {channel,index,preset}` selects a native EQ/compressor
  preset ID from the session audio catalog. One native SetAudioEffect command
  changes only that insert's parameters, retaining bypass and chain order.
  There are seven EQ and seven compressor choices, shared with desktop through
  vv-core::presets. Wrong-kind/unknown IDs, absent inserts and locked tracks
  refuse the command without a partial edit. Saved attribute presets use the
  separate library endpoints described above.

## Native Auto Balance

GET `/preview/balance/{clip}` takes the same FrameQuery and returns a native
read-only Auto Balance suggestion plus its captured identity. It composes the
same isolated track stage against opaque black, samples approximately 250k
RGB pixels and calls vv-core::auto_balance. An enabled ColorCorrection filter
is required. It shares the bounded preview worker/cache/lock and rechecks the
document before delivery. Program seeks take precedence; balance requests take
precedence over pending scopes. The browser refuses changed target/frame or
document identity before committing the returned typed operation.

Timeline `apply_grade_at_frame {clip_id,frame,values:[{param,value}]}` validates
1–18 distinct native values, frame containment, video kind, track lock and
combined wheel bounds before one native set_clip_filters command. Constant
wheel rows change defaults; if any parameter in the wheel is animated, changes
use native source-frame keys (Linear), matching desktop grading semantics.
Unchanged analysis creates no command. Undo restores the complete filter stack.

## Saved backup recovery and root ownership

The projects listing adds regular flat-root .vvproj.bak files under backups.
Project `recover_backup {path_token,name}` requires a clean session, validates
the backup through the same 8 MiB/NOFOLLOW/native project/media/depth checks as
Open, and writes a new no-replace .vvproj before installing a fresh epoch.
Existing source/project/backup files remain intact. Retries return the original
acknowledgment. Dirty sessions should use Save As before recovery; normal Save
updates the one previous-save backup. This is saved-version recovery, not
unsaved edit autosave or a durable render queue.

One vv-web process owns a canonical project root through a nonblocking kernel
directory lock. Startup refuses a second cooperating host, even through a path
alias, before media workers or Vulkan initialization. Process exit releases
the descriptor lock automatically. No lock file is deleted. Other project roots
remain independent; the hardware reservation remains a separate mechanism.

## Explicit software compositor

The launcher accepts --software-preview with only the installed lavapipe ICD,
an unprivileged Linux process and at most two renderer threads. It is mutually
exclusive with --gpu-device. Capabilities expose software_preview and native
diagnostics expose software, adapter/driver and actual residency. This mode uses
a private cache lock and returns RENDER_BUSY for contention; AMD paths retain
the shared hardware reservation and GPU_BUSY. Preview, Program and Export use
the same bounded native pipeline in both modes. No automatic hardware fallback.

## Native export adapter (bounded first release)

POST `/exports` accepts `{range: ProgramQuery, settings:{quality,preset,audio}}`.
The native x264 preset list and CRF 0–51 are validated. The requested range is
an integer exclusive-out range within the captured timeline. Export duration is
independent of the five-minute Program preview window. Width is capped at 1920
and native aspect/pixel budgets still apply.
Encoding/mixing/compositing use vv-session, vv-media and vv-audio. CPU x264/AAC
are explicit; no unverified hardware encoder or decoder is offered.
The returned `program.audio_present` follows the native export rule: requested
audio is included when an audio track contains clips. Download labels use this
actual stream choice; empty audio tracks do not announce an AAC stream.

The shared bounded media worker runs one job and queues one more; output is
limited to 512 MiB and ten minutes of processing. Export records and output use
`<projects-root>/.exports`, separate from the ephemeral Source/Program cache.
Native normalization analysis respects the caller's nonzero CPU thread
budget; the desktop's default automatic policy is preserved. Identical
snapshot/settings/input identities return the existing job. GET/DELETE
`/exports/{job}?project_epoch=...` reports/cancels it. GET
`/exports/{job}/export.mp4?project_epoch=...` downloads the completed immutable
snapshot with byte ranges and a fixed safe attachment filename. Later edits
do not invalidate an export. Media replacement during generation fails it;
completed encoded files remain independent of later media changes. Export
job IDs cannot retrieve Program/Source jobs or vice versa. There is no
user-selected server output path and no overwrite of source/project files.

`GET /exports` lists retained jobs, their original `project_epoch`, saved progress
and capacity. Status/download references use that saved epoch even after server
restart or opening another project. State includes `interrupted`,
`previous_state`, `cancel_requested`, `durable`, `durability_error` and the saved
manifest SHA `export_revision`.
Manifests are atomically published with file/directory sync; completed output
is finalized before READY is persisted and its file identity is checked on
download/recovery. Queued/running records recovered after restart become
`interrupted` with `SERVER_RESTARTED`; persisted cancellation requests recover
as canceled. Jobs are never automatically resumed. Changed/missing completed
output becomes failed rather than downloadable. Failed persistence hides the
UI download; unreadable history blocks export endpoints with
`EXPORT_HISTORY_UNAVAILABLE`, preserving files and editor/preview availability.

Retention is bounded to 64 records and 2 GiB of charged output, including failed
or interrupted partials. Each pending job reserves 512 MiB. Admission refuses
`EXPORT_CAPACITY` when either limit would be exceeded; there is no automatic
eviction. Source/Program jobs remain ephemeral and cannot read
export records. The drawer lists saved exports and retains the latest selection
in session storage. Hardware codec selection, arbitrary output formats, automatic
resume and automatic retention policies remain open.

`POST /exports/{job}/discard` accepts
`{project_epoch,revision,command_id}` with the original export epoch, current
`export_revision` and a canonical lowercase UUID. The bounded request must target
a durable ready/failed/canceled/interrupted export. Success returns
`{id,status:"discarded",project_epoch}`. Wrong/missing references return 404,
including repeated requests after completed removal; stale revisions return
`EXPORT_CHANGED` (409). Active jobs and uncertain metadata cannot be discarded.
An active download holds a shared file lock; discard requires a nonblocking
exclusive lock and otherwise returns `EXPORT_DOWNLOAD_ACTIVE` (409).

The store commits a CAS-protected `discarding` intent before unlinking only
recorded regular output files. It syncs the directory, removes the empty job
directory and removes the manifest last. Restart completes committed discard
intents only. Unknown, linked or changed files are preserved; blocked intents
remain visible and conservatively charge 2 GiB until cleanup succeeds. A bounded
durable ID watermark prevents discarded IDs from being reused. The browser reads
fresh metadata before an exact-job confirmation, binds its immutable receipt and
does not automatically repeat an uncertain request. Successful removal remains
acknowledged if the subsequent history refresh fails. This removes generated
output/history only and cannot be undone; project files and source media remain.

169 Rust and 151 JavaScript tests, fmt, clippy and build pass. Finite software
API acceptance verified mixed animated/static edits, exact Undo/Redo/retry,
atomic crop rejection and completed H.264 download preservation after an owned
forced restart. Running work recovered as interrupted and persisted queued
cancellation recovered as canceled, without automatic rerender.
See `evidence/m4-animated-viewer-durable-exports.json`; GUI/hardware acceptance
remains open. Earlier six-minute export/browser-download proof remains in
`m3-six-minute-export.json`.

Terminal-discard qualification passes 175 Rust and 158 JavaScript tests plus
fmt/clippy/build. Finite no-GPU API/restart proof removed three owned jobs and
released exactly their three slots/2,423 charged bytes; stale/wrong-epoch/repeated
requests did not change remaining files or quota. See
`evidence/m3-export-discard.json`. Browser confirmation and real filesystem
failure qualification remain open.

- Timeline `set_speed {clip_ids,percent,pitch_correction,fit}` uses native
  SetClipSpeed with percent 1–10000, whole linked groups and fit keep_length,
  resize or ripple. A native trial application validates all resulting clip
  ranges and rejects overlaps before one real history entry. Ripple follows
  the desktop's unlocked-track policy. Native source-offset rounding applies.
- `set_freeze {clip_ids,frame}` freezes at an integer timeline frame or clears
  freeze with null, using SetClipFreeze and the same linked/lock validation.
- `set_display_color {clip_ids,color}` changes native ClipColor labels (null
  restores the default). This label is distinct from rendered solid RGBA.
- `edit_mask {clip_id,edit}` accepts add(shape), remove(index),
  move(index,to_index), set(index,patch), or
  path_key(index,timeline_frame,path). A path key uses native source-frame mapping
  and Linear insertion/replacement; null removes the key at that exact frame.
  This explicitly starts path animation; viewer edits retain the static/animated
  policy below. Patch fields enabled/invert/mode,
  parameters `[{param,value}]` and native path `{points:[{point,in_handle,
  out_handle}]}` validate before one native set_clip_masks command. Defaults
  retain existing animation. New shapes fit the source's layer at zoom 1,
  matching desktop mask coordinates. Eight masks maximum; 3–21 Bezier vertices
  per path with a conservative shared 256-point tessellation budget, including
  animated endpoints. Keyframe target `{kind:mask,index,param}` reuses native
  source-frame mapping, interpolation, insertion and removal.
- `edit_viewer_mask {clip_id,index,timeline_frame,parameters,path?}` accepts up to
  five unique geometric parameters `[{param,value}]`: CenterX/Y, Width/Height and
  Rotation, applicable to the mask shape. At least one parameter or Path value is
  required. The unlocked video clip must contain the timeline frame. Constant
  native tracks change defaults; animated tracks upsert a Linear source-frame
  key. Native scalar epsilon no-ops and unchanged paths retain interpolation and
  history. Path edits use native evaluated geometry, leaving the default intact
  when animated. Mask/path limits validate before one native set_clip_masks
  command; other masks/effects/keys remain untouched. Frozen picture time does
  not replace the native effect-animation clock. Detail includes `evaluated_path`
  and `path_keys` (first 16 native source-frame/path/interpolation tuples) alongside
  `path` default and authoritative `path_keyframes` count. The viewer performs no
  key interpolation and sends no command during pointer movement.

Mask handles have 182 Rust/177 JavaScript tests, fmt/clippy/build and finite
no-GPU API/Save/restart proof in `evidence/m4-viewer-mask-handles.json`. Native
tests cover frozen/retimed clocks; the live generated-media fixture covers
ordinary source time. Pen drawing, full path-key navigation, browser/DPI/rendered
and hardware acceptance remain open.

- Project `import_otio {path_token,name}` reads a flat-root .otio file up to
  8 MiB/64 distinct media URLs through the native parser. Media probing and
  fingerprinting use the root policy and NOFOLLOW file descriptors. The imported
  project, mixer/marker ranges and compound cycles validate before a new
  no-replace .vvproj is written and installed. Dirty projects are refused.
  Native parser failure preserves the current session. Import warnings are
  returned in the session snapshot (at most 65 bounded messages).
- GET `/timelines/{id}/timeline.otio` accepts the guarded exact-frame query and
  downloads a native OTIO JSON snapshot, up to 8 MiB, without requiring a GPU.
  Nonempty timelines are supported. Active compound references are refused:
  the native exporter does not serialize their contents; export the child
  timeline instead. Native Venturi metadata now additionally retains track
  mixer/lock/solo, timeline master and markers. Foreign text layout may differ
  because headless OTIO uses the native optional-metrics fallback.
- Timeline `rename_timeline {name}` and `duplicate_timeline {name}` use native
  pool commands. Duplicate allocates fresh clip/link IDs and is one undo step;
  names are nonempty, at most 128 bytes, without control characters.
- `make_compound {clip_ids,name}` resolves linked groups, locks and a native
  plan. This first adapter permits at most one video and one audio track.
  Replacement space must be free of unselected clips, and crossing transitions
  must be selected on both sides. Internal crossings are retained by the native
  planner. Multiple audio clips with enabled per-clip normalization are refused
  because wrapping them changes the native level policy. A native trial checks
  the complete result, including the renderer's maximum compound nesting depth,
  before allocating real entities and applying one composite history step.

Program/Export now reserves the shared nonblocking GPU lock for the entire
bounded native job. Stage permits clone the same locked file description and
wait for submitted GPU work before dropping. The final descriptor releases
the reservation after completion, cancellation or error. Uncached exact
frames return GPU_BUSY while preparation owns the GPU; cached output and
metadata editing remain available. No foreign workload is stopped.

- `copy_clips {clip_ids}` captures native ClipboardEntry values, whole linked
  groups and internal crossing transitions in the session's bounded 4 MiB
  clipboard. It is writer/epoch/generation/revision/idempotency guarded but
  creates no undo step; copying locked tracks is allowed. Session snapshots
  expose only clipboard_count, not clip payloads.
- `paste_clips {frame}` requires the same project epoch and exact timeline FPS.
  A native trial plans missing tracks, fresh clip/group IDs, effect/animation
  copies, internal crossings and cycle/depth checks. Any occupied/locked
  destination refuses the whole paste before real IDs/tracks/history change.
  One composite undo removes all pasted clips and any new tracks. The actual
  browser text clipboard, cross-project transfers and cross-FPS paste are not
  part of this first adapter. Copy again after opening another project.
