import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalTeardown() {
  const mongo: MongoMemoryServer = (global as any).__MONGO_INSTANCE__;
  if (mongo) await mongo.stop();
}
