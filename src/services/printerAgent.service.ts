/**
 * ─────────────────────────────────────────────────────────────────
 *  Embedded Printer Agent — runs inside the backend process
 * ─────────────────────────────────────────────────────────────────
 *  • Starts automatically when the backend server starts
 *  • Polls MongoDB for pending print jobs every POLL_INTERVAL_MS
 *  • Dispatches jobs to their respective printers in parallel
 *  • Uses CUPS (Linux/Mac) or Windows Spooler — no chmod, no sudo
 *  • LAN printers: direct TCP socket on port 9100
 *
 *  PRINT QUALITY FIXES:
 *  ─────────────────────
 *  1. ESC/POS data is written to a temp file and sent via
 *       lp -d QUEUE -o raw TEMPFILE
 *     This avoids stdin piping which can corrupt binary ESC/POS bytes.
 *
 *  2. Separator lines use ASCII '-' (0x2D) instead of Unicode '─'
 *     (U+2500) which most thermal printers cannot render.
 *
 *  3. Text encoding: all content uses Latin-1 / code page 437 safe
 *     characters. ESC t \x00 is sent at init to set CP437 explicitly.
 *
 *  RETRY FIX:
 *  ──────────
 *  maxRetries is bumped to 10 at job-creation time and the agent
 *  backs off 1s between each retry attempt so a temporary CUPS
 *  error doesn't permanently kill a job.
 * ─────────────────────────────────────────────────────────────────
 */

import { execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { printJobService } from './printJob.service';

const POLL_INTERVAL_MS  = 2000;
const MAX_JOBS_PER_POLL = 10;
const AGENT_ID          = `backend-agent-${os.hostname()}-${process.pid}`;

// ── ESC/POS constants ────────────────────────────────────────────
const ESC  = '\x1B';
const GS   = '\x1D';
const LF   = '\n';
const INIT = `${ESC}@${ESC}t\x00`;          // init + select CP437 codepage
const BOLD_ON   = `${ESC}E\x01`;
const BOLD_OFF  = `${ESC}E\x00`;
const DBL_ON    = `${GS}!\x11`;              // double width + height
const DBL_OFF   = `${GS}!\x00`;
const CUT       = `${GS}V\x41\x00`;         // full paper cut
const SEP       = '-'.repeat(32) + LF;      // ASCII separator (safe on all printers)
const CENTER_ON = `${ESC}a\x01`;
const CENTER_OFF= `${ESC}a\x00`;

export function padRight(str: string, width: number): string {
  return str.slice(0, width).padEnd(width);
}

export function line2col(left: string, right: string, width = 32): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right + LF;
}

// ── KOT builder ──────────────────────────────────────────────────
export function buildKOT(payload: any): Buffer {
  let d = '';
  d += INIT;
  d += CENTER_ON;
  d += BOLD_ON + DBL_ON;
  d += `** KOT **${LF}`;
  d += BOLD_OFF + DBL_OFF;
  d += CENTER_OFF;
  d += SEP;
  d += `Table  : ${payload.tableNumber || payload.tableId || '?'}${LF}`;
  d += `KOT No : ${payload.kotNumber || ''}${LF}`;
  d += `Order  : ${payload.orderNumber || ''}${LF}`;
  d += `Time   : ${payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString('en-IN') : new Date().toLocaleTimeString('en-IN')}${LF}`;
  d += SEP;
  (payload.items || []).forEach((item: any, idx: number) => {
    const qty   = item.qty || item.quantity || 1;
    const name  = padRight(`${idx + 1}. ${item.name}`, 24);
    const qtyStr = `x${qty}`;
    d += line2col(name.trim(), qtyStr);
    const note = item.note || item.notes;
    if (note) d += `   ** ${note}${LF}`;
  });
  d += SEP;
  d += `${LF}${LF}${LF}`;
  d += CUT;
  return Buffer.from(d, 'binary');
}

