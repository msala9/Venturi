# Proposed HTTP API contract v1 (NOT upstream endpoints)

Timeline snapshots include native `gaps:[{track_id,start_frame,length_frames}]`
for leading/internal empty intervals on unlocked lanes. Empty lanes and trailing
space are omitted. The shared core helper sorts/scans each lane once; this
metadata does not change the project, revision or history. The browser selects
only these authoritative intervals, without requests during pointer movement.

`close_gap {track,frame}` resolves the clicked interval again under the ordinary
writer, epoch, generation, revision and command-ID guards. Occupied/trailing
positions are invalid and locked target lanes return `TRACK_LOCKED`. The native
`edit::ripple_delete_gap` applies global unlocked-track ripple, overlap repair
and marker clamp/shift as one `RippleDelete` history step. The complete native
trial must validate before mutation. `delete {clip_ids,ripple:true}` uses the
same preflight, replacing its former blanket rejection of unrelated locks.
Locked unselected material remains fixed. All original members of each linked
group must undergo the same timing/trim transformation or all be removed;
partial groups return `TRACK_LOCKED` or `LINKED_GROUP` atomically. A retained
crossing that would lose its valid adjacency returns `CROSSING_CHANGED`.

Canvas clicks and accessible gap buttons share local selection/highlight,
Escape, stale-context and focus guards. Close selected gap, the command palette
and native `IntlBackslash` dispatch through one ripple path; clip selection
uses the existing native delete operation. After a successful current-context
receipt, playhead reveal follows the native snapshot only when a clip lands at
the closed interval's start. Original source bytes are never modified.

`POST /api/v1/media/imports/prepare` accepts strict
`{project_epoch,if_generation,path_tokens}` for 1–256 unique project-root files.
First occurrence order is retained; up to 4096 raw selections may contain
duplicates. The file list uses native `vv_media::is_media_path`, including native
AVI/M4V/AAC/BMP/TIF/TIFF extensions. Preparation does not change the project.
The existing single asset worker probes one pinned regular file at a time in
the native subprocess, with 512 MiB address space, ten CPU seconds and at most
20 wall seconds per file. A batch has a 600-second processing budget; exhausted
files become explicit errors, while prepared successes remain available.
Root media bytes are not copied or limited to the asset store's 512 MiB input
limit. At most 256 source witnesses are retained across import jobs.

`GET`/`DELETE /api/v1/media/imports/{job}?project_epoch=...` return no-store jobs
with `kind:"media_import"`, `progress:{completed,total}` and, when ready,
`result:{items:[{path_token,name,state:"ready"}],errors:[{path_token,name,code,
message,status}]}`. Each partition preserves selection order. Cancel and obsolete
epochs prevent later application; a cancellation after acceptance returns applied.
The ordinary project mutation `import_prepared_media{job_id}` rechecks the writer
lease, epoch, generation and source identities, validates the complete native
project, then applies one `AddEntities(ImportMedia)` command for new media.
Existing paths are reused without a new history step. Receipts include ordered
`media_ids` for every success and the per-file `errors`; ordinary autosave,
idempotency and command lookup apply. Legacy `import_media{path_token}` keeps
its serialized shape and follows the same off-actor preparation before commit.
The receipt journal remains limited to 8 MiB/4096 entries; individual records
allow up to 1 MiB for a batch's IDs and errors. The in-memory receipt window
also retires by bytes before native preparation or another large import result;
expired command epochs require refresh and never authorize blind replay.
The browser's single Import selected files action prepares then commits its
still-current selection, selects all successes and opens the last in Source.

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
`source_span`, `min_length`, `max_length`, `speed_percent` and `pitch_correction`; unsupported
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

`retime_preset {clip_id,percent,overwrite?:false}` accepts the native strip's
10, 25, 50, 75, 100, 125, 150, 200, 400 and 1000 percent choices. It preserves
the exact native `Rational::from_percent` speed, independently of frame-rounded
duration. Linked clips use native `Resize` with the primary pitch flag; shortening
leaves a gap and does not ripple neighbours. Growth shares the explicit overwrite,
lock, linked-group and cloned-project validation above. A complete native no-op
does not create history, while a frozen clip at the same speed can still unfreeze.
The strip's displayed percentage comes from native `speed_percent`, never the
ratio of rounded source span and timeline duration. Hide strip is client-only.

`POST /api/v1/timelines/{id}/presets/capture` accepts
`{query:FrameQuery,clip_ids,options:{name,attributes,anchor,append_filters,shortcut?}}`.
It validates snapshot identity and returns `{project_epoch,generation,revision,
preset}` without changing history. Linked clips join the source selection;
the earliest video and audio clips supply the native preset. The v1 JSON fields
match the desktop attribute preset: version, name, attributes, anchor,
append_filters, shortcut, fps, resolution, video and audio. Capture leaves
shortcut null when its option is omitted. The optional setting is explicitly
`{action:"set",value:<native config string>}` or `{action:"clear"}`; unknown
actions, extra fields and explicit null are rejected. Set validates native
egui 0.36.2 key names/aliases and distinct Ctrl/Shift/Alt modifiers, then stores
canonical Ctrl+Shift+Alt+Key order. `Ctrl++` becomes `Ctrl+Plus`. Omitted options
retain legacy serialized command fingerprints and never activate a binding.

`GET /api/v1/presets/shortcuts` returns a pure no-store
`{version:1,keys:[<117 canonical key names>],modifiers:["Ctrl","Shift","Alt"]}`
catalog, without a session lease, native probe or library access. Settings offer
the complete native key domain; Keep and Remove do not require the catalog.

