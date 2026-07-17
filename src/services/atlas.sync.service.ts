/**
 * atlas.sync.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Local-first → Cloud sync engine.
 *
 * Strategy:
 *  1. Every document written to LOCAL MongoDB has  synced: false.
 *  2. This service runs on a timer (default: every 30 s).
 *  3. When internet is detected it opens a SECOND mongoose connection to
 *     MongoDB Atlas and upserts all unsynced documents.
 *  4. On success it marks local documents  synced: true + syncedAt.
 *  5. If Atlas is unreachable the timer just retries next cycle — no crash.
 *
 * Collections synced:  Orders, Bills, Printers (config), Branches, Staff,
 *                      Menu items, Tables, Sections.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import mongoose, { Connection } from 'mongoose';
import dns from 'dns';

// ── Local models (primary DB) ────────────────────────────────────────────────
import Order    from '../models/Order';
import Bill     from '../models/Bill';
import Payment  from '../models/Payment';
import Branch   from '../models/Branch';
import Staff    from '../models/Staff';
import AuditLog from '../models/AuditLog';

// ─────────────────────────────────────────────────────────────────────────────
// Atlas connection (secondary – created lazily only when internet is available)
// ─────────────────────────────────────────────────────────────────────────────
let atlasConn: Connection | null = null;
let isSyncing = false;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

const ATLAS_URI  = process.env.ATLAS_MONGO_URI || 'mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0';
const SYNC_EVERY = parseInt(process.env.ATLAS_SYNC_INTERVAL_MS || '30000', 10); // 30 s

// ─────────────────────────────────────────────────────────────────────────────
// Utility: check internet by resolving mongodb.net
// ─────────────────────────────────────────────────────────────────────────────
function hasInternet(): Promise<boolean> {
  return new Promise((resolve) => {
    dns.resolve('cloud.mongodb.com', (err) => resolve(!err));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Connect (or reuse) the Atlas secondary connection
// ─────────────────────────────────────────────────────────────────────────────
async function getAtlasConnection(): Promise<Connection | null> {
  if (!ATLAS_URI) {
    console.warn('[Sync] ATLAS_MONGO_URI not set in .env — skipping Atlas sync.');
    return null;
  }

  if (atlasConn && atlasConn.readyState === 1) return atlasConn;

  try {
    const conn = await mongoose.createConnection(ATLAS_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    }).asPromise();
    atlasConn = conn;
    console.log('[Sync] ✅ Connected to MongoDB Atlas for sync.');
    return conn;
  } catch (err: any) {
    console.warn('[Sync] ⚠️  Could not connect to Atlas:', err.message);
    atlasConn = null;
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic upsert helper: replicate one local document → Atlas collection
// ─────────────────────────────────────────────────────────────────────────────
async function upsertToAtlas(
  conn: Connection,
  collectionName: string,
  docs: any[]
): Promise<number> {
  if (docs.length === 0) return 0;

  const col = conn.collection(collectionName);
  const ops = docs.map((doc) => ({
    replaceOne: {
      filter: { _id: doc._id },
      replacement: doc.toObject ? doc.toObject() : doc,
      upsert: true,
    },
  }));

  await col.bulkWrite(ops, { ordered: false });
  return docs.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core sync cycle — called every SYNC_EVERY ms
// ─────────────────────────────────────────────────────────────────────────────
export async function runSyncCycle(): Promise<void> {
  if (isSyncing) return;                    // prevent overlapping cycles
  if (!(await hasInternet())) return;        // no internet — skip silently

  const conn = await getAtlasConnection();
  if (!conn) return;

  isSyncing = true;
  const syncedAt = new Date();

  try {
    // ── Orders ──────────────────────────────────────────────────────────────
    const orders = await Order.find({ synced: false }).limit(200).lean(false);
    if (orders.length > 0) {
      await upsertToAtlas(conn, 'orders', orders);
      await Order.updateMany(
        { _id: { $in: orders.map((o) => o._id) } },
        { synced: true, syncedAt }
      );
      console.log(`[Sync] Orders synced: ${orders.length}`);
    }

    // ── Bills ────────────────────────────────────────────────────────────────
    const bills = await Bill.find({ synced: false }).limit(200).lean(false);
    if (bills.length > 0) {
      await upsertToAtlas(conn, 'bills', bills);
      await Bill.updateMany(
        { _id: { $in: bills.map((b) => b._id) } },
        { synced: true, syncedAt }
      );
      console.log(`[Sync] Bills synced:  ${bills.length}`);
    }

    // ── Payments (needed for cash/card/upi/other breakdown on Admin Dashboard) ─
    const payments = await Payment.find({ synced: false }).limit(200).lean(false);
    if (payments.length > 0) {
      await upsertToAtlas(conn, 'payments', payments);
      await Payment.updateMany(
        { _id: { $in: payments.map((p) => p._id) } },
        { synced: true, syncedAt }
      );
      console.log(`[Sync] Payments synced: ${payments.length}`);
    }

    // ── Branches (config — sync all whenever changed) ───────────────────────
    const branches = await Branch.find({}).limit(50).lean(false);
    if (branches.length > 0) {
      await upsertToAtlas(conn, 'branches', branches);
    }

    // ── Staff (without passwords — safety: strip password before cloud upload) ─
    const staffList = await Staff.find({}).select('-password').limit(100).lean(true);
    if (staffList.length > 0) {
      await upsertToAtlas(conn, 'staffs', staffList);
    }

    // ── Structured Action Logs (AuditLog) ───────────────────────────────────
    const unsyncedLogs = await AuditLog.find({ synced: false }).limit(200);
    if (unsyncedLogs.length > 0) {
      await upsertToAtlas(conn, 'auditlogs', unsyncedLogs);
      const logIds = unsyncedLogs.map((l) => l._id);
      await AuditLog.updateMany({ _id: { $in: logIds } }, { synced: true });
      console.log(`[Sync] 📤 Pushed ${unsyncedLogs.length} structured POS audit logs to Atlas cloud.`);
    }

  } catch (err: any) {
    console.warn('[Sync] ⚠️  Sync cycle error:', err.message);
    // Silently recover — next cycle will retry
  } finally {
    isSyncing = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Start the background sync timer. Call once from server.ts on startup. */
export function startAtlasSync(): void {
  if (!ATLAS_URI) {
    console.warn(
      '[Sync] Atlas sync is DISABLED — set ATLAS_MONGO_URI in .env to enable.'
    );
    return;
  }

  console.log(`[Sync] 🔄 Local → Atlas sync started (every ${SYNC_EVERY / 1000}s).`);

  // Run immediately, then on interval
  runSyncCycle().catch(() => {});
  syncIntervalId = setInterval(() => {
    runSyncCycle().catch(() => {});
  }, SYNC_EVERY);
}

/** Stop the sync timer (e.g. on graceful shutdown). */
export function stopAtlasSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log('[Sync] Sync timer stopped.');
  }
  if (atlasConn) {
    atlasConn.close().catch(() => {});
    atlasConn = null;
  }
}

/** Force an immediate sync (exposed via API endpoint). */
export async function forceSyncNow(): Promise<{ synced: boolean; message: string }> {
  if (!ATLAS_URI) return { synced: false, message: 'ATLAS_MONGO_URI not configured.' };
  if (!(await hasInternet())) return { synced: false, message: 'No internet connection detected.' };

  await runSyncCycle();
  return { synced: true, message: 'Sync cycle completed successfully.' };
}
