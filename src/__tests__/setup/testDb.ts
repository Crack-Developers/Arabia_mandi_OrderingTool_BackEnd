/**
 * testDb.ts
 * Helper: connect/disconnect mongoose to the in-memory MongoDB instance
 */
import mongoose from 'mongoose';

export async function connectTestDB() {
  const uri = process.env['MONGO_URI_TEST'];
  if (!uri) throw new Error('MONGO_URI_TEST not set — did globalSetup run?');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

export async function disconnectTestDB() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function clearCollections() {
  const collections = mongoose.connection.collections;
  for (const col of Object.values(collections)) {
    await col.deleteMany({});
  }
}
