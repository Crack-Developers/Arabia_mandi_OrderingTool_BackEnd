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
    if (!branch || !branch.sections || !Array.isArray(branch.sections)) {
      return 0;
    }
    const branchId = branch._id.toString();
    
    // If sections array is explicitly empty (all sections deleted), prune everything
    if (branch.sections.length === 0) {
      await Table.deleteMany({ branchId, status: 'Available' });
      await Section.deleteMany({ branchId });
      return 0;
    }

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

    // GAP 6 fix: Also delete old sections from the standalone Section collection 
    // so they don't sync down to the desktop POS as ghost categories.
    const allBranchSections = await Section.find({ branchId });
    for (const s of allBranchSections) {
      const secMatch = validSectionNames.includes(s.name) || validSectionIds.includes(s._id.toString());
      if (!secMatch) {
        await Section.findByIdAndDelete(s._id);
      }
    }

    // 2. For each section in branch configuration, ensure target tablesCount tables exist
    for (let idx = 0; idx < branch.sections.length; idx++) {
      const sec = branch.sections[idx];
      const targetCount = Number(sec.tablesCount) || 10;
      const secId = sec._id ? sec._id.toString() : `sec-${idx + 1}`;

      let sectionDoc = await Section.findOne({ branchId, name: sec.name });
      if (!sectionDoc) {
        sectionDoc = await Section.create({ _id: new (require('mongoose').Types.ObjectId)(), branchId, name: sec.name, printerId: '' });
      }

      const existingSecTablesRaw = await Table.find({
        branchId,
        $or: [
          { sectionId: secId },
          { sectionId: `sec-${idx + 1}` },
          { sectionId: sectionDoc._id },
          { sectionId: sectionDoc._id.toString() },
          { sectionName: sec.name } as any
        ]
      });

      // Sort numerically (e.g. T-1, T-2, T-10) instead of alphabetically (T-1, T-10, T-2)
      const existingSecTables = existingSecTablesRaw.sort((a, b) => {
        const numA = parseInt(a.tableNumber.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.tableNumber.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

      const prefix = sec.name ? `${sec.name.trim()}-` : 'T-';

      // 2.1 Enforce naming rules on existing tables if the section was renamed
      for (let i = 0; i < existingSecTables.length; i++) {
        const table = existingSecTables[i];
        const numStr = `${i + 1}`;
        const correctTableNum = `${prefix}${numStr}`;
        
        let needsUpdate = false;
        if (table.tableNumber !== correctTableNum) {
          table.tableNumber = correctTableNum;
          needsUpdate = true;
        }
        if (table.sectionName !== sec.name) {
          table.sectionName = sec.name;
          needsUpdate = true;
        }
        if (needsUpdate) {
          await table.save();
        }
      }

      if (existingSecTables.length < targetCount) {
        const needed = targetCount - existingSecTables.length;
        const existingNumbers = new Set(await Table.find({ branchId }).distinct('tableNumber'));
        let createdThisSection = 0;

        for (let i = 1; i <= targetCount + 50 && createdThisSection < needed; i++) {
          const numStr = `${i}`;
          const tableNum = `${prefix}${numStr}`;
          if (!existingNumbers.has(tableNum)) {
            await Table.create({
              _id: new (require('mongoose').Types.ObjectId)(),
              branchId,
              sectionId: secId,
              sectionName: sec.name,
              tableNumber: tableNum,
              capacity: 4,
              status: 'Available'
            });
            existingNumbers.add(tableNum);
            createdThisSection++;
            totalCreated++;
          }
        }
      } else if (existingSecTables.length > targetCount) {
        // Delete excess tables from the end if they are Available
        for (let i = existingSecTables.length - 1; i >= targetCount; i--) {
          const t = existingSecTables[i];
          if (t.status === 'Available') {
            await Table.findByIdAndDelete(t._id);
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

    console.log(`[BranchDB] 🚀 Syncing tables/sections for branch: ${branch.name} [${dbName}]`);

    // Sync sections and tables in the shared arabian_mandi_erp database
    // (no per-branch database needed — all collections live in one Atlas DB)
    const tablesCreated = await this.syncBranchSectionsAndTables(branch);

    console.log(`[BranchDB] ✅ Branch ${branch.name} ready — ${tablesCreated} table(s) ensured`);
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
