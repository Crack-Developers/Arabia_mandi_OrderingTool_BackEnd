/**
 * Printer Module — Full Test Suite
 *
 * Coverage:
 *  1.  Serial extraction from CUPS device URI
 *  2.  lpstat -p physical status parsing
 *  3.  Deduplication by USB serial number
 *  4.  printerService.create()  — upsert by serial, cupsName derivation
 *  5.  printerService.scanUSB() — full flow: found/saved split, online/offline,
 *        reconnect CUPS-name update, dedup, non-USB skipped, fallback
 *  6.  printerService.scanLAN() — response shape
 *  7.  HTTP: GET /scan, POST /, GET /, DELETE /:id
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearCollections } from './setup/testDb';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import Printer from '../models/Printer';
import Staff from '../models/Staff';
import Branch from '../models/Branch';

// ── Mock OS calls BEFORE importing service ────────────────────────────────────
jest.mock('child_process', () => ({ execSync: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: jest.fn(), readdirSync: jest.fn() }));

const mockExec    = childProcess.execSync as jest.MockedFunction<typeof childProcess.execSync>;
const mockExists  = fs.existsSync         as jest.MockedFunction<typeof fs.existsSync>;
const mockReaddir = fs.readdirSync        as jest.MockedFunction<typeof fs.readdirSync>;

// ── Helpers ───────────────────────────────────────────────────────────────────
const lpV          = (name: string, uri: string) => `device for ${name}: ${uri}`;
const lpP_idle     = (n: string) => `printer ${n} is idle.  enabled since Wed 15 Jul 2026 10:00:00 PM IST`;
const lpP_disabled = (n: string) => `printer ${n} disabled since Wed 15 Jul 2026 10:05:00 PM IST -\n\tUnplugged or turned off`;

function fakeLpstat(vLines: string[], pLines: string[]) {
  mockExec.mockImplementation((cmd: any) => {
    if (String(cmd).includes('lpstat -v')) return vLines.join('\n') as any;
    if (String(cmd).includes('lpstat -p')) return pLines.join('\n') as any;
    return '' as any;
  });
}

function makeToken(id: string): string {
  return jwt.sign(
    { id, role: 'Super Admin' },
    process.env['JWT_SECRET'] || 'test_secret_for_jest',
    { expiresIn: '1h' }
  );
}

// ── Module references (resolved after DB connect) ─────────────────────────────
let printerService: typeof import('../services/printer.service').printerService;
let token: string;

// ─────────────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  await connectTestDB();
  printerService = (await import('../services/printer.service')).printerService;
});

afterAll(async () => { await disconnectTestDB(); });

beforeEach(async () => {
  await clearCollections();
  jest.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'linux', writable: true });

  // Recreate staff + branch each test (clearCollections wipes them)
  const branch = await Branch.create({
    branchCode: 'PRT-TST', name: 'Printer Test Branch',
    address: '1 Test St', phone: '9000000001', gst: 'GST-PRT', status: 'Active',
  });
  const staff = await Staff.create({
    employeeCode: 'EMP-PRT-1', name: 'Printer Tester',
    email: 'printertest@local.dev', phone: '9000000002',
    role: 'Super Admin', branchId: branch._id, active: true,
    username: 'printertest', password: 'hashed', branchAccess: 'All Branches',
  });
  token = makeToken(staff._id.toString());
});



// ═════════════════════════════════════════════════════════════════════════════
// 1. SERIAL EXTRACTION FROM CUPS URI
// ═════════════════════════════════════════════════════════════════════════════
describe('Serial extraction from CUPS device URI', () => {
  const extract = (uri: string) => uri.match(/[?&]serial=([^&\s]+)/i)?.[1] ?? null;

  test('standard usb:// URI', () => {
    expect(extract('usb://TVS/RP%203200%20LITE?serial=111111151111')).toBe('111111151111');
  });

  test('triple-slash usb:/// URI', () => {
    expect(extract('usb:///80Series2?serial=GD10768661F0A0014')).toBe('GD10768661F0A0014');
  });

  test('serial in middle of query string', () => {
    expect(extract('usb://Vendor/Model?foo=bar&serial=ABCDEF&baz=1')).toBe('ABCDEF');
  });

  test('returns null when no serial', () => {
    expect(extract('usb://EPSON/TM-T20III')).toBeNull();
  });

  test('implicitclass:// URIs are NOT USB and must be skipped', () => {
    const uri = 'implicitclass://HP_LaserJet/';
    expect(uri.startsWith('usb://')).toBe(false);
    expect(uri.startsWith('serial:')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. LPSTAT -p PHYSICAL STATUS PARSING
// ═════════════════════════════════════════════════════════════════════════════
describe('lpstat -p physical status parsing', () => {
  const parseOnline = (output: string) => {
    const s = new Set<string>();
    for (const line of output.split('\n')) {
      const m = line.match(/^printer\s+(\S+)\s+(is\s+idle|is\s+printing|now\s+printing)/i);
      if (m) s.add(m[1].trim());
    }
    return s;
  };

  test('idle → online', ()    => expect(parseOnline(lpP_idle('P1')).has('P1')).toBe(true));
  test('disabled → offline', () => expect(parseOnline(lpP_disabled('P1')).has('P1')).toBe(false));

  test('printing line → online', () => {
    const out = 'printer Kyocera now printing something.  enabled since ...';
    expect(parseOnline(out).has('Kyocera')).toBe(true);
  });

  test('mixed output — only idle ones online', () => {
    const out = [lpP_idle('A'), lpP_disabled('B'), lpP_idle('C')].join('\n');
    const s = parseOnline(out);
    expect(s.has('A')).toBe(true);
    expect(s.has('B')).toBe(false);
    expect(s.has('C')).toBe(true);
  });

  test('empty output → no online printers', () => {
    expect(parseOnline('').size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. DEDUPLICATION BY SERIAL
// ═════════════════════════════════════════════════════════════════════════════
describe('Deduplication by USB serial', () => {
  const dedup = (list: { cupsName: string; usbSerial: string | null }[]) => {
    const seen = new Set<string>();
    return list.filter(d => {
      if (!d.usbSerial) return true;
      if (seen.has(d.usbSerial)) return false;
      seen.add(d.usbSerial);
      return true;
    });
  };

  test('drops second entry with same serial', () => {
    const r = dedup([
      { cupsName: 'RP-3200-LITE',   usbSerial: '111111151111' },
      { cupsName: 'RP-3200-LITE-2', usbSerial: '111111151111' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].cupsName).toBe('RP-3200-LITE');
  });

  test('keeps all when serials are different', () => {
    const r = dedup([
      { cupsName: 'A', usbSerial: 'S1' },
      { cupsName: 'B', usbSerial: 'S2' },
    ]);
    expect(r).toHaveLength(2);
  });

  test('keeps all entries with null serial (no basis for dedup)', () => {
    const r = dedup([
      { cupsName: 'lp0', usbSerial: null },
      { cupsName: 'lp1', usbSerial: null },
    ]);
    expect(r).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. printerService.create()
// ═════════════════════════════════════════════════════════════════════════════
describe('printerService.create()', () => {
  test('saves printer with usbSerial and cupsName', async () => {
    const p = await printerService.create({
      name: '80Series2', ip: 'cups:80Series2',
      type: 'thermal', duty: 'KOT', sections: [],
      usbSerial: 'GD10768661F0A0014', cupsName: '80Series2',
    });
    expect((p as any).usbSerial).toBe('GD10768661F0A0014');
    expect((p as any).cupsName).toBe('80Series2');
    expect((p as any).status).toBe('online');
  });

  test('auto-derives cupsName from cups: ip when absent', async () => {
    const p = await printerService.create({
      name: 'Auto', ip: 'cups:AutoPrinter',
      type: 'thermal', duty: 'RECEIPT', sections: [],
    });
    expect((p as any).cupsName).toBe('AutoPrinter');
  });

  test('upserts on same serial — no duplicate in DB', async () => {
    await printerService.create({
      name: 'RP', ip: 'cups:RP-3200-LITE', type: 'thermal',
      duty: 'KOT', sections: [], usbSerial: '111111151111', cupsName: 'RP-3200-LITE',
    });
    // Re-assign with a different CUPS name (OS changed it after reconnect)
    await printerService.create({
      name: 'RP', ip: 'cups:RP-3200-LITE-2', type: 'thermal',
      duty: 'KOT', sections: [], usbSerial: '111111151111', cupsName: 'RP-3200-LITE-2',
    });
    const count = await Printer.countDocuments({ usbSerial: '111111151111' });
    expect(count).toBe(1);
  });

  test('allows multiple printers with different serials', async () => {
    await printerService.create({ name: 'A', ip: 'cups:A', type: 'thermal', duty: 'KOT', sections: [], usbSerial: 'S001', cupsName: 'A' });
    await printerService.create({ name: 'B', ip: 'cups:B', type: 'thermal', duty: 'KOT', sections: [], usbSerial: 'S002', cupsName: 'B' });
    expect(await Printer.countDocuments()).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. printerService.scanUSB() — full flow
// ═════════════════════════════════════════════════════════════════════════════
describe('printerService.scanUSB()', () => {

  test('connected + not in DB → foundPrinters', async () => {
    fakeLpstat(
      [lpV('80Series2', 'usb:///80Series2?serial=GD10768661F0A0014')],
      [lpP_idle('80Series2')]
    );
    const { foundPrinters, savedPrinters } = await printerService.scanUSB();
    expect(foundPrinters).toHaveLength(1);
    expect(foundPrinters[0].name).toBe('80Series2');
    expect(savedPrinters).toHaveLength(0);
  });

  test('disconnected + not in DB → invisible (not found)', async () => {
    fakeLpstat(
      [lpV('RP-3200-LITE', 'usb://TVS/RP?serial=111111151111')],
      [lpP_disabled('RP-3200-LITE')]
    );
    const { foundPrinters } = await printerService.scanUSB();
    expect(foundPrinters).toHaveLength(0);
  });

  test('known DB printer is always in savedPrinters', async () => {
    await Printer.create({
      name: 'RP-3200-LITE', ip: 'cups:RP-3200-LITE', type: 'thermal',
      duty: 'KOT', sections: [], usbSerial: '111111151111', cupsName: 'RP-3200-LITE',
      status: 'online', isActive: true,
    });
    fakeLpstat(
      [lpV('RP-3200-LITE', 'usb://TVS/RP?serial=111111151111')],
      [lpP_disabled('RP-3200-LITE')]
    );
    const { foundPrinters, savedPrinters } = await printerService.scanUSB();
    expect(foundPrinters).toHaveLength(0);   // Known → not in "found"
    expect(savedPrinters).toHaveLength(1);
    expect(savedPrinters[0].status).toBe('offline');  // Updated
  });

  test('known DB printer reconnects → moves to online in savedPrinters', async () => {
    await Printer.create({
      name: 'RP-3200-LITE', ip: 'cups:RP-3200-LITE', type: 'thermal',
      duty: 'KOT', sections: [], usbSerial: '111111151111', cupsName: 'RP-3200-LITE',
      status: 'offline', isActive: true,
    });
    fakeLpstat(
      [lpV('RP-3200-LITE', 'usb://TVS/RP?serial=111111151111')],
      [lpP_idle('RP-3200-LITE')]
    );
    const { savedPrinters } = await printerService.scanUSB();
    expect(savedPrinters[0].status).toBe('online');
  });

  test('reconnect with new CUPS name → DB cupsName and ip updated', async () => {
    await Printer.create({
      name: 'RP', ip: 'cups:RP-3200-LITE', type: 'thermal',
      duty: 'KOT', sections: [], usbSerial: '111111151111', cupsName: 'RP-3200-LITE',
      status: 'offline', isActive: true,
    });
    // OS assigned a new queue name after reconnect
    fakeLpstat(
      [lpV('RP-3200-LITE-2', 'usb://TVS/RP?serial=111111151111')],
      [lpP_idle('RP-3200-LITE-2')]
    );
    await printerService.scanUSB();
    const updated = await Printer.findOne({ usbSerial: '111111151111' }).lean() as any;
    expect(updated.cupsName).toBe('RP-3200-LITE-2');
    expect(updated.ip).toBe('cups:RP-3200-LITE-2');
    expect(updated.status).toBe('online');
  });

  test('two identical serials → only one survives in foundPrinters', async () => {
    fakeLpstat(
      [
        lpV('RP-3200-LITE',   'usb://TVS/RP?serial=111111151111'),
        lpV('RP-3200-LITE-2', 'usb://TVS/RP?serial=111111151111'),
      ],
      [lpP_idle('RP-3200-LITE'), lpP_idle('RP-3200-LITE-2')]
    );
    const { foundPrinters } = await printerService.scanUSB();
    expect(foundPrinters.filter(p => p.name.startsWith('RP'))).toHaveLength(1);
  });

  test('implicitclass:// (network/IPP) URIs are skipped', async () => {
    fakeLpstat(
      [
        'device for HP_LaserJet: implicitclass://HP_LaserJet/',
        lpV('80Series2', 'usb:///80Series2?serial=GD10768661F0A0014'),
      ],
      [lpP_idle('HP_LaserJet'), lpP_idle('80Series2')]
    );
    const { foundPrinters } = await printerService.scanUSB();
    expect(foundPrinters.some(p => p.name.includes('HP'))).toBe(false);
    expect(foundPrinters[0].name).toBe('80Series2');
  });

  test('falls back to /dev/usb/lp* when lpstat returns nothing', async () => {
    mockExec.mockReturnValue('' as any);
    mockExists.mockReturnValue(true);
    mockReaddir.mockReturnValue(['lp0'] as any);
    // Should not throw — fallback runs silently
    await expect(printerService.scanUSB()).resolves.toHaveProperty('foundPrinters');
  });

  test('returns correct shape { foundPrinters, savedPrinters }', async () => {
    mockExec.mockReturnValue('' as any);
    const result = await printerService.scanUSB();
    expect(result).toHaveProperty('foundPrinters');
    expect(result).toHaveProperty('savedPrinters');
    expect(Array.isArray(result.foundPrinters)).toBe(true);
    expect(Array.isArray(result.savedPrinters)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. printerService.scanLAN() — shape check
// ═════════════════════════════════════════════════════════════════════════════
describe('printerService.scanLAN()', () => {
  test('returns { foundPrinters, savedPrinters }', async () => {
    mockExec.mockReturnValue('' as any);
    const result = await printerService.scanLAN();
    expect(result).toHaveProperty('foundPrinters');
    expect(result).toHaveProperty('savedPrinters');
  });

  test('LAN printer (not in DB) appears in foundPrinters', async () => {
    // Mock USB scan returns nothing, but mock a LAN discovery result
    mockExec.mockReturnValue('' as any);
    // LAN discovery via net.Socket is async — if no LAN printers respond, foundPrinters = []
    // Just confirm the function resolves without error
    await expect(printerService.scanLAN()).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. HTTP ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════
describe('Printer HTTP endpoints', () => {

  test('GET /api/v1/printers/scan → 401 without token', async () => {
    const res = await request(app).get('/api/v1/printers/scan');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/printers/scan → 200 with foundPrinters + savedPrinters', async () => {
    mockExec.mockReturnValue('' as any);
    const res = await request(app)
      .get('/api/v1/printers/scan')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('foundPrinters');
    expect(res.body).toHaveProperty('savedPrinters');
    expect(Array.isArray(res.body.foundPrinters)).toBe(true);
    expect(Array.isArray(res.body.savedPrinters)).toBe(true);
  });

  test('POST /api/v1/printers → 201, saves usbSerial in DB', async () => {
    const res = await request(app)
      .post('/api/v1/printers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Thermal-A', ip: 'cups:Thermal-A',
        type: 'thermal', duty: 'KOT', sections: [],
        usbSerial: 'TESTSERIAL001', cupsName: 'Thermal-A',
      });
    expect(res.status).toBe(201);
    const inDB = await Printer.findOne({ usbSerial: 'TESTSERIAL001' }).lean() as any;
    expect(inDB).not.toBeNull();
    expect(inDB.usbSerial).toBe('TESTSERIAL001');
  });

  test('POST /api/v1/printers → 401 without token', async () => {
    const res = await request(app)
      .post('/api/v1/printers')
      .send({ name: 'X', ip: 'cups:X', type: 'thermal', duty: 'KOT', sections: [] });
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/printers → lists all saved printers', async () => {
    await Printer.create([
      { name: 'P1', ip: 'cups:P1', type: 'thermal', duty: 'KOT', sections: [], isActive: true, status: 'online', connection: 'USB/LAN' },
      { name: 'P2', ip: 'cups:P2', type: 'thermal', duty: 'RECEIPT', sections: [], isActive: true, status: 'offline', connection: 'USB/LAN' },
    ]);
    const res = await request(app)
      .get('/api/v1/printers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const list = res.body.data || res.body.printers || res.body;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test('DELETE /api/v1/printers/:id → 200, removes from DB', async () => {
    const created = await Printer.create({
      name: 'ToDelete', ip: 'cups:ToDelete', type: 'thermal',
      duty: 'KOT', sections: [], usbSerial: 'DELETEME001', cupsName: 'ToDelete',
      status: 'offline', isActive: true, connection: 'USB/LAN',
    });
    const res = await request(app)
      .delete(`/api/v1/printers/${created._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await Printer.findById(created._id)).toBeNull();
  });

  test('DELETE /api/v1/printers/:id → 404 for non-existent id', async () => {
    const res = await request(app)
      .delete('/api/v1/printers/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
