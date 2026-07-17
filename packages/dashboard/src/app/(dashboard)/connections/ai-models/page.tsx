import Link from "next/link";
import { redirect } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { AiModelsSection } from "@/components/connections/ai-models-section";
import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";

// Session-gated like every connections page; the provider list itself is
// client-side (connect/Test state), so this stays a thin shell.
export const dynamic = "force-dynamic";

export default async function AiModelsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <PageReveal className="max-w-2xl">
      <RevealItem>
        <Link
          href="/connections"
          className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-secondary transition-colors mb-6"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <AiModelsSection />
      </RevealItem>
    </PageReveal>
  );
}