`POST /api/v1/timelines/{id}/compound-navigation` is a read-only adapter. It
accepts `{query:FrameQuery,action:{kind:"enter",clip_ids:[string]}}` or
`{query,action:{kind:"exit",ancestors:[{timeline_id,revision,clip_id:string|null,
entry_playhead}]}}`. Ancestors run from the selected parent to the immediate
parent, with at most the native 16 levels and no repeated timelines. Query
identity and every parent revision are checked before resolving a return.
Navigation accepts the actual view frame within 0..1000000000, including past
the content end; preview frame range validation is unchanged.

Entry clamps the outer playhead onto the wrapper, calls native
`Clip::picture_frame_at` and clamps the result to the child timeline. Multiple
selected compounds must resolve to the same child; ordinary clips are ignored.
Locked clips remain navigable. Return calls native `timeline_frame_at`, clamped
to each wrapper; freeze, null or removed wrappers use their captured entry
playhead. The response contains `{project_epoch,generation,source_timeline_id,
source_revision,source_frame,timeline_id,revision,frame,via_clip_id}`. Exit has
`via_clip_id:null`. No lease, history, generation or project write is involved;
frame conversion is never performed in JavaScript.

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
Saved library routes are implemented as described below. Browser preset drops
reuse `apply_saved_preset`: dropping on a selected clip applies the selection;
dropping on any other clip applies only that clip, without changing selection.
Linked targets, conversion, role matching and one Undo remain server-owned.
Hover is a local draft with no HTTP requests. Drop validates the captured source,
session, timeline revision, selection and viewport before sending one command.
Broader GUI lifecycle, physical drag acceptance and cross-project runtime remain
separate qualification.

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
Update retains source clips and, when the shortcut option is omitted, its
existing shortcut metadata exactly. Clear removes it; Set replaces it with a
validated canonical string. Existing unknown imported strings can be kept but
are not claimed readable by the current native desktop parser. The named
preset is the only entry changed; no other preset loses a shortcut implicitly.
Saving/editing disables its old browser binding and never enables a new one.
Browser activation remains a separate session-local Enable action with the
existing conflict-filtered Ctrl+Alt+Shift+letter subset. Update creates a previous copy;
restore_previous atomically swaps active/previous files. Archive is recoverable.
Library mutations preserve native timeline history and share ordinary lease,
epoch, generation and durable receipt semantics. A changed response after a
successful ACK requires a read refresh, not a new save/import command.

Native pool assets use the original desktop v1 `AssetFile` JSON wrapper and
`ClipboardPayload` RON text. They are separate from the ds4 media catalog.
`--assets-root` selects the native library root (default `<projects>/.assets`),
containing `assets/<id>.json` and `media/<sha256>/<original-name>`. A configured
directory alone does not establish NAS availability or concurrent desktop writes.

`POST /api/v1/native-assets/prepare` accepts
`{project_epoch,if_generation,action}`. The action is either
`{kind:"capture",media_id,name}` or `{kind:"import",asset_id,revision}`.
Preparation reads a bound snapshot without a writer lease or history change.
Capture selects exactly one pool item, including its complete nested dependency
closure. Missing references, cycles, depth, nonfinite values, invalid native keys
and unsupported project limits fail before native merge. Raw RON map duplicate
normalization follows the original parser; this is not a new project format.

`GET`/`DELETE /native-assets/jobs/{job}?project_epoch=...` reads or cancels a job.
Jobs bind epoch/generation, kind and optional asset ID/revision; browser responses
contain progress and counts, never native paths or clipboard text. A single worker
admits one running and one queued job; at most eight records survive in memory.
Ready jobs expire on process restart. Preparation never publishes an asset or
imports project entities automatically.

Each job supports 64 unique files, 512 MiB per file and 2 GiB total. Pinned regular
files, binary signature checks, native metadata probing, source and destination
identity checks, streamed full SHA-256, no-replace publication and a 512 MiB disk
reserve protect existing bytes. Imported files are independent flat project-root
copies accepted by the existing media adapter. Native fingerprints are recomputed
for their final paths; legacy zero fingerprints are filled only after verified
probe/copy. Desktop `media/<16-hex-fingerprint>/<name>` entries are also accepted
only when their directory matches the payload's original fingerprint; the worker
probes the pinned copy and computes full byte SHA-256 before importing. This
handles the desktop writer's unchanged fingerprint after copying to its library.
Native probing always runs in a separate process with pinned stdin, one CPU,
512 MiB address space, 10 CPU seconds, a 20-second wall deadline, 64 KiB output,
zero core dumps and OOM score 1000. Cancellation/timeout kills and reaps that child.
Copying checks cancellation and its 600-second budget between bounded chunks.
Changing project cancels obsolete jobs; DELETE may cancel the exact original
job/epoch pair after that change, while GET still requires the current epoch.
Cancellation removes only owned partial files.
Completed copies remain available after canceled or rejected publication.

`GET /native-assets/pages/{page}?project_epoch=...&search=...&archived=...` opens
at most 32 native JSON entries per source page within a 10000-name budget.
Search filters each source page; the panel advances through empty result pages.
Items contain ID, SHA-256 revision, name, folder, media/file counts, archive and
previous-version availability. `GET /native-assets/items/{id}` reads one row;
`GET /native-assets/items/{id}/download?project_epoch=...` returns the original
JSON as a no-store attachment, preserving native u64 IDs without browser parsing.

