import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { ThreadCard } from "../email/ThreadCard";
import { CategoryTabs } from "../email/CategoryTabs";
import { SplitTabs } from "../email/SplitTabs";
import { UnifiedInboxBar } from "../search/UnifiedInboxBar";
import { EmailListSkeleton } from "../ui/Skeleton";
import { useThreadStore, type Thread } from "@/stores/threadStore";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { useInboxSplitsStore } from "@/stores/inboxSplitsStore";
import { useActiveLabel, useSelectedThreadId, useActiveCategory } from "@/hooks/useRouteNavigation";
import { navigateToThread, navigateToLabel, navigateBack } from "@/router/navigate";
import { getThreadsForAccount, getThreadsForCategory, getThreadLabelIds, getThreadsByIds, deleteThread as deleteThreadFromDb } from "@/services/db/threads";
import { getThreadsForSplit, getThreadsForCatchAllSplit } from "@/services/db/inboxSplits";
import { getCategoriesForThreads, getCategoryUnreadCounts } from "@/services/db/threadCategories";
import { getActiveFollowUpThreadIds } from "@/services/db/followUpReminders";
import { getBundleRules, getHeldThreadIds, getBundleSummaries, type DbBundleRule } from "@/services/db/bundleRules";
import { getGmailClient } from "@/services/gmail/tokenManager";
import { useLabelStore } from "@/stores/labelStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useComposerStore } from "@/stores/composerStore";
import { getMessagesForThread } from "@/services/db/messages";
import { getSmartFolderSearchQuery, mapSmartFolderRows, type SmartFolderRow } from "@/services/search/smartFolderQuery";
import { getDb } from "@/services/db/connection";
import { Archive, Trash2, X, Ban, Filter, ChevronRight, Package, FolderSearch } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import {
  InboxClearIllustration,
  NoSearchResultsIllustration,
  NoAccountIllustration,
  GenericEmptyIllustration,
} from "../ui/illustrations";

const PAGE_SIZE = 50;

// Curated zero-state backgrounds — each split consistently maps to one via hash
const ZERO_STATE_BACKGROUNDS = [
  // Aurora Borealis
  `radial-gradient(ellipse 150% 60% at 30% 80%, rgba(32, 196, 160, 0.35) 0%, transparent 60%), radial-gradient(ellipse 100% 80% at 70% 20%, rgba(60, 100, 220, 0.40) 0%, transparent 60%), linear-gradient(180deg, #050a1a 0%, #080d20 50%, #060e1a 100%)`,
  // Desert Sunset
  `radial-gradient(ellipse 120% 50% at 50% 100%, rgba(255, 140, 60, 0.5) 0%, transparent 60%), radial-gradient(ellipse 80% 60% at 20% 60%, rgba(255, 80, 100, 0.3) 0%, transparent 50%), linear-gradient(180deg, #1a0820 0%, #2d0a18 30%, #7b1800 70%, #cc4a00 95%)`,
  // Ocean Deep
  `radial-gradient(ellipse 100% 80% at 50% 30%, rgba(0, 160, 180, 0.22) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 80% 80%, rgba(0, 80, 130, 0.28) 0%, transparent 60%), linear-gradient(180deg, #001428 0%, #002040 45%, #003060 80%, #001828 100%)`,
  // Mountain Twilight
  `radial-gradient(ellipse 120% 40% at 50% 80%, rgba(200, 80, 180, 0.28) 0%, transparent 60%), radial-gradient(ellipse 80% 60% at 30% 40%, rgba(80, 40, 140, 0.32) 0%, transparent 60%), linear-gradient(180deg, #0a0520 0%, #150830 40%, #2d1050 75%, #3a0028 100%)`,
  // Forest Night
  `radial-gradient(ellipse 100% 60% at 50% 30%, rgba(20, 100, 60, 0.30) 0%, transparent 70%), radial-gradient(ellipse 80% 80% at 20% 70%, rgba(10, 80, 40, 0.26) 0%, transparent 60%), linear-gradient(180deg, #030a05 0%, #051208 45%, #081a0a 75%, #030a05 100%)`,
  // Deep Space
  `radial-gradient(ellipse 140% 70% at 60% 40%, rgba(80, 40, 180, 0.30) 0%, transparent 65%), radial-gradient(ellipse 80% 80% at 20% 80%, rgba(20, 60, 160, 0.25) 0%, transparent 60%), linear-gradient(180deg, #04040f 0%, #080818 45%, #0c0828 75%, #050510 100%)`,
];

