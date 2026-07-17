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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Global Middleware ───
app.use(helmet());
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000', 'https://billing.arabiamandi.com'], credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
app.use('/api', limiter);

// ─── API Routes (v1) ───
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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Arabian Mandi ERP Backend is running ✅', timestamp: new Date().toISOString() });
});

// ─── Error Handler ───
app.use(errorHandler);

// ─── Start Server ───
const startServer = async () => {
  await connectDB();
  await branchDbService.initializeAllBranches();

  app.listen(PORT, () => {
    console.log(`\n🚀 Arabian Mandi ERP Backend running on http://localhost:${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api/v1`);
    console.log(`💚 Health: http://localhost:${PORT}/api/health\n`);
  });

  // Start local → Atlas background sync after DB is ready
  startAtlasSync();

  // Start embedded printer agent — polls DB and dispatches to CUPS/LAN printers
  startPrinterAgent();

  // Graceful shutdown
  process.on('SIGTERM', () => { stopAtlasSync(); process.exit(0); });
  process.on('SIGINT',  () => { stopAtlasSync(); process.exit(0); });
};

startServer();

export default app;