`POST /native-assets/commands` accepts guarded mutations
`publish_native_asset{job_id}` or `edit_native_asset_library{edit}`. Publication
uses the command ID as the immutable asset ID. Edits are rename
`{action:"update",id,revision,name}` or archive/restore/restore_previous
`{action,id,revision}`. Existing folder metadata is preserved. Library writes use
ordinary writer lease, epoch, generation and durable receipt checks without a
timeline Undo step; stale revisions and foreign file replacements are refused.

`GET /native-assets/folders?project_epoch=...` returns a no-store native v1 tree
`{project_epoch,version:1,folders_revision,folders:[{id,name,parent}]}`.
The root `folders.json` remains compatible with the desktop library. A truly
absent manifest has revision `"absent"`; a present manifest uses its SHA-256.
Malformed files are preserved and refused. Trees contain at most 512 folders,
16 levels and 256 KiB of JSON. Names are trimmed, nonempty and limited to 128
UTF-8 bytes without control characters; duplicate display names are allowed.

The native asset page query additionally accepts `folder` and
`folders_revision`. Omit `folder` for All, use an empty string for Library root,
or supply a known folder ID. A selector requires the current folder revision.
Folder filtering follows source paging, like search; totals describe the source
files, and clients advance through empty filtered pages. Rows preserve the raw
native `folder` and expose `effective_folder`: unknown native memberships appear
at root without rewriting their JSON.

`edit_native_asset_library` also accepts these explicit edits:

- `create_folder {folders_revision,name,parent}`; folder ID is the command ID.
- `rename_folder {id,folders_revision,name}`.
- `move_folder {id,folders_revision,parent}`; cycles and excess depth are refused.
- `remove_folder {id,folders_revision}`; direct child folders and active assets
  move to the removed folder's parent. Nested descendants stay attached to their
  own parents. Archived and previous-version JSON is preserved.
- `move_assets {folders_revision,items:[{id,revision}],folder}`; up to 64 active
  assets move together, with an explicit revision for each asset.

These are library metadata operations and never create timeline Undo steps or
delete media files. The panel supports multiple asset selection for moving;
import, rename and archive controls require a single selected asset.
Preparation shares the existing asset worker and queue. It reads at most 16 MiB
of asset JSON and stages at most 16 MiB, one file at a time; folder removal can
affect at most 128 assets. Final commit rechecks file witnesses and installs the
folder manifest after its affected assets. A private journal rolls accepted
transactions forward after interruption; foreign replacements stop recovery
and preserve its inputs. Catalog readers do not expose a partially installed
transaction. The native desktop writer does not participate in the web locks.

The journal retains the full request fingerprint and a project-root-bound
completion until the ordinary command receipt has been fsynced. A recovered
receipt reports the library change as durable without implying that unrelated
project edits were saved. A still-preparing or unresolved command lookup returns
409 `OUTCOME_UNKNOWN`, never an applied result or an invitation to replay.
Unconfirmed completions are bounded to 4096 entries/8 MiB; global staging
admission is limited to 16 directories, including retained orphan stages.
Capacity refusal preserves existing data. Native folder validation errors use
422, missing folders 404 and stale revisions 409.

`POST /projects/commands` accepts
`import_native_asset{job_id,asset_id,revision}`. Trial validation precedes native
`ClipboardPayload::merge_into` and one `AddEntities(ImportMedia)` history step.
The receipt includes selected root `media_ids` as strings; dependency IDs stay
private. Up to 64 asset/revision imports are cached per project epoch; reuse first
checks the complete dependency closure still exists and preserves edited children.
Eviction returns to native merge behavior. Undo invalidates removed cache entries.
Browser hide, selection/project changes and lease loss cancel pending preparation;
an already submitted mutation is resolved through its original receipt, never
replayed. A failed read after an ACK retains the applied outcome and stops a batch.
Physical drag and broader sharing remain separate parity work.

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

- POST `/api/v1/media/{id}/prepare` with `{project_epoch, quality, window?, audio_stream_index?}` creates or
  reuses an ephemeral source job. Quality is low/medium/high. This does not edit
  the project or history. Duplicate identity/quality/range/stream requests share
  one job. The optional audio index is a zero-based native audio ordinal, defaults
  to zero and must fit an unsigned 32-bit integer and the native stream count.
  Silent video and stills accept default zero; a nonzero index requires audio.
  Invalid choices refuse admission before cache allocation. Full and ranged
  proxies decode that stream using its own sample rate and channel format;
  legacy proxy waveforms use the same selection. Separate full-source asset
  analysis retains its documented first-stream scope below.
- Optional `window:{start_frame,end_frame}` uses absolute, half-open source
  frames. It must be nonempty, inside the full source and at most 60 seconds
  using native rational FPS. The returned `source_window` contains those bounds,
  full `total_frames`, rational `fps`, `audio_stream_index` and an opaque
  file-identity `source_version`. Stream choice does not change file identity.
  The job key includes range, quality, epoch, media ID, full file identity and
  audio index; omitted and explicit zero share the same entry.
  Ranged jobs publish only the requested zero-based movie and skip whole-source
  thumbnail/waveform scans. Status and asset authorization still bind the full
  original. Omitting `window` retains legacy full-file behavior and its ten-minute
  limit; legacy callers and original still-image preparation remain supported.
- Review opens bounded Source windows with absolute native-frame seeks. Its
  per-pane audition audio selectors are independent of replacement policy and
  default to zero after source changes, swap and refresh. Selection persists
  through seeks and EOF windows; attachment and heartbeat must match the chosen
  native index. Changing audition pauses playback and reloads the chosen stream
  without editing the timeline or changing replacement settings.
