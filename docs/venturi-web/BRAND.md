# Brand and visual system — MadRock-inspired

Reference: https://madrock.ai/ and https://madrock.ai/brand/monogram.png. The identity uses a very dark base and hot pink / violet / orange / amber accents. **These CSS hex codes are proposed design tokens**, not proven official brand hex values extracted from the site. Replace after receiving an approved brand kit or inspecting computed site styles.

## Direction

- Professional tool with content priority, NOT colorful marketing dashboard.
- Dark neutral-purple surfaces; no large gradients behind footage, scopes, timeline or meters.
- Orange primary action/selected outline, magenta AI Take-related affordances, violet specialty tools, amber warnings; text in warm near-white.
- Preserve semantically meaningful RGB scopes/color wheels and media track colors. Theme color is not scientific color.
- Font: Windows `Segoe UI`/system-ui, tabular numeral timecode, no font asset needed.
- Border/spacing: 4px base grid; panels minimal 5px radius; 1px hairlines. Neutral hover, visible focus outline. Hit targets >=28px for dense desktop, ideally >=32px without wasting space.

## Proposed semantic palette

| Token | Proposed hex | Meaning |
|---|---|---|
| --bg | #0B090E | canvas |
| --surface | #19131D | dock panels |
| --raised | #251C29 | inputs / floating surfaces |
| --border | #3A2C40 | separators |
| --text | #F5EFF5 | body |
| --muted | #B9AABA | muted / metadata |
| --primary | #FF673D | primary action |
| --pink | #FF2D8D | AI take/variant emphasis |
| --violet | #9B59FF | advanced panel accent |
| --amber | #FFAD45 | warning/progress |
| --danger | #FF6274 | error / unsafe overwrite |
| --success | #7BCD9B | success |

Test WCAG contrast with actual font weight and background. For small text, do not place primary orange on white or pale backgrounds. Color is never the *only* indicator of state. Use explicit icons and text for clipped/offline/selected/saving/error.

## Components and spacing

- Main app: true black-ish viewer frame; work area panel contrast slight.
- Clip fills: media type + user-assigned color; selection drawn with distinct outline and handles, not fill-only.
- Status labels plain and compact; no repeated pills/badges for ordinary metadata.
- No animation on clip drag/playhead/trim; only 100–150ms transition for opening drawers/hover when reduced motion allows.
- Monogram/logotype: not included in this pack. Add only assets the project owner is authorized to use. Until then render typographic `Venturi Web` / small MadRock theme indicator. Do not silently fetch an external logo at runtime.

## Acceptance artifacts

Create screenshots at 1920×1080 for all 4 workspace presets, Source/Program modes, open command palette, disconnected state and blocked overwrite. Compare them against native Venturi reference screenshots and this visual direction.
