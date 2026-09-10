# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub's private vulnerability
reporting for this repository — the **Security** tab, then *Report a
vulnerability*. That channel is private between the reporter and the
maintainer until a fix is published.

Please do not open a public issue for a security report, and please do not
test against the live site: `cleanplateva.com` serves real traffic, and its
Worker request budget is metered.

Expect an acknowledgement within a week. This is a single-maintainer project,
so there is no formal SLA beyond that.

## Scope

In scope:

- the Cloudflare Worker in `src/worker.js` — the R2 full-data channel and the
  `/admin/api/*` routes;
- the client under `app/` — in particular anything that would let page content
  or URL state execute script, or let a visitor reach admin-only behaviour;
- the build and deploy configuration (`vite.config.ts`, `wrangler.jsonc`,
  `public/_headers`) where a misconfiguration would weaken transport or
  caching guarantees.

Out of scope:

- the accuracy or completeness of inspection data, scores or grades — that is
  a data question, not a security one, and NOTICE.md explains where the
  authoritative records live;
- findings that require an already-compromised maintainer device or
  Cloudflare account;
- automated scanner output with no demonstrated impact.

## What is already known and intended

- **The full data tier is public.** `/data-full/*` is served to anyone who
  acknowledges the terms; there is no authentication on it and none is
  intended. It is public records, presented publicly.
- **`/admin` is identity-gated by Cloudflare Access**, verified server-side in
  the Worker against the team's public keys. The `ACCESS_AUD` value and team
  domain in `wrangler.jsonc` are audience identifiers, not secrets.
- **The admin surface writes to exactly one place** — content-addressed draft
  objects in a dedicated R2 bucket. It cannot publish, and it cannot write to
  the bucket the data tier is served from.
