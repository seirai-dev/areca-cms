import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { motionFeaturesGroup, motionShellModules } from './motion-chunks'

const root = path.resolve(import.meta.dirname, '../..')

describe('motion chunks', () => {
  it('keeps the m components with the shell and the features apart', async () => {
    const shell = await motionShellModules(root)
    const files = [...shell].map((file) => file.replaceAll('\\', '/'))
    expect(
      files.some((file) => file.endsWith('/render/VisualElement.mjs')),
    ).toBe(true)
    expect(files.some((file) => file.includes('/LazyMotion/'))).toBe(true)

    const group = motionFeaturesGroup(shell)
    for (const file of shell) {
      if (file.includes('node_modules')) expect(group.test(file)).toBe(false)
    }
    const framerFile = files.find((file) => file.includes('/framer-motion/'))!
    const framerDist = framerFile.slice(0, framerFile.indexOf('/dist/es/') + 9)
    expect(group.test(`${framerDist}render/dom/features-max.mjs`)).toBe(true)
    expect(group.test(path.join(root, 'src/lib/motion-features.ts'))).toBe(
      false,
    )
  })
})
