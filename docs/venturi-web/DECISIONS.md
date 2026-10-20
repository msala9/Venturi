# Architecture decisions (ADRs, terse)

| ID | Decision | Rationale | Revisit when |
|---|---|---|---|
| ADR-01 | Vanilla ES modules + native CSS/HTML | Tight app scope, input control, tiny deployment | Boilerplate/lifecycle code demonstrably exceeds alternatives |
| ADR-02 | Canvas2D timeline + DOM controls | Cheap per-frame redraw, precise pointer geometry, accessibility for controls | Canvas bottleneck shown by profiling |
| ADR-03 | Direct vv-session host behind HTTP | One source of truth; MCP remains for agent tools | Upstream provides first-class HTTP service |
| ADR-04 | Single-user actor + snapshots | Avoid shared mutable timeline + deterministic edit ordering | Collaboration becomes a requirement |
| ADR-05 | HTTP command API + SSE jobs | Simpler debug, caching and deployment | Continuous low-latency controls justify WebSocket |
| ADR-06 | PNG exact seek, later composed preview segments | Validate correctness/headless first | Verified lag demands WebRTC |
| ADR-07 | Safe move is default, overwrite explicit | Existing `move_clips` may overwrite destination | Never remove safety rule |
| ADR-08 | Sidecar AI metadata | Preserve native `.vvproj` stability | Upstream adopts Shot/Take schema |
| ADR-09 | Loopback + SSH tunnel initially | Minimize exposure of filesystem/GPU server | Authenticated VPN/reverse proxy designed and audited |
| ADR-10 | MadRock-inspired token CSS, no vendored logo | Brand consistency without asserting exact CSS tokens/asset rights | Approved official brand kit available |
| ADR-11 | No system FFmpeg edit pipeline | `vv-media` already owns decode/encode | One-off diagnostics with measured benefit |

Decisions should be reversed only with a small decision record including observed evidence, costs and rollback.
