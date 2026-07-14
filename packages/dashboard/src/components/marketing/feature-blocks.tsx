import { IconUsers } from "@tabler/icons-react";
import { KumaLogo } from "@/components/ui/kuma-logo";
import { SpecialistRoster } from "@/components/marketing/specialist-roster";
import { SynthesizerVisual } from "@/components/marketing/synthesizer-card"; // Note: we reused the file, but renamed the export

export function FeatureBlocks() {
  return (
    <div className="py-24 space-y-32">
      
      {/* Block 1: The Specialists */}
      <div className="mx-auto max-w-7xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Text Block */}
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-2 mb-4">
            <IconUsers className="h-5 w-5 text-accent-primary" /> 
            <span className="text-sm font-semibold tracking-wider text-accent-primary uppercase">The Specialists</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-serif font-semibold text-content-primary mb-6 tracking-tight">
            Expertise across the board.
          </h2>
          <p className="text-lg text-content-muted mb-8 leading-relaxed">
            Kuma doesn't rely on a single generalist AI. We deploy 6 specialized agents, each fine-tuned for a specific domain—from security to performance. They review your PR in parallel to ensure nothing slips through the cracks.
          </p>
          
          <div className="flex flex-col gap-4 border-y border-border-subtle py-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              <span className="text-content-primary font-medium">Parallel PR Review speeds up the process</span>
            </div>
            <div className="h-px bg-border-subtle w-full" />
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              <span className="text-content-primary font-medium">Deep Domain Expertise catches edge cases</span>
            </div>
            <div className="h-px bg-border-subtle w-full" />
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              <span className="text-content-primary font-medium">Domain-Specific Context prevents hallucinations</span>
            </div>
          </div>
        </div>
        
        {/* Visual Block */}
        <div className="order-1 lg:order-2">
          <SpecialistRoster />
        </div>
      </div>

      {/* Block 2: The Synthesizer */}
      <div className="mx-auto max-w-7xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Visual Block */}
        <div className="order-1 lg:order-1">
          <SynthesizerVisual />
        </div>
        
        {/* Text Block */}
        <div className="order-2 lg:order-2">
          <div className="flex items-center gap-2 mb-4">
            <KumaLogo size={20} className="text-accent-primary" /> 
            <span className="text-sm font-semibold tracking-wider text-accent-primary uppercase">The Synthesizer</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-serif font-semibold text-content-primary mb-6 tracking-tight">
            The Core Orchestrator.
          </h2>
          <p className="text-lg text-content-muted mb-8 leading-relaxed">
            Kuma isn't just a list of suggestions. The Synthesizer is a specialized neural router that takes the raw outputs from all six agents, cross-references them, and guarantees a mathematically sound pull request patch.
          </p>
          
          <div className="flex flex-col gap-4 border-y border-border-subtle py-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              <span className="text-content-primary font-medium">AST Verification guarantees code compiles</span>
            </div>
            <div className="h-px bg-border-subtle w-full" />
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              <span className="text-content-primary font-medium">Conflict Resolution brokers agent disagreements</span>
            </div>
            <div className="h-px bg-border-subtle w-full" />
            <div className="flex items-center gap-4">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              <span className="text-content-primary font-medium">Unified Output creates instantly mergeable PRs</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
