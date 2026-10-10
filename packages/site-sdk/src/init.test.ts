import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from './args.js'
import { run } from './cli.js'
import { loadLocalEnv } from './env.js'
import { initSite } from './init.js'

const originalUrl = process.env.ARECA_CMS_URL
const originalToken = process.env.ARECA_SITE_TOKEN
const extraEnvKeys = new Set<string>()

afterEach(() => {
  if (originalUrl === undefined) delete process.env.ARECA_CMS_URL
  else process.env.ARECA_CMS_URL = originalUrl
  if (originalToken === undefined) delete process.env.ARECA_SITE_TOKEN
  else process.env.ARECA_SITE_TOKEN = originalToken
  for (const key of extraEnvKeys) {
    delete process.env[key]
  }
  extraEnvKeys.clear()
})

describe('parseArgs init / run / sync-manifest', () => {
  it('parses init with all flags including -y and --force', () => {
    expect(
      parseArgs([
        'init',
        '--cms-url',
        'http://localhost:3000',
        '--token',
        'site-token',
        '--site-key',
        'acme-site',
        '--out',
        'tmp/content',
        '--config',
        'custom.config.ts',
        '-y',
        '--force',
      ]),
    ).toEqual({
      command: 'init',
      cmsUrl: 'http://localhost:3000',
      token: 'site-token',
      siteKey: 'acme-site',
      outDir: 'tmp/content',
      configPath: 'custom.config.ts',
      yes: true,
      force: true,
    })
  })

  it('parses init without --yes', () => {
    expect(parseArgs(['init'])).toEqual({
      command: 'init',
      cmsUrl: undefined,
      token: undefined,
      siteKey: undefined,
      outDir: 'src/generated/content',
      configPath: 'areca.config.ts',
      yes: false,
      force: false,
    })
  })

  it('accepts --yes', () => {
    expect(parseArgs(['init', '--yes'])).toMatchObject({
      command: 'init',
      yes: true,
    })
  })

  it('requires a value for --cms-url', () => {
    expect(parseArgs(['init', '--cms-url'])).toEqual({
      command: 'error',
      message: 'Missing value for --cms-url',
    })
  })

  it('requires a value for --token', () => {
    expect(parseArgs(['init', '--token'])).toEqual({
      command: 'error',
      message: 'Missing value for --token',
    })
  })

  it('requires a value for --site-key', () => {
    expect(parseArgs(['init', '--site-key'])).toEqual({
      command: 'error',
      message: 'Missing value for --site-key',
    })
  })

  it('requires a value for --out on init', () => {
    expect(parseArgs(['init', '--out'])).toEqual({
      command: 'error',
      message: 'Missing value for --out',
    })
  })

  it('defaults sync-manifest path when omitted', () => {
    expect(parseArgs(['sync-manifest'])).toEqual({
      command: 'sync-manifest',
      configPath: './areca.config.ts',
    })
  })

  it('parses sync-manifest with an explicit path', () => {
    expect(parseArgs(['sync-manifest', './areca.config.ts'])).toEqual({
      command: 'sync-manifest',
      configPath: './areca.config.ts',
    })
  })

  it('parses run -- vite dev', () => {
    expect(parseArgs(['run', '--', 'vite', 'dev'])).toEqual({
      command: 'run',
      commandArgs: ['vite', 'dev'],
    })
  })

  it('errors when run has no --', () => {
    expect(parseArgs(['run', 'vite', 'dev'])).toEqual({
      command: 'error',
      message: 'Missing command. Usage: areca run -- <command>',
    })
  })

  it('errors when run has no command', () => {
    expect(parseArgs(['run'])).toEqual({
      command: 'error',
      message: 'Missing command. Usage: areca run -- <command>',
    })
    expect(parseArgs(['run', '--'])).toEqual({
      command: 'error',
      message: 'Missing command. Usage: areca run -- <command>',
    })
  })

  it('rejects unknown init flags', () => {
    expect(parseArgs(['init', '--nope'])).toEqual({
      command: 'error',
      message: 'Unknown argument: --nope',
    })
  })
})

