import { useEffect, useLayoutEffect, useCallback, useRef, useState } from "react";
import { useInboxSplitsStore } from "@/stores/inboxSplitsStore";

export interface SplitTabsProps {
  activeSplitId: string;
  onSplitChange: (splitId: string) => void;
}

export function SplitTabs({ activeSplitId, onSplitChange }: SplitTabsProps) {
  const splits = useInboxSplitsStore((s) => s.splits);
  const unreadCounts = useInboxSplitsStore((s) => s.unreadCounts);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const enabledSplits = splits.filter((s) => s.isEnabled);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkOverflow();
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    el.addEventListener("scroll", checkOverflow, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", checkOverflow);
    };
  }, [checkOverflow]);

  useLayoutEffect(() => {
    const el = tabRefs.current.get(activeSplitId);
    if (el) {
      setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [activeSplitId, enabledSplits.length]);

  if (enabledSplits.length === 0) return null;

  return (
    <div className="relative border-b border-border-secondary/60 shrink-0">
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-bg-secondary to-transparent z-10 pointer-events-none" />
      )}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-bg-secondary to-transparent z-10 pointer-events-none" />
      )}
      <div ref={scrollRef} className="flex px-3 overflow-x-auto hide-scrollbar relative">
        {enabledSplits.map((split) => {
          const count = unreadCounts[split.id] ?? 0;
          const isActive = split.id === activeSplitId;
          return (
            <button
              key={split.id}
              ref={(el) => {
                if (el) tabRefs.current.set(split.id, el);
                else tabRefs.current.delete(split.id);
              }}
              onClick={(e) => {
                onSplitChange(split.id);
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-2.5 text-[0.8125rem] transition-all relative whitespace-nowrap flex items-center gap-1.5 ${
                isActive
                  ? "text-text-primary font-semibold"
                  : "text-text-tertiary/60 font-medium hover:text-text-secondary"
              }`}
            >
              {split.icon && (
                <span className={`text-[0.875rem] leading-none transition-all ${isActive ? "opacity-100" : "opacity-60"}`}>
                  {split.icon}
                </span>
              )}
              {split.name}
              {count > 0 && (
                <span
                  className={`text-[0.6rem] font-semibold px-1.5 py-px rounded-full leading-none ${
                    isActive
                      ? "bg-accent text-white"
                      : "bg-accent/20 text-accent"
                  }`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
        {indicatorStyle && (
          <span
            className="absolute bottom-0 h-[2px] bg-accent rounded-full transition-all duration-200 ease-out pointer-events-none"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        )}
      </div>
    </div>
  );
}
