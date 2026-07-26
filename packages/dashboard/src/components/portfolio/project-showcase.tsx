"use client";

import { motion } from "framer-motion";
import { IconBrandGithub, IconExternalLink, IconCheck, IconStar } from "@tabler/icons-react";
import Image from "next/image";

interface ProjectFeature {
  title: string;
  description: string;
  icon?: React.ReactNode;
}

interface ProjectShowcaseProps {
  title: string;
  tagline: string;
  description: string;
  githubUrl?: string;
  liveUrl?: string;
  techStack: string[];
  features: ProjectFeature[];
  images: string[];
}

export function ProjectShowcase({
  title,
  tagline,
  description,
  githubUrl,
  liveUrl,
  techStack,
  features,
  images
}: ProjectShowcaseProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100 } }
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] text-[var(--color-content-primary)] font-sans pb-24">
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center text-center overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[var(--color-accent-primary)] opacity-5 blur-[120px] rounded-full" />
        </div>
        
        <motion.div 
          className="z-10 relative max-w-3xl"
          initial="hidden"
          animate="visible"
          variants={containerVariants}
        >
          <motion.div variants={itemVariants} className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-panel text-sm text-[var(--color-content-secondary)] font-medium mb-6">
            <IconStar size={16} className="text-[var(--color-accent-secondary)]" />
            Featured Repository
          </motion.div>
          
          <motion.h1 variants={itemVariants} className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
            {title}
          </motion.h1>
          
          <motion.p variants={itemVariants} className="text-xl md:text-2xl text-[var(--color-content-secondary)] mb-8 font-serif italic">
            {tagline}
          </motion.p>
          
          <motion.p variants={itemVariants} className="text-lg text-[var(--color-content-muted)] mb-10 max-w-2xl mx-auto leading-relaxed">
            {description}
          </motion.p>
          
          <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-center gap-4">
            {githubUrl && (
              <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-[var(--color-content-primary)] text-[var(--color-surface-0)] px-6 py-3 rounded-full font-medium hover:scale-105 transition-transform">
                <IconBrandGithub size={20} />
                View Repository
              </a>
            )}
            {liveUrl && (
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 glass-panel-interactive px-6 py-3 rounded-full font-medium text-[var(--color-content-primary)]">
                <IconExternalLink size={20} />
                Live Demo
              </a>
            )}
          </motion.div>
        </motion.div>
      </section>

      {/* Main Content Layout */}
      <main className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 mt-12">
        
        {/* Left Sidebar - Tech Stack */}
        <div className="lg:col-span-4 space-y-8">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="glass-panel p-8"
          >
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              Technology Stack
            </h3>
            <div className="flex flex-wrap gap-2">
              {techStack.map((tech) => (
                <span key={tech} className="px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border-default)] text-sm font-medium">
                  {tech}
                </span>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Right Content - Features & Gallery */}
        <div className="lg:col-span-8 space-y-16">
          
          {/* Features */}
          <section>
            <h2 className="text-3xl font-bold mb-8 font-serif">Key Features</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, i) => (
                <motion.div 
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="glass-panel p-6"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border-default)] flex items-center justify-center mb-4 text-[var(--color-accent-primary)]">
                    {feature.icon || <IconCheck size={24} />}
                  </div>
                  <h4 className="text-lg font-bold mb-2">{feature.title}</h4>
                  <p className="text-[var(--color-content-muted)] leading-relaxed">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </section>

          {/* Gallery */}
          <section>
            <h2 className="text-3xl font-bold mb-8 font-serif">Showcase Gallery</h2>
            <div className="space-y-8">
              {images.map((src, i) => (
                <motion.div 
                  key={src}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  className="glass-panel overflow-hidden p-2"
                >
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-[var(--color-surface-2)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={src} 
                      alt={`${title} screenshot ${i + 1}`} 
                      className="object-cover w-full h-full hover:scale-105 transition-transform duration-700 ease-out"
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
