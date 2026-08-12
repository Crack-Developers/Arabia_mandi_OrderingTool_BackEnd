const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const Branch = require('./dist/models/Branch').default || require('./dist/models/Branch');

async function findBranch() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const branch = await Branch.findOne({ branchCode: 'BR-797' }).lean();
  console.log(`Branch BR-797 _id: ${branch ? branch._id : 'NOT FOUND'}`);
  
  process.exit(0);
}
findBranch();
