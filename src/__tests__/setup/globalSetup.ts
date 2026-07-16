import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer;

export default async function globalSetup() {
  mongo = await MongoMemoryServer.create();
  process.env['MONGO_URI_TEST'] = mongo.getUri();
  process.env['JWT_SECRET'] = 'test_secret_for_jest';
  process.env['NODE_ENV'] = 'test';
  // Store instance on global so teardown can stop it
  (global as any).__MONGO_INSTANCE__ = mongo;
}
