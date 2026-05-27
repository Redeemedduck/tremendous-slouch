import type { CommissionerTask } from "./commissionerTasks";
import type { SourceSearchEntry } from "./sourceSearchLedger";
import { sourceSearchSummary } from "./sourceSearchLedger";

const taskOpenItemIds: Record<string, string[]> = {
  "collect-buyins": ["money-collected"],
  "review-payment-notes": ["money-note-review"],
  "review-payment-evidence": ["money-paid-evidence"],
  "review-payout-evidence": ["payout-evidence"],
  "collect-ghin-indexes": ["roster-ghin"],
  "confirm-schedule": ["schedule-confirmed"],
  "verify-tailnet-url": ["tailnet-url-gate"],
  "verify-production-url": ["production-url-gate"],
  "verify-iphone-safari": ["iphone-safari-gate"],
  "verify-docker": ["docker-gate"],
  "set-access-code": ["access-gate"],
  "fix-rule-blockers": ["score-rules"],
};

const evidenceStatus = (entries: SourceSearchEntry[]) => {
  if (entries.some((entry) => entry.status === "blocked")) return "blocked_source";
  if (entries.some((entry) => entry.status === "not_found")) return "searched_no_source";
  if (entries.some((entry) => entry.status === "recorded")) return "recorded_fact";
  if (entries.some((entry) => entry.status === "inferred")) return "inferred";
  return "not_searched";
};

const manualEvidencePath = (
  task: CommissionerTask,
  relatedSources: SourceSearchEntry[]
) => {
  if (task.severity === "external") {
    return task.nextAction;
  }
  if (relatedSources.some((entry) => entry.id === "messages-access-denied")) {
    return [
      "Fast path: copy the request packet into the group chat or player DMs,",
      "then paste replies into Ops > One-Paste Intake.",
      "Messages source path: grant Full Disk Access to the terminal/Codex app,",
      "then rerun the source-search sweep before changing league facts.",
    ].join(" ");
  }
  if (relatedSources.some((entry) => entry.status === "not_found")) {
    return "Paste direct player or commissioner replies into Ops > One-Paste Intake before changing league facts.";
  }
  return task.nextAction;
};

export function buildBlockerHandoff(
  tasks: CommissionerTask[],
  sourceEntries: SourceSearchEntry[]
) {
  const rows = tasks.map((task) => {
    const relatedOpenItems = taskOpenItemIds[task.id] ?? [];
    const relatedSources = sourceEntries.filter((entry) =>
      entry.relatedOpenItems.some((item) => relatedOpenItems.includes(item))
    );
    return {
      taskId: task.id,
      title: task.title,
      area: task.area,
      severity: task.severity,
      detail: task.detail,
      nextAction: task.nextAction,
      items: task.items,
      copyText: task.copyText,
      relatedOpenItems,
      evidenceStatus: evidenceStatus(relatedSources),
      evidenceSummary:
        relatedSources.length === 0
          ? "No source-search entry is linked to this task."
          : relatedSources.map((entry) => entry.decision).join(" "),
      sourceSearchEntryIds: relatedSources.map((entry) => entry.id),
      manualEvidencePath: manualEvidencePath(task, relatedSources),
      manualActionRequired:
        task.severity === "external" || evidenceStatus(relatedSources) !== "recorded_fact",
    };
  });

  return {
    summary: {
      taskCount: rows.length,
      manualActionRequired: rows.filter((row) => row.manualActionRequired).length,
      sourceSearch: sourceSearchSummary(sourceEntries),
    },
    rows,
  };
}

export function buildBlockerHandoffText(
  tasks: CommissionerTask[],
  sourceEntries: SourceSearchEntry[]
) {
  const handoff = buildBlockerHandoff(tasks, sourceEntries);
  if (handoff.rows.length === 0) {
    return [
      "DJDI Commissioner Handoff",
      `Source-search entries: ${handoff.summary.sourceSearch.count}`,
      "",
      "No open handoff items.",
    ].join("\n");
  }

  return [
    "DJDI Commissioner Handoff",
    `Open tasks: ${handoff.summary.taskCount}`,
    `Manual action required: ${handoff.summary.manualActionRequired}`,
    `Source-search entries: ${handoff.summary.sourceSearch.count}`,
    "",
    ...handoff.rows.flatMap((row, index) => [
      `[${index + 1}. ${row.title}]`,
      `Severity: ${row.severity}`,
      `Area: ${row.area}`,
      `Detail: ${row.detail}`,
      `Next: ${row.nextAction}`,
      `Evidence: ${row.evidenceStatus} - ${row.evidenceSummary}`,
      `Manual evidence path: ${row.manualEvidencePath}`,
      row.copyText ? `Copy:\n${row.copyText}` : "Copy: none",
      "",
    ]),
  ].join("\n");
}
