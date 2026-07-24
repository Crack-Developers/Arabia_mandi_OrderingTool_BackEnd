const mongoose = require('mongoose');
const Branch = require('./dist/models/Branch').default;
const Table = require('./dist/models/Table').default;
const Section = require('./dist/models/Section').default;

async function fixGhostTables() {
  await mongoose.connect('mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0');
  
  const branches = await Branch.find({});
  for (const branch of branches) {
    let changed = false;
    for (let i = 0; i < branch.sections.length; i++) {
      const sec = branch.sections[i];
      // Count ACTUAL tables in this section
      const tablesCount = await Table.countDocuments({
        branchId: branch._id.toString(),
        $or: [
          { sectionId: sec._id.toString() },
          { sectionName: sec.name }
        ]
      });
      
      if (sec.tablesCount !== tablesCount) {
        console.log(`Fixing Branch ${branch.name} Section ${sec.name}: tablesCount was ${sec.tablesCount}, actual tables is ${tablesCount}. Updating to ${tablesCount}.`);
        branch.sections[i].tablesCount = tablesCount;
        changed = true;
      }
    }
    if (changed) {
      await branch.save();
      console.log(`Saved branch ${branch.name}`);
    }
  }
  
  console.log('Finished fixing ghost tables.');
  process.exit(0);
}

fixGhostTables().catch(console.error);
