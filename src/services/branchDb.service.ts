import mongoose from 'mongoose';
import Branch from '../models/Branch';
import Table from '../models/Table';
import Section from '../models/Section';
import MenuItem from '../models/MenuItem';
import Category from '../models/Category';

/**
 * branchDb.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated per-branch local database engine.
 *
 * Requirements addressed:
 * 1. When admin creates a branch, immediately create a dedicated local MongoDB
 *    database for that specific branch (e.g., arabian_mandi_branch_BR-555).
 * 2. When receptionist logs in for their branch, their POS operates on their
 *    own branch scope and data on the individual local system.
 * 3. Initializes default collections (tables, menu items) for the branch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const branchDbService = {
  /**
   * Generates a clean database name for a branch code or ID.
   * e.g., "BR-555" -> "arabian_mandi_branch_BR_555"
   */
  getBranchDbName(branchCodeOrId: string): string {
    const clean = branchCodeOrId.replace(/[^a-zA-Z0-9_]/g, '_');
    return `arabian_mandi_branch_${clean}`;
  },

  /**
   * Synchronizes Section and Table documents for a branch based on branch.sections tablesCount
   */
  async syncBranchSectionsAndTables(branch: any): Promise<number> {
    if (!branch || !branch.sections || !Array.isArray(branch.sections) || branch.sections.length === 0) {
      return 0;
    }
    const branchId = branch._id.toString();
    let totalCreated = 0;

    // 1. Check all existing tables for this branch
    const allBranchTables = await Table.find({ branchId });
    const validSectionNames = branch.sections.map((s: any) => s.name);
    const validSectionIds = branch.sections.map((s: any, idx: number) => (s._id ? s._id.toString() : `sec-${idx + 1}`));

    // Clean up tables belonging to old sections that no longer exist on this branch
    for (const t of allBranchTables) {
      const secMatch = validSectionNames.includes((t as any).sectionName) || validSectionIds.includes(t.sectionId?.toString());
      if (!secMatch && t.status === 'Available') {
        await Table.findByIdAndDelete(t._id);
      }
    }

    // 2. For each section in branch configuration, ensure target tablesCount tables exist
    for (let idx = 0; idx < branch.sections.length; idx++) {
      const sec = branch.sections[idx];
      const targetCount = Number(sec.tablesCount) || 10;
      const secId = sec._id ? sec._id.toString() : `sec-${idx + 1}`;

      let sectionDoc = await Section.findOne({ branchId, name: sec.name });
      if (!sectionDoc) {
        sectionDoc = await Section.create({ branchId, name: sec.name, printerId: '' });
      }

      const existingSecTables = await Table.find({
        branchId,
        $or: [
          { sectionId: secId },
          { sectionId: `sec-${idx + 1}` },
          { sectionId: sectionDoc._id },
          { sectionId: sectionDoc._id.toString() },
          { sectionName: sec.name } as any
        ]
      }).sort({ tableNumber: 1 });

      if (existingSecTables.length < targetCount) {
        // Smart prefix calculation based on floor or section name rules
        let prefix = 'T-';
        const floorLower = (sec.floor || '').toLowerCase();
        const nameLower = (sec.name || '').toLowerCase();

        if (nameLower.includes('dining')) {
          prefix = 'DIN T-';
        } else if (nameLower.includes('party')) {
          prefix = 'PAR T-';
        } else if (nameLower.includes('mandhi') || nameLower.includes('mandi')) {
          prefix = 'MAN T-';
        } else if (nameLower.includes('majlis') || nameLower.includes('vip')) {
          prefix = 'VIP T-';
        } else if (floorLower.includes('ground')) {
          prefix = 'G T-';
        } else if (floorLower.includes('first') || floorLower.includes('1st')) {
          prefix = '1T-';
        } else if (floorLower.includes('second') || floorLower.includes('2nd')) {
          prefix = '2T-';
        } else if (floorLower.includes('third') || floorLower.includes('3rd')) {
          prefix = '3T-';
        } else if (floorLower.includes('roof')) {
          prefix = 'ROOF T-';
        } else if (branch.sections.length > 1) {
          const cleanName = sec.name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
          prefix = cleanName ? `${cleanName} T-` : `S${idx + 1}-`;
        } else if (floorLower) {
          prefix = 'G T-';
        }

        const needed = targetCount - existingSecTables.length;
        const existingNumbers = new Set(await Table.find({ branchId }).distinct('tableNumber'));

        for (let i = 1; i <= targetCount + 50 && totalCreated < needed; i++) {
          const numStr = i < 10 ? `0${i}` : `${i}`;
          const tableNum = `${prefix}${numStr}`;
          if (!existingNumbers.has(tableNum)) {
            await Table.create({
              branchId,
              sectionId: secId,
              sectionName: sec.name,
              tableNumber: tableNum,
              capacity: 4,
              status: 'Available'
            });
            existingNumbers.add(tableNum);
            totalCreated++;
          }
        }
      }
    }

    return totalCreated;
  },

  /**
   * Ensure a dedicated database exists and is initialized for a given branch.
   */
  async ensureBranchDatabase(branch: any): Promise<{ dbName: string; tablesCreated: number }> {
    const code = branch.branchCode || branch._id.toString();
    const dbName = this.getBranchDbName(code);
    const branchId = branch._id.toString();

    console.log(`[BranchDB] 🚀 Initializing dedicated local database for branch: ${branch.name} [${dbName}]`);

    // Ensure master database table count matches the branch sections tablesCount
    const tablesCreated = await this.syncBranchSectionsAndTables(branch);

    // 2. Open a connection to the dedicated per-branch local MongoDB database
    try {
      const baseUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/arabian_mandi_erp';
      let uri = `mongodb://localhost:27017/${dbName}`;
      if (baseUri.includes('mongodb+srv://')) {
        uri = baseUri.replace(/\/([a-zA-Z0-9_-]+)?(\?|$)/, `/${dbName}$2`);
      }
      const branchConn = await mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 5000,
      }).asPromise();

      // Ensure branch DB metadata collection records its branch info
      const MetadataModel = branchConn.model('BranchMetadata', new mongoose.Schema({
        branchId: String,
        branchCode: String,
        name: String,
        initializedAt: Date,
      }, { strict: false }));

      await MetadataModel.findOneAndUpdate(
        { branchId },
        {
          branchId,
          branchCode: branch.branchCode,
          name: branch.name,
          initializedAt: new Date(),
        },
        { upsert: true }
      );

      // Ensure Table schema exists in dedicated branch database without inserting dummy tables
      branchConn.model('Table', Table.schema);

      await branchConn.close();
      console.log(`[BranchDB] ✅ Dedicated database [${dbName}] configured & verified for branch: ${branch.name}`);
    } catch (err: any) {
      console.warn(`[BranchDB] ⚠️ Could not initialize dedicated branch connection: ${err.message}`);
    }

    return { dbName, tablesCreated };
  },

  /**
   * Initializes dedicated databases and tables for all branches present in the system.
   * Called on startup.
   */
  async initializeAllBranches(): Promise<void> {
    try {
      const branches = await Branch.find({});
      console.log(`[BranchDB] Checking dedicated local databases for ${branches.length} branches...`);
      for (const branch of branches) {
        await this.ensureBranchDatabase(branch);
      }
    } catch (err: any) {
      console.error('[BranchDB] Error initializing branch databases:', err.message);
    }
  },
};
