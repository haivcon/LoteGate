import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('three runtime circuit artifacts match manifest and deployment hashes', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('circuits/serial/manifest.json', root)));
  const deployment = JSON.parse(await readFile(new URL('deployment/xlayer.json', root)));
  assert.equal(deployment.chainId, 196);
  assert.equal(manifest.modules.length, 3);
  for (const module of manifest.modules) {
    for (const [extension, hashKey, sizeKey] of [['bin', 'binarySha256', 'binaryBytes'], ['blif', 'blifSha256', 'blifBytes']]) {
      const bytes = await readFile(new URL(`circuits/serial/${module.name}.${extension}`, root));
      assert.equal(bytes.length, module[sizeKey]);
      assert.ok(bytes.length < 34000);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), module[hashKey]);
    }
    assert.equal(module.binarySha256, deployment.circuits[module.name].binarySha256);
  }
});
