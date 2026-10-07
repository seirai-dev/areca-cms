#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";

import {
  recoveryEnvironment,
  portableConfiguration,
  verifyContainerCredentials,
} from "./recovery-config.mjs";

const [command, project, envFileArg, backupArg] = process.argv.slice(2);
if (
  !["backup", "restore"].includes(command) ||
  !project ||
  !envFileArg ||
  !backupArg ||
  !/^[a-z0-9][a-z0-9_-]*$/.test(project)
)
  throw new Error(
    "Usage: node docker/recovery.mjs backup|restore PROJECT ENV_FILE BACKUP_DIR",
  );
const composeFile = resolve("docker/compose.yml"),
  envFile = resolve(envFileArg),
  backup = resolve(backupArg);
const dockerEnvironment = recoveryEnvironment(
  process.env,
  readFileSync(composeFile, "utf8"),
  readFileSync(envFile, "utf8"),
);
function run(args, capture = false) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env: dockerEnvironment,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0)
    throw new Error(`Docker command failed: ${args.slice(0, 3).join(" ")}`);
  return result.stdout?.trim();
}
const compose = (...args) =>
  run([
    "compose",
    "--project-name",
    project,
    "--env-file",
    envFile,
    "-f",
    composeFile,
    ...args,
  ]);
const volumes = ["postgres_data", "rustfs_data", "redis_data"];
const checksum = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
if (command === "backup") {
  mkdirSync(backup, { mode: 0o700 });
  // Stop every writer and database/storage service; keep stopped on failure.
  compose("stop");
  const configuration = JSON.parse(
    run(
      [
        "compose",
        "--project-name",
        project,
        "--env-file",
        envFile,
        "-f",
        composeFile,
        "config",
        "--format",
        "json",
      ],
      true,
    ),
  );
  const images = {};
  for (const [service, definition] of Object.entries(configuration.services)) {
    const container = run(
      [
        "compose",
        "--project-name",
        project,
        "--env-file",
        envFile,
        "-f",
        composeFile,
        "ps",
        "-a",
        "-q",
        service,
      ],
      true,
    );
    if (container)
      verifyContainerCredentials(
        service,
        definition.environment,
        JSON.parse(
          run(["inspect", "--format", "{{json .Config.Env}}", container], true),
        ),
      );
    images[service] = container
      ? run(["inspect", "--format", "{{.Image}}", container], true)
      : definition.image;
  }
  copyFileSync(envFile, join(backup, "instance.env"));
  chmodSync(join(backup, "instance.env"), 0o600);
  copyFileSync(composeFile, join(backup, "compose.source.yml"));
  writeFileSync(
    join(backup, "compose.yml"),
    JSON.stringify(portableConfiguration(configuration), null, 2),
    { mode: 0o600 },
  );
  for (const volume of volumes) {
    run(["volume", "inspect", `${project}_${volume}`], true);
    run([
      "run",
      "--rm",
      "-v",
      `${project}_${volume}:/source:ro`,
      "-v",
      `${backup}:/backup`,
      "alpine:3.21",
      "tar",
      "-czf",
      `/backup/${volume}.tgz`,
      "-C",
      "/source",
      ".",
    ]);
    chmodSync(join(backup, `${volume}.tgz`), 0o600);
  }
  const files = Object.fromEntries(
    readdirSync(backup).map((name) => [name, checksum(join(backup, name))]),
  );
  writeFileSync(
    join(backup, "backup.json"),
    JSON.stringify(
      {
        format: "areca-instance",
        version: 1,
        createdAt: new Date().toISOString(),
        images,
        files,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Backup complete. Services remain stopped; restart explicitly after moving the protected archive off host.",
  );
} else {
  const manifest = JSON.parse(
    readFileSync(join(backup, "backup.json"), "utf8"),
  );
  if (manifest.format !== "areca-instance" || manifest.version !== 1)
    throw new Error("Unsupported backup");
  const expected = [
    "instance.env",
    "compose.yml",
    "compose.source.yml",
    ...volumes.map((v) => `${v}.tgz`),
  ];
  if (Object.keys(manifest.files).sort().join() !== expected.sort().join())
    throw new Error("Invalid backup files");
  for (const name of expected)
    if (checksum(join(backup, name)) !== manifest.files[name])
      throw new Error(`Checksum mismatch: ${name}`);
  if (checksum(envFile) !== manifest.files["instance.env"])
    throw new Error(
      "Destination ENV_FILE must be an exact protected copy of instance.env (keys/passwords preserved)",
    );
  // Restore only into fresh volumes. Never overwrite the operator's current instance.
  for (const volume of volumes) {
    const found = run(["volume", "ls", "--format", "{{.Name}}"], true).split(
      "\n",
    );
    if (found.includes(`${project}_${volume}`))
      throw new Error(
        `Destination volume already exists: ${project}_${volume}; choose a new isolated project`,
      );
  }
  for (const volume of volumes) {
    run(["volume", "create", `${project}_${volume}`]);
    run([
      "run",
      "--rm",
      "-v",
      `${project}_${volume}:/destination`,
      "-v",
      `${backup}:/backup:ro`,
      "alpine:3.21",
      "tar",
      "-xzf",
      `/backup/${volume}.tgz`,
      "-C",
      "/destination",
    ]);
  }
  writeFileSync(
    join(dirname(envFile), `${project}-images.yml`),
    JSON.stringify(
      {
        services: Object.fromEntries(
          Object.entries(manifest.images).map(([service, image]) => [
            service,
            { image },
          ]),
        ),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Restored isolated volumes for ${project}. Start pinned images using the archived compose.yml and ${join(dirname(envFile), `${project}-images.yml`)} override; keep CMS stopped until verification.`,
  );
}
