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
  Newest = highest `createdAt`. If `deployments` is missing/empty, fallback `{applicationId}-{timestamp}`.

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

## domain.create — `POST /api/domain.create`

Required: `{ host }`
Optional: `path`, `port`, `customEntrypoint`, `https`, `applicationId`, `certificateType` (`letsencrypt` | `none` | `custom`), `customCertResolver`, `composeId`, `serviceName`, `domainType` (`application` | `compose` | `preview`), `previewDeploymentId`, `internalPath`, `stripPath`, `middlewares`, `forwardAuthEnabled`