- Main Source opens explicit windows, with whole-file slider/numeric navigation,
  absolute In/Out, timecode, stepping, audition and native fast-audio sample
  bounds. Seeks must verify the requested frame before publishing a clock.
  Natural EOF prepares only the following window; paused/manual seeks do not
  autoplay. Cached attachment, metadata, file version, audio-tail and event
  ownership guards refuse obsolete or changed media. AAC padding at natural EOF
  retains the final valid native frame. This does not establish gapless playback
  or arbitrary delayed-stream timestamp parity.
- POST `/api/v1/media/{id}/assets/prepare` with `{project_epoch}` creates/reuses a
  separate full-source analysis job. Its `source_assets` descriptor contains
  `source_version`, `total_frames`, `fps`, `has_video` and `has_audio`;
  `program`, `source_window`, `source_asset` and the legacy export-only
  `project_epoch` field are null. Authorization still requires the query epoch.
  It publishes `thumb.png` for video and `waveform.json` for the first audio
  stream; `source.mp4` is absent. Waveform JSON has `scope:"full_source"`, actual
  native audio `duration_seconds` and at most 65,536 normalized finite peaks.
  PNG/JSON limits are 1/4 MiB. Critical media metadata and file identity are
  rechecked; descriptive legacy metadata may be absent. Analysis requires an
  idle media worker at admission. Accepted foreground preparation preempts
  running analysis; invalid or rejected requests do not. Cache limits and
  retention apply. Browser retries are explicit after failure or cancellation.
- GET `/api/v1/media/{id}/jobs/{job}?project_epoch=...` returns id, state, frames
  and optional error. States: queued, running, ready, failed, canceled.
- DELETE the same job URL requests cancellation; it never deletes source media.
- Ready status, preparation cache hits and asset opens renew shared retention for
  45 seconds. DELETE does not release another viewer's retention. Source checks
  attached ready media every ten seconds, Program every two seconds, also paused;
  requests are serial and stale completions cannot affect replacement media.
  Obsolete prepare replies do not cancel shared deduplicated jobs.
- Ephemeral admission reserves 512 MiB per queued/running job against 2 GiB and
  32 entries, separately from durable exports. SOURCE_CACHE_FULL refuses admission
  when retained entries, failed cleanup or scratch free space prevent a safe
  reservation with a 1 GiB floor. Native cancellation checks and final publication
  enforce job budgets; write batches/trailers are not filesystem quotas.
  Active asset streams hold file locks against eviction. No route scans old
  process caches or evicts durable export history.
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
- At natural EOF, the browser requests the next window from the prepared movie's
  actual exclusive end, keeping the same document identity. It prepares one
  foreground window at a time and displays the preparation pause. End of the
  timeline stops continuation. Stop, pause, seek, document changes and late
  replies cannot start an obsolete window. Cached covering ranges retain their
  actual media origin. Fast audio must finish its old bounded tail before the
  next movie is installed; canceled or incomplete tails refuse continuation.
  This does not establish gapless playback or continuous filter state.
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
  (`replace_linked`/`selected_only`), `attributes` (`preserve`/`reset`), optional
  `audio_streams` (`{policy:"preserve"}` by default, or explicit
  `{policy:"select",index:0}` with a zero-based integer), optional `frozen`
  (`reject` by default, `hold_source_in` or `unfreeze`), and nullable
  `source_version`. Preserve retains each affected Audio clip's existing stream;
  Select maps every affected Audio clip to that B stream. Video clip stream
  fields are untouched. An unavailable resulting stream refuses the entire
  plan/command with `TAKE_AUDIO_STREAM`; there is no automatic fallback to zero.
  Omitted and explicit Preserve retain legacy command receipt fingerprints.
  The native plan returns canonical IDs, before/after lengths,
  native source ranges, removed crossing count, merged animation-key count and
  the current source version, plus `audio_stream_count` and per-change
  `previous_audio_stream_index`/`audio_stream_index` (null for Video clips).
  Session media snapshots expose native `audio_stream_count`, including native
  legacy metadata semantics. Sample rate, channels and recorded stream count
  are re-probed before preview and application. Review shows the B count and
  each Audio mapping before confirmation; changing B resets to Preserve and
  discards the plan. The replacement policy does not change A/B audition,
  which has separate explicit zero-based stream choices for each pane.
  Changed imported timing/streams/fingerprint require explicit relink/reimport.
  Frozen clips require an explicit policy. `hold_source_in` uses exactly B's
  native `source_in` frame for every already-frozen affected clip, preserves
  its complete timeline duration and keeps it silent. Its independent animation
  clock can extend beyond the moving source range. Moving clips retain normal
  duration checks. `unfreeze` clears each affected freeze, then checks Preserve
  or explicit Shorten against the original edit length; it never trims first.
  `reject` refuses an affected freeze without editing anything. Omitted and
  explicit Reject retain legacy command receipt fingerprints. Each plan change
  adds nullable `previous_freeze_source_frame`/`freeze_source_frame`; native
  keyframe/rate/offset mapping remains independent of the held picture.
