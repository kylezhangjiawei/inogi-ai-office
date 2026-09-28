# Shared layout and visual refinement — 2026-09-18

## Scope

Applied the requested Horizon visual language and operational density to shared
styles. Preserved the original application palette and all business workflows.
This pass builds on the earlier procurement layout and shared-shell remediation.

## Changes in this pass

- Removed the extra white card around shared page headings. Improved title,
  description, and metadata hierarchy; actions wrap according to content width.
- Consolidated metrics into one bordered strip, with larger numeric typography
  and responsive separators. Removed homepage-only oversized metric cards.
- Gave work surfaces subtle borders; reduced shared card and shell shadows.
- Compressed homepage section gaps, module summaries, and quick-action entries.
  Existing permissions, real data, filtering, and detail dialogs remain intact.
- Connected the order workspace to shared container-width behavior; used semantic
  surface and hover colors in its toolbar and table.
- Fixed user-directory filter clipping at 1024px: filters now reflow based on
  usable width instead of fixed columns selected by viewport width.
- Added `DESIGN.md` to describe the approved visual rules and ownership boundaries.

## Verification

- 69 existing checks passed across dashboard, active shared UI, order processing,
  core system administration, and procurement workspace suites.
- TypeScript check passed; Vite production build passed (47.55 seconds).
- Browser visual checks: 1440px homepage, users, purchase orders, and procurement
  workspace; 1024px user directory; 390px users and purchase orders.
- Homepage status filtering and detail dialog opened correctly. Procurement full
  details opened and dismissed with Escape. No captured browser error logs in the
  checked session.
- At 390px the existing home route redirects to the mobile research workspace;
  this behavior was retained. Its document width matched the viewport.

These are representative checks of shared changes, not an assertion that every
route was manually inspected. No new dependencies, API changes, commits, or
deployments were made for this styling pass.
