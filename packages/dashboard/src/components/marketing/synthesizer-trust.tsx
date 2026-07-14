"use client";

import { motion, Variants } from "framer-motion";
import { IconBrain, IconShieldCheck, IconFilter, IconChecklist } from "@tabler/icons-react";

const steps = [
  {
    icon: IconBrain,
    title: "Ingests Raw Specialist Data",
    description: "The Synthesizer aggregates independent reviews from our Security, Quality, and Performance agents, combining their specialized perspectives.",
    visual: "synthesizer-visual-1 bg-primary-500/10",
  },
  {
    icon: IconFilter,
    title: "Removes Duplicates & Contradictions",
    description: "It cross-references every comment, stripping out redundant flags and intelligently resolving conflicting advice to provide one unified voice.",
    visual: "synthesizer-visual-2 bg-primary-500/10",
  },
  {
    icon: IconShieldCheck,
    title: "Drops Hallucinated Context",
    description: "Every code suggestion is strictly verified against the actual PR diff. If an agent hallucinates a variable or file, the Synthesizer drops the comment.",
    visual: "synthesizer-visual-3 bg-primary-500/10",
  },
  {
    icon: IconChecklist,
    title: "Final Verification & Risk Scoring",
    description: "The verified feedback is bundled into actionable file reviews, capped with an executive summary and an accurate global Risk Level (Low to Critical).",
    visual: "synthesizer-visual-4 bg-primary-500/10",
  }
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { 
    opacity: 1, 
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 }
  },
};

export function SynthesizerTrust() {
  return (
    <section className="py-24 relative overflow-hidden bg-surface-0">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary-500/5 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto mb-24"
        >
          <h2 className="text-sm font-semibold text-primary-400 tracking-wide uppercase mb-3">Why Trust Areté?</h2>
          <h3 className="text-4xl font-bold tracking-tight text-white sm:text-5xl mb-6">
            Meet the Synthesizer Agent.
          </h3>
          <p className="text-lg text-content-subtle">
            We don't just dump raw AI output on your PRs. Every review is filtered, cross-referenced, and verified by our Synthesizer Agent—ensuring zero hallucinations and zero noise.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-50px" }}
          className="flex flex-col gap-24"
        >
          {steps.map((step, idx) => {
            const isEven = idx % 2 === 0;
            return (
              <motion.div
                key={idx}
                variants={itemVariants}
                className={`flex flex-col ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'} items-center gap-12 lg:gap-24`}
              >
                {/* Text Section */}
                <div className="flex-1 space-y-6">
                  <div className="w-16 h-16 rounded-2xl bg-primary-500/10 flex items-center justify-center mb-6">
                    <step.icon className="w-8 h-8 text-primary-400" />
                  </div>
                  <h4 className="text-3xl font-bold text-white">{step.title}</h4>
                  <p className="text-xl text-content-subtle leading-relaxed">
                    {step.description}
                  </p>
                </div>
                
                {/* Visual Section */}
                <div className="flex-1 w-full">
                  <div className="relative aspect-video rounded-3xl overflow-hidden bg-surface-100/50 backdrop-blur-xl border border-white/5 flex items-center justify-center p-8 group hover:border-primary-500/30 transition-colors duration-500">
                     <div className={`absolute inset-0 opacity-20 group-hover:opacity-40 transition-opacity duration-500 ${step.visual}`} />
                     {/* Mock Visual UI - a glassmorphic terminal or UI element */}
                     <div className="relative z-10 w-full h-full rounded-xl bg-surface-0/80 border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                       <div className="h-10 border-b border-white/10 flex items-center px-4 gap-2">
                         <div className="w-3 h-3 rounded-full bg-red-500/80" />
                         <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                         <div className="w-3 h-3 rounded-full bg-green-500/80" />
                       </div>
                       <div className="p-6 flex-1 flex flex-col justify-center items-center gap-4">
                         <step.icon className="w-12 h-12 text-primary-500/50" />
                         <div className="h-2 w-1/2 bg-white/5 rounded-full" />
                         <div className="h-2 w-3/4 bg-white/5 rounded-full" />
                         <div className="h-2 w-1/3 bg-white/5 rounded-full" />
                       </div>
                     </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
