# INOGI Office UI direction

The existing business product is the source of truth. Preserve its routes, data,
permissions, task states, filters, and workflows when changing presentation.

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
