# Arabian Mandi ERP — Backend

## Tech Stack
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: MongoDB + Mongoose
- **Auth**: JWT + bcryptjs

## Quick Start

### Step 1: Install MongoDB (one-time)
```bash
# Ubuntu/Debian
sudo apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB service
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Step 2: Configure Environment
Edit `.env` if needed (default settings work for local dev):
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/arabian_mandi_erp
JWT_SECRET=ArabianMandi_ERP_SuperSecret_2026_JWT_Key
```

> **Alternative**: Use MongoDB Atlas (cloud, no install needed)
> Replace `MONGODB_URI` with your Atlas connection string.

### Step 3: Seed Database
```bash
npm run seed
```

### Step 4: Start Backend
```bash
npm run dev
```
Server runs at: `http://localhost:5000`
Health check: `http://localhost:5000/api/health`

---

## API Endpoints (`/api/v1`)

| Module | Endpoints |
|--------|-----------|
| Auth | `POST /auth/login`, `GET /auth/profile`, `PUT /auth/change-password` |
| Branches | `GET/POST /branches`, `GET/PUT/DELETE /branches/:id`, `PATCH /branches/:id/toggle-status` |
| Staff | `GET/POST /staff`, `GET/PUT/DELETE /staff/:id`, `POST /staff/:id/reset-password` |
| Sections | `GET/POST /sections`, `PUT/DELETE /sections/:id` |
| Tables | `GET/POST /tables`, `GET/PUT/DELETE /tables/:id`, `POST /tables/reserve`, `/tables/merge`, `/tables/release` |
| Menu | `GET/POST /menu/categories`, `GET/POST /menu/items`, `PATCH /menu/items/:id/availability` |
| Orders | `GET/POST /orders`, `GET /orders/:id`, `POST /orders/:id/kot`, `/orders/:id/bill`, `/orders/payment` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `DELETE /notifications/:id` |
| Sync | `POST /sync/upload`, `GET /sync/status`, `POST /sync/mark-synced` |
| Dashboard | `GET /dashboard/admin` |

## Default Login Credentials (after seed)

| Role | Username | Password |
|------|----------|----------|
| Super Admin | `admin` | `Password@123` |
| Receptionist | `tariq.pos` | `POS#Tariq2026` |
| Cashier | `ramesh.cashier` | `Mandi#Ramesh99` |
| Manager | `john.manager` | `Jubilee@2026` |
