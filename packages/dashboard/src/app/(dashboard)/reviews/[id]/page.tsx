import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReviewDetail, resolveSelectedInstallationIds } from "@/lib/queries";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";
import { CopyAgentPrompt } from "@/components/dashboard/copy-agent-prompt";
import { IconArrowLeft, IconSparkles } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

function riskBadgeClasses(riskLevel: string): string {
  switch (riskLevel.toLowerCase()) {
    case "critical":
    case "high":
      return "bg-accent-danger/10 text-accent-danger border-accent-danger/25";
    case "medium":
      return "bg-accent-warning/10 text-accent-warning border-accent-warning/25";
    case "low":
      return "bg-accent-success/10 text-accent-success border-accent-success/25";
    default:
      return "bg-content-primary/5 text-content-muted border-border-default";
  }
}

function severityBadgeClasses(severity: string): string {
  switch (severity.toLowerCase()) {
    case "error":
      return "bg-accent-danger/10 text-accent-danger border-accent-danger/25";
    case "warning":
      return "bg-accent-warning/10 text-accent-warning border-accent-warning/25";
    default:
      return "bg-accent-info/10 text-accent-info border-accent-info/25";
  }
}

function formatCategory(category: string): string {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ installation?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const { installation } = await searchParams;
  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], installation);
  const review = await getReviewDetail(db, installationIds, id);

  if (!review) {
    return (
      <PageReveal className="max-w-2xl">
        <RevealItem>
          <Link
            href="/overview"
            className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors mb-6"
          >
            <IconArrowLeft className="w-4 h-4" />
            Back to Overview
          </Link>
          <div className="glass-panel p-8 text-center">
            <p className="text-sm text-content-secondary">
              This review doesn&apos;t exist, or isn&apos;t part of an installation you have access to.
            </p>
          </div>
        </RevealItem>
      </PageReveal>
    );
  }

  // Paste-ready prompt for a coding agent, from the real verified findings.
  const agentPrompt = [
    `Fix the following ${review.findings.length} code review ${review.findings.length === 1 ? "finding" : "findings"} on ${review.repositoryFullName} (PR #${review.prNumber}):`,
    "",
    ...review.findings.map(
      (f, i) => `${i + 1}. [${formatCategory(f.category)} · ${f.severity}] ${f.path}:${f.line}\n   ${f.body}`,
    ),
  ].join("\n");

  return (
    <PageReveal className="max-w-5xl space-y-6">
      <RevealItem>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors mb-4"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back to Overview
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-content-muted font-mono">{review.repositoryFullName}</p>
            <h1 className="text-xl font-semibold text-content-primary mt-1">
              PR #{review.prNumber}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <Link
              href={`/services?container=${review.id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
            >
              <IconSparkles size={14} stroke={1.75} aria-hidden />
              View in Synthesizer
            </Link>
            {review.findings.length > 0 && <CopyAgentPrompt prompt={agentPrompt} />}
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide border shrink-0 ${riskBadgeClasses(review.riskLevel)}`}
            >
              {review.riskLevel}
            </span>
          </div>
        </div>
      </RevealItem>

      <RevealItem className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Metadata sidebar — SuperLog incident-detail pattern */}
        <div className="lg:col-span-1 glass-panel p-5 space-y-4 h-fit">
          <MetaRow label="Status" value={review.analysisStatus} />
          <MetaRow label="Repository" value={review.repositoryFullName} mono />
          <MetaRow label="Pull request" value={`#${review.prNumber}`} mono />
          <MetaRow label="Findings" value={review.findings.length.toString()} />
          <MetaRow
            label="Reviewed"
            value={new Date(review.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
        </div>

        {/* Findings + Summary */}
        <div className="lg:col-span-3 space-y-6">
          <div className="glass-panel p-5">
            <h2 className="text-sm font-semibold text-content-primary mb-3">Summary</h2>
            <p className="text-sm text-content-secondary whitespace-pre-wrap leading-relaxed">
              {review.overallSummary}
            </p>
          </div>

          <div className="glass-panel p-5">
            <h2 className="text-sm font-semibold text-content-primary mb-4">
              Findings <span className="text-content-muted font-normal">({review.findings.length})</span>
            </h2>
            {review.findings.length === 0 ? (
              <p className="text-sm text-content-muted">No findings on this review.</p>
            ) : (
              <div className="space-y-3">
                {review.findings.map((finding) => (
                  <div
                    key={finding.id}
                    className="border border-border-subtle rounded-xl p-4 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-content-secondary truncate">
                        {finding.path}:{finding.line}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-medium text-content-muted border border-border-subtle rounded-full px-2 py-0.5">
                          {formatCategory(finding.category)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${severityBadgeClasses(finding.severity)}`}
                        >
                          {finding.severity}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-content-secondary">{finding.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </RevealItem>
    </PageReveal>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-content-muted mb-1">{label}</p>
      <p className={`text-sm text-content-secondary ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
