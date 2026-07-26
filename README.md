<div align="center">

# ✧ Areté

**The Next Generation Autonomous Agentic Ecosystem**

*Secure boundaries. Marble & Ink aesthetics. Powerful multi-agent orchestration.*

[![Build Status](https://img.shields.io/badge/build-passing-success)]()
[![License](https://img.shields.io/badge/License-MIT-blue)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]()
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange)]()

https://github.com/stroland02/Arete/raw/main/docs/assets/demo-1.mp4

</div>

## What is Areté?

Areté is a powerful monorepo that houses a suite of microservices, dashboard frontends, and backend controllers. It enables developers to build, monitor, and deploy advanced AI agents seamlessly. It brings absolute clarity to complex multi-agent workflows by providing a pristine visualization layer and strict security boundaries.

The ecosystem is consumed in multiple ways:
* 🖥️ **The Dashboard** — A beautiful Next.js frontend built with the 'Marble & Ink' design system, featuring Framer Motion animations and real-time data websockets.
* 🧠 **Agent Sub-networks** — Core agent logic, LLM coordination, reasoning loops, and prompt compilation operating within secure, isolated bounds.
* 🗺️ **Topology Engine** — Manages the dynamic graphs and structural relationships between instantiated agents on the fly.
* 🪝 **Webhook Dispatcher** — An extensive event-driven architecture allowing real-time streaming, integrations, and external system triggers.

> *Why it's different: Areté isn't just an agent builder; it is a full-stack, secure operating environment with a breathtaking visual interface that makes debugging and monitoring agent behavior effortless and completely transparent.*

## ✨ Features

* **Marble & Ink UI:** A stunning, custom-built light theme relying on warm off-white paper backgrounds (`surface-0`), crisp graphite typography, and subtle cobalt blue accents.
* **Agentic Framework:** A robust framework that orchestrates complex autonomous agents to accomplish multi-step tasks across isolated boundaries.
* **Secure Sub-networking:** Creates isolated execution environments and private networks, ensuring security boundaries are rigorously maintained between different agent clusters.
* **RBAC & Auditing:** Fine-grained role-based access controls and detailed event logging for compliance and monitoring of all agent behaviors.
* **Prisma & PostgreSQL:** Scalable persistence layer managing schemas, migrations, and strongly-typed queries across the monorepo.

<div align="center">
  https://github.com/stroland02/Arete/raw/main/docs/assets/demo-2.mp4
  <p><em>The Areté Dashboard — Real-time Agent Auditing and Logs</em></p>
</div>

## 🏗️ System Architecture & Engineering

Areté is engineered from the ground up for massive scalability, strict security boundaries, and real-time observability across autonomous agents. 

### The Tech Stack
- **Frontend (Dashboard):** Built on **Next.js 16 (Turbopack)** utilizing modern React Server Components, Auth.js (NextAuth v5), and styled with Tailwind CSS v4 to achieve the proprietary "Marble & Ink" design language.
- **Agent Services:** Powered by **Python / FastAPI** clusters optimized for real-time streaming, LLM routing (Gemini & Anthropic tiering), and complex reasoning loops.
- **Integrations & Webhooks:** Built on **Express (TypeScript)** handling secure incoming/outgoing webhooks (GitHub, GitLab, Stripe) and offloading heavy async jobs to a **BullMQ / Redis** queue architecture.
- **Persistence:** Relational modeling utilizing **PostgreSQL** paired with **Prisma ORM** for heavily typed, safe database interactions across the monorepo.

### Security & Authentication
- **Zero-Trust Internal Token Exchange:** Service-to-service communication is secured via short-lived, dynamically rotated HS256 JWT tokens. Every internal hop (e.g., from an Agent process back to the Dashboard for memory write-backs) mandates a verified `kid` signature.
- **RBAC & Tenancy:** Strict tenant isolation at the database layer ensuring that platform-level operational data and tenant-level LLM context are never entangled.
- **Encrypted Secrets:** External API keys (like PostHog, GitHub Apps, or LLM providers) are encrypted at rest using AES-256-GCM.

### Observability (The "Superlog")
We run a world-class, production-grade observability pipeline designed for AI workloads:
- **OpenTelemetry (OTel):** Integrated deeply into every service (Python and Node/TS).
- **ClickHouse & Jaeger:** Telemetry is forwarded by the local OTel Collector into ClickHouse for blistering-fast analytic querying, and traces are deep-linked via Jaeger UI to instantly resolve failing LLM generations and latency anomalies.
- **Prometheus & Alertmanager:** Dedicated monitoring daemons that independently track failure rates across agent queues and LLM API response times, immediately alerting on degraded model performance.