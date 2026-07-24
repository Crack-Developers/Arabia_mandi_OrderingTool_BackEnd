const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://developer:fN9R474mR8DXXGgM@petpooja-cluster.zrcf8.mongodb.net/arabia_mandi_orderingtool?retryWrites=true&w=majority')
.then(async () => {
  const branchId = '6a61fe7f2466d0c5828fb488'; // The branch ID the user is on
  
  const Branch = mongoose.model('Branch', new mongoose.Schema({}, { strict: false }));
  
  // Try to find the branch and see its sections
  const branch = await Branch.findById(branchId);
  console.log("Branch sections:", JSON.stringify(branch.sections, null, 2));
  
  const res = await Branch.updateOne(
    { _id: new mongoose.Types.ObjectId(branchId), "sections.name": "B" },
    { $inc: { "sections.$.tablesCount": -1 } }
  );
  console.log("Update result for name:", res);
  
  process.exit();
}).catch(console.error);
