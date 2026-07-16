import Bill from '../models/Bill';
import CounterConfiguration from '../models/CounterConfiguration';
import MenuItem from '../models/MenuItem';
import Order from '../models/Order';
import Printer from '../models/Printer';
import PrintJob, { IPrintJob, PrintJobType } from '../models/PrintJob';

const LOCK_STALE_MS = 60_000;

type QueueResult = {
  jobs: IPrintJob[];
  unassignedItems: Array<{ name: string; menuItemId?: string; reason: string }>;
};

export const printJobService = {
  async queueKOTJobs(kot: any, context?: { branchId?: string }): Promise<QueueResult> {
    const candidateOrderId = kot.orderId || kot.dbOrderId || kot._id;
    let order = null as any;

    if (candidateOrderId && /^[0-9a-fA-F]{24}$/.test(String(candidateOrderId))) {
      order = await Order.findById(candidateOrderId).lean();
    }

    if (!order && kot.orderNumber) {
      order = await Order.findOne({ orderNumber: kot.orderNumber }).sort({ createdAt: -1 }).lean();
    }

    const resolvedBranchId =
      order?.branchId?.toString?.() ||
      kot.branchId ||
      context?.branchId;

    if (!order && resolvedBranchId && kot.tableId) {
      order = await Order.findOne({
        branchId: resolvedBranchId,
        tableId: kot.tableId,
      }).sort({ createdAt: -1 }).lean();
    }

    if (!resolvedBranchId) {
      throw { statusCode: 400, message: 'branchId is required when order context is unavailable for KOT queueing.' };
    }

    // Find KOT-capable printers — match by branchId if available, otherwise find all active KOT printers
    const printerQuery: any = {
      isActive: true,
      duty: { $in: ['KOT', 'BOTH'] },
    };
    if (resolvedBranchId) {
      // Include printers explicitly for this branch OR printers with no branch (unassigned)
      printerQuery.$or = [
        { branchId: resolvedBranchId },
        { branchId: { $exists: false } },
        { branchId: null },
      ];
    }
    const printers = await Printer.find(printerQuery).lean();

    if (printers.length === 0) {
      return { jobs: [], unassignedItems: kot.items.map((item: any) => ({ name: item.name, menuItemId: String(item.menuItemId || ''), reason: 'No active KOT printers configured.' })) };
    }

    const menuIds = kot.items
      .map((item: any) => item.menuItemId)
      .filter(Boolean)
      .map((id: any) => String(id))
      .filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id)); // only valid ObjectIds

    const menuItems = await MenuItem.find({ _id: { $in: menuIds } })
      .select('_id printerId sections name')
      .lean();

    console.log(`[KOT] ${kot.items?.length} items, ${menuItems.length} found in DB, ${printers.length} active KOT printers`);
    menuItems.forEach((m: any) => console.log(`  Menu: ${m.name} -> printerId: ${m.printerId || '(none)'}`));

    const menuById = new Map(menuItems.map((item) => [String(item._id), item]));
    const itemsByPrinterId: Record<string, any[]> = {};
    const unassignedItems: Array<{ name: string; menuItemId?: string; reason: string }> = [];

    for (const item of kot.items || []) {
      const menuItem = item.menuItemId ? menuById.get(String(item.menuItemId)) : undefined;
      const explicitPrinterId = menuItem?.printerId ? String(menuItem.printerId) : undefined;
      const itemSection = menuItem?.sections?.[0];

      // 1. Explicit dish-to-printer mapping — but only use if that printer is ONLINE
      let targetPrinter = explicitPrinterId
        ? printers.find((p) => String(p._id) === explicitPrinterId && (p as any).status !== 'offline')
        : undefined;

      // 1b. Explicit printer exists but is OFFLINE — redirect to any online 'ALL' printer
      if (!targetPrinter && explicitPrinterId) {
        const offlineMapped = printers.find((p) => String(p._id) === explicitPrinterId);
        if (offlineMapped) {
          // Printer is assigned but offline — find any online KOT printer as backup
          targetPrinter = printers.find(
            (p) => (p as any).status !== 'offline' && (p.sections?.includes('ALL') || p.sections?.includes(itemSection || ''))
          );
          if (targetPrinter) {
            console.log(`[KOT] Item "${item.name}" reassigned: printer "${(offlineMapped as any).name}" is offline → using "${(targetPrinter as any).name}"`);
          }
        }
      }

      // 2. Section-based fallback — prefer SPECIFIC section match over 'ALL' wildcard
      if (!targetPrinter && itemSection && itemSection !== 'ALL') {
        // Try exact section match first (e.g., "Grill", "Cold Drinks")
        targetPrinter = printers.find(
          (p) => (p as any).status !== 'offline' && p.sections?.includes(itemSection)
        );
      }

      // 3. 'ALL' section wildcard — item has no section or its section didn't match.
      //    Route to the FIRST online printer that has sections: ['ALL'].
      //    This means one printer handles everything when there's no specific mapping.
      if (!targetPrinter) {
        targetPrinter = printers.find(
          (p) => (p as any).status !== 'offline' && p.sections?.includes('ALL')
        );
      }

      // 4. Absolute last fallback: any online KOT printer
      if (!targetPrinter) {
        targetPrinter = printers.find((p) => (p as any).status !== 'offline');
      }

      // 5. No online printer found — skip item
      if (!targetPrinter) {
        console.log(`[KOT] Item "${item.name}" skipped — no online KOT printer available.`);
        unassignedItems.push({
          name: item.name,
          menuItemId: item.menuItemId ? String(item.menuItemId) : undefined,
          reason: explicitPrinterId
            ? 'Assigned printer is offline. No online fallback found.'
            : 'No online KOT printer available.',
        });
        continue;
      }

      const printerId = String(targetPrinter._id);
      itemsByPrinterId[printerId] ||= [];
      itemsByPrinterId[printerId].push(item);
    }

    const jobs = await Promise.all(
      Object.entries(itemsByPrinterId).map(async ([printerId, items]) =>
        PrintJob.create({
          printerId,
          branchId: resolvedBranchId,
          orderId: order?._id,
          jobType: 'KOT',
          payload: {
            type: 'KOT',
            orderId: order?._id ? String(order._id) : undefined,
            orderNumber: order?.orderNumber || kot.orderNumber,
            tableId: order?.tableId ? String(order.tableId) : kot.tableId,
            tableNumber: order?.tableNumber || kot.tableNumber,
            kotNumber: kot.kotNumber,
            sequence: kot.sequence,
            timestamp: new Date().toISOString(),
            items,
          },
        })
      )
    );

    return { jobs, unassignedItems };
  },

  async queueReceiptJob(billId: string, opts?: { counterName?: string; counterConfigId?: string }): Promise<IPrintJob> {
    const bill = await Bill.findById(billId).lean();
    if (!bill) throw { statusCode: 404, message: 'Bill not found for receipt queueing.' };

    const order = await Order.findById(bill.orderId).lean();
    if (!order) throw { statusCode: 404, message: 'Order not found for receipt queueing.' };

    let counterConfig = opts?.counterConfigId
      ? await CounterConfiguration.findById(opts.counterConfigId).lean()
      : null;

    if (!counterConfig) {
      const counterName = opts?.counterName || 'Reception Counter';
      counterConfig = await CounterConfiguration.findOne({
        branchId: bill.branchId,
        counterName,
        isActive: true,
      }).lean();
    }

    if (!counterConfig) {
      throw { statusCode: 400, message: 'No active receipt printer is assigned to this counter.' };
    }

    const printer = await Printer.findOne({
      _id: counterConfig.receiptPrinterId,
      branchId: bill.branchId,
      isActive: true,
      duty: { $in: ['RECEIPT', 'BOTH'] },
    }).lean();

    if (!printer) {
      throw { statusCode: 400, message: 'Assigned receipt printer is inactive or missing.' };
    }

    return PrintJob.create({
      printerId: printer._id,
      branchId: bill.branchId,
      orderId: order._id,
      billId: bill._id,
      counterConfigId: counterConfig._id,
      jobType: 'RECEIPT',
      payload: {
        type: 'BILL',
        billId: String(bill._id),
        billNumber: bill.billNumber,
        orderNumber: order.orderNumber,
        tableId: String(order.tableId),
        tableNumber: order.tableNumber,
        subtotal: bill.subtotal,
        cgst: bill.cgst,
        sgst: bill.sgst,
        grandTotal: bill.grandTotal,
        items: order.items,
        timestamp: new Date().toISOString(),
        counterName: counterConfig.counterName,
      },
    });
  },

  async getJobs(filters?: { status?: string; branchId?: string; printerId?: string; limit?: number }) {
    const query: Record<string, any> = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.branchId) query.branchId = filters.branchId;
    if (filters?.printerId) query.printerId = filters.printerId;

    return PrintJob.find(query).sort({ createdAt: -1 }).limit(filters?.limit || 100);
  },

  async claimNextPendingJob(agentId: string, branchId?: string) {
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    await PrintJob.updateMany(
      { status: 'Printing', lockedAt: { $lt: staleBefore } },
      { status: 'Pending', agentId: undefined, lockedAt: undefined }
    );

    const query: Record<string, any> = {
      status: 'Pending',
      $expr: { $lt: ['$retryCount', '$maxRetries'] },
    };
    if (branchId) query.branchId = branchId;

    const job = await PrintJob.findOneAndUpdate(
      query,
      { status: 'Printing', agentId, lockedAt: new Date() },
      { new: true, sort: { createdAt: 1 } }
    ).populate('printerId');

    return job;
  },

  async completeJob(jobId: string, agentId: string, message?: string) {
    const job = await PrintJob.findById(jobId);
    if (!job) throw { statusCode: 404, message: 'Print job not found.' };

    job.status = 'Completed';
    job.completedAt = new Date();
    job.lockedAt = undefined;
    job.agentId = agentId;
    job.lastError = undefined;
    job.attempts.push({ attemptedAt: new Date(), agentId, status: 'Completed', message });
    await job.save();
    return job;
  },

  async failJob(jobId: string, agentId: string, error: string) {
    const job = await PrintJob.findById(jobId);
    if (!job) throw { statusCode: 404, message: 'Print job not found.' };

    job.retryCount += 1;
    job.agentId = agentId;
    job.lockedAt = undefined;
    job.lastError = error;
    job.attempts.push({ attemptedAt: new Date(), agentId, status: 'Failed', message: error });
    job.status = job.retryCount >= job.maxRetries ? 'Failed' : 'Pending';
    await job.save();
    return job;
  },

  async queueTestJob(printerId: string, branchId?: string) {
    const printer = await Printer.findById(printerId).lean();
    if (!printer) throw { statusCode: 404, message: 'Printer not found.' };

    return PrintJob.create({
      printerId: printer._id,
      branchId: branchId || printer.branchId,
      jobType: 'TEST' as PrintJobType,
      payload: {
        type: 'TEST_PRINT',
        printerName: printer.name,
        timestamp: new Date().toISOString(),
      },
    });
  },
};
