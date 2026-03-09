/**
 * FastmailImapProvider
 *
 * Fastmail accounts use standard IMAP/SMTP with OAuth2 (XOAUTH2 mechanism).
 * Servers are fixed — users don't need to configure host/port.
 * This provider wraps ImapSmtpProvider with Fastmail's known configuration.
 * The fixed server values (FASTMAIL_SERVER_CONFIG) are written to the DB at
 * account creation time so ImapSmtpProvider reads them normally.
 *
 * Future: FastmailJmapProvider will replace this for better performance.
 * The EmailProvider interface is already JMAP-compatible.
 */

import type { EmailProvider, EmailFolder, SyncResult, AccountProvider } from "./types";
import type { ParsedMessage } from "../gmail/messageParser";
import { ImapSmtpProvider } from "./imapSmtpProvider";

export const FASTMAIL_SERVER_CONFIG = {
  imap_host: "imap.fastmail.com",
  imap_port: 993,
  imap_security: "ssl",
  smtp_host: "smtp.fastmail.com",
  smtp_port: 465,
  smtp_security: "ssl",
  auth_method: "xoauth2",
} as const;

export const FASTMAIL_OAUTH_CONFIG = {
  authUrl: "https://api.fastmail.com/oauth/authorize",
  tokenUrl: "https://api.fastmail.com/oauth/refresh",
  scopes: [
    "https://www.fastmail.com/dev/protocol-imap",
    "https://www.fastmail.com/dev/protocol-smtp",
    "profile",
    "email",
  ],
  // Fastmail requires users to register their own OAuth app at:
  // https://app.fastmail.com/settings/security/integrations
  requiresUserClientId: true,
} as const;

export class FastmailImapProvider implements EmailProvider {
  readonly type = "fastmail_imap" as const satisfies AccountProvider;
  private inner: ImapSmtpProvider;

  constructor(accountId: string) {
    this.inner = new ImapSmtpProvider(accountId);
  }

  get accountId(): string {
    return this.inner.accountId;
  }

  listFolders(): Promise<EmailFolder[]> {
    return this.inner.listFolders();
  }

  createFolder(name: string, parentPath?: string): Promise<EmailFolder> {
    return this.inner.createFolder(name, parentPath);
  }

  deleteFolder(path: string): Promise<void> {
    return this.inner.deleteFolder(path);
  }

  renameFolder(path: string, newName: string): Promise<void> {
    return this.inner.renameFolder(path, newName);
  }

  initialSync(
    daysBack: number,
    onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult> {
    return this.inner.initialSync(daysBack, onProgress);
  }

  deltaSync(syncToken: string): Promise<SyncResult> {
    return this.inner.deltaSync(syncToken);
  }

  fetchMessage(messageId: string): Promise<ParsedMessage> {
    return this.inner.fetchMessage(messageId);
  }

  fetchAttachment(messageId: string, attachmentId: string): Promise<{ data: string; size: number }> {
    return this.inner.fetchAttachment(messageId, attachmentId);
  }

  fetchRawMessage(messageId: string): Promise<string> {
    return this.inner.fetchRawMessage(messageId);
  }

  archive(threadId: string, messageIds: string[]): Promise<void> {
    return this.inner.archive(threadId, messageIds);
  }

  trash(threadId: string, messageIds: string[]): Promise<void> {
    return this.inner.trash(threadId, messageIds);
  }

  permanentDelete(threadId: string, messageIds: string[]): Promise<void> {
    return this.inner.permanentDelete(threadId, messageIds);
  }

  markRead(threadId: string, messageIds: string[], read: boolean): Promise<void> {
    return this.inner.markRead(threadId, messageIds, read);
  }

  star(threadId: string, messageIds: string[], starred: boolean): Promise<void> {
    return this.inner.star(threadId, messageIds, starred);
  }

  spam(threadId: string, messageIds: string[], isSpam: boolean): Promise<void> {
    return this.inner.spam(threadId, messageIds, isSpam);
  }

  moveToFolder(threadId: string, messageIds: string[], folderPath: string): Promise<void> {
    return this.inner.moveToFolder(threadId, messageIds, folderPath);
  }

  addLabel(threadId: string, labelId: string): Promise<void> {
    return this.inner.addLabel(threadId, labelId);
  }

  removeLabel(threadId: string, labelId: string): Promise<void> {
    return this.inner.removeLabel(threadId, labelId);
  }

  sendMessage(rawBase64Url: string, threadId?: string): Promise<{ id: string }> {
    return this.inner.sendMessage(rawBase64Url, threadId);
  }

  createDraft(rawBase64Url: string, threadId?: string): Promise<{ draftId: string }> {
    return this.inner.createDraft(rawBase64Url, threadId);
  }

  updateDraft(draftId: string, rawBase64Url: string, threadId?: string): Promise<{ draftId: string }> {
    return this.inner.updateDraft(draftId, rawBase64Url, threadId);
  }

  deleteDraft(draftId: string): Promise<void> {
    return this.inner.deleteDraft(draftId);
  }

  testConnection(): Promise<{ success: boolean; message: string }> {
    return this.inner.testConnection();
  }

  getProfile(): Promise<{ email: string; name?: string }> {
    return this.inner.getProfile();
  }

  /**
   * Invalidate cached IMAP/SMTP configs (e.g., after token refresh).
   * Delegates to the inner ImapSmtpProvider.
   */
  clearConfigCache(): void {
    this.inner.clearConfigCache();
  }
}
