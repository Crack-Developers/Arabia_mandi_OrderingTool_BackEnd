const mongoose = require('mongoose');
const Branch = require('./dist/models/Branch').default;
const Table = require('./dist/models/Table').default;

async function printTables() {
  await mongoose.connect('mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0');
  const branch = await Branch.findOne({ name: 'laak' });
  const tables = await Table.find({ branchId: branch._id.toString() });
  console.log('Tables for laak:');
  tables.forEach(t => console.log(`${t.sectionName}: ${t.tableNumber}`));
  process.exit(0);
}
printTables();
