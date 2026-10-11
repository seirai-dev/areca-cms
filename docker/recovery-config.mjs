/** Make --env-file authoritative rather than letting an unrelated shell override it. */
export function recoveryEnvironment(environment, composeSource, envSource) {
  const result = { ...environment };
  const keys = new Set(
    [...composeSource.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (match) => match[1],
    ),
  );
  for (const match of envSource.matchAll(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
  ))
    keys.add(match[1]);
  for (const key of keys) delete result[key];
  return result;
}
/** Resolved config retains literal secrets but restores into a new project namespace. */
export function portableConfiguration(configuration) {
  const portable = structuredClone(configuration);
  delete portable.name;
  for (const resource of ["volumes", "networks"])
    for (const definition of Object.values(portable[resource] ?? {})) {
      if (!definition.external) delete definition.name;
    }
  function escape(value) {
    if (typeof value === "string") return value.replaceAll("$", () => "$$");
    if (Array.isArray(value)) return value.map(escape);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, escape(item)]),
      );
    return value;
  }
  return escape(portable);
}
export function verifyContainerCredentials(service, expected, actualEnv) {
  const actual = Object.fromEntries(
    actualEnv.map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  );
  for (const [key, value] of Object.entries(expected ?? {})) {
    if (
      /^(DATABASE_URL|POSTGRES_(PASSWORD|USER|DB)|BETTER_AUTH_SECRET|DOKPLOY_CREDENTIALS_ENCRYPTION_KEY|AI_SETTINGS_ENCRYPTION_KEY|S3_|RUSTFS_)/.test(
        key,
      ) &&
      String(value) !== actual[key]
    ) {
      throw new Error(
        `Environment file does not match ${service} container credential ${key}; backup aborted`,
      );
    }
  }
}
