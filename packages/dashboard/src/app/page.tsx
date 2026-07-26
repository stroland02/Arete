import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "../lib/auth";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { LandingHero } from "@/components/marketing/landing-hero";
import {
  FinalCta,
  HowItWorks,
  MarketingFooter,
  PricingSection,
} from "@/components/marketing/landing-sections";

// Public marketing landing page. Signed-in visitors skip straight to the
// real product (/overview) rather than seeing the pitch again — this is the
// one place `/` needs a session check, since proxy.ts's authorized()
// callback deliberately leaves "/" public so anonymous visitors can land
// here at all.
export default async function LandingPage() {
  // A stale/rotated session cookie makes auth() throw JWTSessionError ("no
  // matching decryption secret") and triple-log on every request. The landing
  // page renders logged-out fine, so swallow the decode failure and treat the
  // visitor as anonymous. redirect() stays OUTSIDE the try — it throws
  // NEXT_REDIRECT internally, which must not be caught. (QA bug 2, 2026-07-15.)
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (session?.user) {
    redirect("/overview");
  }

  return (
    <div className="min-h-screen bg-surface-0">
      <MarketingNav />
      <LandingHero />
      <HowItWorks />
      <PricingSection />
      <FinalCta />
      <MarketingFooter />
    </div>
  );
}
