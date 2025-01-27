import assert from 'assert';
import { ValkeyDriver } from '../src/index';

describe('ValkeyDriver', () => {
  let driver: ValkeyDriver;

  // @ts-expect-error
  beforeAll(async () => {
    driver = new ValkeyDriver();
  });

  // @ts-expect-error
  afterAll(async () => {
    await driver.shutdown();
    process.exit(); // TODO: remove this
  });

    it("should allow concurrent queries to multiple room names", async () => {
      for (let i=0; i<10; i++) { await driver.createInstance({ name: "one", roomId: "x" + i, clients: i, maxClients: 10, }).save(); }
      for (let i=0; i<10; i++) { await driver.createInstance({ name: "two", roomId: "y" + i, clients: i, maxClients: 10, }).save(); }
      for (let i=0; i<10; i++) { await driver.createInstance({ name: "three", roomId: "z" + i, clients: i, maxClients: 10, }).save(); }

      // TODO actually implement testing, because concurrent redis queries are OK since we don't have to load everything locally
    });
})