# Dokploy API notes (test server v0.29.12)

Verified against `http://192.168.0.141:3000` with `x-api-key`.
`GET /api/project.all` works. No applications exist yet.
`GET /api/openapi.json` is 404 (auth or not). `/swagger` redirects to `/` without a web session.
`GET /api/settings.getDokployVersion` → `"v0.29.12"`.
Shapes below come from live Zod validation errors + Dokploy v0.29.12 source.

Auth: header `x-api-key` (not Bearer). Base path `/api`.

## application.deploy — `POST /api/application.deploy`

Required: `{ applicationId }`. Optional: `title`, `description`.
Response is typically `true` or an **empty 200 body** (adapter treats empty as success).
The deployment id is **not** returned here — read `application.one` → `deployments[]`.

## application.one — `GET /api/application.one?applicationId=`

Missing id → `NOT_FOUND` `"Application not found"`.
Expected 200 body includes:

- `applicationStatus`: `idle` | `running` | `done` | `error`
- `deployments[]` (relation): `{ deploymentId, createdAt, status, title, ... }`
  CMS dispatches use title `areca:<build-job-id>` and description
  `publication=<publication-id> snapshot=<snapshot-hash>`. Only a unique exact
  title/description match establishes acceptance; missing records stay uncertain.
  Polling uses that deployment's status, never application-wide status or newest
  record. There is no fabricated deployment ID fallback.

Confirmed in the pinned [v0.29.12 application router](https://github.com/Dokploy/dokploy/blob/v0.29.12/apps/dokploy/server/api/routers/application.ts#L667-L709):
`application.deploy` carries title/description into the queued deployment and
returns no deployment ID. An error response can follow queue acceptance (for
example, an audit failure), so even a deployment POST 5xx must be reconciled.
The CMS never automatically repeats this POST.

## application.create — `POST /api/application.create`

Required: `{ name, environmentId }`
Optional: `appName`, `description`, `serverId`
Project `areca-cms` production `environmentId`: `5lgM18mEtVAtjeb6sPi7K`

## application.saveGithubProvider — `POST /api/application.saveGithubProvider`

Required: `{ applicationId, repository, owner, branch, buildPath, githubId }`
Optional: `triggerType` (`push` | `tag`, default `push`), `enableSubmodules`, `watchPaths`

## application.saveGitProvider — `POST /api/application.saveGitProvider`

**Typo path `application.saveGitProdiver` is 404 on v0.29.12.** Use `saveGitProvider`.

Required: `{ applicationId, customGitUrl, customGitBranch, customGitBuildPath, watchPaths }`
Optional: `enableSubmodules`, `customGitSSHKeyId`

`watchPaths` is required by Zod `.required()`; send `[]` or `null`.

## application.saveBuildType — `POST /api/application.saveBuildType`

Required: `{ applicationId, buildType, dockerfile, dockerContextPath, dockerBuildStage, herokuVersion, railpackVersion }`
Optional: `publishDirectory`, `isStaticSpa`

`buildType`: `dockerfile` | `nixpacks` | `heroku_buildpacks` | `paketo_buildpacks` | `static` | `railpack`
Nullable extras (`dockerfile`, `dockerContextPath`, …) must still be present (`null` is ok).

## application.saveEnvironment — `POST /api/application.saveEnvironment`

Required: `{ applicationId, env, buildArgs, buildSecrets, createEnvFile }`
`env` is a single string (`KEY=value` lines). Others may be `null` but must be present.
`buildSecrets` is a newline-separated `KEY=value` block. Dokploy exposes each key
to BuildKit as `--secret id=KEY,env=KEY`; consume it with
`RUN --mount=type=secret,id=KEY` so it is not recorded in image layers or metadata.

## domain.create — `POST /api/domain.create`

Required: `{ host }`
Optional: `path`, `port`, `customEntrypoint`, `https`, `applicationId`, `certificateType` (`letsencrypt` | `none` | `custom`), `customCertResolver`, `composeId`, `serviceName`, `domainType` (`application` | `compose` | `preview`), `previewDeploymentId`, `internalPath`, `stripPath`, `middlewares`, `forwardAuthEnabled`
