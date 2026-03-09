export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  userInfoUrl?: string;
  /** Whether PKCE is required (Microsoft requires it, Yahoo supports it) */
  usePkce: boolean;
  /**
   * When true, the user must supply their own OAuth client ID from the
   * provider's developer settings. No default clientId is bundled.
   * (Fastmail requires user-registered OAuth apps.)
   */
  requiresUserClientId?: boolean;
}

const providers: Record<string, OAuthProviderConfig> = {
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authUrl:
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    tokenUrl:
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    scopes: [
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "profile",
      "email",
    ],
    userInfoUrl: undefined,
    usePkce: true,
  },
  yahoo: {
    id: "yahoo",
    name: "Yahoo",
    authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
    scopes: ["mail-r", "mail-w", "openid", "sdps-r"],
    userInfoUrl: "https://api.login.yahoo.com/openid/v1/userinfo",
    usePkce: true,
  },
  fastmail: {
    id: "fastmail",
    name: "Fastmail",
    authUrl: "https://api.fastmail.com/oauth/authorize",
    tokenUrl: "https://api.fastmail.com/oauth/refresh",
    scopes: [
      "https://www.fastmail.com/dev/protocol-imap",
      "https://www.fastmail.com/dev/protocol-smtp",
      "profile",
      "email",
    ],
    userInfoUrl: undefined,
    usePkce: true,
    // No default clientId — user must supply from Fastmail developer settings:
    // https://app.fastmail.com/settings/security/integrations
    requiresUserClientId: true,
  },
};

export function getOAuthProvider(id: string): OAuthProviderConfig | null {
  return providers[id] ?? null;
}

export function getAllOAuthProviders(): OAuthProviderConfig[] {
  return Object.values(providers);
}