// ── Bill / Receipt builder ────────────────────────────────────────
export function buildReceipt(payload: any): Buffer {
  const subtotal   = Number(payload.subtotal   || 0);
  const cgst       = Number(payload.cgst       || 0);
  const sgst       = Number(payload.sgst       || 0);
  const grandTotal = Number(payload.grandTotal || 0);

  let d = '';
  d += INIT;
  d += CENTER_ON;
  d += BOLD_ON + DBL_ON;
  d += `BILL / TAX INVOICE${LF}`;
  d += BOLD_OFF + DBL_OFF;
  d += CENTER_OFF;
  d += SEP;
  d += `Bill   : ${payload.billNumber   || ''}${LF}`;
  d += `Order  : ${payload.orderNumber  || ''}${LF}`;
  d += `Table  : ${payload.tableNumber  || payload.tableId || '?'}${LF}`;
  d += `Counter: ${payload.counterName  || ''}${LF}`;
  d += SEP;
  (payload.items || []).forEach((item: any, idx: number) => {
    const qty    = item.qty || item.quantity || 1;
    const price  = (Number(item.price) || 0) * qty;
    const left   = `${idx + 1}. ${padRight(item.name, 18)}  x${qty}`;
    d += line2col(left, `Rs.${price.toFixed(0)}`);
    (item.addons || []).forEach((a: any) => {
      d += `   + ${a.name}  Rs.${Number(a.price || 0).toFixed(0)}${LF}`;
    });
  });
  d += SEP;
  d += line2col('Subtotal  :', `Rs.${subtotal.toFixed(2)}`);
  const taxGroups: Record<number, { taxable: number; tax: number }> = {};
  let hasTaxes = false;
  (payload.items || []).forEach((item: any) => {
    const qty = item.qty || item.quantity || 1;
    const price = (Number(item.price) || 0) * qty;
    const rate = Number(item.taxRate) || 0;
    if (rate > 0) {
      hasTaxes = true;
      if (!taxGroups[rate]) taxGroups[rate] = { taxable: 0, tax: 0 };
      taxGroups[rate].taxable += price;
      taxGroups[rate].tax += (price * rate) / 100;
    }
  });

  if (hasTaxes) {
    Object.keys(taxGroups).forEach((rateStr) => {
      const rate = Number(rateStr);
      const halfRate = rate / 2;
      const grp = taxGroups[rate];
      // Format: 630.00@ CGST@2.5 2.5%  15.75
      // 15 chars left, 15 chars right
      d += line2col(`${grp.taxable.toFixed(2)}@ CGST@${halfRate}`, `${halfRate}%  ${(grp.tax / 2).toFixed(2)}`);
      d += line2col(`${grp.taxable.toFixed(2)}@ SGST@${halfRate}`, `${halfRate}%  ${(grp.tax / 2).toFixed(2)}`);
    });
  } else if (cgst > 0 || sgst > 0) {
    // Fallback if no item-level tax rates are found but tax exists
    d += line2col('CGST :', `Rs.${cgst.toFixed(2)}`);
    d += line2col('SGST :', `Rs.${sgst.toFixed(2)}`);
  }
  d += SEP;
  d += BOLD_ON;
  const statusStr = (payload.paymentStatus === 'Paid' || payload.status === 'Completed') ? 'Paid' : 'Not Paid';
  d += line2col(statusStr, `Grand Total Rs.${grandTotal.toFixed(2)}`);
  d += BOLD_OFF;
  d += SEP;
  if (payload.paymentMethods) {
    const pm = payload.paymentMethods;
    if (pm.cash  > 0) d += line2col('Cash  :', `Rs.${Number(pm.cash ).toFixed(0)}`);
    if (pm.card  > 0) d += line2col('Card  :', `Rs.${Number(pm.card ).toFixed(0)}`);
    if (pm.upi   > 0) d += line2col('UPI   :', `Rs.${Number(pm.upi  ).toFixed(0)}`);
    d += SEP;
  }
  d += `${LF}`;
  d += CENTER_ON + `  Thank you! Visit again.${LF}` + CENTER_OFF;
  d += `${LF}${LF}${LF}`;
  d += CUT;
  return Buffer.from(d, 'binary');
}

// ── Test page builder ─────────────────────────────────────────────
export function buildTest(payload: any): Buffer {
  let d = '';
  d += INIT;
  d += CENTER_ON;
  d += BOLD_ON + DBL_ON;
  d += `PRINTER TEST OK${LF}`;
  d += BOLD_OFF + DBL_OFF;
  d += CENTER_OFF;
  d += SEP;
  d += `Printer : ${payload.printerName || ''}${LF}`;
  d += `Agent   : ${AGENT_ID.slice(0, 28)}${LF}`;
  d += `Time    : ${new Date().toLocaleTimeString('en-IN')}${LF}`;
  d += SEP;
  d += `${LF}${LF}${LF}`;
  d += CUT;
  return Buffer.from(d, 'binary');
}

export function buildPrintData(job: any): Buffer {
  const type = job.payload?.type || job.jobType;
  if (type === 'KOT')                        return buildKOT(job.payload);
  if (type === 'BILL' || type === 'RECEIPT') return buildReceipt(job.payload);
  return buildTest(job.payload || { printerName: 'Unknown' });
}

