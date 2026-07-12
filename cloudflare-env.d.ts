declare global {
  interface CloudflareEnv {
    ASSETS: Fetcher
    DB: D1Database
    CF_ACCESS_AUD?: string
    CF_ACCESS_TEAM_DOMAIN?: string
  }

  interface Env {
    CF_ACCESS_AUD?: string
    CF_ACCESS_TEAM_DOMAIN?: string
  }
}

export {}
