# INOGI Office UI direction

Existing business data, permissions, task states, and workflows remain the
source of truth for behavior. Preserve original record links and valid actions
when changing presentation. Explicit user-approved prototypes govern the visual
structure of their scoped pages, as documented in the production exception below.

## Visual language

Use Horizon UI's calm application surfaces with Linear's clear information
hierarchy. Do not import a dashboard template or add decorative business metrics.
Keep the existing palette: near-white `#f8faff` canvas, white work surfaces,
`#1b2559` primary text, `#526080` secondary text, and `#422afb` brand purple.
Use semantic theme variables rather than repeating these colors in components.

- If the shell breadcrumb already identifies the page, do not repeat a visible
  page heading or decorative eyebrow. Keep accessible heading semantics. Show a
  visible heading when there is no breadcrumb (including standalone/immersive views).
- Use white bordered surfaces for actionable lists, forms, and detail workspaces.
- Related summary numbers belong in one compact divided strip.
- Reserve the brand accent for primary actions, selection, focus, and relevant data.
- Keep warning, error, success, permission, and freshness information visible.
- Avoid gradients, glass effects, oversized metric cards, decorative charts, and
  hover movement. Shadows separate layers without creating a floating-card wall.

## Layout and typography

- The shell owns navigation width and page gutters; individual pages must not
  override shell dimensions.
- Use the shared Horizon page header, metric strip, section header, and UI controls.
- Primary work comes before supporting summaries. Keep list/detail relationships
  and independent filter scopes intact.
- Page headings: 24px desktop / 20px compact, weight 700. Body: 14px. Metadata and
  table labels: 12px. Numeric values use tabular figures.
- Work surfaces use the shared 16px panel radius; controls use the 10px radius.
  Use 12–16px internal spacing and 16–24px between work regions.
- Responsive decisions should follow available content width, not just viewport
  width. Retain horizontal scrolling inside genuinely wide data tables; never
  clip filter controls or actions at the outer page boundary.
- Preserve keyboard focus, accessible labels, semantic tables, loading/error/empty
  states, and reduced-motion behavior.

## Ownership

- `src/styles/theme.css`: shared colors, dimensions, radii, and elevation tokens.
- `src/styles/horizon.css`: page hierarchy, shared surfaces and responsive patterns.
- `src/app/components/horizon/HorizonPage.tsx`: shared structural components.
- Business module styles own only their distinct workspaces. Update existing rules
  rather than appending competing global overrides.

Verify representative task, directory, and order pages at desktop and compact
widths after changes to shared primitives. Do not claim every route was visually
tested when only representative pages were checked.

## Production prototype exception · 2026-10-09

The user's P00–P08 and P10 images are the visual authority for production pages.
There is no supplied P09. The user rejected the compact-summary/task-workbench
interpretation and the later free reorganization of the remaining pages.
This exception applies to production only; it does not redefine the global
brand, shell, shared controls, or unrelated modules.

Production now has named pages with their prototype IDs. The visible module
entry is “生产管理”, while `/production-execution` and its permission keys stay
compatible. Six main navigation entries identify planning, field reporting,
inspection, defects, collaboration, and transfer/archive. P07 is under planning,
P10 under transfer/archive, and P06 is the page-header “全部任务” entry. Do not
reintroduce a generic workbench or require users to infer which prototype a
multi-level technical tab represents.

Use the prototype's blue/white business surfaces, navy headings, restrained
borders, and distinct primary/secondary work regions. The local source is
`src/app/production/execution/production-prototype.css` and the scoped field,
inspection, quality, lifecycle, and cockpit styles. The local primary blue
`#1554e8`, 12px production panels, and visible page title with its P-number are
intentional exceptions to the shared palette/radius/header guidance above.
Do not introduce global tokens or a second global design system for this scope.

- P00: four KPI cards, trend and quality charts, line progress and coordination.
  This overrides compact metric-strip and work-first guidance for the cockpit.
- P01: planning table on the left, selected task on the right, and use-material below;
  omit the annotated ten-day schedule card. P07 owns the day-by-process matrix;
  each cell shows the process name and quantity with its actual unit, linking to the original task.
- P02: shared dispatch identity, compact expandable SOP/SIP/drawing versions,
  then two clearly named reporting and field-defect panels. Do not repeat the
  outer title or let supporting files push these panels below the first screen.
- P03: four authentic first-final-inspection metrics, inspection tables, and a
  separate exception/reinspection column. Reuse the page-wide model filter.
- P04/P08: left issue list, right original issue, evidence, collaboration or
  disposition, verification, and handling history. Do not fork the quality record.
- P05/P10: transfer requirements and fixed documents beside the relevant archive;
  or old/new change documents beside personal acknowledgment and affected scope.
  Batch archive remains a separate P05 view.
- P06: task table with selected-task details; only actually integrated task types.

Meeting decisions override contradictory prototype details: omit routine
field-defect dimension entry; use photographs/video and options; support
cross-department collaboration; keep QA release separate. Ordinary final
inspection must never masquerade as performance/final-gate completion. Missing
attendance, gate statistics, inspection types, and priority/acceptance states
must stay unavailable or explicitly out of scope, never decorative data.

Desktop columns become stacked regions at compact widths. Wide tables scroll
inside their surfaces. Preserve keyboard access, original permissions, date and
record context, error/retry states, and drafts after failed submissions. Verification
uses isolated fixture data; screenshots do not certify real business figures.

Current implementation and evidence:
[Production prototype alignment](docs/production-rectification/2026-10-09-production-prototype-alignment.md).
P00's previous correction and data contract remain documented in
[Production cockpit correction](docs/production-rectification/2026-10-09-cockpit-correction.md).
