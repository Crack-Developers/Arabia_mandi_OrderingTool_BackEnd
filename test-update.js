const mongoose = require('mongoose');
const Branch = require('./src/models/Branch').default;

mongoose.connect('mongodb+srv://developer:fN9R474mR8DXXGgM@petpooja-cluster.zrcf8.mongodb.net/arabia_mandi_orderingtool?retryWrites=true&w=majority')
.then(async () => {
  const branchId = '6a61fe7f2466d0c5828fb488'; // The branch ID the user is on
  
  // Try to find the branch and see its sections
  const branch = await Branch.findById(branchId);
  console.log("Branch sections:", branch.sections);
  
  const res = await Branch.updateOne(
    { _id: branchId, "sections.name": "B" },
    { $inc: { "sections.$.tablesCount": -1 } }
  );
  console.log("Update result for name:", res);
  
  const res2 = await Branch.updateOne(
    { _id: branchId, "sections._id": "6a6230f65bbd69f993d052d9" },
    { $inc: { "sections.$.tablesCount": -1 } }
  );
  console.log("Update result for sectionId:", res2);
  
  process.exit();
}).catch(console.error);
