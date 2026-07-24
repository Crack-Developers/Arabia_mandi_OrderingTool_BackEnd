import mongoose from 'mongoose';
import Category from './src/models/Category';

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://admin:admin@arabiamandicluster.v91v9.mongodb.net/?retryWrites=true&w=majority&appName=ArabiaMandiCluster');
Category.find({}).then(cats => {
  console.log(cats);
  process.exit(0);
});
