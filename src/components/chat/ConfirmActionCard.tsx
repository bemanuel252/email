import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ConfirmationRequest } from "@/services/ai/agent/tools";

interface Props {
  request: ConfirmationRequest;
  onApprove: () => void;
  onCancel: () => void;
}

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ConfirmActionCard({ request, onApprove, onCancel }: Props) {
  const { action, previewItems, threadIds, isIrreversible } = request;
  const visibleItems = previewItems.slice(0, 5);
  const hiddenCount = threadIds.length - visibleItems.length;

  return (
    <div
      className={`rounded-md border overflow-hidden ${
        isIrreversible
          ? "border-red-500/40 bg-red-500/5"
          : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b ${
          isIrreversible
            ? "border-red-500/30 bg-red-500/10"
            : "border-amber-500/30 bg-amber-500/10"
        }`}
      >
        {isIrreversible ? (
          <ShieldAlert size={14} className="text-red-400 shrink-0" />
        ) : (
          <AlertTriangle size={14} className="text-amber-400 shrink-0" />
        )}
        <span className="text-xs font-semibold text-text-primary">
          Confirm Action
        </span>
      </div>

      {/* Action description */}
      <div className="px-3 pt-3 pb-2">
        <p className="text-sm font-medium text-text-primary">{action}</p>
      </div>

      {/* Preview list */}
      {visibleItems.length > 0 && (
        <div className="px-3 pb-2 space-y-1">
          {visibleItems.map((item, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 py-1.5 border-t border-border-secondary first:border-t-0"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-primary truncate">
                  {item.subject || "(no subject)"}
                </div>
                <div className="text-[0.625rem] text-text-tertiary truncate">
                  {item.from}
                </div>
              </div>
              <span className="text-[0.625rem] text-text-tertiary shrink-0">
                {formatDate(item.date)}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <p className="text-xs text-text-tertiary pt-1">
              ...and {hiddenCount} more
            </p>
          )}
        </div>
      )}

      {/* Irreversible warning */}
      {isIrreversible && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded bg-red-500/15 border border-red-500/25">
          <p className="text-xs text-red-400 font-medium">
            This action cannot be undone
          </p>
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-border-secondary">
        <Button variant="secondary" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={isIrreversible ? "danger" : "primary"}
          size="xs"
          onClick={onApprove}
        >
          {isIrreversible ? "Delete permanently" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
