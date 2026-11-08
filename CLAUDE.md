# 🚀 Project: POS Tech Drive

## 🎯 Project Overview

**POS Tech Drive** is a comprehensive Point of Sale (POS) system designed for modern retail businesses. It streamlines sales, inventory management, customer engagement, and business analytics into a single, powerful platform.

## 🌟 Key Features

### 1. 🛒 Point of Sale (POS)

- **Fast Checkout**: Quick item selection with barcode scanning support
- **Multiple Payment Methods**: Cash, credit/debit cards, mobile payments, gift cards
- **Split Payments**: Split bills between multiple payment methods
- **Discounts & Promotions**: Apply discounts, coupons, and loyalty rewards
- **Returns & Exchanges**: Hassle-free return processing
- **Customer Management**: Create and manage customer profiles
- **Order Management**: Track order status (pending, completed, returned)
- **Receipt Generation**: Email and SMS/Whatsapp receipt delivery
- **Offline Mode**: Continue sales even without internet connection
- **Multi-Language Support**: Only English
- **Multi-Currency Support**: Only BDT
- **Tax Management**: Configurable tax rates and automatic calculation
- **Employee Permissions**: Role-based access control

### 2. 📦 Inventory Management

- **Real-Time Tracking**: Monitor stock levels across all locations
- **Low Stock Alerts**: Automated notifications when items run low
- **Stock Adjustments**: Easy stock level updates and corrections
- **Product Variants**: Support for size, color, and other variations
- **Barcode Generation**: Create and print barcodes for products
- **Stock Transfers**: Move inventory between locations
- **Purchase Orders**: Create and track purchase orders
- **Supplier Management**: Manage supplier information and orders
- **Cost Tracking**: Monitor product costs and landed costs
- **Inventory Valuation**: FIFO, LIFO, and Weighted Average methods

### 3. 👥 Customer Management (CRM)

- **Customer Profiles**: Complete customer information database
- **Purchase History**: Track all past purchases and returns
- **Loyalty Program**: Points-based rewards system
- **Customer Segmentation**: Group customers by behavior and value
- **Personalized Offers**: Send targeted promotions and discounts
- **Communication Tools**: Email and SMS marketing integration
- **Feedback Management**: Collect and respond to customer feedback
- **Customer Groups**: Create custom customer groups
- **VIP Programs**: Special tiers for high-value customers

### 4. 📊 Analytics & Reporting

- **Sales Reports**: Daily, weekly, monthly, and custom date ranges
- **Profitability Analysis**: Track profit margins by product and category
- **Inventory Reports**: Stock levels, turnover, and aging reports
- **Customer Reports**: Top customers, purchase frequency, LTV
- **Employee Performance**: Track sales by employee
- **Cash Flow Analysis**: Monitor cash inflows and outflows
- **Tax Reports**: Automated tax calculation and reporting
- **Export Options**: Export reports to PDF, Excel, and CSV
- **Real-Time Dashboards**: Visual insights into business performance
- **Custom Report Builder**: Create personalized reports

### 5. ⚙️ System Configuration

- **Store Management**: Manage multiple store locations
- **User Management**: Create and manage employee accounts
- **Role-Based Permissions**: Granular access control
- **Payment Settings**: Configure payment methods and gateways
- **Tax Settings**: Set up tax rates and rules
- **Receipt Customization**: Customize receipt templates
- **Notification Settings**: Configure email and SMS alerts
- **Integration Settings**: Connect with third-party services
- **Backup & Restore**: Automated data backups
- **Audit Logs**: Track all system activities

## 🛠️ Technology Stack

### Frontend

- **Framework**: React 19 with TypeScript
- **State Management**: Redux Toolkit + Redux Persist
- **UI Components**: Material UI (MUI) v7
- **Routing**: React Router DOM v7
- **Data Fetching**: TanStack Query (React Query)
- **Form Management**: React Hook Form + Zod
- **Styling**: Styled Components + Emotion
- **Charts & Visualization**: Recharts
- **Notifications**: Notistack
- **Date Handling**: date-fns
- **Icons**: Material Icons

### Backend

- **Framework**: NestJS (Node.js)
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: TypeORM
- **Authentication**: Passport.js (JWT strategy)
- **Authorization**: RBAC (Role-Based Access Control)
- **Validation**: class-validator + class-transformer
- **File Uploads**: Multer
- **Email Service**: Nodemailer
- **SMS Service**: Twilio
- **Payment Gateway**: Stripe Integration
- **Real-time Communication**: Socket.IO

### Infrastructure

- **Containerization**: Docker + Docker Compose
- **Web Server**: Nginx
- **Database**: PostgreSQL
- **Caching**: Redis
- **Message Queue**: BullMQ
- **CI/CD**: GitHub Actions
- **Version Control**: Git + GitHub

## 📂 Project Structure

pos-tech-drive/
├── frontend/                  # React frontend application
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   ├── pages/             # Page components
│   │   ├── store/             # Redux store configuration
│   │   ├── services/          # API service layer
│   │   ├── hooks/             # Custom React hooks
│   │   ├── utils/             # Utility functions
│   │   └── types/             # TypeScript type definitions
│   └── package.json
│
├── backend/                   # NestJS backend application
│   ├── src/
│   │   ├── modules/           # Feature modules
│   │   │   ├── auth/          # Authentication module
│   │   │   ├── users/         # User management module
│   │   │   ├── products/      # Product management module
│   │   │   ├── orders/        # Order management module
│   │   │   ├── customers/     # Customer management module
│   │   │   ├── inventory/     # Inventory management module
│   │   │   ├── analytics/     # Analytics module
│   │   │   ├── settings/      # System settings module
│   │   │   └── common/        # Common services and utilities
│   │   ├── config/            # Configuration files
│   │   ├── guards/            # Authentication guards
│   │   ├── interceptors/      # Request/response interceptors
│   │   ├── filters/           # Exception filters
│   │   ├── pipes/             # Validation pipes
│   │   └── main.ts            # Application entry point
│   └── package.json
│
├── docker/                    # Docker configuration
│   ├── docker-compose.yml     # Multi-container setup
│   ├── nginx/                 # Nginx configuration
│   └── postgres/              # PostgreSQL configuration
│
├── .github/                   # GitHub workflows
│   └── workflows/
│       └── ci-cd.yml          # CI/CD pipeline
│
├── .env.example               # Environment variable template
├── README.md                  # Project documentation
└── package.json               # Root package.json

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 13+
- Redis 6+
- Docker & Docker Compose (optional)

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd pos-tech-drive
   ```

2. **Install dependencies**

   ```bash
   # Install frontend dependencies
   cd frontend
   npm install

   # Install backend dependencies
   cd ../backend
   npm install
   ```

3. **Configure environment variables**

   ```bash
   # Copy environment template
   cp .env.example .env

   # Edit .env with your configuration
   ```

4. **Database setup**

   ```bash
   # Create database
   createdb pos_tech_drive

   # Run migrations
   cd backend
   npm run typeorm migration:run
   ```

5. **Start the application**

   ```bash
   # Start backend
   cd backend
   npm run start:dev

   # Start frontend
   cd ../frontend
   npm run dev
   ```

6. **Access the application**
   - Frontend

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
