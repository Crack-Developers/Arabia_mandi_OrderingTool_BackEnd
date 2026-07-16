import net from 'net';
import fs from 'fs';
import os from 'os';
import { exec, execSync } from 'child_process';
import Printer from '../models/Printer';
import CounterConfiguration from '../models/CounterConfiguration';
import { printJobService } from './printJob.service';

function detectLocalSubnet(): string {
  if (process.env.LAN_SUBNET) return process.env.LAN_SUBNET;
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (!iface.internal && iface.family === 'IPv4') {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
          }
        }
      }
    }
  } catch {}
  return '192.168.1';
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const printerService = {

  async getAll(branchId?: string) {
    const filter: any = {};
    if (branchId && branchId !== 'ALL') {
      filter.$or = [{ branchId }, { branchId: null }, { branchId: { $exists: false } }];
    }
    return Printer.find(filter).sort({ createdAt: -1 });
  },

  async getById(id: string) {
    const printer = await Printer.findById(id);
    if (!printer) throw { statusCode: 404, message: 'Printer not found.' };
    return printer;
  },

  async create(data: any) {
    // Extract cupsName from the ip field if it's a cups: reference
    const cupsName = data.cupsName ||
      (data.ip?.startsWith('cups:') ? data.ip.replace('cups:', '') : undefined);

    const printerData = {
      ...data,
      cupsName: cupsName || data.name,
      status: 'online',
    };

    // If a printer with this serial already exists IN THIS BRANCH, update it instead of duplicating across branches
    if (printerData.usbSerial && printerData.branchId) {
      const existing = await Printer.findOneAndUpdate(
        { usbSerial: printerData.usbSerial, branchId: printerData.branchId },
        { $set: printerData },
        { new: true, upsert: false }
      );
      if (existing) return existing; // updated existing record
    } else if (printerData.usbSerial) {
      const existing = await Printer.findOneAndUpdate(
        { usbSerial: printerData.usbSerial, branchId: { $exists: false } },
        { $set: printerData },
        { new: true, upsert: false }
      );
      if (existing) return existing;
    }

    const printer = new Printer(printerData);
    return printer.save();
  },


  async update(id: string, data: any) {
    const printer = await Printer.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!printer) throw { statusCode: 404, message: 'Printer not found.' };
    return printer;
  },

  async delete(id: string, branchId?: string) {
    const filter: any = { _id: id };
    if (branchId && branchId !== 'ALL') {
      filter.$or = [{ branchId }, { branchId: null }, { branchId: { $exists: false } }];
    }
    const printer = await Printer.findOneAndDelete(filter);
    if (!printer) {
      const exists = await Printer.findById(id);
      if (exists) throw { statusCode: 403, message: 'Cannot delete printer belonging to another branch.' };
      throw { statusCode: 404, message: 'Printer not found.' };
    }
    return printer;
  },

  async getCounterConfigs(branchId?: string) {
    const filter: any = {};
    if (branchId) filter.branchId = branchId;
    return CounterConfiguration.find(filter).sort({ createdAt: -1 });
  },

  async createCounterConfig(data: any) {
    const config = new CounterConfiguration(data);
    return config.save();
  },

  async updateCounterConfig(id: string, data: any) {
    const config = await CounterConfiguration.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!config) throw { statusCode: 404, message: 'Counter configuration not found.' };
    return config;
  },

  async deleteCounterConfig(id: string) {
    const config = await CounterConfiguration.findByIdAndDelete(id);
    if (!config) throw { statusCode: 404, message: 'Counter configuration not found.' };
    return config;
  },

  async scanUSB(branchId?: string): Promise<{ foundPrinters: any[]; savedPrinters: any[] }> {
    const discovered: any[] = [];

    if (process.platform === 'win32') {
      // ── Windows: PowerShell ───────────────────────────────────────────────
      try {
        const out = execSync(
          `powershell -NoProfile -Command "Get-Printer | Select-Object Name,PortName,PrinterStatus | ConvertTo-Json"`,
          { encoding: 'utf8', timeout: 5000 }
        );
        const arr = Array.isArray(JSON.parse(out.trim())) ? JSON.parse(out.trim()) : [JSON.parse(out.trim())];
        for (const p of arr) {
          if (!p.Name) continue;
          discovered.push({
            cupsName: p.Name,
            usbSerial: null,
            deviceUri: `win://${p.Name}`,
            physicallyOnline: p.PrinterStatus === 3,
          });
        }
      } catch { /* Windows discovery failed */ }

    } else {
      // ── Linux / macOS ─────────────────────────────────────────────────────

      // Step 1: `lpstat -v` → get all CUPS USB queues + device URIs + serials
      const cupsQueues: Map<string, { cupsName: string; usbSerial: string | null; deviceUri: string }> = new Map();
      try {
        const lpstatV = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
        for (const line of lpstatV.split('\n')) {
          const m = line.match(/^device for ([^:]+):\s*(.+)$/);
          if (!m) continue;
          const cupsName = m[1].trim();
          const deviceUri = m[2].trim();
          if (!deviceUri.startsWith('usb://') && !deviceUri.startsWith('serial:') && !deviceUri.startsWith('parallel:')) continue;
          const sm = deviceUri.match(/[?&]serial=([^&\s]+)/i);
          cupsQueues.set(cupsName, { cupsName, usbSerial: sm ? sm[1] : null, deviceUri });
        }
      } catch { /* lpstat -v not available */ }

      // Step 2: `lpstat -p` → get REAL physical status of each CUPS queue
      // When a USB printer is physically disconnected CUPS marks the queue as
      // "disabled" and reports "not connected" or "Connection refused".
      // "idle" = physically present and ready.
      const physicallyOnline = new Set<string>();
      // ALL printers seen in lpstat -p output (regardless of state)
      const seenInLpstatP = new Set<string>();
      try {
        const lpstatP = execSync('lpstat -p 2>/dev/null', { encoding: 'utf8' });
        for (const line of lpstatP.split('\n')) {
          // Match idle / printing
          const m = line.match(/^printer\s+(\S+)\s+(is\s+idle|is\s+printing|now\s+printing)/i);
          if (m) {
            physicallyOnline.add(m[1].trim());
            seenInLpstatP.add(m[1].trim());
          }
          // Also track disabled printers (they ARE seen by lpstat -p but not online)
          const d = line.match(/^printer\s+(\S+)\s+disabled/i);
          if (d) seenInLpstatP.add(d[1].trim());
        }
      } catch { /* lpstat -p not available — assume all online */ }

      // Trust lpstat -p if it reported ANY printer at all (idle or disabled)
      const trustLpstatP = seenInLpstatP.size > 0;

      for (const [, q] of cupsQueues) {
        const isOnline = trustLpstatP ? physicallyOnline.has(q.cupsName) : true;
        discovered.push({ ...q, physicallyOnline: isOnline });
      }

      // Fallback: /dev/usb/lp* (device file exists only when physically plugged in)
      if (cupsQueues.size === 0) {
        try {
          if (fs.existsSync('/dev/usb')) {
            for (const file of fs.readdirSync('/dev/usb')) {
              if (file.startsWith('lp')) {
                discovered.push({ cupsName: file, usbSerial: null, deviceUri: `/dev/usb/${file}`, physicallyOnline: true });
              }
            }
          }
        } catch { /* /dev scan failed */ }
      }
    }

    // ── Deduplicate by serial number ─────────────────────────────────────────
    // Same physical printer can appear twice with different CUPS names
    // (e.g. "RP-3200-LITE" and "RP-3200-LITE-2"). Keep only the first.
    const seenSerials = new Set<string>();
    const deduplicated = discovered.filter((d) => {
      if (!d.usbSerial) return true;
      if (seenSerials.has(d.usbSerial)) return false;
      seenSerials.add(d.usbSerial);
      return true;
    });

    // ── Reconcile with DB ─────────────────────────────────────────────────────
    const Printer = (await import('../models/Printer')).default;
    const filter: any = {};
    if (branchId && branchId !== 'ALL') {
      filter.$or = [{ branchId }, { branchId: null }, { branchId: { $exists: false } }];
    }
    const dbPrinters = await Printer.find(filter).lean();

    // Build a quick lookup of currently physically-online CUPS names
    const onlineCupsNames = new Set<string>(
      deduplicated.filter((d) => d.physicallyOnline).map((d) => d.cupsName)
    );

    // Update every DB printer's live status
    for (const dbP of dbPrinters) {
      const cupsName = dbP.cupsName || (dbP.ip?.startsWith('cups:') ? dbP.ip.replace('cups:', '') : null);
      const nowOnline = cupsName ? onlineCupsNames.has(cupsName) : false;
      const newStatus = nowOnline ? 'online' : 'offline';
      if ((dbP as any).status !== newStatus) {
        await Printer.updateOne({ _id: dbP._id }, { status: newStatus });
      }
    }

    // Separate: which discovered printers are already in DB?
    const foundPrinters: any[] = [];
    for (const d of deduplicated) {
      if (!d.physicallyOnline) continue; // only show physically connected devices

      // Match by serial first, then by cupsName/ip
      let existing: any = null;
      if (d.usbSerial) existing = dbPrinters.find((p: any) => p.usbSerial === d.usbSerial);
      if (!existing) existing = dbPrinters.find((p: any) => p.cupsName === d.cupsName || p.ip === `cups:${d.cupsName}`);

      if (existing) {
        // Known printer came back online — refresh CUPS name/ip/serial
        const updates: any = { status: 'online' };
        if (existing.cupsName !== d.cupsName) updates.cupsName = d.cupsName;
        if (existing.ip !== `cups:${d.cupsName}`) updates.ip = `cups:${d.cupsName}`;
        if (d.usbSerial && existing.usbSerial !== d.usbSerial) updates.usbSerial = d.usbSerial;
        await Printer.updateOne({ _id: existing._id }, updates);
      } else {
        // Brand-new printer — show in "Found Printers"
        foundPrinters.push({
          _id: `cups-${d.cupsName}`,
          name: d.cupsName,
          ip: `cups:${d.cupsName}`,
          port: 9100,
          type: 'thermal',
          connection: 'USB/LAN',
          status: 'online',
          sections: [],
          deviceUri: d.deviceUri,
          usbSerial: d.usbSerial,
          cupsName: d.cupsName,
        });
      }
    }

    // Return saved devices with their freshly-updated status
    const savedPrinters = await Printer.find(filter).sort({ createdAt: -1 }).lean();

    return { foundPrinters, savedPrinters };
  },


  // ─── LAN Auto-Discovery ─────────────────────────────────────────────────────

  async scanLAN(branchId?: string): Promise<{ foundPrinters: any[]; savedPrinters: any[] }> {

    // Automatically detect the host machine's actual LAN subnet
    const subnet = detectLocalSubnet();
    const ports  = [9100, 631];
    const timeout = 400; // ms per probe

    const probe = (host: string, port: number): Promise<{ host: string; port: number } | null> =>
      new Promise((resolve) => {
        const socket = new net.Socket();
        const done = (result: { host: string; port: number } | null) => {
          socket.destroy();
          resolve(result);
        };
        socket.setTimeout(timeout);
        socket.once('connect', () => done({ host, port }));
        socket.once('timeout', () => done(null));
        socket.once('error', () => done(null));
        socket.connect(port, host);
      });

    // Probe last 50 addresses of the subnet (limit scope to keep response fast)
    const probes: Promise<{ host: string; port: number } | null>[] = [];
    for (let i = 1; i <= 254; i++) {
      for (const port of ports) {
        probes.push(probe(`${subnet}.${i}`, port));
      }
    }

    const results = await Promise.all(probes);
    const found = results.filter(Boolean) as { host: string; port: number }[];

    const discoveredLAN = found.map((f, idx) => ({
      _id:        `scan-lan-${idx + 1}`,
      name:       `Network Printer @ ${f.host}:${f.port}`,
      ip:         f.host,
      port:       f.port,
      type:       f.port === 631 ? 'ipp' : 'thermal',
      connection: 'LAN',
      status:     'online',
      sections:   [],
    }));

    const usbResult = await printerService.scanUSB(branchId);

    // Merge LAN found printers into foundPrinters (LAN printers are always new)
    const mergedFound = [
      ...usbResult.foundPrinters,
      ...discoveredLAN.map((f: any, idx: number) => ({ ...f, _id: `scan-lan-${idx + 1}` })),
    ];

    return { foundPrinters: mergedFound, savedPrinters: usbResult.savedPrinters };
  },

  // ─── Verify LAN Printer by IP:Port (TCP ping) ────────────────────────────────
  async pingLAN(ip: string, port = 9100): Promise<{
    success: boolean;
    online: boolean;
    ip: string;
    port: number;
    latencyMs?: number;
    name: string;
    type: string;
    connection: string;
    message: string;
  }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(4000);

      const done = (online: boolean, msg: string) => {
        socket.destroy();
        const latencyMs = online ? Date.now() - start : undefined;
        // Guess printer name from IP (can be edited before saving)
        const nameSuffix = ip.split('.').slice(-1)[0];
        const type = port === 631 ? 'ipp' : 'thermal';
        resolve({
          success: online,
          online,
          ip,
          port,
          latencyMs,
          name: `LAN Printer (${ip})`,
          type,
          connection: 'LAN',
          message: online
            ? `Printer at ${ip}:${port} is reachable (${latencyMs}ms)`
            : msg,
        });
        return nameSuffix; // suppress unused warning
      };

      socket.once('connect', () => done(true, ''));
      socket.once('timeout', () => done(false, `No response from ${ip}:${port} — check IP and port`));
      socket.once('error',   (e) => done(false, `Cannot reach ${ip}:${port} — ${e.message}`));
      socket.connect(port, ip);
    });
  },

  // ─── Multi-Printer KOT Dispatcher (Splits by assigned dish printerId or section) ───
  async dispatchKOT(kotPayload: any): Promise<{ dispatched: number; results: any[]; unassignedItems: any[] }> {
    const queueResult = await printJobService.queueKOTJobs(kotPayload, {
      branchId: kotPayload.branchId,
    });
    return {
      dispatched: queueResult.jobs.length,
      results: queueResult.jobs.map((job) => ({
        jobId: job._id,
        printerId: job.printerId,
        status: 'queued',
      })),
      unassignedItems: queueResult.unassignedItems,
    };
  },

  // ─── Print-Job Dispatcher ────────────────────────────────────────────────────
  async printJob(printerId: string, payload: any): Promise<void> {
    const printer = await Printer.findById(printerId);
    if (!printer) throw { statusCode: 404, message: 'Printer not found.' };
    if (!printer.isActive) throw { statusCode: 400, message: 'Printer is marked inactive.' };

    const { ip, port = 9100, type, name } = printer;

    if (ip.startsWith('cups:')) {
      // Primary method: CUPS lp command (works for all CUPS-registered printers on Linux)
      const cupsName = ip.replace('cups:', '');
      await printerService._sendViaCUPS(cupsName, payload, name);
    } else if (ip.startsWith('/dev/')) {
      // Try CUPS first (if 80Series2 or similar is registered), fall back to raw write
      try {
        const lpstatOut = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
        // Find a CUPS printer that uses this /dev path
        const cupsLine = lpstatOut.split('\n').find(l => l.includes(ip));
        if (cupsLine) {
          const match = cupsLine.match(/^device for ([^:]+):/);
          if (match) {
            await printerService._sendViaCUPS(match[1].trim(), payload, name);
            return;
          }
        }
        // Also try the first available USB CUPS printer
        const usbCupsLine = lpstatOut.split('\n').find(l => l.includes('usb://'));
        if (usbCupsLine) {
          const match = usbCupsLine.match(/^device for ([^:]+):/);
          if (match) {
            await printerService._sendViaCUPS(match[1].trim(), payload, name);
            return;
          }
        }
      } catch { /* fall through to raw write */ }
      await printerService._sendRawESCPOS_USB(ip, payload, name);
    } else if (type === 'thermal') {
      await printerService._sendRawESCPOS(ip, port, payload, name);
    } else if (type === 'ipp') {
      console.log(`[IPP] Would send IPP job to ${ip} – payload:`, JSON.stringify(payload));
    } else {
      console.log(`[PDF] Would send PDF print job to ${ip} – payload:`, JSON.stringify(payload));
    }
  },

  // ─── Send via CUPS lp command (most reliable on Linux) ───────────────────────
  _sendViaCUPS(cupsName: string, payload: any, printerName: string): Promise<void> {
    return new Promise((resolve) => {
      const ESC = '\x1B';
      const GS  = '\x1D';
      const LF  = '\n';

      let printData = '';
      printData += `${ESC}@`;    // init
      printData += `${ESC}!0`;   // normal font

      if (payload.type === 'TEST_PRINT') {
        printData += `${ESC}E\x01${GS}!\x01`;
        printData += `Arabian Mandi POS${LF}`;
        printData += `${ESC}E\x00${GS}!\x00`;
        printData += `Printer Test OK${LF}`;
        printData += `${payload.timestamp || new Date().toISOString()}${LF}`;
        printData += `CUPS Printer: ${cupsName}${LF}`;
      } else if (payload.type === 'KOT') {
        printData += `${ESC}E\x01${GS}!\x01`;
        printData += `KOT - ${payload.section || 'Kitchen'}${LF}`;
        printData += `${ESC}E\x00${GS}!\x00`;
        printData += `Table  : ${payload.tableId}${LF}`;
        printData += `KOT No : ${payload.kotNumber || ''}${LF}`;
        printData += `Time   : ${payload.timestamp || ''}${LF}`;
        printData += `${'-'.repeat(32)}${LF}`;
        (payload.items || []).forEach((item: any, idx: number) => {
          const qty = item.qty || item.quantity || 1;
          const note = item.note || item.notes;
          printData += `${idx + 1}. ${item.name}  x${qty}${LF}`;
          if (note) printData += `   ** ${note} **${LF}`;
        });
        printData += `${'-'.repeat(32)}${LF}`;
        printData += `Branch : ${payload.branchName || ''}${LF}`;
      } else if (payload.type === 'BILL') {
        printData += `${ESC}E\x01${GS}!\x01`;
        printData += `BILL / TAX INVOICE${LF}`;
        printData += `${ESC}E\x00${GS}!\x00`;
        printData += `Bill No: ${payload.billNumber || ''}${LF}`;
        printData += `Table  : ${payload.tableId || ''}${LF}`;
        printData += `${'-'.repeat(32)}${LF}`;
        (payload.items || []).forEach((item: any, idx: number) => {
          const qty = item.qty || item.quantity || 1;
          const price = (item.price || 0) * qty;
          printData += `${idx + 1}. ${item.name}  x${qty}  Rs.${price.toFixed(0)}${LF}`;
        });
        printData += `${'-'.repeat(32)}${LF}`;
        printData += `Subtotal: Rs.${Number(payload.subtotal || 0).toFixed(2)}${LF}`;
        printData += `CGST 2.5%: Rs.${Number(payload.cgst || 0).toFixed(2)}${LF}`;
        printData += `SGST 2.5%: Rs.${Number(payload.sgst || 0).toFixed(2)}${LF}`;
        printData += `${ESC}E\x01`;
        printData += `TOTAL: Rs.${Number(payload.grandTotal || 0).toFixed(2)}${LF}`;
        printData += `${ESC}E\x00`;
        printData += `Branch : ${payload.branchName || ''}${LF}`;
      }

      // Feed and cut
      printData += `${LF}${LF}${LF}`;
      printData += `${GS}V\x41\x00`; // full paper cut

      // Cross-platform print command (Linux/macOS CUPS vs Windows PowerShell Spooler)
      const printCommand =
        process.platform === 'win32'
          ? `powershell -Command "$input | Out-Printer -Name '${cupsName}'"`
          : `lp -d "${cupsName}" -o raw -`;

      const child = exec(
        printCommand,
        { encoding: 'buffer' },
        (err, _stdout, stderr) => {
          if (err) {
            console.warn(`[System Spooler] Error printing to "${printerName}" (${cupsName}): ${err.message}`);
            if (stderr) console.warn('[System Spooler stderr]', stderr.toString());
          } else {
            console.log(`[System Spooler] Successfully sent print job to "${printerName}" (${cupsName})`);
          }
          resolve(); // always resolve so caller can continue
        }
      );

      if (child.stdin) {
        child.stdin.write(Buffer.from(printData, 'binary'));
        child.stdin.end();
      }
    });
  },

  // ─── Raw ESC/POS over USB/Serial device ──────────────────────────────────────
  _sendRawESCPOS_USB(devicePath: string, payload: any, printerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(devicePath)) {
        reject(new Error(`Device path ${devicePath} does not exist.`));
        return;
      }

      const ESC = '\x1B';
      const GS  = '\x1D';
      const LF  = '\n';

      let printData = '';

      // ── ESC/POS Initialise ──
      printData += `${ESC}@`;                // init printer
      printData += `${ESC}!0`;               // normal font
      printData += `${ESC}E1`;               // bold on
      printData += `${GS}!1`;                // double-height

      if (payload.type === 'TEST_PRINT') {
        printData += `Arabian Mandi POS${LF}`;
        printData += `${ESC}E0`;
        printData += `Printer Test OK${LF}`;
        printData += `${payload.timestamp || new Date().toISOString()}${LF}`;
        printData += `USB Path: ${devicePath}${LF}`;
      } else if (payload.type === 'KOT') {
        printData += `KOT - ${payload.section || 'Kitchen'}${LF}`;
        printData += `${ESC}E0${GS}!0`;
        printData += `Table: ${payload.tableId}${LF}`;
        printData += `${payload.kotNumber || ''}  ${payload.timestamp || ''}${LF}`;
        printData += `${'─'.repeat(32)}${LF}`;
        (payload.items || []).forEach((item: any, idx: number) => {
          const itemQty = item.qty || item.quantity || 1;
          const itemNote = item.note || item.notes;
          printData += `${idx + 1}. ${item.name}  x${itemQty}${LF}`;
          if (itemNote) printData += `   Note: ${itemNote}${LF}`;
        });
        printData += `${'─'.repeat(32)}${LF}`;
        printData += `Branch: ${payload.branchName || ''}${LF}`;
      }

      // ── Paper cut ──
      printData += `${LF}${LF}${LF}`;
      printData += `${GS}V\x41\x00`; // full cut

      fs.writeFile(devicePath, Buffer.from(printData, 'binary'), (err) => {
        if (err) {
          console.warn(`[USB/Serial POS] Error sending to "${printerName}" @ ${devicePath} – ${err.message}`);
          if (err.code === 'EACCES') {
            reject(new Error(`Permission denied writing to ${devicePath}. Run: sudo chmod 666 ${devicePath}`));
          } else {
            reject(err);
          }
        } else {
          console.log(`[USB/Serial POS] Successfully printed to "${printerName}" @ ${devicePath}`);
          resolve();
        }
      });
    });
  },

  // ─── Raw ESC/POS over TCP (port 9100) ───────────────────────────────────────
  _sendRawESCPOS(ip: string, port: number, payload: any, printerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = 5000;

      socket.setTimeout(timeout);
      socket.once('timeout', () => {
        socket.destroy();
        // Don't hard-fail on timeout – queue will retry
        console.warn(`[ESC/POS] Timeout connecting to printer "${printerName}" @ ${ip}:${port}`);
        resolve();
      });
      socket.once('error', (err) => {
        socket.destroy();
        console.warn(`[ESC/POS] Error sending to "${printerName}" @ ${ip}:${port} – ${err.message}`);
        // Resolve instead of reject so caller adds to offline queue rather than crashing
        resolve();
      });

      socket.connect(port, ip, () => {
        const ESC = '\x1B';
        const GS  = '\x1D';
        const LF  = '\n';

        let printData = '';

        // ── ESC/POS Initialise ──
        printData += `${ESC}@`;                // init printer
        printData += `${ESC}!0`;               // normal font
        printData += `${ESC}E1`;               // bold on
        printData += `${GS}!1`;               // double-height

        if (payload.type === 'TEST_PRINT') {
          printData += `Arabian Mandi POS${LF}`;
          printData += `${ESC}E0`;
          printData += `Printer Test OK${LF}`;
          printData += `${payload.timestamp || new Date().toISOString()}${LF}`;
          printData += `IP: ${ip}:${port}${LF}`;
        } else if (payload.type === 'KOT') {
          printData += `KOT - ${payload.section || 'Kitchen'}${LF}`;
          printData += `${ESC}E0${GS}!0`;
          printData += `Table: ${payload.tableId}${LF}`;
          printData += `${payload.kotNumber || ''}  ${payload.timestamp || ''}${LF}`;
          printData += `${'─'.repeat(32)}${LF}`;
          (payload.items || []).forEach((item: any, idx: number) => {
            const itemQty = item.qty || item.quantity || 1;
            const itemNote = item.note || item.notes;
            printData += `${idx + 1}. ${item.name}  x${itemQty}${LF}`;
            if (itemNote) printData += `   Note: ${itemNote}${LF}`;
          });
          printData += `${'─'.repeat(32)}${LF}`;
          printData += `Branch: ${payload.branchName || ''}${LF}`;
        }

        // ── Paper cut ──
        printData += `${LF}${LF}${LF}`;
        printData += `${GS}V\x41\x00`; // full cut

        socket.write(Buffer.from(printData, 'binary'), () => {
          socket.end();
          resolve();
        });
      });
    });
  },
};
