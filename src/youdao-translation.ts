import { createHash } from 'node:crypto';

export function truncateYoudaoQuery(text: string): string {
  return text.length <= 20 ? text : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
}

export function buildYoudaoRequest(input: {
  text: string;
  appKey: string;
  appSecret: string;
  salt: string;
  curtime: string;
}) {
  const sign = createHash('sha256')
    .update(`${input.appKey}${truncateYoudaoQuery(input.text)}${input.salt}${input.curtime}${input.appSecret}`)
    .digest('hex');
  return {
    q: input.text,
    from: 'en',
    to: 'zh-CHS',
    appKey: input.appKey,
    salt: input.salt,
    curtime: input.curtime,
    sign,
    signType: 'v3',
  };
}
