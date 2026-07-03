import { createAuth0Client, type Auth0Client } from '@auth0/auth0-spa-js'
import type { AuthProviderPublic } from '../api/types'

export type Auth0ClientConfig = {
  domain: string
  clientId: string
}

export type Auth0Provider = AuthProviderPublic & {
  provider_type: 'oidc'
  oidc_domain: string
  oidc_client_id: string
}

let clientPromise: Promise<Auth0Client> | null = null
let cachedKey: string | null = null

export function getAuth0Client(config: Auth0ClientConfig): Promise<Auth0Client> {
  const key = `${config.domain}::${config.clientId}`
  if (!clientPromise || cachedKey !== key) {
    cachedKey = key
    clientPromise = createAuth0Client({
      domain: config.domain,
      clientId: config.clientId,
      authorizationParams: {
        redirect_uri: `${window.location.origin}/login`,
        scope: 'openid profile email',
      },
      cacheLocation: 'memory',
      useRefreshTokens: false,
    })
  }
  return clientPromise
}

export function isAuth0Provider(provider: AuthProviderPublic): provider is Auth0Provider {
  return (
    provider.provider_type === 'oidc' &&
    typeof provider.oidc_domain === 'string' &&
    provider.oidc_domain.length > 0 &&
    typeof provider.oidc_client_id === 'string' &&
    provider.oidc_client_id.length > 0
  )
}