- Timeline `replace_take {replacement}` additionally requires that previewed
  source version. It revalidates epoch/generation/revision, source descriptor,
  locks, streams, linked media/speeds and the complete trial project. Native
  `vv_core::take::plan` supplies one ReplaceTake command: clip IDs, placement and
  existing speed stay; a short take is refused unless shorten was chosen.
  Shortening never ripples following clips and removes affected cross-cut
  transitions within the same Undo. Preserved keyframes follow source FPS/In;
  crop follows the native relink resolution convention. Reset affects clip
  effects/fades, keeping labels/disabled/link/speed state. Media entries and
  source files remain unchanged. Native compound cache generations can advance
  during Undo/Redo; they are invalidation metadata, not an edit to source files.
  Compound wrapper replacement remains unsupported;
  Review marks a compound target explicitly and does not substitute an unrelated
  A source. Open the child timeline and select its ordinary media clip to replace
  a take inside a compound through the same guarded command. Review offers two independent bounded
  source players with equal-elapsed-time comparison and exclusive audio
  audition. The longest ready playable native duration leads comparison, with
  A winning equal-duration ties; a shorter pane cannot stop the longer one at
  its end. Playback rate and encoded proxy duration do not select the leader.
  Invalid native timing is excluded from playback. Replacement always requires a visible native preview followed by
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
  It returns linked handle intersection, source FPS, full `total_frames`, all linked IDs, lock state
  and an exact native `[delta,first,last]` source-frame map. At most 65537
  positions around center are returned; a different center can refresh the
  window explicitly. Descriptor file identity invalidates the local proxy cache
  after source replacement. No project or history mutation occurs on this read.
  The selected video is the preview source; an audio selection uses the first
  linked video in native track/clip-ID order. The returned `clip_id` still
  identifies the selected clip; source metadata and frame map identify the
  chosen video. An unlinked audio clip retains numeric Slip without video.
  The dual viewer prepares one shared or two sequential Source windows, each
  at most 60 seconds and 32 MiB of local MP4 Blob storage. The full source may
  exceed ten minutes. Both descriptors must match the manifest's pinned file
  identity, full FPS and frame count. Local seeks subtract the window origin.
  No HTTP is sent from pointer movement or numeric input; a committed numeric
  change outside cached coverage or explicit Refresh recenters the windows.
  Close, selection/project invalidation and stale/error paths detach video
  sources and release owned Blob URLs without canceling shared server jobs.
  One completed timeline gesture sends the existing `slip`
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

POST `/exports` accepts
`{range: ProgramQuery, settings:{quality,preset,audio,encoder?,decoder?,
scale_percent?,audio_codec?,audio_bitrate_kbps?,audio_fast_coder?}}`.
Omitted codecs retain x264 and software decoding, including the existing
canonical job identity and saved settings. Encoder IDs are `x264`, `nvenc`,
`vulkan` and platform-native `videotoolbox`; decoder IDs are `software`, `nvdec`
and `vulkan`. Choices and quality/preset bounds come from the native catalog.
Unknown IDs, unsupported platform encoders and invalid settings are refused.
The requested range is
an integer exclusive-out range within the captured timeline. Export duration is
independent of the five-minute Program preview window. Without `scale_percent`,
the existing maximum-width path remains capped at 1920. An explicit native
percentage (`100`, `75`, `50`, `25`) uses `ExportSettings::output_size` and the
captured timeline resolution, independently of that legacy width. Timeline
snapshots expose `export_scales:[{percent,width,height}]`; the client does not
reimplement native output rounding. Dimensions must be within 1–8192 pixels.

Explicit percentages require memory admission before enqueue and again in the
worker. The conservative working estimate is native pixels × 64 + output pixels
× 16 + 256 MiB, with another 4 GiB of host headroom and 256 MiB of effective
cgroup headroom. The minimum headroom across cgroup ancestors applies. Missing
or malformed memory metadata fails closed; a controller-less cgroup v2 root is
allowed after delegated ancestors are checked. Refusal is 409
`EXPORT_MEMORY_PRESSURE`. This is an admission estimate, not an allocation
guarantee or high-resolution qualification; renderer process limits still apply.

Optional audio settings use native `aac`/`fdk_aac`, a bitrate of
`96|128|160|192|256|320` kbps and `audio_fast_coder` for Fast versus Twoloop.
Unavailable selected encoders are refused. Omitting these fields retains legacy
AAC/128/Twoloop settings, serialization and job identity. The audio checkbox
still controls whether any audio is included.

Program In/Out are client transport state with exclusive Out. Setting an In at
or after Out clears Out; setting an Out at or before In clears In, matching
native `MarkRange`. Marks reset on project/timeline changes, remain across
Program/Source switches on the same timeline and create no history entry.
The export drawer defaults to Marks when the resolved range is not the whole
timeline, offers an explicit Whole choice and preserves Custom ranges. Empty
resolved marks refuse submission. Only the resolved range is sent to the API.
Encoding/mixing/compositing use vv-session, vv-media and vv-audio. A selected
hardware codec requires a successful explicit check in the current server
instance. Hardware encoding does not silently fall back to x264. Native
decoding may fall back to bounded software decoding; progress reports observed
`decoders:[{id,label}]` and `decoder_fallback` separately from the encoder and
compositor. Hardware selection is disabled on CPU-only preview hosts.
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
in session storage. Arbitrary output formats, automatic resume and automatic
retention policies are not implemented and are not acceptance requirements
established from the original GUI. The browser reattaches to its selected job
after refresh without submitting another export. Status shows measured elapsed
time and FPS, an estimated running ETA and expandable native pipeline metrics.

