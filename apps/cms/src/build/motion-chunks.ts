import path from 'node:path'
import { build } from 'esbuild'

/**
 * What the always-loaded UI takes from motion. Animation features come later
 * through <LazyMotion> (src/lib/motion-features.ts). `VisualElement` is here
 * because its file also holds the feature registry the `m` components read,
 * and chunks split by file.
 */
const SHELL_IMPORTS = `
  export { div } from 'motion/react-m'
  export { AnimatePresence, LayoutGroup, LazyMotion, useReducedMotion, VisualElement, parseValueFromTransform } from 'motion/react'
`

const MOTION_PACKAGE =
  /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils|motion)[\\/]/

/** Absolute paths of the motion files that `SHELL_IMPORTS` keeps after tree-shaking. */
export async function motionShellModules(root: string) {
  const result = await build({
    stdin: { contents: SHELL_IMPORTS, resolveDir: root },
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
  })
  const [output] = Object.values(result.metafile.outputs)
  return new Set(
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([file]) => path.resolve(root, file)),
  )
}

/**
 * A chunk group for every other motion file, so the animation engine,
 * gestures, drag and layout projection stay out of the shell's chunk. They
 * load with the features, or with the few screens that use `motion.*` or
 * `Reorder` directly.
 */
export function motionFeaturesGroup(shellModules: Set<string>) {
  return {
    name: 'motion-features',
    test: (id: string) =>
      MOTION_PACKAGE.test(id) && !shellModules.has(path.resolve(id)),
    // The features import the shell's motion files; keep those where they are.
    includeDependenciesRecursively: false,
  }
}
