import cron from 'node-cron';
import Branch from '../models/Branch';
import Order from '../models/Order';
import { auditLogService } from './auditLog.service';

/**
 * Parses a time string like "12:00 PM – 11:30 PM" and returns the closing time in minutes from midnight.
 */
function parseClosingTime(timings: string): number | null {
  if (!timings) return null;
  // Usually format is "Open - Close". So we split by '-' or '–' or 'to'
  const parts = timings.split(/[-–]| to /i).map((s) => s.trim());
  if (parts.length < 2) return null;
  
  const closeTimeStr = parts[1]; // e.g. "11:30 PM"
  const match = closeTimeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
}

export function startCronJobs() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[Cron] Checking for auto-settlement of active orders past closing time...');
    
    try {
      const branches = await Branch.find({ status: 'Active' });
      const now = new Date();
      // Current time in minutes from midnight in IST (or server local time)
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      for (const branch of branches) {
        const closingMinutes = parseClosingTime(branch.timings);
        if (closingMinutes === null) continue;
        
        // If current time is past closing time by at least 15 minutes OR it's a new day (e.g. 1 AM and closing was 11 PM)
        // A simple way is to check if currentMinutes > closingMinutes && currentMinutes < closingMinutes + 120 (within 2 hours after close)
        // Or just settle ALL active orders if it's currently between 3 AM and 5 AM as a fallback.
        
        let shouldSettle = false;
        
        // Settle if we are strictly after closing time but before next morning
        if (closingMinutes < 24 * 60 - 60) {
           // e.g. closes at 23:30 (1410). Current time 23:45 (1425).
           if (currentMinutes >= closingMinutes && currentMinutes <= closingMinutes + 300) {
             shouldSettle = true;
           }
        }
        
        // As a brute-force daily fallback, if current time is between 2:00 AM and 4:00 AM, settle everything
        if (currentMinutes >= 120 && currentMinutes <= 240) {
           shouldSettle = true;
        }

        if (shouldSettle) {
          const activeOrders = await Order.find({
            branchId: branch._id,
            status: { $in: ['Active', 'On Hold'] }
          });
          
          if (activeOrders.length > 0) {
             console.log(`[Cron] Auto-settling ${activeOrders.length} orders for branch ${branch.name}`);
             for (const order of activeOrders) {
               order.status = 'Completed';
               const saved = await order.save();
               
               await auditLogService.logAction({
                 branchId: branch._id.toString(),
                 actionType: 'ORDER_UPDATED',
                 target: {
                   entityType: 'ORDER',
                   entityId: saved._id.toString(),
                   label: saved.orderNumber,
                 },
                 details: {
                   note: 'Auto-settled by EOD Cron Job',
                   status: 'Completed',
                   paymentMethod: 'Cash'
                 },
               });
             }
          }
        }
      }
    } catch (err: any) {
      console.error('[Cron] Error in auto-settlement job:', err.message);
    }
  });
}
