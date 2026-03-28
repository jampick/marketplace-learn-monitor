const test = require("node:test");
const assert = require("node:assert/strict");

test("messages handler rejects invalid bot payloads with 400", async () => {
  const { createMessagesHandler } = require("../dist/src/functions/messages.js");

  let adapterCalled = false;
  const handler = createMessagesHandler({
    adapter: {
      async process() {
        adapterCalled = true;
      },
    },
    bot: {
      async run() {},
    },
  });

  const response = await handler(
    {
      method: "POST",
      headers: new Headers(),
      async json() {
        return {};
      },
    },
    {
      error() {},
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.jsonBody, {
    error: "Expected a Bot Framework activity payload.",
  });
  assert.equal(adapterCalled, false);
});

