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

- GET `/api/v1/timelines/{id}/clips/{clip}` accepts the same revisioned query as
  exact frame preview. Returns native evaluated/default transform and gain,
  source-frame keyframes, bounds, fades, RGBA, blend and matte choices. Reads
  reject stale epoch, generation and revision.
- Timeline command `set_properties {clip_id, patch}` accepts transform entries
  `{param,value}`, flip, gain_db, blend, matte, color, fade_in and fade_out.
  Native enum names are case-sensitive. Matte `None` clears the matte. All
  supplied properties apply in one undo step after complete validation.
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
  refuse the command without a partial edit. Saved/custom preset libraries are
  outside this increment.

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
an integer exclusive-out range within the captured timeline, at most five
minutes. Width is capped at 1920 and native aspect/pixel budgets still apply.
Encoding/mixing/compositing use vv-session, vv-media and vv-audio. CPU x264/AAC
are explicit; no unverified hardware encoder or decoder is offered.

The shared bounded media worker runs one job and queues one more; output is
limited to 512 MiB/ten minutes, inside the private 2 GiB process cache. Identical
snapshot/settings/input identities return the existing job. GET/DELETE
`/exports/{job}?project_epoch=...` reports/cancels it. GET
`/exports/{job}/export.mp4?project_epoch=...` downloads the completed immutable
snapshot with byte ranges and a fixed safe attachment filename. Later edits
do not invalidate an export. Media replacement during generation fails it;
completed encoded files remain independent of later media changes. Export
job IDs cannot retrieve Program/Source jobs or vice versa. There is no
user-selected server output path and no overwrite of source/project files.

Jobs continue while the browser is closed, until server shutdown or cache
eviction. The UI remembers the latest job in browser session storage and can
resume status polling after reload. Durable queues/server restart recovery,
arbitrary output formats and timelines longer than five minutes remain open.

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
  move(index,to_index) or set(index,patch). Patch fields enabled/invert/mode,
  parameters `[{param,value}]` and native path `{points:[{point,in_handle,
  out_handle}]}` validate before one native set_clip_masks command. Defaults
  retain existing animation. New shapes fit the source's layer at zoom 1,
  matching desktop mask coordinates. Eight masks maximum; 3–21 Bezier vertices
  per path with a conservative shared 256-point tessellation budget, including
  animated endpoints. Keyframe target `{kind:mask,index,param}` reuses native
  source-frame mapping, interpolation, insertion and removal.

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
