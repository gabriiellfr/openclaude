// @ts-nocheck
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type ProviderProfile = 'openai' | 'ollama'

type ProfileFile = {
  profile: ProviderProfile
  env?: {
    OPENAI_BASE_URL?: string
    OPENAI_MODEL?: string
    OPENAI_API_KEY?: string
  }
}

function parseProfile(argv: string[]): ProviderProfile | 'auto' | null {
  const profile = argv[0]?.toLowerCase()
  if (!profile) return 'auto'
  if (profile === 'auto') return 'auto'
  if (profile === 'openai' || profile === 'ollama') return profile
  return null
}

function loadPersistedProfile(): ProfileFile | null {
  const path = resolve(process.cwd(), '.openclaude-profile.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProfileFile
    if (parsed.profile === 'openai' || parsed.profile === 'ollama') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

async function hasLocalOllama(): Promise<boolean> {
  const endpoint = 'http://localhost:11434/api/tags'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)
  try {
    const response = await fetch(endpoint, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function runCommand(command: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(command, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      shell: true,
    })

    child.on('close', code => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

function buildEnv(profile: ProviderProfile, persisted: ProfileFile | null): NodeJS.ProcessEnv {
  const persistedEnv = persisted?.env ?? {}
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_USE_OPENAI: '1',
  }

  if (profile === 'ollama') {
    env.OPENAI_BASE_URL = persistedEnv.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1'
    env.OPENAI_MODEL = persistedEnv.OPENAI_MODEL || process.env.OPENAI_MODEL || 'llama3.1:8b'
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'SUA_CHAVE') {
      delete env.OPENAI_API_KEY
    }
    return env
  }

  env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || persistedEnv.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  env.OPENAI_MODEL = process.env.OPENAI_MODEL || persistedEnv.OPENAI_MODEL || 'gpt-4o'
  env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || persistedEnv.OPENAI_API_KEY
  return env
}

function printSummary(profile: ProviderProfile, env: NodeJS.ProcessEnv): void {
  const keySet = Boolean(env.OPENAI_API_KEY)
  console.log(`Launching profile: ${profile}`)
  console.log(`OPENAI_BASE_URL=${env.OPENAI_BASE_URL}`)
  console.log(`OPENAI_MODEL=${env.OPENAI_MODEL}`)
  console.log(`OPENAI_API_KEY_SET=${keySet}`)
}

async function main(): Promise<void> {
  const requestedProfile = parseProfile(process.argv.slice(2))
  if (!requestedProfile) {
    console.error('Usage: bun run scripts/provider-launch.ts [openai|ollama|auto]')
    process.exit(1)
  }

  const persisted = loadPersistedProfile()
  let profile: ProviderProfile

  if (requestedProfile === 'auto') {
    if (persisted) {
      profile = persisted.profile
    } else {
      profile = (await hasLocalOllama()) ? 'ollama' : 'openai'
    }
  } else {
    profile = requestedProfile
  }

  const env = buildEnv(profile, persisted)

  if (profile === 'openai' && (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'SUA_CHAVE')) {
    console.error('OPENAI_API_KEY is required for openai profile and cannot be SUA_CHAVE. Run: bun run profile:init -- --provider openai --api-key <key>')
    process.exit(1)
  }

  printSummary(profile, env)

  const doctorCode = await runCommand('bun run scripts/system-check.ts', env)
  if (doctorCode !== 0) {
    console.error('Runtime doctor failed. Fix configuration before launching.')
    process.exit(doctorCode)
  }

  const devCode = await runCommand('bun run dev', env)
  process.exit(devCode)
}

await main()

export {}
