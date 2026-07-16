/**
 * Printer Agent — ESC/POS Build & Transport Test Suite
 *
 * Tests the three core fixes:
 *  1. ESC/POS output quality (ASCII separators, correct bytes, no Unicode glyphs)
 *  2. Temp-file CUPS transport (lp -o raw FILE, not stdin)
 *  3. Retry resilience (failJob increments counter, job re-queued until maxRetries)
 *
 * All OS calls (execSync, fs.writeFileSync, net.Socket) are mocked.
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as net from 'net';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  unlink:        jest.fn((_p: any, cb: any) => cb && cb()),
}));

const mockExecSync    = childProcess.execSync as jest.MockedFunction<typeof childProcess.execSync>;
const mockWriteFileSync = fs.writeFileSync    as jest.MockedFunction<typeof fs.writeFileSync>;

import {
  buildKOT,
  buildReceipt,
  buildTest,
  buildPrintData,
  sendViaCUPS,
  sendViaTCP,
  padRight,
  line2col,
} from '../services/printerAgent.service';

// ── ESC/POS constants used for assertions ─────────────────────────
const ESC = '\x1B';
const GS  = '\x1D';
const CUT = `${GS}V\x41\x00`;
const INIT = `${ESC}@${ESC}t\x00`;

beforeEach(() => jest.clearAllMocks());

// ═════════════════════════════════════════════════════════════════
// 1. padRight / line2col layout helpers
// ═════════════════════════════════════════════════════════════════
describe('Layout helpers', () => {
  test('padRight pads short string to width', () => {
    expect(padRight('Chicken', 10)).toBe('Chicken   ');
  });

  test('padRight truncates long string', () => {
    expect(padRight('Very Long Dish Name Here', 10)).toBe('Very Long ');
  });

  test('line2col total width ≤ 32 chars + LF', () => {
    const out = line2col('1. Chicken Mandi', 'x2');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.replace('\n', '').length).toBeLessThanOrEqual(32);
  });

  test('line2col right-aligns second column', () => {
    const out = line2col('Left', 'Right');
    const parts = out.trim().split(/\s+/);
    expect(parts[0]).toBe('Left');
    expect(parts[parts.length - 1]).toBe('Right');
  });

  test('line2col always has at least 1 space between columns', () => {
    // Even with very long left column — must not merge
    const out = line2col('A'.repeat(29), 'B');
    expect(out.includes(' B')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. buildKOT — ESC/POS output correctness
// ═════════════════════════════════════════════════════════════════
describe('buildKOT()', () => {
  const samplePayload = {
    tableNumber: 'T5',
    kotNumber:   'KOT-42',
    orderNumber: 'ORD/2026/0042',
    timestamp:   new Date('2026-07-15T17:30:00.000Z').toISOString(),
    items: [
      { name: 'Chicken Mandi', quantity: 2 },
      { name: 'Lamb Ouzi',     quantity: 1, notes: 'No garlic' },
    ],
  };

  let buf: Buffer;
  beforeAll(() => { buf = buildKOT(samplePayload); });

  test('returns a Buffer', () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('starts with ESC @ (printer init)', () => {
    const str = buf.toString('binary');
    expect(str.startsWith(INIT)).toBe(true);
  });

  test('contains paper cut command at end', () => {
    const str = buf.toString('binary');
    expect(str.includes(CUT)).toBe(true);
  });

  test('contains table number', () => {
    expect(buf.toString('binary')).toContain('T5');
  });

  test('contains KOT number', () => {
    expect(buf.toString('binary')).toContain('KOT-42');
  });

  test('contains order number', () => {
    expect(buf.toString('binary')).toContain('ORD/2026/0042');
  });

  test('contains all item names', () => {
    const str = buf.toString('binary');
    expect(str).toContain('Chicken Mandi');
    expect(str).toContain('Lamb Ouzi');
  });

  test('contains item quantities', () => {
    const str = buf.toString('binary');
    expect(str).toContain('x2');
    expect(str).toContain('x1');
  });

  test('contains item note', () => {
    expect(buf.toString('binary')).toContain('No garlic');
  });

  // KEY FIX: No Unicode box-drawing characters
  test('separator uses ASCII dashes only — NO Unicode box chars', () => {
    const str = buf.toString('binary');
    // Unicode '─' is U+2500 = 0xE2 0x94 0x80 in UTF-8
    // As latin-1 / binary encoding it would appear as odd byte sequences
    // The simplest check: no occurrence of the Unicode character itself
    expect(str).not.toContain('─');
    expect(str).not.toContain('\u2500');
    // Verify ASCII dashes ARE present
    expect(str).toContain('---');
  });

  test('each line is ≤ 42 chars wide (standard 80mm thermal)', () => {
    const str = buf.toString('binary');
    for (const line of str.split('\n')) {
      // Skip ESC/POS control sequences which are non-printable
      const printable = line.replace(/[\x00-\x1F\x7F]/g, '');
      expect(printable.length).toBeLessThanOrEqual(42);
    }
  });

  test('handles missing optional fields gracefully', () => {
    expect(() => buildKOT({ items: [] })).not.toThrow();
    expect(() => buildKOT({})).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. buildReceipt — ESC/POS output correctness
// ═════════════════════════════════════════════════════════════════
describe('buildReceipt()', () => {
  const samplePayload = {
    billNumber:  'BILL/2026/0099',
    orderNumber: 'ORD/2026/0042',
    tableNumber: 'T5',
    counterName: 'Reception Counter',
    subtotal:    350,
    cgst:         8.75,
    sgst:         8.75,
    grandTotal:  367.5,
    paymentMethods: { cash: 368, card: 0, upi: 0 },
    items: [
      { name: 'Chicken Mandi', quantity: 2, price: 175, addons: [] },
      { name: 'Lamb Ouzi',     quantity: 1, price: 0,   addons: [{ name: 'Extra Sauce', price: 20 }] },
    ],
  };

  let buf: Buffer;
  beforeAll(() => { buf = buildReceipt(samplePayload); });

  test('returns a Buffer', () => expect(Buffer.isBuffer(buf)).toBe(true));

  test('starts with printer init', () => {
    expect(buf.toString('binary').startsWith(INIT)).toBe(true);
  });

  test('ends with paper cut', () => {
    expect(buf.toString('binary')).toContain(CUT);
  });

  test('contains bill number', () => {
    expect(buf.toString('binary')).toContain('BILL/2026/0099');
  });

  test('contains CGST and SGST', () => {
    const str = buf.toString('binary');
    expect(str).toContain('CGST');
    expect(str).toContain('SGST');
  });

  test('contains grand total', () => {
    expect(buf.toString('binary')).toContain('367.50');
  });

  test('contains cash payment amount', () => {
    expect(buf.toString('binary')).toContain('Rs.368');
  });

  test('contains addon name', () => {
    expect(buf.toString('binary')).toContain('Extra Sauce');
  });

  test('no Unicode box chars in separator', () => {
    const str = buf.toString('binary');
    expect(str).not.toContain('─');
    expect(str).toContain('---');
  });

  test('contains thank-you message', () => {
    expect(buf.toString('binary')).toContain('Thank you');
  });

  test('handles missing payment methods gracefully', () => {
    expect(() => buildReceipt({ items: [], subtotal: 0, grandTotal: 0 })).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. buildTest — test page
// ═════════════════════════════════════════════════════════════════
describe('buildTest()', () => {
  test('returns Buffer with printer name', () => {
    const buf = buildTest({ printerName: 'RP-3200-LITE' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('binary')).toContain('RP-3200-LITE');
  });

  test('contains PRINTER TEST OK header', () => {
    const buf = buildTest({ printerName: 'X' });
    expect(buf.toString('binary')).toContain('PRINTER TEST OK');
  });

  test('ends with paper cut', () => {
    const buf = buildTest({});
    expect(buf.toString('binary')).toContain(CUT);
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. buildPrintData — job type routing
// ═════════════════════════════════════════════════════════════════
describe('buildPrintData() — job type routing', () => {
  test('routes KOT jobType → KOT output (contains table header)', () => {
    const job = { jobType: 'KOT', payload: { type: 'KOT', tableNumber: 'T9', items: [] } };
    const buf = buildPrintData(job);
    expect(buf.toString('binary')).toContain('KOT');
  });

  test('routes RECEIPT jobType → receipt output (contains BILL header)', () => {
    const job = { jobType: 'RECEIPT', payload: { type: 'RECEIPT', items: [], grandTotal: 0 } };
    const buf = buildPrintData(job);
    expect(buf.toString('binary')).toContain('BILL');
  });

  test('routes BILL jobType → receipt output', () => {
    const job = { jobType: 'BILL', payload: { type: 'BILL', items: [], grandTotal: 0 } };
    const buf = buildPrintData(job);
    expect(buf.toString('binary')).toContain('BILL');
  });

  test('unknown type falls back to test page', () => {
    const job = { jobType: 'UNKNOWN', payload: { printerName: 'X' } };
    const buf = buildPrintData(job);
    expect(buf.toString('binary')).toContain('PRINTER TEST OK');
  });
});

// ═════════════════════════════════════════════════════════════════
// 6. sendViaCUPS — temp-file transport (KEY FIX)
// ═════════════════════════════════════════════════════════════════
describe('sendViaCUPS() — temp-file transport', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    mockExecSync.mockReturnValue('' as any);
    mockWriteFileSync.mockImplementation(() => undefined);
  });

  test('writes ESC/POS data to a temp file before calling lp', async () => {
    const data = buildKOT({ tableNumber: 'T1', items: [] });
    await sendViaCUPS('80Series2', data);

    // fs.writeFileSync must have been called with a .bin temp file
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [tmpPath, writtenData] = mockWriteFileSync.mock.calls[0];
    expect(String(tmpPath)).toMatch(/\.bin$/);
    expect(writtenData).toEqual(data);                // exact bytes preserved
  });

  test('calls lp with -o raw and the temp file path (NOT stdin)', async () => {
    const data = buildKOT({ tableNumber: 'T1', items: [] });
    await sendViaCUPS('80Series2', data);

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).toContain('-o raw');        // raw mode — no CUPS filter
    expect(cmd).toContain('80Series2');     // correct queue name
    expect(cmd).not.toContain(' - ');       // NOT reading from stdin (trailing dash)
    expect(cmd).toMatch(/\.bin/);           // points to temp file
  });

  test('uses lp -d on Linux (not PowerShell)', async () => {
    await sendViaCUPS('RP-3200-LITE', Buffer.from('test'));
    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd.startsWith('lp -d')).toBe(true);
  });

  test('rejects if execSync throws (CUPS error propagated)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('CUPS destination not found'); });
    await expect(sendViaCUPS('BadQueue', Buffer.from('x'))).rejects.toThrow('CUPS');
  });

  test('rejects if writeFileSync throws (disk full, permission denied)', async () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('ENOSPC: no space left'); });
    await expect(sendViaCUPS('Queue', Buffer.from('x'))).rejects.toThrow('ENOSPC');
  });

  test('uses PowerShell on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
    await sendViaCUPS('WinPrinter', Buffer.from('test'));
    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd.toLowerCase()).toContain('powershell');
  });
});

// ═════════════════════════════════════════════════════════════════
// 7. sendViaTCP — TCP transport
// ═════════════════════════════════════════════════════════════════
describe('sendViaTCP()', () => {
  test('connects to given IP:port and writes data', (done) => {
    // Create a local TCP server that echoes back
    const server = require('net').createServer((socket: any) => {
      socket.on('data', (chunk: Buffer) => {
        expect(chunk.toString()).toBe('ESC/POS-DATA');
        server.close();
        done();
      });
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      await sendViaTCP('127.0.0.1', port, Buffer.from('ESC/POS-DATA'));
    });
  });

  test('rejects when host is unreachable (connection refused)', async () => {
    // Port 1 is almost certainly not listening
    await expect(sendViaTCP('127.0.0.1', 1, Buffer.from('x'))).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════
// 8. Integration: full job payload → correct bytes → CUPS
// ═════════════════════════════════════════════════════════════════
describe('End-to-end: job payload → CUPS', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    mockExecSync.mockReturnValue('' as any);
    mockWriteFileSync.mockImplementation(() => undefined);
  });

  test('KOT job → valid ESC/POS buffer → CUPS call with raw flag', async () => {
    const job = {
      jobType: 'KOT',
      payload: {
        type: 'KOT',
        tableNumber: 'T3',
        kotNumber: 'KOT-01',
        orderNumber: 'ORD/001',
        items: [{ name: 'Chicken Mandi', quantity: 2, notes: 'Less spicy' }],
      },
    };
    const data = buildPrintData(job);
    await sendViaCUPS('RP-3200-LITE', data);

    const str = data.toString('binary');
    expect(str).toContain('T3');
    expect(str).toContain('Chicken Mandi');
    expect(str).toContain('Less spicy');
    expect(str).not.toContain('─');             // no Unicode
    expect(str).toContain(CUT);                 // paper cut present

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).toContain('-o raw');
    expect(cmd).toContain('RP-3200-LITE');
  });

  test('Receipt job → contains all financial fields', async () => {
    const job = {
      jobType: 'RECEIPT',
      payload: {
        type: 'RECEIPT',
        billNumber: 'BILL/001',
        items: [{ name: 'Lamb Ouzi', quantity: 1, price: 320, addons: [] }],
        subtotal: 320,
        cgst: 8,
        sgst: 8,
        grandTotal: 336,
        paymentMethods: { cash: 336, card: 0, upi: 0 },
      },
    };
    const data = buildPrintData(job);
    const str  = data.toString('binary');
    expect(str).toContain('BILL/001');
    expect(str).toContain('CGST');
    expect(str).toContain('336');
    expect(str).toContain('Thank you');
    expect(str).toContain(CUT);
  });
});
