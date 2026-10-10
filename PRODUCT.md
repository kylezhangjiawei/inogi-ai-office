# INOGI production management

Scope: production overview and execution pages inside the existing INOGI
business application. This scoped product note does not replace the rest of
the application's requirements or authorize changing unrelated modules.

## Audience and source of truth

Production supervisors, planners, line owners, inspectors, and collaborating
staff need to find their original task, act within their role, and trace its
result. The user's supplied P00–P08 and P10 images define each page's identity
and layout. The meeting decisions define business changes when they differ
from those images. Existing authorized records and rules define what the
current implementation can truthfully show or perform.

The user rejected an independently invented “production workbench” organization.
The visible module is now “生产管理”, with prototype names and P-numbers retained.
Navigation has six named entries: planning/dispatch (P01), field reporting and
defects (P02), inspection/reinspection (P03), defect handling (P08), production
collaboration (P04), and transfer/archive (P05). P07 is a planning subpage,
P10 is a transfer/archive subpage, and P06 is the page-header all-tasks entry.
P05 has separate transfer and batch-archive views. P00 remains the cockpit.

## Product commitments

- Selected month, model and plan determine the authorized production scope.
  Daily inspection metrics use the explicitly selected date; pending inspections
  retain cross-day/cross-month unfinished tasks. Links preserve original plan,
  task, quality, inspection and document-version identities.
- Field reporting and defects share dispatch context. The production number
  comes from the original production batch. Defect registration uses the original
  report's unregistered bad quantity, options, and photo/video evidence. It does
  not require routine dimension entry or duplicate the original quality record.
- First-final-inspection pass rate excludes process checks, legacy unclassified
  inspections and reinspection corrections. Component units must not be added
  to whole-machine units. No records and unknown data are different states.
- Whole-machine completion requires performance and final-gate approval. QA
  release remains separate. Monthly completion follows actual gate date, while
  monthly-plan completion follows the plan cohort. Until these links exist,
  cockpit completion/remaining/rate values remain unavailable. Attendance also
  remains unavailable until a real attendance source exists.
- Collaboration may involve R&D, procurement, or other permitted colleagues.
  It continues the original issue through reply, disposition and verification;
  a separate departmental accept/reject state is not yet implemented.

## Deliberate scope limits

This iteration aligns the nine execution prototypes P01–P08 and P10, following
P00's previous correction. It does not claim that all fourteen attached images
or the entire meeting backlog are implemented. S06/S10/S11/S16 retain their
existing supply-chain records and pages. The warehouse-arrival → planning-use
and inspection-priority confirmation → QC → procurement/production-plan feedback
chain is still incomplete. Performance/final-gate records, independent acceptance,
priority fields and full process handoffs remain explicit follow-up work.

Original backend commands, permission gates, idempotency and draft protection
are reused. Layout changes do not create new databases, migrations, ERP writes,
real business records or a deployment. Auxiliary scenario calculation leaves
main navigation while compatible old links remain available.

Detailed mapping, decisions, implementation limits and local verification:
[2026-10-09 production prototype alignment](docs/production-rectification/2026-10-09-production-prototype-alignment.md).
P00-specific data definitions and evidence:
[2026-10-09 cockpit correction](docs/production-rectification/2026-10-09-cockpit-correction.md).
