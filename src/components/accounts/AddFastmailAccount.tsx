import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { insertOAuthImapAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";
import { getOAuthProvider } from "@/services/oauth/providers";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";

interface AddFastmailAccountProps {
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

const FASTMAIL_PROVIDER_ID = "fastmail";
const FASTMAIL_IMAP_HOST = "imap.fastmail.com";
const FASTMAIL_IMAP_PORT = 993;
const FASTMAIL_IMAP_SECURITY = "ssl" as const;
const FASTMAIL_SMTP_HOST = "smtp.fastmail.com";
const FASTMAIL_SMTP_PORT = 465;
const FASTMAIL_SMTP_SECURITY = "ssl" as const;

const inputClass =
  "w-full px-3 py-2 bg-bg-secondary border border-border-primary rounded-lg text-sm text-text-primary outline-none focus:border-accent transition-colors";
const labelClass = "block text-xs font-medium text-text-secondary mb-1";

interface TestStatus {
  state: "idle" | "testing" | "success" | "error";
  message?: string;
}

export function AddFastmailAccount({
  onClose,
  onSuccess,
  onBack,
}: AddFastmailAccountProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);

  // OAuth state
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);

  // Connection test state
  const [imapTest, setImapTest] = useState<TestStatus>({ state: "idle" });
  const [smtpTest, setSmtpTest] = useState<TestStatus>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showTest, setShowTest] = useState(false);

  const addAccount = useAccountStore((s) => s.addAccount);

  const hasOAuthTokens = !!(accessToken && refreshToken);

  const handleOAuthConnect = useCallback(async () => {
    const provider = getOAuthProvider(FASTMAIL_PROVIDER_ID);
    if (!provider) {
      setError(
        "Fastmail OAuth provider is not configured. Please ensure the provider is registered.",
      );
      return;
    }

    if (!clientId.trim()) {
      setError("Please enter a Client ID first.");
      return;
    }

    setOauthConnecting(true);
    setError(null);

    try {
      const { tokens, userInfo } = await startProviderOAuthFlow(
        provider,
        clientId.trim(),
        clientSecret.trim() || undefined,
      );

      const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

      setAccessToken(tokens.access_token);
      setRefreshToken(tokens.refresh_token ?? null);
      setTokenExpiresAt(expiresAt);
      setOauthEmail(userInfo.email);
      if (userInfo.email) setEmail(userInfo.email);
      if (userInfo.name) setDisplayName(userInfo.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth sign-in failed");
    } finally {
      setOauthConnecting(false);
    }
  }, [clientId, clientSecret]);

  const testImapConnection = async () => {
    setImapTest({ state: "testing" });
    try {
      const result = await invoke<string>("imap_test_connection", {
        config: {
          host: FASTMAIL_IMAP_HOST,
          port: FASTMAIL_IMAP_PORT,
          security: "tls",
          username: oauthEmail ?? email,
          password: accessToken ?? "",
          auth_method: "oauth2",
          accept_invalid_certs: false,
        },
      });
      setImapTest({ state: "success", message: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImapTest({ state: "error", message });
    }
  };

  const testSmtpConnection = async () => {
    setSmtpTest({ state: "testing" });
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "smtp_test_connection",
        {
          config: {
            host: FASTMAIL_SMTP_HOST,
            port: FASTMAIL_SMTP_PORT,
            security: "tls",
            username: oauthEmail ?? email,
            password: accessToken ?? "",
            auth_method: "oauth2",
            accept_invalid_certs: false,
          },
        },
      );
      setSmtpTest({
        state: result.success ? "success" : "error",
        message: result.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSmtpTest({ state: "error", message });
    }
  };

  const testBothConnections = async () => {
    await Promise.all([testImapConnection(), testSmtpConnection()]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasOAuthTokens) {
      setError("Please complete OAuth sign-in first.");
      return;
    }
    setShowTest(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const accountId = crypto.randomUUID();
      const finalEmail = oauthEmail ?? email.trim();

      await insertOAuthImapAccount({
        id: accountId,
        email: finalEmail,
        displayName: displayName.trim() || null,
        avatarUrl: null,
        imapHost: FASTMAIL_IMAP_HOST,
        imapPort: FASTMAIL_IMAP_PORT,
        imapSecurity: FASTMAIL_IMAP_SECURITY,
        smtpHost: FASTMAIL_SMTP_HOST,
        smtpPort: FASTMAIL_SMTP_PORT,
        smtpSecurity: FASTMAIL_SMTP_SECURITY,
        accessToken: accessToken!,
        refreshToken: refreshToken!,
        tokenExpiresAt: tokenExpiresAt!,
        oauthProvider: FASTMAIL_PROVIDER_ID,
        oauthClientId: clientId.trim(),
        oauthClientSecret: clientSecret.trim() || null,
        imapUsername: null,
        acceptInvalidCerts: false,
      });

      addAccount({
        id: accountId,
        email: finalEmail,
        displayName: displayName.trim() || null,
        avatarUrl: null,
        isActive: true,
      });

      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      setSaving(false);
    }
  };

  const renderTestResult = (label: string, status: TestStatus) => {
    const icon =
      status.state === "testing" ? (
        <Loader2 className="w-4 h-4 animate-spin text-accent" />
      ) : status.state === "success" ? (
        <CheckCircle2 className="w-4 h-4 text-success" />
      ) : status.state === "error" ? (
        <div className="w-4 h-4 rounded-full bg-danger/20 flex items-center justify-center">
          <span className="text-danger text-xs font-bold">✕</span>
        </div>
      ) : (
        <div className="w-4 h-4 rounded-full border-2 border-border-primary" />
      );

    return (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-bg-secondary border border-border-primary">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary">{label}</div>
          {status.message && (
            <div
              className={`text-xs mt-0.5 ${
                status.state === "error"
                  ? "text-danger"
                  : status.state === "success"
                    ? "text-success"
                    : "text-text-tertiary"
              }`}
            >
              {status.message}
            </div>
          )}
        </div>
      </div>
    );
  };

  const bothTestsPassed =
    imapTest.state === "success" && smtpTest.state === "success";

  if (showTest) {
    return (
      <Modal
        isOpen={true}
        onClose={onClose}
        title="Verify Fastmail Connection"
        width="w-full max-w-lg"
      >
        <div className="p-4">
          <div className="text-sm text-text-secondary mb-4">
            Test your connection before adding the account.
          </div>

          <div className="space-y-3 mb-4">
            {renderTestResult("IMAP Connection", imapTest)}
            {renderTestResult("SMTP Connection", smtpTest)}
          </div>

          <button
            onClick={testBothConnections}
            disabled={
              imapTest.state === "testing" || smtpTest.state === "testing"
            }
            className="w-full px-4 py-2 text-sm bg-bg-secondary border border-border-primary rounded-lg text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          >
            {imapTest.state === "testing" || smtpTest.state === "testing"
              ? "Testing..."
              : imapTest.state === "idle" && smtpTest.state === "idle"
                ? "Test Connection"
                : "Re-test Connection"}
          </button>

          {saveError && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger mb-4">
              {saveError}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowTest(false)}
              className="flex items-center gap-1 px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!bothTestsPassed || saving}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Adding..." : "Add Account"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Add Fastmail Account"
      width="w-full max-w-lg"
    >
      <div className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="fm-email" className={labelClass}>
              Email Address
            </label>
            <input
              id="fm-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@fastmail.com"
              className={inputClass}
              autoFocus
              disabled={hasOAuthTokens}
            />
          </div>

          {/* Display Name */}
          <div>
            <label htmlFor="fm-display-name" className={labelClass}>
              Display Name <span className="text-text-tertiary">(optional)</span>
            </label>
            <input
              id="fm-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your Name"
              className={inputClass}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-border-primary pt-4">
            <div className="text-xs font-medium text-text-secondary mb-3">
              OAuth Credentials
            </div>

            {/* Client ID */}
            <div className="mb-3">
              <label htmlFor="fm-client-id" className={labelClass}>
                OAuth Client ID
              </label>
              <input
                id="fm-client-id"
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Fastmail app Client ID"
                className={inputClass}
                disabled={hasOAuthTokens}
              />
            </div>

            {/* Client Secret */}
            <div className="mb-3">
              <label htmlFor="fm-client-secret" className={labelClass}>
                OAuth Client Secret
              </label>
              <input
                id="fm-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Fastmail app Client Secret"
                className={inputClass}
                disabled={hasOAuthTokens}
              />
            </div>

            <p className="text-xs text-text-tertiary mb-4">
              Register your app at{" "}
              <span className="text-accent">
                app.fastmail.com → Settings → Security &amp; Privacy → Integrations
              </span>
              . Set the redirect URI to:{" "}
              <code className="bg-bg-tertiary px-1 rounded">
                http://127.0.0.1:17248
              </code>
            </p>

            {/* OAuth connect button / connected state */}
            {hasOAuthTokens ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                <div className="text-sm text-success">
                  Connected as{" "}
                  <span className="font-medium">{oauthEmail}</span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleOAuthConnect}
                disabled={oauthConnecting || !clientId.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {oauthConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Sign in with Fastmail
                  </>
                )}
              </button>
            )}
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!hasOAuthTokens}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
