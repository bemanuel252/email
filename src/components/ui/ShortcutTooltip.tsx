import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ShortcutTooltipProps {
  label: string;
  shortcut?: string; // e.g. "e", "Cmd+K", "Shift+U", "Ctrl+Enter"
  description?: string;
  children: ReactNode;
  delay?: number;
  side?: "bottom" | "top" | "right";
}

function parseShortcut(raw: string): string[] {
  return raw.split("+").map((k) => {
    switch (k.toLowerCase()) {
      case "cmd":
      case "command":
      case "meta":
        return "⌘";
      case "ctrl":
      case "control":
        return "⌃";
      case "shift":
        return "⇧";
      case "alt":
      case "option":
        return "⌥";
      case "enter":
      case "return":
        return "↵";
      case "escape":
      case "esc":
        return "⎋";
      case "tab":
        return "⇥";
      case "arrowup":
        return "↑";
      case "arrowdown":
        return "↓";
      case "arrowleft":
        return "←";
      case "arrowright":
        return "→";
      case "backspace":
        return "⌫";
      case "delete":
        return "⌦";
      case "f5":
        return "F5";
      default:
        return k.length === 1 ? k.toUpperCase() : k;
    }
  });
}

export function ShortcutTooltip({
  label,
  shortcut,
  description,
  children,
  delay = 500,
  side = "bottom",
}: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        if (side === "right") {
          setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
        } else if (side === "top") {
          setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
        } else {
          setPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
        }
      }
      setVisible(true);
    }, delay);
  }, [delay, side]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const keys = shortcut ? parseShortcut(shortcut) : [];

  return (
    <div
      ref={triggerRef}
      className="contents"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              transform:
                side === "right"
                  ? "translateY(-50%)"
                  : side === "top"
                    ? "translateX(-50%) translateY(-100%)"
                    : "translateX(-50%)",
              zIndex: 9999,
              pointerEvents: "none",
            }}
          >
            {/* Arrow — points toward trigger */}
            {side === "bottom" && (
              <div
                style={{
                  position: "absolute",
                  top: -4,
                  left: "50%",
                  transform: "translateX(-50%) rotate(45deg)",
                  width: 8,
                  height: 8,
                  background: "#1e1e28",
                  borderLeft: "1px solid rgba(255,255,255,0.08)",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            )}
            {side === "right" && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: -4,
                  transform: "translateY(-50%) rotate(45deg)",
                  width: 8,
                  height: 8,
                  background: "#1e1e28",
                  borderLeft: "1px solid rgba(255,255,255,0.08)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            )}

            <div
              style={{
                background: "#1e1e28",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 8,
                padding: "7px 10px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
                minWidth: 100,
                maxWidth: 260,
                backdropFilter: "blur(12px)",
              }}
            >
              {/* Label row + keys */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.88)",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.01em",
                  }}
                >
                  {label}
                </span>
                {keys.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    {keys.map((key, i) => (
                      <kbd
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 18,
                          height: 18,
                          padding: "0 4px",
                          fontSize: "0.65rem",
                          fontWeight: 500,
                          fontFamily: "inherit",
                          background: "rgba(255,255,255,0.08)",
                          border: "1px solid rgba(255,255,255,0.14)",
                          borderRadius: 4,
                          color: "rgba(255,255,255,0.65)",
                          lineHeight: 1,
                        }}
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                )}
              </div>

              {/* Description line */}
              {description && (
                <p
                  style={{
                    margin: "3px 0 0",
                    fontSize: "0.68rem",
                    color: "rgba(255,255,255,0.4)",
                    lineHeight: 1.3,
                    whiteSpace: "normal",
                  }}
                >
                  {description}
                </p>
              )}
            </div>

            {/* Arrow (bottom when side=top) */}
            {side === "top" && (
              <div
                style={{
                  position: "absolute",
                  bottom: -4,
                  left: "50%",
                  transform: "translateX(-50%) rotate(45deg)",
                  width: 8,
                  height: 8,
                  background: "#1e1e28",
                  borderRight: "1px solid rgba(255,255,255,0.08)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
