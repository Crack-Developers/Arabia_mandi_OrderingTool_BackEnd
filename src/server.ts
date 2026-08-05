import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import authRoutes from './routes/auth.routes';
import branchRoutes from './routes/branch.routes';
import staffRoutes from './routes/staff.routes';
import sectionRoutes from './routes/section.routes';
import tableRoutes from './routes/table.routes';
import menuRoutes from './routes/menu.routes';
import orderRoutes from './routes/order.routes';
import notificationRoutes from './routes/notification.routes';
import syncRoutes from './routes/sync.routes';
import dashboardRoutes from './routes/dashboard.routes';
import printerRoutes from './routes/printer.routes';
import atlasSyncRoutes from './routes/atlas.sync.routes';
import auditLogRoutes from './routes/auditLog.routes';
import { startAtlasSync, stopAtlasSync } from './services/atlas.sync.service';
import { branchDbService } from './services/branchDb.service';
import { startPrinterAgent } from './services/printerAgent.service';
import { startCronJobs } from './services/cron.service';

dotenv.config();

const app = express();
app.set('trust proxy', 1); // Trust Render / load balancer reverse proxy for correct IP identification
const PORT = process.env.PORT || 5000;

// ─── Global Middleware ───
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Electron desktop, server-to-server sync)
    if (!origin) return callback(null, true);
    // Allow all localhost ports (dev, Electron desktop on 3001, Vite on 5173, etc.)
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    // Allow the production admin dashboard domain
    if (origin === 'https://billing.arabiamandi.com') return callback(null, true);
    // Allow Electron file:// origin
    if (origin.startsWith('file://')) return callback(null, true);
    // Default: allow (be permissive for now since sync is critical)
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
app.use('/api', limiter);

// ─── API Routes (v1) ───
import { syncNotifier } from './middleware/syncNotifier';
app.use('/api/v1', syncNotifier);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/staff', staffRoutes);
app.use('/api/v1/sections', sectionRoutes);
app.use('/api/v1/tables', tableRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/printers',   printerRoutes);
app.use('/api/v1/atlas-sync', atlasSyncRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);

// Network info for LAN discovery
app.get('/api/v1/network/info', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ignoredPrefixes = ['docker', 'vbox', 'vmnet', 'br-', 'lo', 'veth', 'tun', 'tap'];
  let ip = '192.168.137.64';
  for (const name of Object.keys(nets)) {
    if (ignoredPrefixes.some(prefix => name.toLowerCase().startsWith(prefix))) continue;
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        if (name.startsWith('en') || name.startsWith('eth') || name.startsWith('wl')) { ip = net.address; break; }
        ip = net.address;
      }
    }
  }
  const port = process.env.PORT || 5000;
  res.json({ success: true, data: { ip, port, url: `http://${ip}:${port}` } });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Arabian Mandi ERP Backend is running ✅', timestamp: new Date().toISOString() });
});

// ─── Error Handler ───
app.use(errorHandler);

import { createServer } from 'http';
import { initSocket } from './services/socket.service';

// ─── Start Server ───
const startServer = async () => {
  await connectDB();
  await branchDbService.initializeAllBranches();

  const httpServer = createServer(app);
  initSocket(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`\n🚀 Arabian Mandi ERP Backend running on http://localhost:${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api/v1`);
    console.log(`💚 Health: http://localhost:${PORT}/api/health\n`);
  });

  // Start local → Atlas background sync after DB is ready
  startAtlasSync();

  // Start embedded printer agent — polls DB and dispatches to CUPS/LAN printers
  startPrinterAgent();
  
  // Start EOD auto-settlement cron jobs
  startCronJobs();

  // Graceful shutdown
  process.on('SIGTERM', () => { stopAtlasSync(); process.exit(0); });
  process.on('SIGINT',  () => { stopAtlasSync(); process.exit(0); });
};

startServer();

export default app;

// Trigger restart
