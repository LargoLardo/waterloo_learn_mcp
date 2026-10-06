import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';

test('MCP advertises exam context, material search, and page text', async () => {
  const server = createServer();
  const client = new Client({ name: 'test', version: '1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'get_exam_context'));
    const search = tools.find((tool) => tool.name === 'search_course_materials');
    assert.equal(search.inputSchema.properties.maxFiles.maximum, 60);
    for (const name of ['get_topic_file', 'get_drive_file']) {
      const tool = tools.find((tool) => tool.name === name);
      assert.ok(tool.outputSchema.properties.pages.items.properties.text);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
