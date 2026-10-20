# Editing consistency, idempotency and project safety

## Invariants

- Native `vv_session::Session` is the **single project truth**; no second persistent JSON video editing engine in browser.
- Project `epoch` changes when the project is replaced; timeline `revision` changes when its content changes. Both must match before a timeline mutation.
- IDs opaque and stable per upstream design. Undo restores original IDs. Do not create synthetic IDs for persisted media/clips.
- Frame arithmetic integer/rational. Sidecar metadata must refer to real media IDs and survive relink if possible; if relink breaks IDs, report orphaned metadata for user review.
- One user action = one undo step. Sliders and drags commit once; no network per pointer move.
- No destructive overlap on normal drag. Linked group and locked tracks must all be checked before mutation.
- Save atomically: temporary file in target dir, flush, rename, keep timestamped backup/recovery. Investigate `vv_core::save_project` behavior before wrapping it; do not claim it is already atomic.

## Failure state machine

```text
Draft → Sending(command_id) → Applied(revision)
                           ↘ Rejected(reason) → restore confirmed state
                           ↘ ConnectionLost → Unknown → Lookup(command_id)
                                                       ↳ Applied / Failed / StillRunning
```

Do not let a user double-click cause duplicate edit commands. Browser may preview a draft, but status must change to unconfirmed while awaiting server. On a conflict, fetch authoritative state, retain only intended local draft for explicit reapply by user, never secretly remap a destructive edit.

## Session / tab policy for v1

- One writer lease per active project browser session, lease TTL or explicit owner. Second tab opens read-only by default with request-to-take-over; first tab notified.
- Saving is server-owned, not dependent on page unload events. Browser close does not cancel export or throw away pending committed commands.
- On process restart, load last saved document/recovery and report actual unsaved state. Do not restore a speculative client-only edit as authoritative.

## Source replace for AI takes

`replace_take` must be a single command with explicit source duration rule, preserve edit range when valid, preserve transforms/keyframes only if semantically correct, and preflight source compatibility. No silent speedup or shortening. If linked audio source differs, require explicit policy. Implement only after tests capture all linked-track and undo behaviors.