`GET /exports/codecs` reads native metadata without opening codec devices. It
returns `identity`, `build`, `adapter`, `encoders`, `decoders` and `audio`. The
audio object contains `codecs:[{id,label,status}]`, `bitrates` and
`coders:[{id,label,fast_coder}]`; availability only checks the native registry.
Each video option
has `id`, `label`, `status` and an optional `reason`; encoder rows also include
`quality:{min,max,rises,default,label}`, `presets` and `default_preset`. Status is
`not_checked`, `checking`, `available`, `unavailable` or `disabled`. Identity is
scoped to the server instance, executable and configured adapter; restarting
invalidates previous hardware checks. Vulkan encoding uses FFmpeg's default
device, while Vulkan decoding names the configured adapter.

`POST /exports/codecs/probe` accepts only
`{kind:"encoder"|"decoder",id,force?:false}` within a 2 KiB body. This is the
only catalog operation that runs a native check. A cached result is returned
unless an explicit recheck sets `force:true`. Checks are single flight; busy,
timeout and child failures leave previous availability intact. A disabled host
rejects hardware checks before creating a child. Successful requests return
the full updated catalog.

Checks run in an isolated child before server/preview startup, with a private
temporary directory, one allowed CPU, a CPU-time and output budget, low priority
and a child-owned wall-clock deadline. They require at least 4 GiB of host
memory headroom and an effective cgroup memory limit of at most 4 GiB with zero
swap; missing limits return `CODEC_PROBE_RESOURCE_LIMIT` without changing cached
availability. Hardware checks require the nonblocking shared GPU
reservation, retained through child exit and device-cache release. The preview
worker yields its resident context before a probe/export and holds its own
reservation for the full residency. A hardware decoder check decodes and checks
color through the requested native device; device creation alone is insufficient.
The drawer reads choices on open/refresh and checks hardware only through its
explicit check buttons. It rejects stale responses after context/server changes.

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

- POST `/projects/otio/prepare` accepts
  `{project_epoch,if_generation,path_token}` and prepares a root .otio file
  without changing the current project, including untitled or dirty projects.
  GET/DELETE `/projects/otio/jobs/{job}?project_epoch=...` reads/cancels that
  preparation. Jobs use the existing single asset worker and one queued slot;
  other job kinds are refused by these routes. Native URL callback counts appear
  in `progress:{completed,total}`; offline media remain explicit warnings.
- Project `import_prepared_otio {job_id,name,reuse_existing}` requires an
  explicit boolean reuse policy and the prepared epoch/generation. It uses native
  `pool::absorb` and one `AddEntities(ImportOtio)` Undo step. Reuse matches native
  file labels for noncompound media. New media enter a named folder; top-level
  timelines enter the root and receive the import name (or `name - original`
  for multiple roots). Nested names remain intact. The ACK adds `timeline_ids`,
  `media_ids`, `folder_id` and `warnings`. A validated trial precedes final
  source/cancellation checks and native application; exact retries return the
  original receipt. Late cancellation cannot undo an applied import.
- Preparation accepts at most 8 MiB input/output and 64 distinct media URLs.
  NOFOLLOW descriptors and missing/unreadable entry witnesses pin root identity
  and source state until application. Changed sources, root escapes, symlinks,
  special files, indirect manifests and cancellation fail preparation/application
  atomically; they do not become ordinary offline warnings. Retained jobs share
  the existing 256-descriptor admission budget. Each native media probe runs in
  an isolated process with a hard 20-second timeout, 512 MiB address space and
  10 CPU seconds. The whole 600-second preparation budget is cooperative between
  parser callbacks; one blocked native parser/title call is not preemptible.
- Legacy project `import_otio {path_token,name}` retains its separate new-project
  meaning, dirty-project refusal and no-replace .vvproj write. It now uses the
  same preparation worker outside the session actor. Project, mixer/marker,
  transition and compound constraints validate before install. Parser or save
  failure preserves the current session and the original cached error. Import
  warnings also appear in session snapshots (at most 65 bounded messages).
- GET `/timelines/{id}/timeline.otio` accepts the guarded exact-frame query and
  downloads a native OTIO JSON snapshot, up to 8 MiB, without requiring a GPU.
  Nonempty timelines are supported. Active compound references are refused:
  the native exporter does not serialize their contents; export the child
  timeline instead. Native Venturi metadata now additionally retains track
  mixer/lock/solo, timeline master and markers. Both import and export use
  `vv_render::text::title_metrics`, matching desktop CPU font shaping for
  automatic title backgrounds and corner-radius conversion. This initializes
  no GPU or audio device. Font availability can still differ across machines.
- Timeline `rename_timeline {name}` and `duplicate_timeline {name}` use native
  pool commands. Duplicate allocates fresh clip/link IDs and is one undo step;
  names are nonempty, at most 128 bytes, without control characters.
- `make_compound {clip_ids,name}` resolves linked groups, locks and a native
  plan. Multiple selected video/audio tracks use the native compound planner.
  Audibility and processing guards apply independently to each role: one audio
  track retains its original host bus, so pan, inserts, solo and mute remain
  valid even when multiple video tracks are selected. Multiple audio tracks
  use an opt-in native plan with a new neutral audio track. Child buses retain
  their full gain, pan, Mono, bypassed inserts and mute/solo flags; original
  tracks and unselected clips remain in place. The wrapper inherits the OR of
  selected solo flags, including muted solo buses, without acquiring a mute
  flag from an outside solo. Enabled inserts other than Mono remain refused
  because splitting processed buses can change their context or filter tails.
  The compound origin must land on a whole native 48 kHz sample to preserve
  fractional-FPS phase. Rounded source audio extents must also fit the wrapper,
  preventing a one-sample tail truncation. Appending the wrapper respects the
  128-track cap.
  Multiple video
  tracks require unmuted tracks, all intervening material selected and no
  changed adjustment/matte/selected-blend dependencies.
  Existing replacement tracks must be free of unselected clips; the new audio
  track allows unselected material inside the compound span on original audio
  buses. Crossing transitions
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

