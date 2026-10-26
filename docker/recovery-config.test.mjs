import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  recoveryEnvironment,
  portableConfiguration,
  verifyContainerCredentials,
} from "./recovery-config.mjs";
test("recovery preserves the configured S3 namespace and ignores inherited prefixes", () => {
  const composeSource = readFileSync(
    new URL("./compose.yml", import.meta.url),
    "utf8",
  );
  assert.match(composeSource, /S3_PREFIX: \$\{S3_PREFIX:-\}/);
  assert.deepEqual(
    recoveryEnvironment(
      { PATH: "/bin", S3_PREFIX: "unrelated/instance" },
      composeSource,
      "",
    ),
    { PATH: "/bin" },
  );
  const configuration = {
    services: { cms: { environment: { S3_PREFIX: "tenant/prod" } } },
  };
  assert.equal(
    portableConfiguration(configuration).services.cms.environment.S3_PREFIX,
    "tenant/prod",
  );
  verifyContainerCredentials("cms", configuration.services.cms.environment, [
    "S3_PREFIX=tenant/prod",
  ]);
  assert.throws(
    () =>
      verifyContainerCredentials(
        "cms",
        configuration.services.cms.environment,
        ["S3_PREFIX=tenant/other"],
      ),
    /S3_PREFIX/,
  );
});
test("environment file wins over unrelated sourced integration credentials", () => {
  assert.deepEqual(
    recoveryEnvironment(
      {
        PATH: "/bin",
        S3_ACCESS_KEY: "wrong",
        CMS_IMAGE: "wrong",
        EXTRA: "wrong",
        DOCKER_HOST: "host",
      },
      "image: ${CMS_IMAGE:-default}\nkey: ${S3_ACCESS_KEY}",
      "EXTRA=file\nS3_ACCESS_KEY=file",
    ),
    { PATH: "/bin", DOCKER_HOST: "host" },
  );
});
test("resolved archive uses new project namespace and escapes literal secret dollars", () => {
  const source = {
    name: "old",
    services: { cms: { environment: { SECRET: "password$secret" } } },
    volumes: {
      data: { name: "old_data" },
      shared: { name: "global", external: true },
    },
    networks: { default: { name: "old_default" } },
  };
  assert.deepEqual(portableConfiguration(source), {
    services: { cms: { environment: { SECRET: "password$$secret" } } },
    volumes: { data: {}, shared: { name: "global", external: true } },
    networks: { default: {} },
  });
  assert.equal(source.name, "old");
});
test("rejects mismatched running credentials without exposing their values", () => {
  verifyContainerCredentials(
    "cms",
    { S3_ACCESS_KEY: "saved", DATABASE_URL: "db?x=y" },
    ["S3_ACCESS_KEY=saved", "DATABASE_URL=db?x=y"],
  );
  assert.throws(
    () =>
      verifyContainerCredentials("cms", { S3_ACCESS_KEY: "supersecret" }, [
        "S3_ACCESS_KEY=wrongsecret",
      ]),
    (error) =>
      error.message.includes("S3_ACCESS_KEY") &&
      !error.message.includes("supersecret") &&
      !error.message.includes("wrongsecret"),
  );
});

test("backup rejects a different AI encryption key in the supplied environment", () => {
  assert.throws(
    () =>
      verifyContainerCredentials(
        "cms",
        { AI_SETTINGS_ENCRYPTION_KEY: "stale-key" },
        ["AI_SETTINGS_ENCRYPTION_KEY=actual-key"],
      ),
    /AI_SETTINGS_ENCRYPTION_KEY/,
  );
  verifyContainerCredentials(
    "cms",
    { AI_SETTINGS_ENCRYPTION_KEY: "actual-key" },
    ["AI_SETTINGS_ENCRYPTION_KEY=actual-key"],
  );
});
