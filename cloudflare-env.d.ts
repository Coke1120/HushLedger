declare global {
  interface CloudflareEnv {
    ASSETS: Fetcher
    DB: D1Database
    AI_SETTINGS_ENCRYPTION_KEY_V1?: string
    CF_ACCESS_AUD?: string
    CF_ACCESS_TEAM_DOMAIN?: string
  }

  interface Env {
    AI_SETTINGS_ENCRYPTION_KEY_V1?: string
    CF_ACCESS_AUD?: string
    CF_ACCESS_TEAM_DOMAIN?: string
  }
}

export {}
