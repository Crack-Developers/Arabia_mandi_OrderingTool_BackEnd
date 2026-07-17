import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://crackdevelopers-ArabiaMandi-billingsoftware:nnTeANAwuzD0rxTk@cluster0.ttl8rsc.mongodb.net/arabian_mandi_erp?appName=Cluster0';

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(MONGODB_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error: any) {
    console.warn(`⚠️ Primary MongoDB connection failed (${MONGODB_URI}). Retrying via 127.0.0.1...`);
    try {
      const fallbackUri = MONGODB_URI.replace('localhost', '127.0.0.1');
      const conn = await mongoose.connect(fallbackUri);
      console.log(`✅ MongoDB Connected via Fallback: ${conn.connection.host}/${conn.connection.name}`);
    } catch (fallbackError) {
      console.error('❌ MongoDB Connection Error:', fallbackError);
      process.exit(1);
    }
  }
};

export default connectDB;
