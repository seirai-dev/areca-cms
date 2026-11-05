# Contributor docs

These notes are for people working on Areca CMS itself. If you want to use Areca CMS (install it, write content, connect a website), go to the documentation site at **[docs.arecacms.com](https://docs.arecacms.com)** instead.

| Read this | When you want to |
| --- | --- |
| [Development](DEVELOPMENT.md) | Run the workspace locally, use the test databases, and run the test suites |
| [Architecture](ARCHITECTURE.md) | Find your way around the code: data model, content versions, publishing, preview |
| [Design decisions](DECISIONS.md) | Understand what Areca CMS deliberately does and does not do, before proposing a large change |
| [Permissions matrix](AUTHZ_MATRIX.md) | Check which role may do what. The server enforces this table and tests check it |
| [Integration reliability](INTEGRATIONS.md) | Change deployment adapters, retries or the handling of uncertain deploys |
| [Design system](DESIGN.md) | Build CMS screens with the existing tokens, components and patterns |
| [Design notes](design/) | Read the reasoning behind a larger feature, written before it was built |

Other READMEs sit next to the code they describe: [the CMS app](../apps/cms), [Docker](../docker/README.md), [the site SDK](../packages/site-sdk/README.md), [agent skills](../packages/skills/README.md), [the docs site](../apps/docs/README.md), [the landing page](../apps/landing/README.md) and [the demo website](../examples/demo-site/README.md).
