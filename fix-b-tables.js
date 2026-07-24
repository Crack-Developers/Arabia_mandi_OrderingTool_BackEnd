const mongoose = require('mongoose');
const Branch = require('./dist/models/Branch').default;

mongoose.connect('mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0')
.then(async () => {
  const branchId = '6a61fe7f2466d0c5828fb488'; // The branch ID the user is on
  
  const branch = await Branch.findById(branchId);
  if (!branch) { console.log("Branch not found"); process.exit(1); }
  
  let bIndex = -1;
  for(let i=0; i<branch.sections.length; i++) {
    if (branch.sections[i].name === 'B') {
      bIndex = i;
      break;
    }
  }
  
  if (bIndex > -1) {
    console.log(`Setting B section tablesCount to 9`);
    branch.sections[bIndex].tablesCount = 9;
    await branch.save();
    console.log("Saved successfully");
  } else {
    console.log("Section B not found");
  }
  
  process.exit();
}).catch(console.error);
