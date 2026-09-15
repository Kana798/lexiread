import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildYoudaoRequest, truncateYoudaoQuery } from './youdao-translation';

test('uses the original query for Youdao V3 signatures when it is 20 characters or shorter', () => {
  const request = buildYoudaoRequest({
    text: 'hello',
    appKey: 'test-app',
    appSecret: 'test-secret',
    salt: '1',
    curtime: '1700000000',
  });

  assert.equal(request.signType, 'v3');
  assert.equal(request.sign, '369406f9993723a8ecfff6b2677c5be188c82c8e0b781cd2b969f1b25270726d');
});

test('uses Youdao truncation rules for long source text before signing', () => {
  assert.equal(truncateYoudaoQuery('abcdefghijklmnopqrstu'), 'abcdefghij21lmnopqrstu');
});
