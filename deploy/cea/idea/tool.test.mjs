import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, invocation } from './tool.mjs';
const root = 'D:/Example Project/backend';
test('maps Windows archive and credentials into existing helper mounts', () => {
  assert.equal(translate('docker-archive:D:\\Example Project\\backend\\.local\\idea-cea\\work\\import\\image.tar', root), 'docker-archive:/work/import/image.tar');
  assert.equal(translate(root + '/deploy/cea/secrets/backend/registry-auth.json', root), '/run/secrets/registry-auth.json');
});
test('maps build context and output but preserves registry image identity', () => {
  assert.equal(translate('type=docker,name=cea-build.local/result:build,dest=' + root + '/.local/idea-cea/work/build/image.tar', root), 'type=docker,name=cea-build.local/result:build,dest=/work/build/image.tar');
  assert.equal(translate('docker://registry-center:5000/lab/test:1', root), 'docker://registry-center:5000/lab/test:1');
  assert.deepEqual(invocation('buildctl', ['debug', 'workers'], root), ['exec', 'cea-idea-tools', 'buildctl', '--addr', 'unix:///run/cea-buildkit/buildkitd.sock', 'debug', 'workers']);
});