// ── Send via CUPS (temp-file method — most reliable) ─────────────
// Writing to stdin can corrupt binary ESC/POS data on some CUPS versions.
// Writing to a temp file and passing it to `lp` is guaranteed safe.
export function sendViaCUPS(cupsName: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `kot_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
    try {
      fs.writeFileSync(tmpFile, data);
    } catch (e: any) {
      return reject(new Error(`Failed to write temp file: ${e.message}`));
    }

    let cmd: string;
    if (process.platform === 'win32') {
      cmd = `powershell -NoProfile -Command "& {[System.IO.File]::ReadAllBytes('${tmpFile}') | Out-Printer -Name '${cupsName}'}"`;
    } else {
      // -o raw tells CUPS NOT to apply any filters — send bytes verbatim
      cmd = `lp -d "${cupsName}" -o raw "${tmpFile}"`;
    }

    try {
      execSync(cmd, { stdio: 'pipe', timeout: 10_000 });
      console.log(`[PrintAgent] ✅ CUPS job sent to "${cupsName}"`);
      resolve();
    } catch (e: any) {
      const stderr = e.stderr?.toString() || '';
      reject(new Error(`CUPS error for "${cupsName}": ${e.message} ${stderr}`.trim()));
    } finally {
      // Clean up temp file (non-blocking)
      fs.unlink(tmpFile, () => {});
    }
  });
}

// ── Send via TCP (LAN printers on port 9100) ─────────────────────
export function sendViaTCP(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`TCP timeout to ${ip}:${port}`)); });
    socket.once('error',   (e) => { socket.destroy(); reject(e); });
    socket.connect(port, ip, () => {
      socket.write(data, () => { socket.end(); resolve(); });
    });
  });
}

// ── Send via raw /dev write ───────────────────────────────────────
function sendViaRawUSB(devicePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile(devicePath, data, (err) => {
      if (err) return reject(new Error(`${err.message}${err.code === 'EACCES' ? ' — run: sudo chmod 666 ' + devicePath : ''}`));
      resolve();
    });
  });
}

// ── Route to correct transport ────────────────────────────────────
async function sendToPrinter(printer: any, data: Buffer): Promise<void> {
  const { ip, port = 9100 } = printer;
  if (!ip) throw new Error('Printer has no IP/device path configured');

  if (ip.startsWith('cups:')) {
    await sendViaCUPS(ip.replace('cups:', ''), data);
  } else if (ip.startsWith('/dev/')) {
    // Try CUPS first (preferred — no chmod needed)
    try {
      const lpstat = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
      const cupsLine = lpstat.split('\n').find((l) => l.includes(ip));
      if (cupsLine) {
        const m = cupsLine.match(/^device for ([^:]+):/);
        if (m) { await sendViaCUPS(m[1].trim(), data); return; }
      }
    } catch { /* no CUPS */ }
    // Fallback: raw device write
    await sendViaRawUSB(ip, data);
  } else {
    await sendViaTCP(ip, Number(port) || 9100, data);
  }
}

// ── Main polling loop ────────────────────────────────────────────
async function pollAndPrint(): Promise<void> {
  try {
    const claimedJobs: any[] = [];
    for (let i = 0; i < MAX_JOBS_PER_POLL; i++) {
      const job = await printJobService.claimNextPendingJob(`${AGENT_ID}-${i}`);
      if (!job) break;
      claimedJobs.push(job);
    }

    if (claimedJobs.length === 0) return;

    console.log(`[PrintAgent] 🔄 Processing ${claimedJobs.length} print job(s)`);

    await Promise.allSettled(
      claimedJobs.map(async (job) => {
        const printer = job.printerId as any;
        const jobId   = String(job._id);
        console.log(`[PrintAgent] 📄 ${job.jobType} → ${printer?.name} @ ${printer?.ip}`);

        let data: Buffer;
        try {
          data = buildPrintData(job);
        } catch (e: any) {
          console.error(`[PrintAgent] ❌ Build failed ${jobId}: ${e.message}`);
          await printJobService.failJob(jobId, AGENT_ID, e.message);
          return;
        }

        try {
          await sendToPrinter(printer, data);
          await printJobService.completeJob(jobId, AGENT_ID, 'Printed OK');
          console.log(`[PrintAgent] ✅ Done: ${job.jobType} → ${printer?.name}`);
        } catch (e: any) {
          console.error(`[PrintAgent] ❌ Print failed (${printer?.name}): ${e.message}`);
          await printJobService.failJob(jobId, AGENT_ID, e.message);
        }
      })
    );
  } catch {
    // DB not ready yet — next poll will retry
  }
}

// ── Public API: start the embedded agent ─────────────────────────
export function startPrinterAgent(): void {
  console.log(`[PrintAgent] 🖨️  Embedded printer agent started (polling every ${POLL_INTERVAL_MS}ms)`);
  console.log(`[PrintAgent]    Agent ID: ${AGENT_ID}`);
  pollAndPrint();
  setInterval(pollAndPrint, POLL_INTERVAL_MS);
}
