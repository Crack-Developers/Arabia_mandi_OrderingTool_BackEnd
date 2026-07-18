const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0').then(async () => {
  const Branch = mongoose.connection.collection('branches');
  const branches = await Branch.find({}).toArray();
  const mainId = branches.find(b => b.branchCode === 'BR-MAIN')._id.toString();
  const hibId = branches.find(b => b.branchCode === 'BR-908')._id.toString();
  console.log('Main:', mainId);
  console.log('Hib:', hibId);
  const Staff = mongoose.connection.collection('staffs');
  const staffs = await Staff.find({ username: { $in: ['ifran', 'umran'] } }).toArray();
  console.log(JSON.stringify(staffs, null, 2));
  process.exit(0);
});
