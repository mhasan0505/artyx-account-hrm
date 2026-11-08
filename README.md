# Artyx Digital — Agency Accounting & Enterprise ERP

> Enterprise agency management, client 360° vault, project financial accounting, real-time EBITDA & P&L intelligence, advanced HR & payroll, and partner equity profit distribution engine.

Built for **Artyx Digital** — modern software and digital marketing agency.

---

## ⚡ Core Agency Capabilities

1. **Agency Client CRM & 360° Profiles**
   - Retainers & milestone contracts
   - Secure client credentials vault (Domain, Hosting/cPanel, CMS Admin, API Keys, Socials)
   - Client financial ledger & payment reconciliation in BDT (৳)

2. **Real-Time Agency Profitability & P&L**
   - Income statement with Revenue, Cost of Delivery, Gross Margin %, Operating Expenses, and EBITDA
   - Project-level profitability tracking with contractor attribution

3. **Partner Equity & Profit Share Engine**
   - Partner registry with dynamic equity share percentages
   - Capital accounts and personal drawings log
   - Profit distribution wizard with retained company reserve calculations and batch ledger postings

4. **Advanced Agency HR & Payroll**
   - Multi-department teams: Engineering, Performance Marketing, Creative & UI/UX, Operations
   - Attendance tracking, leave management, monthly salary structures & automated payslip generation

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 20.x
- pnpm >= 9.x
- PostgreSQL database (e.g. Neon, Supabase, or local instance)

### Installation
```bash
# Clone the repository
git clone https://github.com/artyxdigital/artyx-office.git
cd artyx-office

# Install dependencies
pnpm install

# Setup environment variables
cp .env.example .env.local

# Run database push and seed
pnpm db:push
npx tsx prisma/seed-agency.ts

# Start development server
pnpm dev
```

---

## 🎨 Design System & Motion Tokens
Governed by `.agents/` design DNA, GSAP motion standards, and canonical Artyx tokens:
- **Obsidian Ground**: `#070B06`
- **Neon Lime Accent**: `#7FFF00` (Dark mode) / `#3E7000` (Light mode WCAG compliant)
- **Surfaces**: `#121711` & `#1a2318`
- **Motion**: `power3.out` / `cubic-bezier(0.16, 1, 0.3, 1)` mechanical transitions