describe('initSite', () => {
  it('writes config, env files, gitignore, empty manifest, and package.json scripts', async () => {
    const dir = makeSiteDir()
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })

      expect(readUtf8(join(dir, 'areca.config.ts'))).toBe(
        `import { defineSiteContent } from '@areca-cms/site-sdk'\n\nexport default defineSiteContent({\n  siteKey: 'acme-site',\n  collections: {},\n})\n`,
      )
      expect(readUtf8(join(dir, '.env.example'))).toBe(
        'ARECA_CMS_URL=http://localhost:3000\nARECA_SITE_TOKEN=\nARECA_SCHEMA_TOKEN=\n',
      )
      expect(readUtf8(join(dir, '.env.local'))).toBe(
        'ARECA_CMS_URL=http://localhost:3000\nARECA_SITE_TOKEN=site-token\n',
      )
      expect(readUtf8(join(dir, '.gitignore'))).toBe(
        '.env.local\nsrc/generated/content/\n',
      )
      expect(
        JSON.parse(readUtf8(join(dir, 'src/generated/content/manifest.json'))),
      ).toEqual({
        publicationId: '',
        hash: '',
        createdAt: '',
        collections: {},
      })
      expect(existsSync(join(dir, 'src/generated/content/articles.json'))).toBe(
        false,
      )

      const pkg = JSON.parse(readUtf8(join(dir, 'package.json'))) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts['sync-manifest']).toBe('areca manifest push')
      expect(pkg.scripts['content:pull']).toBe(
        'areca pull --out src/generated/content',
      )
      expect(pkg.scripts.dev).toBeUndefined()
      expect(pkg.scripts.prebuild).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails without package.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'areca-init-'))
    try {
      await expect(
        initSite({
          cwd: dir,
          yes: true,
          cmsUrl: 'http://localhost:3000',
          token: 'site-token',
          siteKey: 'acme-site',
        }),
      ).rejects.toThrow(/No package\.json found/)
      expect(existsSync(join(dir, 'areca.config.ts'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips existing areca.config.ts without --force and overwrites with --force', async () => {
    const dir = makeSiteDir()
    const configPath = join(dir, 'areca.config.ts')
    const original = 'export default { kept: true }\n'
    writeFileSync(configPath, original, 'utf8')
    writeFileSync(join(dir, '.env.example'), 'KEEP=1\n', 'utf8')
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      expect(readUtf8(configPath)).toBe(original)
      expect(readUtf8(join(dir, '.env.example'))).toBe('KEEP=1\n')

      await initSite({
        cwd: dir,
        yes: true,
        force: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      expect(readUtf8(configPath)).toContain("siteKey: 'acme-site'")
      expect(readUtf8(join(dir, '.env.example'))).toContain(
        'ARECA_CMS_URL=http://localhost:3000',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('upserts env.local keys and preserves other keys', async () => {
    const dir = makeSiteDir()
    writeFileSync(
      join(dir, '.env.local'),
      '# keep me\nOTHER=stay\nARECA_CMS_URL=http://old.example\n',
      'utf8',
    )
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'https://cms.example.com',
        token: 'rotated-token',
        siteKey: 'acme-site',
      })
      expect(readUtf8(join(dir, '.env.local'))).toBe(
        '# keep me\nOTHER=stay\nARECA_CMS_URL=https://cms.example.com\nARECA_SITE_TOKEN=rotated-token\n',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not duplicate gitignore lines', async () => {
    const dir = makeSiteDir()
    writeFileSync(
      join(dir, '.gitignore'),
      'node_modules/\n.env.local\nsrc/generated/content/\n',
      'utf8',
    )
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      expect(readUtf8(join(dir, '.gitignore'))).toBe(
        'node_modules/\n.env.local\nsrc/generated/content/\n',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not clobber an existing sync-manifest script', async () => {
    const dir = makeSiteDir({ scripts: { 'sync-manifest': 'echo custom' } })
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      const pkg = JSON.parse(readUtf8(join(dir, 'package.json'))) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts['sync-manifest']).toBe('echo custom')
      expect(pkg.scripts['content:pull']).toBe(
        'areca pull --out src/generated/content',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('wraps dev with areca run -- when it does not already load env', async () => {
    const dir = makeSiteDir({ scripts: { dev: 'vite --port 3001' } })
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      const pkg = JSON.parse(readUtf8(join(dir, 'package.json'))) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts.dev).toBe('areca run -- vite --port 3001')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves an already-wrapped dev script alone', async () => {
    const dir = makeSiteDir({
      scripts: {
        dev: 'areca run -- vite',
        preview: 'node --env-file=.env.local vite preview',
      },
    })
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      const pkg = JSON.parse(readUtf8(join(dir, 'package.json'))) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts.dev).toBe('areca run -- vite')
      expect(pkg.scripts.preview).toBe(
        'node --env-file=.env.local vite preview',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not add dev or prebuild if missing', async () => {
    const dir = makeSiteDir({ scripts: { test: 'vitest' } })
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      const pkg = JSON.parse(readUtf8(join(dir, 'package.json'))) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts.dev).toBeUndefined()
      expect(pkg.scripts.prebuild).toBeUndefined()
      expect(pkg.scripts.test).toBe('vitest')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses --out in content:pull and gitignore', async () => {
    const dir = makeSiteDir()
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
        outDir: 'tmp/content',
      })
      const pkg = JSON.parse(readUtf8(join(dir, 'package.json'))) as {
        scripts: Record<string, string>
      }
      expect(pkg.scripts['content:pull']).toBe('areca pull --out tmp/content')
      expect(readUtf8(join(dir, '.gitignore'))).toContain('tmp/content/')
      expect(existsSync(join(dir, 'tmp/content/manifest.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an invalid site-key', async () => {
    const dir = makeSiteDir()
    try {
      await expect(
        initSite({
          cwd: dir,
          yes: true,
          cmsUrl: 'http://localhost:3000',
          token: 'site-token',
          siteKey: 'Acme_Site',
        }),
      ).rejects.toThrow(/Invalid site key/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an invalid cms-url', async () => {
    const dir = makeSiteDir()
    try {
      await expect(
        initSite({
          cwd: dir,
          yes: true,
          cmsUrl: 'not-a-url',
          token: 'site-token',
          siteKey: 'acme-site',
        }),
      ).rejects.toThrow(/Invalid CMS URL/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('errors when --yes is missing a token', async () => {
    const dir = makeSiteDir()
    try {
      await expect(
        initSite({
          cwd: dir,
          yes: true,
          cmsUrl: 'http://localhost:3000',
          siteKey: 'acme-site',
        }),
      ).rejects.toThrow(/Missing --token/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts all flags without --yes when stdin is not a TTY', async () => {
    const dir = makeSiteDir()
    try {
      await initSite({
        cwd: dir,
        cmsUrl: 'http://localhost:3000',
        token: 'site-token',
        siteKey: 'acme-site',
      })
      expect(readUtf8(join(dir, 'areca.config.ts'))).toContain(
        "siteKey: 'acme-site'",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not log the token', async () => {
    const dir = makeSiteDir()
    const token = 'super-secret-token-value'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await initSite({
        cwd: dir,
        yes: true,
        cmsUrl: 'http://localhost:3000',
        token,
        siteKey: 'acme-site',
      })
      const printed = [
        ...log.mock.calls,
        ...err.mock.calls,
        ...info.mock.calls,
        ...warn.mock.calls,
      ]
        .flat()
        .map(String)
        .join(' ')
      expect(printed).not.toContain(token)
    } finally {
      log.mockRestore()
      err.mockRestore()
      info.mockRestore()
      warn.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('loadLocalEnv', () => {
  it('loads .env.local then .env without overriding process.env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'areca-env-'))
    process.env.EXISTING = 'from-process'
    extraEnvKeys.add('EXISTING')
    extraEnvKeys.add('SHARED')
    extraEnvKeys.add('LOCAL_ONLY')
    extraEnvKeys.add('ENV_ONLY')
    extraEnvKeys.add('COMMENTED')
    extraEnvKeys.add('QUOTED')
    extraEnvKeys.add('SINGLE')
    extraEnvKeys.add('LITERAL_CMD')
    extraEnvKeys.add('LITERAL_HOME')
    writeFileSync(
      join(dir, '.env.local'),
      [
        '# comment',
        '',
        'SHARED=from-local',
        'LOCAL_ONLY=1',
        'EXISTING=from-file',
        'QUOTED="hello world"',
        "SINGLE='single quotes'",
        'LITERAL_CMD=$(whoami)',
        'LITERAL_HOME=$HOME',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      join(dir, '.env'),
      'SHARED=from-env\nENV_ONLY=2\nCOMMENTED=nope\n',
      'utf8',
    )
    try {
      const loaded = loadLocalEnv(dir)
      expect(loaded).toEqual([join(dir, '.env.local'), join(dir, '.env')])
      expect(process.env.SHARED).toBe('from-local')
      expect(process.env.LOCAL_ONLY).toBe('1')
      expect(process.env.ENV_ONLY).toBe('2')
      expect(process.env.EXISTING).toBe('from-process')
      expect(process.env.QUOTED).toBe('hello world')
      expect(process.env.SINGLE).toBe('single quotes')
      expect(process.env.LITERAL_CMD).toBe('$(whoami)')
      expect(process.env.LITERAL_HOME).toBe('$HOME')
      expect(process.env.COMMENTED).toBe('nope')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores comments and blank lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'areca-env-'))
    extraEnvKeys.add('FOO')
    extraEnvKeys.add('BAR')
    writeFileSync(
      join(dir, '.env'),
      '# ignore\n\nFOO=bar\n  # also\nBAR=baz\n',
      'utf8',
    )
    try {
      loadLocalEnv(dir)
      expect(process.env.FOO).toBe('bar')
      expect(process.env.BAR).toBe('baz')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('run init', () => {
  it('exits 1 when init has no flags and stdin is not a TTY', async () => {
    const dir = makeSiteDir()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    })
    try {
      await expect(run(['init'], { cwd: dir })).resolves.toBe(1)
      expect(err.mock.calls.flat().join(' ')).toMatch(/Missing --cms-url/)
    } finally {
      if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      err.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 for init --yes in a temp cwd', async () => {
    const dir = makeSiteDir()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        run(
          [
            'init',
            '--yes',
            '--cms-url',
            'http://localhost:3000',
            '--token',
            'site-token',
            '--site-key',
            'acme-site',
          ],
          { cwd: dir },
        ),
      ).resolves.toBe(0)
      expect(existsSync(join(dir, 'areca.config.ts'))).toBe(true)
      expect(existsSync(join(dir, 'src/generated/content/manifest.json'))).toBe(
        true,
      )
    } finally {
      log.mockRestore()
      err.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('run -- exits with the child status', async () => {
    await expect(run(['run', '--', 'exit', '42'])).resolves.toBe(42)
  })
})

function makeSiteDir(pkg: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'areca-init-'))
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'tmp-site', private: true, ...pkg }, null, 2)}\n`,
    'utf8',
  )
  return dir
}

function readUtf8(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

it('uses custom config and quoted output paths in generated scripts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'areca-custom-init-'))
  try {
    writeFileSync(join(dir, 'package.json'), '{}')
    await initSite({
      cwd: dir,
      cmsUrl: 'https://cms.test',
      token: 'read',
      siteKey: 'site',
      configPath: 'config/custom schema.ts',
      outDir: 'generated content',
      yes: true,
    })
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.scripts['sync-manifest']).toBe(
      "areca manifest push 'config/custom schema.ts'",
    )
    expect(pkg.scripts['content:pull']).toBe(
      "areca pull --out 'generated content'",
    )
    expect(existsSync(join(dir, 'config/custom schema.ts'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
