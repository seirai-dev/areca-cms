import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/docker-entrypoint.mjs'],
  outfile: '.docker/docker-entrypoint.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  // pg's optional native driver is unused; the JS driver stays bundled.
  external: ['pg-native'],
  // Bundled CommonJS dependencies still require Node's built-in modules.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
})
