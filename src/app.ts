/**
 * app.ts — Express app factory (no DB connect, no listen)
 * Used by Jest tests via Supertest without starting the server.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler';

import authRoutes        from './routes/auth.routes';
import branchRoutes      from './routes/branch.routes';
import staffRoutes       from './routes/staff.routes';
import tableRoutes       from './routes/table.routes';
import menuRoutes        from './routes/menu.routes';
import orderRoutes       from './routes/order.routes';
import dashboardRoutes   from './routes/dashboard.routes';
import printerRoutes     from './routes/printer.routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/v1/network/info', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let ip = '192.168.137.64';
  for (const name of Object.keys(nets)) {
    if (['docker', 'vbox', 'vmnet', 'br-', 'lo', 'veth'].some(p => name.toLowerCase().startsWith(p))) continue;
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
    }
  }
  res.json({ success: true, data: { ip, port: 5000, url: `http://${ip}:5000` } });
});

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Test server OK' });
});

app.use('/api/v1/auth',      authRoutes);
app.use('/api/v1/branches',  branchRoutes);
app.use('/api/v1/staff',     staffRoutes);
app.use('/api/v1/tables',    tableRoutes);
app.use('/api/v1/menu',      menuRoutes);
app.use('/api/v1/orders',    orderRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/printers',  printerRoutes);

app.use(errorHandler);

export default app;
