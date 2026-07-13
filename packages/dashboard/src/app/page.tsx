import { redirect } from "next/navigation";
import { auth } from "../lib/auth";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { LandingHero } from "@/components/marketing/landing-hero";
import { ServicesPreview } from "@/components/marketing/services-preview";
import {
  ConnectorStrip,
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
  const session = await auth();
  if (session?.user) {
    redirect("/overview");
  }

  return (
    <div className="min-h-screen bg-surface-0">
      <MarketingNav />
      <LandingHero />
      <HowItWorks />
      <ServicesPreview />
      <ConnectorStrip />
      <PricingSection />
      <FinalCta />
      <MarketingFooter />
    </div>
  );
}