function splitBgIndex(splitId: string): number {
  let h = 0;
  for (let i = 0; i < splitId.length; i++) h = (h * 31 + splitId.charCodeAt(i)) >>> 0;
  return h % ZERO_STATE_BACKGROUNDS.length;
}

// Map sidebar labels to Gmail label IDs
const LABEL_MAP: Record<string, string> = {
  inbox: "INBOX",
  starred: "STARRED",
  sent: "SENT",
  drafts: "DRAFT",
  trash: "TRASH",
  spam: "SPAM",
  snoozed: "SNOOZED",
  all: "", // no filter
};

export function EmailList({ width, listRef, fullScreen }: { width?: number; listRef?: React.Ref<HTMLDivElement>; fullScreen?: boolean }) {
  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useSelectedThreadId();
  const selectedThreadIds = useThreadStore((s) => s.selectedThreadIds);
  const isLoading = useThreadStore((s) => s.isLoading);
  const setThreads = useThreadStore((s) => s.setThreads);
  const setLoading = useThreadStore((s) => s.setLoading);
  const removeThreads = useThreadStore((s) => s.removeThreads);
  const clearMultiSelect = useThreadStore((s) => s.clearMultiSelect);
  const selectAll = useThreadStore((s) => s.selectAll);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeLabel = useActiveLabel();
  const readFilter = useUIStore((s) => s.readFilter);
  const setReadFilter = useUIStore((s) => s.setReadFilter);
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  const userLabels = useLabelStore((s) => s.labels);
  const smartFolders = useSmartFolderStore((s) => s.folders);

  // Detect smart folder mode
  const isSmartFolder = activeLabel.startsWith("smart-folder:");
  const smartFolderId = isSmartFolder ? activeLabel.replace("smart-folder:", "") : null;
  const activeSmartFolder = smartFolderId ? smartFolders.find((f) => f.id === smartFolderId) ?? null : null;

  const inboxViewMode = useUIStore((s) => s.inboxViewMode);
  const splitScope = useUIStore((s) => s.splitScope);
  const routerCategory = useActiveCategory();
  const splitsStore = useInboxSplitsStore();

  // In split mode, use the router's category; in unified mode, always use "All"
  const activeCategory = (inboxViewMode === "split" || inboxViewMode === "custom-split") ? routerCategory : "All";
  const setActiveCategory = (inboxViewMode === "split" || inboxViewMode === "custom-split")
    ? (cat: string) => navigateToLabel("inbox", { category: cat })
    : () => {};

  // Load splits when in custom-split mode
  useEffect(() => {
    if (inboxViewMode !== "custom-split" || !activeAccountId) return;
    splitsStore.loadSplits(activeAccountId, true).then(() => {
      splitsStore.refreshUnreadCounts(activeAccountId);
    });
  }, [inboxViewMode, activeAccountId]);

  // Auto-navigate to first split if none selected
  useEffect(() => {
    if (inboxViewMode !== "custom-split" || !activeLabel.startsWith("inbox")) return;
    if (activeCategory !== "All") return;
    const firstSplit = splitsStore.splits.find((s) => s.isEnabled);
    if (firstSplit) {
      navigateToLabel("inbox", { category: firstSplit.id });
    }
  }, [inboxViewMode, activeCategory, splitsStore.splits, activeLabel]);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(() => new Map());
  const [categoryUnreadCounts, setCategoryUnreadCounts] = useState<Map<string, number>>(() => new Map());
  const [followUpThreadIds, setFollowUpThreadIds] = useState<Set<string>>(() => new Set());
  const [bundleRules, setBundleRules] = useState<DbBundleRule[]>([]);
  const [heldThreadIds, setHeldThreadIds] = useState<Set<string>>(() => new Set());
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(() => new Set());
  const [bundleSummaries, setBundleSummaries] = useState<Map<string, { count: number; latestSubject: string | null; latestSender: string | null }>>(() => new Map());

  const openMenu = useContextMenuStore((s) => s.openMenu);
  const multiSelectCount = selectedThreadIds.size;

  const openComposer = useComposerStore((s) => s.openComposer);
  const multiSelectBarRef = useRef<HTMLDivElement>(null);

  const handleThreadContextMenu = useCallback((e: React.MouseEvent, threadId: string) => {
    e.preventDefault();
    openMenu("thread", { x: e.clientX, y: e.clientY }, { threadId });
  }, [openMenu]);

  const handleDraftClick = useCallback(async (thread: Thread) => {
    if (!activeAccountId) return;
    try {
      const messages = await getMessagesForThread(activeAccountId, thread.id);
      // Get the last message (the draft)
      const draftMsg = messages[messages.length - 1];
      if (!draftMsg) return;

      // Look up the Gmail draft ID so auto-save can update the existing draft
      let draftId: string | null = null;
      try {
        const client = await getGmailClient(activeAccountId);
        const drafts = await client.listDrafts();
        const match = drafts.find((d) => d.message.id === draftMsg.id);
        if (match) draftId = match.id;
      } catch {
        // If we can't get draft ID, composer will create a new draft on save
      }

      const to = draftMsg.to_addresses
        ? draftMsg.to_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      const cc = draftMsg.cc_addresses
        ? draftMsg.cc_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      const bcc = draftMsg.bcc_addresses
        ? draftMsg.bcc_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

      openComposer({
        mode: "new",
        to,
        cc,
        bcc,
        subject: draftMsg.subject ?? "",
        bodyHtml: draftMsg.body_html ?? draftMsg.body_text ?? "",
        threadId: thread.id,
        draftId,
      });
    } catch (err) {
      console.error("Failed to open draft:", err);
    }
  }, [activeAccountId, openComposer]);

  const handleThreadClick = useCallback((thread: Thread) => {
    if (activeLabel === "drafts") {
      handleDraftClick(thread);
    } else if (selectedThreadId === thread.id) {
      // Click the open thread again → close reading pane
      navigateBack();
    } else {
      navigateToThread(thread.id);
    }
  }, [activeLabel, handleDraftClick, selectedThreadId]);

  const handleBulkDelete = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const isTrashView = activeLabel === "trash";
    const ids = [...selectedThreadIds];
    removeThreads(ids);
    try {
      const client = await getGmailClient(activeAccountId);
      await Promise.all(ids.map(async (id) => {
        if (isTrashView) {
          await client.deleteThread(id);
          await deleteThreadFromDb(activeAccountId, id);
        } else {
          await client.modifyThread(id, ["TRASH"], ["INBOX"]);
        }
      }));
    } catch (err) {
      console.error("Bulk delete failed:", err);
    }
  };

  const handleBulkArchive = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    removeThreads(ids);
    try {
      const client = await getGmailClient(activeAccountId);
      await Promise.all(ids.map((id) => client.modifyThread(id, undefined, ["INBOX"])));
    } catch (err) {
      console.error("Bulk archive failed:", err);
    }
  };

  const handleBulkSpam = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    const isSpamView = activeLabel === "spam";
    removeThreads(ids);
    try {
      const client = await getGmailClient(activeAccountId);
      await Promise.all(ids.map((id) =>
        isSpamView
          ? client.modifyThread(id, ["INBOX"], ["SPAM"])
          : client.modifyThread(id, ["SPAM"], ["INBOX"]),
      ));
    } catch (err) {
      console.error("Bulk spam failed:", err);
    }
  };

  const searchThreadIds = useThreadStore((s) => s.searchThreadIds);
  const searchQuery = useThreadStore((s) => s.searchQuery);

  // When search is active, load the matched threads directly from DB (cross-folder).
  // Effect is defined below, after mapDbThreads is declared.
  const [searchResultThreads, setSearchResultThreads] = useState<Thread[] | null>(null);

  const filteredThreads = useMemo(() => {
    // When search is active, use the DB-fetched search results (cross-folder, cross-page)
    let filtered = searchResultThreads !== null ? searchResultThreads : threads;
    // Apply read filter
    if (readFilter === "unread") filtered = filtered.filter((t) => !t.isRead);
    else if (readFilter === "read") filtered = filtered.filter((t) => t.isRead);
    return filtered;
  }, [searchResultThreads, threads, readFilter]);

  // Pre-compute bundled category Set for O(1) lookups in filter
  const bundledCategorySet = useMemo(
    () => new Set(bundleRules.map((r) => r.category)),
    [bundleRules],
  );

  // Memoize visible threads (excludes bundled/held threads in "All" inbox view)
  const visibleThreads = useMemo(() => {
    if (activeLabel !== "inbox" || activeCategory !== "All") return filteredThreads;
    return filteredThreads.filter((t) => {
      const cat = categoryMap.get(t.id);
      if (cat && bundledCategorySet.has(cat)) return false;
      if (heldThreadIds.has(t.id)) return false;
      return true;
    });
  }, [filteredThreads, activeLabel, activeCategory, categoryMap, bundledCategorySet, heldThreadIds]);

  const mapDbThreads = useCallback(async (dbThreads: Awaited<ReturnType<typeof getThreadsForAccount>>): Promise<Thread[]> => {
    return Promise.all(
      dbThreads.map(async (t) => {
        const labelIds = await getThreadLabelIds(t.account_id, t.id);
        return {
          id: t.id,
          accountId: t.account_id,
          subject: t.subject,
          snippet: t.snippet,
          lastMessageAt: t.last_message_at ?? 0,
          messageCount: t.message_count,
          isRead: t.is_read === 1,
          isStarred: t.is_starred === 1,
          isPinned: t.is_pinned === 1,
          isMuted: t.is_muted === 1,
          hasAttachments: t.has_attachments === 1,
          labelIds,
          fromName: t.from_name,
          fromAddress: t.from_address,
        };
      }),
    );
  }, []);

  // Load search result threads from DB when searchThreadIds changes.
  // Placed here (after mapDbThreads) because it depends on mapDbThreads.
  useEffect(() => {
    if (searchThreadIds === null) {
      setSearchResultThreads(null);
      return;
    }
    if (searchThreadIds.size === 0) {
      setSearchResultThreads([]);
      return;
    }
    const ids = [...searchThreadIds];
    let cancelled = false;
    // Don't filter by accountId — IDs are already scoped by the search
    // (passing accountId here would break multi-account search results)
    getThreadsByIds(ids)
      .then(async (dbThreads) => {
        if (cancelled) return;
        const mapped = await mapDbThreads(dbThreads);
        setSearchResultThreads(mapped);
      })
      .catch(() => { if (!cancelled) setSearchResultThreads([]); });
    return () => { cancelled = true; };
  }, [searchThreadIds, activeAccountId, mapDbThreads]);

  const clearSearch = useThreadStore((s) => s.clearSearch);

  const loadThreads = useCallback(async () => {
    if (!activeAccountId) {
      setThreads([]);
      return;
    }

    clearSearch();
    setLoading(true);
    setHasMore(true);
    try {
      // Smart folder query path
      if (isSmartFolder && activeSmartFolder) {
        const { sql, params } = getSmartFolderSearchQuery(
          activeSmartFolder.query,
          activeAccountId,
          PAGE_SIZE,
        );
        const db = await getDb();
        const rows = await db.select<SmartFolderRow[]>(sql, params);
        const mapped = await mapSmartFolderRows(rows);
        setThreads(mapped);
        setHasMore(false); // Smart folders load all at once
      } else {
        let dbThreads;
        // Custom split mode
        if (activeLabel === "inbox" && inboxViewMode === "custom-split" && activeCategory !== "All") {
          const inboxOnly = splitScope === "inbox";
          const split = splitsStore.splits.find((s) => s.id === activeCategory);
          if (split) {
            if (split.isCatchAll) {
              const others = splitsStore.splits.filter((s) => s.isEnabled && !s.isCatchAll);
              dbThreads = await getThreadsForCatchAllSplit(activeAccountId, others, PAGE_SIZE, 0, inboxOnly);
            } else {
              dbThreads = await getThreadsForSplit(activeAccountId, split, PAGE_SIZE, 0, inboxOnly);
            }
          } else {
            dbThreads = await getThreadsForAccount(activeAccountId, "INBOX", PAGE_SIZE, 0);
          }
        // Server-side category filtering for inbox split mode
        } else if (activeLabel === "inbox" && inboxViewMode === "split" && activeCategory !== "All") {
          dbThreads = await getThreadsForCategory(activeAccountId, activeCategory, PAGE_SIZE, 0);
        } else {
          const gmailLabelId = LABEL_MAP[activeLabel] ?? activeLabel;
          dbThreads = await getThreadsForAccount(
            activeAccountId,
            gmailLabelId || undefined,
            PAGE_SIZE,
            0,
          );
        }

        const mapped = await mapDbThreads(dbThreads);
        setThreads(mapped);
        setHasMore(dbThreads.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error("Failed to load threads:", err);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId, activeLabel, activeCategory, inboxViewMode, splitScope, splitsStore.splits, isSmartFolder, activeSmartFolder, setThreads, setLoading, mapDbThreads, clearSearch]);

  const loadMore = useCallback(async () => {
    if (!activeAccountId || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const offset = threads.length;
      let dbThreads;
      if (activeLabel === "inbox" && inboxViewMode === "custom-split" && activeCategory !== "All") {
        const inboxOnly = splitScope === "inbox";
        const split = splitsStore.splits.find((s) => s.id === activeCategory);
        if (split) {
          if (split.isCatchAll) {
            const others = splitsStore.splits.filter((s) => s.isEnabled && !s.isCatchAll);
            dbThreads = await getThreadsForCatchAllSplit(activeAccountId, others, PAGE_SIZE, offset, inboxOnly);
          } else {
            dbThreads = await getThreadsForSplit(activeAccountId, split, PAGE_SIZE, offset, inboxOnly);
          }
        } else {
          dbThreads = await getThreadsForAccount(activeAccountId, "INBOX", PAGE_SIZE, offset);
        }
      } else if (activeLabel === "inbox" && inboxViewMode === "split" && activeCategory !== "All") {
        dbThreads = await getThreadsForCategory(activeAccountId, activeCategory, PAGE_SIZE, offset);
      } else {
        const gmailLabelId = LABEL_MAP[activeLabel] ?? activeLabel;
        dbThreads = await getThreadsForAccount(
          activeAccountId,
          gmailLabelId || undefined,
          PAGE_SIZE,
          offset,
        );
      }

      const mapped = await mapDbThreads(dbThreads);
      if (mapped.length > 0) {
        setThreads([...threads, ...mapped]);
      }
      setHasMore(dbThreads.length === PAGE_SIZE);
    } catch (err) {
      console.error("Failed to load more threads:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [activeAccountId, activeLabel, activeCategory, inboxViewMode, splitScope, splitsStore.splits, threads, loadingMore, hasMore, setThreads, mapDbThreads]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Stable thread ID key — only changes when the actual set of thread IDs changes, not on every array reference
  const threadIdKey = useMemo(() => threads.map((t) => t.id).join(","), [threads]);

  // Load all thread metadata (categories, unread counts, follow-ups, bundles) in one coordinated effect
  useEffect(() => {
    let cancelled = false;

    if (!activeAccountId) {
      setCategoryMap(new Map());
      setCategoryUnreadCounts(new Map());
      setFollowUpThreadIds(new Set());
      setBundleRules([]);
      setHeldThreadIds(new Set());
      setBundleSummaries(new Map());
      return;
    }

    const threadIds = threadIdKey ? threadIdKey.split(",") : [];
    const isInbox = activeLabel === "inbox";
    const isAllCategory = activeCategory === "All";

    const loadMetadata = async () => {
      try {
        // Build all promises based on current view
        const promises: Promise<void>[] = [];

        // Categories (only for inbox "All" tab with threads)
        if (isInbox && isAllCategory && threadIds.length > 0) {
          promises.push(
            getCategoriesForThreads(activeAccountId, threadIds).then((result) => {
              if (!cancelled) setCategoryMap(result);
            }),
          );
        } else {
          setCategoryMap(new Map());
        }

        // Unread counts (only for inbox)
        if (isInbox) {
          promises.push(
            getCategoryUnreadCounts(activeAccountId).then((result) => {
              if (!cancelled) setCategoryUnreadCounts(result);
            }),
          );
        } else {
          setCategoryUnreadCounts(new Map());
        }

        // Follow-up indicators
        if (threadIds.length > 0) {
          promises.push(
            getActiveFollowUpThreadIds(activeAccountId, threadIds).then((result) => {
              if (!cancelled) setFollowUpThreadIds(result);
            }).catch(() => {
              if (!cancelled) setFollowUpThreadIds(new Set());
            }),
          );
        } else {
          setFollowUpThreadIds(new Set());
        }

        // Bundle rules + held threads (only for inbox)
        if (isInbox) {
          promises.push(
            getBundleRules(activeAccountId).then(async (rules) => {
              if (cancelled) return;
              const bundled = rules.filter((r) => r.is_bundled);
              setBundleRules(bundled);
              // Batch-fetch all summaries in 2 queries instead of 2N
              if (bundled.length > 0) {
                const summaries = await getBundleSummaries(activeAccountId, bundled.map((r) => r.category)).catch(() => new Map());
                if (!cancelled) setBundleSummaries(summaries);
              } else {
                if (!cancelled) setBundleSummaries(new Map());
              }
            }).catch(() => {
              if (!cancelled) setBundleRules([]);
            }),
          );
          promises.push(
            getHeldThreadIds(activeAccountId).then((result) => {
              if (!cancelled) setHeldThreadIds(result);
            }).catch(() => {
              if (!cancelled) setHeldThreadIds(new Set());
            }),
          );
        } else {
          setBundleRules([]);
          setHeldThreadIds(new Set());
          setBundleSummaries(new Map());
        }

        await Promise.all(promises);
      } catch (err) {
        console.error("Failed to load thread metadata:", err);
      }
    };

    loadMetadata();
    return () => { cancelled = true; };
  }, [threadIdKey, activeLabel, activeCategory, activeAccountId]);

  // Auto-scroll selected thread into view (triggered by keyboard navigation)
  useEffect(() => {
    if (!selectedThreadId || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector(`[data-thread-id="${CSS.escape(selectedThreadId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedThreadId]);

  // Listen for sync completion to reload (debounced to avoid waterfall from multiple emitters)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadThreads(), 500);
    };
    window.addEventListener("velo-sync-done", handler);
    return () => {
      window.removeEventListener("velo-sync-done", handler);
      if (timer) clearTimeout(timer);
    };
  }, [loadThreads, activeAccountId, activeLabel]);

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Don't load more when showing search results — those are already fully loaded
      if (useThreadStore.getState().searchThreadIds !== null) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMore();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  // Derived label name for non-inbox views
  const currentLabelName = isSmartFolder
    ? activeSmartFolder?.name ?? "Smart Folder"
    : LABEL_MAP[activeLabel] !== undefined
      ? activeLabel.charAt(0).toUpperCase() + activeLabel.slice(1)
      : userLabels.find((l) => l.id === activeLabel)?.name ?? activeLabel;

  const showTabs = activeLabel === "inbox" && (inboxViewMode === "split" || inboxViewMode === "custom-split");

  return (
    <div
      ref={listRef}
      className={`flex flex-col bg-bg-secondary/40 glass-panel transition-[width] duration-200 ${
        readingPanePosition === "right" && !fullScreen
          ? "min-w-[280px] shrink-0"
          : readingPanePosition === "bottom"
            ? "w-full border-b border-border-primary h-[40%] min-h-[200px]"
            : "w-full flex-1"
      }`}
      style={readingPanePosition === "right" && !fullScreen && width ? { width } : undefined}
    >
      {/* ── Tabs at the very top (Superhuman-style) ── */}
      {showTabs && activeLabel === "inbox" && inboxViewMode === "split" && (
        <CategoryTabs
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          unreadCounts={Object.fromEntries(categoryUnreadCounts)}
        />
      )}
      {showTabs && activeLabel === "inbox" && inboxViewMode === "custom-split" && (
        <SplitTabs
          activeSplitId={activeCategory}
          onSplitChange={setActiveCategory}
        />
      )}
      {showTabs && inboxViewMode === "custom-split" && (() => {
        const activeSplit = splitsStore.splits.find(s => s.id === activeCategory && s.isEnabled);
        if (!activeSplit) return null;
        const count = splitsStore.unreadCounts[activeSplit.id] ?? 0;
        return (
          <div className="px-4 pt-3 pb-2 flex items-baseline gap-3 shrink-0">
            <h1 className="text-[1.0625rem] font-semibold text-text-primary tracking-tight leading-none">
              {activeSplit.icon && <span className="mr-1.5">{activeSplit.icon}</span>}
              {activeSplit.name}
            </h1>
            {count > 0 && (
              <span className="text-[0.8125rem] text-text-tertiary font-normal tabular-nums">
                {count}
              </span>
            )}
          </div>
        );
      })()}

      {/* ── Search + filter row ── */}
      <div className={`flex items-center gap-2 px-3 py-2 ${showTabs ? "border-b border-border-secondary/60" : "border-b border-border-secondary"}`}>
        <div className="flex-1 min-w-0">
          <UnifiedInboxBar />
        </div>
        {/* Read filter — compact icon-style */}
        {readFilter !== "all" ? (
          <button
            onClick={() => setReadFilter("all")}
            className="shrink-0 text-[0.65rem] text-accent bg-accent/10 border border-accent/20 px-2 py-1 rounded-full transition-colors hover:bg-accent/20 whitespace-nowrap"
          >
            {readFilter === "unread" ? "Unread" : "Read"} ×
          </button>
        ) : (
          <select
            value={readFilter}
            onChange={(e) => setReadFilter(e.target.value as "all" | "read" | "unread")}
            className="shrink-0 text-[0.7rem] bg-transparent text-text-tertiary hover:text-text-secondary border-none outline-none cursor-pointer appearance-none px-1"
            title="Filter by read status"
          >
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
        )}
      </div>

      {/* ── Non-inbox label header (minimal) ── */}
      {activeLabel !== "inbox" && (
        <div className="px-4 pt-4 pb-1 flex items-center gap-2">
          {isSmartFolder && <FolderSearch size={13} className="text-accent shrink-0" />}
          <h2 className="text-[0.8rem] font-semibold text-text-secondary uppercase tracking-wider">
            {currentLabelName}
          </h2>
          <span className="text-[0.65rem] text-text-quaternary ml-auto">
            {filteredThreads.length}
          </span>
        </div>
      )}

      {/* Multi-select action bar */}
      <CSSTransition nodeRef={multiSelectBarRef} in={multiSelectCount > 0} timeout={150} classNames="slide-down" unmountOnExit>
        <div ref={multiSelectBarRef} className="px-3 py-2 border-b border-border-primary bg-accent/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">
              {multiSelectCount} selected
            </span>
            {multiSelectCount < filteredThreads.length && (
              <button
                onClick={selectAll}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                Select all
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleBulkArchive}
              title="Archive selected"
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            >
              <Archive size={14} />
            </button>
            <button
              onClick={handleBulkDelete}
              title="Delete selected"
              className="p-1.5 text-text-secondary hover:text-error hover:bg-bg-hover rounded transition-colors"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={handleBulkSpam}
              title={activeLabel === "spam" ? "Not spam" : "Report spam"}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            >
              <Ban size={14} />
            </button>
            <button
              onClick={clearMultiSelect}
              title="Clear selection"
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </CSSTransition>

      {/* Thread list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {isLoading && threads.length === 0 ? (
          <EmailListSkeleton />
        ) : filteredThreads.length === 0 && bundleRules.length === 0 ? (
          (inboxViewMode === "custom-split" && activeLabel === "inbox" && !searchQuery && readFilter === "all") ? (
            <SplitZeroState
              splitId={activeCategory}
              splitName={splitsStore.splits.find(s => s.id === activeCategory)?.name ?? activeCategory}
              splitIcon={splitsStore.splits.find(s => s.id === activeCategory)?.icon ?? undefined}
            />
          ) : (
            <EmptyStateForContext
              searchQuery={searchQuery}
              activeAccountId={activeAccountId}
              activeLabel={activeLabel}
              readFilter={readFilter}
              activeCategory={activeCategory}
            />
          )
        ) : (
          <>
            {/* Bundle rows for "All" inbox view */}
            {activeLabel === "inbox" && activeCategory === "All" && bundleRules.map((rule) => {
              const summary = bundleSummaries.get(rule.category);
              if (!summary || summary.count === 0) return null;
              const isExpanded = expandedBundles.has(rule.category);
              const bundledThreads = isExpanded
                ? filteredThreads.filter((t) => categoryMap.get(t.id) === rule.category)
                : [];
              return (
                <div key={`bundle-${rule.category}`}>
                  <button
                    onClick={() => {
                      setExpandedBundles((prev) => {
                        const next = new Set(prev);
                        if (next.has(rule.category)) next.delete(rule.category);
                        else next.add(rule.category);
                        return next;
                      });
                    }}
                    className="w-full text-left px-4 py-3 border-b border-border-secondary hover:bg-bg-hover transition-colors flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                      <Package size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">
                          {rule.category}
                        </span>
                        <span className="text-xs bg-accent/15 text-accent px-1.5 rounded-full">
                          {summary.count}
                        </span>
                      </div>
                      <span className="text-xs text-text-tertiary truncate block mt-0.5">
                        {summary.latestSender && `${summary.latestSender}: `}{summary.latestSubject ?? ""}
                      </span>
                    </div>
                    <ChevronRight
                      size={14}
                      className={`text-text-tertiary transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </button>
                  {isExpanded && bundledThreads.map((thread) => (
                    <div key={thread.id} className="pl-4">
                      <ThreadCard
                        thread={thread}
                        isSelected={thread.id === selectedThreadId}
                        onClick={handleThreadClick}
                        onContextMenu={handleThreadContextMenu}
                        category={rule.category}
                        hasFollowUp={followUpThreadIds.has(thread.id)}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
            {visibleThreads.map((thread, idx) => {
              const prevThread = idx > 0 ? filteredThreads[idx - 1] : undefined;
              const showDivider = prevThread?.isPinned && !thread.isPinned;
              return (
                <div
                  key={thread.id}
                  data-thread-id={thread.id}
                  className={idx < 15 ? "stagger-in" : undefined}
                  style={idx < 15 ? { animationDelay: `${idx * 30}ms` } : undefined}
                >
                  {showDivider && (
                    <div className="px-4 py-1.5 text-xs font-medium text-text-tertiary uppercase tracking-wider bg-bg-tertiary/50 border-b border-border-secondary">
                      Other emails
                    </div>
                  )}
                  <ThreadCard
                    thread={thread}
                    isSelected={thread.id === selectedThreadId}
                    onClick={handleThreadClick}
                    onContextMenu={handleThreadContextMenu}
                    category={categoryMap.get(thread.id)}
                    showCategoryBadge={activeLabel === "inbox" && activeCategory === "All"}
                    hasFollowUp={followUpThreadIds.has(thread.id)}
                  />
                </div>
              );
            })}
            {loadingMore && (
              <div className="px-4 py-3 text-center text-xs text-text-tertiary">
                Loading more...
              </div>
            )}
            {!hasMore && threads.length > PAGE_SIZE && (
              <div className="px-4 py-3 text-center text-xs text-text-tertiary">
                All conversations loaded
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SplitZeroState({ splitId, splitName, splitIcon }: { splitId: string; splitName: string; splitIcon?: string }) {
  const bgIndex = splitBgIndex(splitId);
  const bg = ZERO_STATE_BACKGROUNDS[bgIndex]!;

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center relative overflow-hidden transition-[background] duration-500"
      style={{ background: bg, minHeight: "100%" }}
    >
      {/* Scrim to ensure text readability */}
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-3 text-center px-8">
        {splitIcon && (
          <div className="text-4xl mb-1 opacity-90">{splitIcon}</div>
        )}
        <h2 className="text-2xl font-semibold text-white/90 tracking-tight">
          All done
        </h2>
        <p className="text-sm text-white/55 font-medium tracking-wide">
          {splitName}
        </p>
        <div className="flex items-center gap-4 mt-4">
          <span className="text-[0.7rem] text-white/35 font-medium">
            <kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white/50">Tab</kbd>
            {" "}Next split
          </span>
          <span className="text-white/20">·</span>
          <span className="text-[0.7rem] text-white/35 font-medium">
            <kbd className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white/50">⌘K</kbd>
            {" "}Command palette
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyStateForContext({
  searchQuery,
  activeAccountId,
  activeLabel,
  readFilter,
  activeCategory,
}: {
  searchQuery: string | null;
  activeAccountId: string | null;
  activeLabel: string;
  readFilter: string;
  activeCategory: string;
}) {
  if (searchQuery) {
    return <EmptyState illustration={NoSearchResultsIllustration} title="No results found" subtitle="Try a different search term" />;
  }
  if (readFilter !== "all") {
    return <EmptyState icon={Filter} title={`No ${readFilter} emails`} subtitle="Try changing the filter" />;
  }
  if (!activeAccountId) {
    return <EmptyState illustration={NoAccountIllustration} title="No account connected" subtitle="Add a Gmail account to get started" />;
  }

  switch (activeLabel) {
    case "inbox":
      if (activeCategory !== "All") {
        const categoryMessages: Record<string, { title: string; subtitle: string }> = {
          Primary: { title: "Primary is clear", subtitle: "No important conversations" },
          Updates: { title: "No updates", subtitle: "Notifications and transactional emails appear here" },
          Promotions: { title: "No promotions", subtitle: "Marketing and promotional emails appear here" },
          Social: { title: "No social emails", subtitle: "Social network notifications appear here" },
          Newsletters: { title: "No newsletters", subtitle: "Newsletters and subscriptions appear here" },
        };
        const msg = categoryMessages[activeCategory];
        if (msg) return <EmptyState illustration={InboxClearIllustration} title={msg.title} subtitle={msg.subtitle} />;
      }
      return <EmptyState illustration={InboxClearIllustration} title="You're all caught up" subtitle="No new conversations" />;
    case "starred":
      return <EmptyState illustration={GenericEmptyIllustration} title="No starred conversations" subtitle="Star emails to find them here" />;
    case "snoozed":
      return <EmptyState illustration={GenericEmptyIllustration} title="No snoozed emails" subtitle="Snoozed emails will appear here" />;
    case "sent":
      return <EmptyState illustration={GenericEmptyIllustration} title="No sent messages" />;
    case "drafts":
      return <EmptyState illustration={GenericEmptyIllustration} title="No drafts" />;
    case "trash":
      return <EmptyState illustration={GenericEmptyIllustration} title="Trash is empty" />;
    case "spam":
      return <EmptyState illustration={GenericEmptyIllustration} title="No spam" subtitle="Looking good!" />;
    case "all":
      return <EmptyState illustration={GenericEmptyIllustration} title="No emails yet" />;
    default:
      if (activeLabel.startsWith("smart-folder:")) {
        return <EmptyState icon={FolderSearch} title="No matching emails" subtitle="Try adjusting the smart folder query" />;
      }
      return <EmptyState illustration={GenericEmptyIllustration} title="Nothing here" subtitle="No conversations with this label" />;
  }
}
