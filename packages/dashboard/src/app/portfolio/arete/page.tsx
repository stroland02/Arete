import { ProjectShowcase } from "@/components/portfolio/project-showcase";
import { IconCpu, IconNetwork, IconShieldLock, IconTerminal2 } from "@tabler/icons-react";

export default function AreteShowcasePage() {
  const features = [
    {
      title: "Agentic Framework",
      description: "A robust framework that orchestrates complex autonomous agents to accomplish tasks, communicate seamlessly, and manage context.",
      icon: <IconCpu size={24} />
    },
    {
      title: "Secure Sub-networking",
      description: "Creates isolated execution environments and private networks, ensuring security boundaries are rigorously maintained.",
      icon: <IconNetwork size={24} />
    },
    {
      title: "Marble & Ink UI",
      description: "A stunningly fast, elegant, and light-themed Dashboard built with Next.js, Framer Motion, and Tailwind CSS.",
      icon: <IconTerminal2 size={24} />
    },
    {
      title: "RBAC & Auditing",
      description: "Fine-grained role-based access controls and detailed event logging for compliance and monitoring of agent behaviors.",
      icon: <IconShieldLock size={24} />
    }
  ];

  return (
    <ProjectShowcase
      title="Areté"
      tagline="The Next Generation Autonomous Agentic Ecosystem"
      description="Areté is a powerful monorepo housing a suite of microservices, dashboard frontends, and backend controllers that enable developers to build, monitor, and deploy advanced AI agents seamlessly."
      githubUrl="https://github.com/stroland02/Arete"
      techStack={[
        "Next.js 16",
        "React 19",
        "TypeScript",
        "Tailwind CSS v4",
        "Framer Motion",
        "Prisma",
        "PostgreSQL"
      ]}
      features={features}
      images={[
        "/portfolio/arete-mockup-1.jpg",
        "/portfolio/arete-mockup-2.jpg"
      ]}
    />
  );
}
