import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { getAllSettings, setSetting } from "@/services/db/settings";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore } from "@/stores/shortcutStore";

const EXPORT_VERSION = 1;

/**
 * Keys that must never leave the device — OAuth tokens and encryption material.
 */
const EXCLUDED_KEY_PATTERNS = [
  /oauth/i,
  /access_token/i,
  /refresh_token/i,
  /encryption_key/i,
  /^account_/i,
];

function isExcluded(key: string): boolean {
  return EXCLUDED_KEY_PATTERNS.some((re) => re.test(key));
}

export async function exportSettings(): Promise<"saved" | "cancelled"> {
  const allSettings = await getAllSettings();

  // Strip device-bound / credential keys
  const exportable: Record<string, string> = {};
  for (const [key, value] of Object.entries(allSettings)) {
    if (!isExcluded(key)) {
      exportable[key] = value;
    }
  }

  const payload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: exportable,
  };

  const filePath = await save({
    defaultPath: `velo-settings-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!filePath) return "cancelled";

  await writeTextFile(filePath, JSON.stringify(payload, null, 2));
  return "saved";
}

export async function importSettings(): Promise<"imported" | "cancelled" | "invalid"> {
  const selected = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });

  if (!selected || Array.isArray(selected)) return "cancelled";

  let payload: unknown;
  try {
    const raw = await readTextFile(selected);
    payload = JSON.parse(raw);
  } catch {
    return "invalid";
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as Record<string, unknown>).version !== EXPORT_VERSION ||
    typeof (payload as Record<string, unknown>).settings !== "object"
  ) {
    return "invalid";
  }

  const settings = (payload as { settings: Record<string, string> }).settings;

  // Write all imported settings to SQLite
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "string" && !isExcluded(key)) {
      await setSetting(key, value);
    }
  }

  // Hot-reload stores from the just-written DB values
  // UIStore reads its own settings via setSetting internally, so we call
  // each setter directly using the imported values.
  const ui = useUIStore.getState();

  const s = settings;
  if (s.theme === "light" || s.theme === "dark" || s.theme === "system") ui.setTheme(s.theme);
  if (s.visual_theme) ui.setVisualTheme(s.visual_theme as Parameters<typeof ui.setVisualTheme>[0]);
  if (s.reading_pane_position) ui.setReadingPanePosition(s.reading_pane_position as Parameters<typeof ui.setReadingPanePosition>[0]);
  if (s.email_density) ui.setEmailDensity(s.email_density as Parameters<typeof ui.setEmailDensity>[0]);
  if (s.default_reply_mode === "reply" || s.default_reply_mode === "replyAll") ui.setDefaultReplyMode(s.default_reply_mode);
  if (s.font_size) ui.setFontScale(s.font_size as Parameters<typeof ui.setFontScale>[0]);
  if (s.color_theme) ui.setColorTheme(s.color_theme as Parameters<typeof ui.setColorTheme>[0]);
  if (s.mark_as_read_behavior) ui.setMarkAsReadBehavior(s.mark_as_read_behavior as Parameters<typeof ui.setMarkAsReadBehavior>[0]);
  if (s.send_and_archive !== undefined) ui.setSendAndArchive(s.send_and_archive === "true");
  if (s.reduce_motion !== undefined) ui.setReduceMotion(s.reduce_motion === "true");
  if (s.inbox_view_mode) ui.setInboxViewMode(s.inbox_view_mode as Parameters<typeof ui.setInboxViewMode>[0]);
  if (s.email_list_width) ui.setEmailListWidth(Number(s.email_list_width));
  if (s.sidebar_nav_config) {
    try { ui.setSidebarNavConfig(JSON.parse(s.sidebar_nav_config)); } catch { /* ignore */ }
  }

  // Reload shortcut overrides
  await useShortcutStore.getState().loadKeyMap();

  return "imported";
}
