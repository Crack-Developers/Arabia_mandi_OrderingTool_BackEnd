const mongoose = require('mongoose');
const Branch = require('./dist/models/Branch').default;
const Table = require('./dist/models/Table').default;
const Section = require('./dist/models/Section').default;

async function forceDeleteCatTables() {
  await mongoose.connect('mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0');
  
  // Find branch laak
  const branch = await Branch.findOne({ name: 'laak' });
  if (!branch) { console.log('Branch not found'); process.exit(0); }
  
  // Find section 'cat'
  let catIndex = -1;
  for (let i = 0; i < branch.sections.length; i++) {
    if (branch.sections[i].name === 'cat') {
      catIndex = i;
      break;
    }
  }
  
  if (catIndex > -1) {
    console.log(`Setting cat tablesCount to 0`);
    branch.sections[catIndex].tablesCount = 0;
    await branch.save();
  }
  
  // Delete all tables in cat section
  const res = await Table.deleteMany({ branchId: branch._id.toString(), sectionName: 'cat' });
  console.log(`Deleted ${res.deletedCount} cat tables from cloud DB`);
  
  // Delete all tables in got section if got-4 was supposed to be the only one deleted... wait, user said: "deleted the got-4 only"
  // Let's delete got-4 from cloud DB
  const resGot = await Table.deleteMany({ branchId: branch._id.toString(), sectionName: 'got', tableNumber: 'got-4' });
  console.log(`Deleted ${resGot.deletedCount} got-4 tables from cloud DB`);
  
  process.exit(0);
}

forceDeleteCatTables().catch(console.error);
