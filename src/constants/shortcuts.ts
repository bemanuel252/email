export interface ShortcutItem {
  id: string;
  keys: string; // default key binding
  desc: string;
}

export interface ShortcutCategory {
  category: string;
  items: ShortcutItem[];
}

export const SHORTCUTS: ShortcutCategory[] = [
  { category: "Navigation", items: [
    { id: "nav.next", keys: "j", desc: "Next conversation" },
    { id: "nav.prev", keys: "k", desc: "Previous conversation" },
    { id: "nav.open", keys: "Enter", desc: "Open conversation" },
    { id: "nav.msgNext", keys: "n", desc: "Next message in thread" },
    { id: "nav.msgPrev", keys: "p", desc: "Previous message in thread" },
    { id: "nav.scrollDown", keys: "Space", desc: "Scroll down" },
    { id: "nav.scrollUp", keys: "Shift+Space", desc: "Scroll up" },
    { id: "nav.splitNext", keys: "Tab", desc: "Next split" },
    { id: "nav.splitPrev", keys: "Shift+Tab", desc: "Previous split" },
    { id: "nav.escape", keys: "Escape", desc: "Go back" },
  ]},
  { category: "Conversations", items: [
    { id: "action.archive", keys: "e", desc: "Mark Done (Archive)" },
    { id: "action.markNotDone", keys: "Shift+E", desc: "Mark Not Done" },
    { id: "action.snooze", keys: "h", desc: "Remind Me (Snooze)" },
    { id: "action.star", keys: "s", desc: "Star / Unstar" },
    { id: "action.markRead", keys: "u", desc: "Mark Read or Unread" },
    { id: "action.delete", keys: "#", desc: "Trash" },
    { id: "action.spam", keys: "!", desc: "Mark Spam" },
    { id: "action.mute", keys: "Shift+M", desc: "Mute" },
    { id: "action.unsubscribe", keys: "Cmd+U", desc: "Unsubscribe" },
  ]},
  { category: "Messages", items: [
    { id: "action.compose", keys: "c", desc: "Compose" },
    { id: "action.replyAll", keys: "Enter", desc: "Reply All" },
    { id: "action.reply", keys: "r", desc: "Reply" },
    { id: "action.forward", keys: "f", desc: "Forward" },
    { id: "action.expandMessage", keys: "o", desc: "Expand Message" },
    { id: "action.expandAllMessages", keys: "Shift+O", desc: "Expand All Messages" },
  ]},
  { category: "Folders", items: [
    { id: "nav.goInbox", keys: "g then i", desc: "Go to Inbox" },
    { id: "nav.goStarred", keys: "g then s", desc: "Go to Starred" },
    { id: "nav.goDrafts", keys: "g then d", desc: "Go to Drafts" },
    { id: "nav.goSent", keys: "g then t", desc: "Go to Sent Mail" },
    { id: "nav.goDone", keys: "g then e", desc: "Go to Done (Archived)" },
    { id: "nav.goSnoozed", keys: "g then h", desc: "Go to Reminders (Snoozed)" },
    { id: "nav.goMuted", keys: "g then m", desc: "Go to Muted" },
    { id: "nav.goSpam", keys: "g then !", desc: "Go to Spam" },
    { id: "nav.goTrash", keys: "g then #", desc: "Go to Trash" },
    { id: "nav.goAllMail", keys: "g then a", desc: "Go to All Mail" },
  ]},
  { category: "Labels", items: [
    { id: "action.addLabel", keys: "l", desc: "Add or Remove Label" },
    { id: "action.moveToFolder", keys: "v", desc: "Move" },
  ]},
  { category: "Select", items: [
    { id: "action.selectConversation", keys: "x", desc: "Select Conversation" },
    { id: "action.addToSelection", keys: "Shift+J", desc: "Add to Selection" },
    { id: "action.selectFromHere", keys: "Cmd+A", desc: "Select All From Here" },
    { id: "action.selectAll", keys: "Cmd+Shift+A", desc: "Select All" },
  ]},
  { category: "App", items: [
    { id: "app.commandPalette", keys: "/", desc: "Command palette" },
    { id: "app.commandPaletteAlt", keys: "Cmd+K", desc: "Command palette (alt)" },
    { id: "app.send", keys: "Cmd+Enter", desc: "Send email" },
    { id: "app.help", keys: "?", desc: "Show keyboard shortcuts" },
    { id: "app.toggleSidebar", keys: "Ctrl+Shift+E", desc: "Toggle sidebar" },
    { id: "app.toggleChat", keys: "Ctrl+Shift+K", desc: "Toggle AI" },
    { id: "app.askInbox", keys: "i", desc: "Ask AI" },
    { id: "app.syncFolder", keys: "F5", desc: "Sync folder" },
    { id: "action.createTaskFromEmail", keys: "t", desc: "Create task from email" },
  ]},
];

/**
 * Build a flat map of shortcut ID -> default key binding.
 */
export function getDefaultKeyMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const cat of SHORTCUTS) {
    for (const item of cat.items) {
      map[item.id] = item.keys;
    }
  }
  return map;
}
