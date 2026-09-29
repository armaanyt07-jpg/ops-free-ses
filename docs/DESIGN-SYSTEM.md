# Design system

SRS §20 requires a minimal developer-tool aesthetic and forbids generic
"AI SaaS" decoration. This documents what's actually in the codebase, so a
new screen extends it instead of inventing a new visual style (§20.10).

## Tokens

Colors are the shadcn/ui neutral palette (`src/app/globals.css`) — grayscale
`oklch` values for background/foreground/card/border/muted, both themes. No
custom brand hue lives in the token set; color is added only at the
component level, and only to carry meaning (see Semantic color below).

Radius, spacing and typography come from the same file's `@theme` block and
Tailwind defaults. Don't add new radius/spacing scales.

## Components

`src/components/ui/*` are unmodified shadcn primitives (`style: radix-nova`,
`baseColor: neutral`, see `components.json`). Compose them; don't redesign
them or fork a one-off variant.

`src/components/dashboard/primitives.tsx` holds the screen-level building
blocks every dashboard page should reuse rather than hand-rolling:

| Component | Use for |
| --- | --- |
| `PageHeader` | Every page's title + description + actions row |
| `StatTile` | A single metric card, optionally linking to a filtered view |
| `EmptyState` | "Nothing here yet" body |
| `SegmentedLinks` | A small set of mutually-exclusive view options (e.g. time window) |
| `Time` | Any timestamp — relative text, exact UTC on hover. Never render `.toISOString()` or a raw date string directly in a table |
| `Pagination` | List pagination |
| `Fields` | A label/value list on a detail page |

If a new screen needs a header, a stat, an empty state or a timestamp, use
these. If none fits, extend the primitive rather than styling ad hoc markup
that will drift from the rest of the app.

## Semantic color

Colors communicate state, never decoration (§20.5):

| Color | Meaning | Where |
| --- | --- | --- |
| Neutral (shadcn default/secondary) | Primary UI, disabled/secondary info | Everywhere by default |
| Blue (`sky`) | Informational / in-progress | `sending`/`sent` in `StatusBadge` |
| Green (`emerald`) | Success / verified | `delivered`, `verified`, `confirmed`, `active`, `healthy`, `pass` |
| Amber | Warning / pending | `pending`, `expiring`, `stale`, `warn` |
| Red (shadcn `destructive`) | Error / bounce / complaint | `bounced`, `complained`, `failed`, `unsubscribed` |

The reusable tone classes live in `src/components/dashboard/badge-tones.ts`
(`GREEN`, `AMBER`, `SKY`) — apply them as `className` on a `secondary`
Badge rather than inventing new color literals. Red and gray already come
from the shadcn `destructive`/`secondary` variants, so they aren't
duplicated there.

Status is never color-only: every badge also carries the status word, and
places that use an icon for status (e.g. the Overview reputation notes)
pair it with text.

`StatusBadge`, `CheckBadge` and `DomainStatusBadge`
(`src/components/dashboard/status-badge.tsx`,
`src/components/dashboard/check-badge.tsx`) are the canonical mappings from
a domain status enum to a badge. Add new statuses there, not at the call
site.

## Typography

Monospace (`font-mono`) is used for anything the user copies or matches
against another system: API keys, message/request IDs, DNS record
name/value/type, SES message IDs, worker/job IDs. Everything else is the
default sans stack. Page titles are `text-2xl font-semibold`; card titles
use the shadcn `CardTitle` default — don't introduce a larger heading size
inside an operational view.

## What's deliberately absent

No gradients, glow, glassmorphism, decorative blobs, 3D illustrations, or
particle/hero treatments exist in the dashboard, and none should be added.
`rounded-full` is reserved for functional pills/dots (status indicators,
progress bar caps), not decoration. Animation is limited to `transition-colors`
on hover/active states, dialog/select open transitions, and loading spinners
(`Loader2Icon animate-spin`) — no continuous or attention-grabbing motion.

## Before adding a new screen

Check it against §20.11's gate:

1. Does it look like a professional developer/infrastructure tool?
2. Is every visual element useful?
3. Is the information hierarchy immediately understandable?
4. Are colors primarily semantic (the table above, not decoration)?
5. Is it visually restrained — no items from "What's deliberately absent"?
6. Does it reuse `components/ui` and `components/dashboard/primitives.tsx`
   rather than one-off markup?
7. Is it consistent with the rest of the dashboard (nav, spacing, page
   header pattern, table style)?

If any answer is no, simplify before calling the screen done.