- Timeline `copy_clips {clip_ids}` and project `copy_media {media_ids}` capture
  the original native `venturi-clipboard/1` text, including selected dependencies,
  within 4 MiB/4096 selections/64 files/64 timelines. Copy is writer, epoch,
  generation, revision and idempotency guarded but creates no Undo; locked clips
  may be copied. The retained fragment survives project changes. Snapshot fields
  `clipboard_count`, `clipboard_media_count`, `clipboard_revision` and
  `clipboard_current_project` describe it. Copy ACKs include its revision.
- GET `/clipboard?project_epoch=...&if_generation=...&clipboard_revision=...`
  returns the exact captured text, revision, epoch, generation and selected clip/
  media counts with no-store. Text is not included in durable command receipts.
  The browser writes it from the Copy/Cut user gesture. Text inputs, modal forms
  and media controls retain their normal clipboard handling; pool focus selects
  pool copy/paste, preventing stale timeline selection from stealing Copy.
- Timeline `cut_clips {clip_ids,clipboard_revision}` requires the exact current
  captured selection and unlocked linked tracks. It uses the native non-ripple
  delete in one Undo, preserving the copy. The browser submits Cut only after
  confirmed system clipboard writing and an unchanged captured context. A denied
  write keeps the native copy and exposes an explicit system-copy retry without
  deleting clips. Unknown mutation outcomes retain the original command identity.
- POST `/clipboard/prepare` accepts
  `{project_epoch,if_generation,text:string|null,to_pool:boolean}`. Null uses the
  retained native snapshot; opaque system text comes from a real paste event or
  the explicit system Paste button. The latter captures context before async
  permission/read and never silently falls back on denial. Rust resolves ordinary
  nonpayload text to the retained clip copy outside the pool; in the pool it is
  a no-op. Unsupported/malformed native versions are refused. Empty/image-only
  clipboard import is not part of this native text path.
- GET/DELETE `/clipboard/jobs/{job}?project_epoch=...` reads/cancels typed
  `clipboard_import` preparation. Its native summary contains `clip_count`,
  `media_count` (selected pool roots), `warnings`, and actual distinct-file
  progress. The existing single worker, one queue slot, eight job records and
  global 256-descriptor budget apply. Parsing/validation is outside the session
  actor; authorized source witnesses and isolated native media probes follow the
  OTIO limits above. No files are copied or allowlists expanded. File hashes are
  independently fingerprinted before native content reuse; missing/unreadable
  entries retain offline metadata with hash zero. Changed critical metadata,
  symlinks, root escapes, manifests and canceled/stale jobs cannot apply.
- Project `paste_prepared_clipboard {job_id,to_pool,overwrite?,timeline_id,
  timeline_revision,frame}` validates the entire native merge and clip plan on a
  clone, then rechecks source/cancellation witnesses before infallible application.
  `overwrite` defaults to false and is omitted when false in the canonical command
  identity, preserving older retries. Pool requests require null timeline/revision,
  frame zero and overwrite false; timeline requests
  require the captured exact target revision. A native media-only payload goes
  to the pool even with timeline focus. The ACK adds `media_ids` (selected pool
  roots), `clip_ids` and `changed`. Native path/content reuse, nested naming,
  fresh IDs and intentionally dangling offline references follow `merge_into`.
  Pool reuse/no-op creates no Undo or allocator changes; a changed paste is one
  complete Undo for both imported dependencies and inserted clips. Current
  compound reuse requires the exact trusted captured text and current session;
  a received origin identifier alone never authorizes the fast path.
  Explicit timeline overwrite uses native `insert_overwriting`: existing clips
  are split, trimmed or removed while copied gaps remain gaps in the incoming
  selection. Existing material inside those gaps remains in place. Missing
  destination tracks, dependency imports, replacement and relinking share one
  PasteClips Undo. Locked destinations or linked members refuse the whole edit.
  Every affected linked member must receive the same overlapping replacement
  interval; a partial linked overwrite is refused before real allocation.
  The visible Replace overlapping clips checkbox starts unchecked, applies to
  retained/system/keyboard timeline paste, and is captured before clipboard
  reading or preparation. Changing it cancels preparation without replay.
- `paste_clips {frame}` requires the same project epoch. Different timeline FPS
  use native `Clip::retime`: set the copied relative start, conform to the target
  timeline/media FPS, then add the destination playhead. Source-frame animation,
  source offsets, speed, pitch and freeze retain their native semantics;
  generator clips keep their native conform rate. Internal crossing durations
  use native frame conversion with a one-frame minimum.
  A native trial plans missing tracks, fresh clip/group IDs, effect/animation
  copies, internal crossings and cycle/depth checks. Any occupied/locked
  destination refuses the whole paste before real IDs/tracks/history change.
  One composite undo removes all pasted clips and any new tracks. Legacy direct
  paste refuses a retained foreign epoch; the prepared path handles cross-project
  transfers. Internal crossing transitions remain in the trusted local cache;
  the original v1 text format has no top-level crossing list. Nested timeline
  crossings retain their native representation.
- `paste_attributes` keeps native `Conversion::paste` for both keyframe modes,
  including different timeline FPS and retained foreign clips. It does not apply
  preset FPS/resolution conversion. Original source IDs are excluded only in the
  same project; numerically equal IDs from a foreign snapshot are valid targets.

