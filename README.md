<div align="center">
  <img src="./docs/assets/hero-network.jpg" alt="Areté Network Interface" width="100%">

  # ✦ Areté ✦

  **The Next Generation Autonomous Agentic Ecosystem**

  <p align="center">
    <a href="#features">Features</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#ui-aesthetic">UI Aesthetic</a>
  </p>
</div>

---

**Areté** is a powerful monorepo housing a suite of microservices, dashboard frontends, and backend controllers that enable developers to build, monitor, and deploy advanced AI agents seamlessly. Built around strict security boundaries and stunning aesthetics, it brings clarity to complex multi-agent workflows.

## 🚀 Key Features

* **Agentic Framework:** A robust framework that orchestrates complex autonomous agents to accomplish tasks, communicate seamlessly, and manage context.
* **Secure Sub-networking:** Creates isolated execution environments and private networks, ensuring security boundaries are rigorously maintained between agent clusters.
* **RBAC & Auditing:** Fine-grained role-based access controls and detailed event logging for compliance, security, and monitoring of all agent behaviors.
* **Webhooks & Integrations:** Extensive event-driven architecture allowing real-time streaming and custom integrations.

<br/>

<div align="center">
  <img src="./docs/assets/dashboard-logs.jpg" alt="Areté Dashboard Interface" width="100%">
  <p><em>The Areté Dashboard — Real-time Agent Auditing and Logs</em></p>
</div>

<br/>

## 🏗 Architecture & Packages

Areté is structured as an advanced monorepo managed via `pnpm`. The repository is split into dedicated packages for high scalability and separation of concerns:

| Package | Description |
| :--- | :--- |
| 🖥️ **`packages/dashboard`** | The Next.js 16 frontend featuring the 'Marble & Ink' design system, Framer Motion animations, and real-time websockets. |
| 🧠 **`packages/agents`** | Core agent logic, LLM coordination, reasoning loops, and prompt compilation. |
| 🔒 **`packages/net-guard`** | The security layer handling sub-networking, isolation, and traffic interception between agents. |
| 🗄️ **`packages/db`** | Prisma and PostgreSQL database schemas, migrations, and typed clients. |
| 🗺️ **`packages/topology`** | Manages the dynamic graphs and structural relationships between instantiated agents. |
| 🪝 **`packages/webhook`** | Manages outbound webhooks, event dispatching, and system integrations. |

## 🎨 UI Aesthetic: "Marble & Ink"

Areté ships with a stunning, custom-built light theme known as **Marble & Ink**. It relies on warm, off-white paper-like backgrounds (`surface-0`), crisp graphite typography (`content-primary`), and subtle cobalt blue accents. The layout utilizes `glass-panel` components to create a sense of tactile depth without heavy shadows.

## 🛠 Quick Start

Ensure you have `pnpm`, `docker`, and `node` (v20+) installed.

```bash
# 1. Clone the repository
git clone https://github.com/stroland02/Arete.git
cd Arete

# 2. Install dependencies across all packages
pnpm install

# 3. Start local infrastructure (Postgres, Redis, etc.)
docker-compose -f infra/docker-compose.yml up -d

# 4. Run the development server
pnpm dev
```

## 📜 License
Proprietary / All Rights Reserved.