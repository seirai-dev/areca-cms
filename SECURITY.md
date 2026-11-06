# Security policy

Areca CMS holds client content, user accounts and deployment credentials, so security reports get priority.

## Reporting a vulnerability

**Please don't report security problems in public issues, pull requests or discussions.** A public report shows everyone the weakness before a fix is out.

Report it privately in either of these ways:

1. **GitHub (preferred):** open the [Security tab](https://github.com/seirai-dev/areca-cms/security) and choose **Report a vulnerability**. Only the maintainers can see the report, and we can work on the fix and the advisory together there.
2. **Email:** [security@arecacms.com](mailto:security@arecacms.com).

Useful things to include:

- what an attacker could do, and which role or access they need (anonymous visitor, editor, owner, site token, MCP connection...)
- the steps to reproduce it, or a proof of concept
- the version or commit you tested (the Docker image tag, or the `@areca-cms/site-sdk` version)

## What happens next

- We confirm we received the report within **3 working days**.
- We investigate, keep you updated, and agree on a disclosure date with you. We aim to release a fix within **90 days**, and much sooner for serious problems.
- Once the fix is released, we publish a GitHub security advisory. We credit you in it, unless you'd rather stay anonymous.

Please give us a reasonable chance to fix the problem before you share it, and don't access or change other people's data while testing. Test against your own installation, not someone else's.

## Supported versions

Fixes go into the newest release. Upgrade to the latest version to get them:

| Component | Supported |
| --- | --- |
| CMS Docker image `ghcr.io/seirai-dev/areca-cms` | the latest `vX.Y.Z` release |
| `@areca-cms/site-sdk` | the latest version on npm |
| `@areca-cms/skills` | the latest version on npm |

## In scope

- The CMS (`apps/cms`): sign-in, two-factor authentication, roles and permissions, tenant separation between clients and sites, site tokens, the MCP connectors and OAuth, preview links, uploads, and stored deployment credentials.
- The site SDK and CLI (`packages/site-sdk`), for example writing files outside the content folder during `areca pull`.
- The Docker setup in `docker/`.

Problems in a dependency should go to that project first. If one affects Areca CMS in a specific way, tell us as well.

[The security section of the docs](https://docs.arecacms.com/docs/security) explains how roles, tokens, secrets and two-factor authentication are meant to work.