### Custom audio parameter presets

- GET `/audio/presets?project_epoch=...` returns `project_epoch`, the SHA-256
  `revision` of the exact library bytes, and native `eq_presets` and
  `compressor_presets` arrays of `{name,params}`. Missing storage is an empty
  catalog with SHA-256 of empty bytes. Responses use `no-store`.
- POST `/audio/presets/commands` accepts only project operation
  `edit_audio_preset_library {edit}` with the existing writer lease, project
  epoch, generation and durable command identity. Save uses
  `edit:{action:"save",name,revision,parameters}` where `parameters` is a native
  `AudioEffectKind::Equalizer` or `MultibandCompressor`. Delete uses
  `edit:{action:"delete",kind,name,revision}`, with `kind` equal to `equalizer`
  or `multiband_compressor`. Names are trimmed, case-sensitive, scoped to the
  effect kind and limited to 256 UTF-8 bytes without control characters.
  Same-name Save replaces in place; identical Save preserves the revision.
- The bounded `.venturi-audio-presets.json` sidecar under `--presets-root`
  contains the original desktop Settings envelope, with at most 256 presets
  per kind and 1 MiB total. Only native parameters are stored; bypass, insert
  order and project state are excluded. Desktop settings are not overwritten.
  Pinned roots/files, a separate nonblocking advisory lock and revision/file
  witnesses guard atomic publication. Corrupt storage refuses library access
  without preventing editor startup. `AUDIO_PRESETS_CHANGED` and
  `AUDIO_PRESETS_BUSY` require refresh; `AUDIO_PRESETS_UNCERTAIN` means publication
  occurred but durable directory synchronization could not be confirmed.
- Timeline operation `apply_saved_audio_preset {channel,index,preset_kind,name,
  revision}` also requires the current timeline revision. It resolves the
  captured library version, validates the native parameters and matching
  insert kind, then applies one native `SetAudioEffect`. It preserves bypass,
  slot, chain order and other inserts. Undo/Redo use the native project history.
  Save/Delete affect only the global library and create no project Undo entry.
- EQ/compressor cards keep built-in and custom choosers separate. Save captures
  the current uncommitted numeric draft; same-name replacement is explicit.
  A library-only acknowledgement retains the card and its draft only after an
  authoritative session read confirms unchanged project, history, media and
  timeline revisions. Apply follows the normal authoritative editor refresh.
  Changed context, detached/closed cards and uncertain outcomes cannot replay
  a mutation or update a stale panel.

### Bitmap clipboard import

- POST `/clipboard/images/prepare?project_epoch=...&if_generation=...` accepts
  the original encoded image as its raw body, with a canonical Content-Type of
  `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/bmp` or `image/tiff`.
  The body limit is 32 MiB, with one concurrent upload and a 30-second body
  deadline. A saved current project is required before reading the body and
  again before preparation. Unsupported MIME/signature pairs are refused.
- GET/DELETE `/clipboard/images/jobs/{job}?project_epoch=...` reads/cancels only
  typed `clipboard_image` jobs. The existing single preparation worker, one
  queue slot and eight-record limit apply. Ready results contain a suggested
  name, canonical extension/MIME, encoded byte count and native dimensions.
  The isolated native probe verifies metadata; SHA-256 verification remains
  outside the session actor. Cancellation removes only the job's owned stage.
- Project `import_clipboard_image {job_id,name}` requires the usual writer,
  epoch, generation and command identity. A native trial precedes publication
  and one `AddEntities(ImportMedia)` command. The ACK's `media_ids` contains the
  selected native media ID; `errors` is empty on success. Exact retries retain
  the original result. `IMAGE_NAME_TAKEN` leaves the prepared job editable.
  Names are trimmed, limited to 120 UTF-8 bytes and cannot contain separators
  or control characters. Add never overwrites an existing file.
- Encoded bytes are preserved in `Pasted Images/<name>.<extension>` next to the
  saved project. This exact managed child directory is authorized in addition
  to flat project-root media; arbitrary nested paths remain refused. Root,
  directory and file witnesses reject replacement and symlinks. Saved-project
  reopening, Source, native clipboard/OTIO reuse and native asset capture use
  the same managed-path rules. Undo removes the native media item while keeping
  its file, matching desktop import; Redo restores the same native identity.
- The browser obtains an image from an actual empty-text paste event or the
  explicit Paste image from system clipboard action. Nonempty text retains the
  native text path. Read permission failure never falls back to another copy.
  Add/Cancel, an editable name and collision feedback precede mutation. An
  unsaved project offers the existing Save As flow; the user pastes again after
  saving. Changed focus/project/selection cancels preparation. A submitted
  command with an unknown outcome is neither replayed nor canceled blindly.
- PNG/JPEG/WebP Source assets preserve their original bytes. BMP/TIFF use a
  native CPU-decoded PNG representation, retaining full admitted dimensions
  and alpha while leaving the original file unchanged. Full PNG and thumbnail
  generation run in one isolated child, with a 512 MiB address-space limit,
  ten CPU seconds, twenty wall-clock seconds, bounded diagnostics/output and
  cancellation through kill/reap. The parent checks pinned output headers
  without decoding the representation again. PNG/JPEG/WebP Source and still
  SourceAssets also use the isolated thumbnail-only mode, preserving the native
  opaque thumbnail while avoiding a full-frame decode in the editor. GIF retains native
  regular-media classification and its video Source path.
