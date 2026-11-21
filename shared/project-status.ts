export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  planning: "Planning",
  awaiting_approval: "Plan ready",
  generating: "Building",
  creating: "Creating",
  ready: "Ready",
  completed: "Completed",
};

export function statusLabel(status: string | null) {
  if (!status) return "Draft";
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}
