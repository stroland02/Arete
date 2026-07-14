"use client";

import { motion, Variants } from "framer-motion";
import { IconBrain, IconShieldCheck, IconFilter, IconChecklist } from "@tabler/icons-react";

const steps = [
  {
    icon: IconBrain,
    title: "1. Ingests Raw Specialist Data",
    description: "The Synthesizer aggregates independent reviews from our Security, Quality, and Performance agents, combining their specialized perspectives.",
  },
  {
    icon: IconFilter,
    title: "2. Removes Duplicates & Contradictions",
    description: "It cross-references every comment, stripping out redundant flags and intelligently resolving conflicting advice to provide one unified voice.",
  },
  {
    icon: IconShieldCheck,
    title: "3. Drops Hallucinated Context",
    description: "Every code suggestion is strictly verified against the actual PR diff. If an agent hallucinates a variable or file, the Synthesizer drops the comment.",
  },
  {
    icon: IconChecklist,
    title: "4. Final Verification & Risk Scoring",
    description: "The verified feedback is bundled into actionable file reviews, capped with an executive summary and an accurate global Risk Level (Low to Critical).",
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
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto mb-16"
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
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {steps.map((step, idx) => (
            <motion.div
              key={idx}
              variants={itemVariants}
              className="relative p-6 rounded-2xl bg-surface-100/50 backdrop-blur-xl border border-white/5 hover:border-primary-500/30 transition-colors duration-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center mb-6 group-hover:bg-primary-500/20 transition-colors duration-300">
                <step.icon className="w-6 h-6 text-primary-400" />
              </div>
              <h4 className="text-xl font-semibold text-white mb-3">{step.title}</h4>
              <p className="text-content-subtle text-sm leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
