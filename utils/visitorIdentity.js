import { isIP } from 'node:net';

export const normalizeVisitorIp = raw => {
  let value = String(raw || '').trim().toLowerCase();
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) value = value.slice(7);
  if (!isIP(value)) return '';
  if (isIP(value) === 6) return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  return value;
};

// Historical sessions are grouped at read time; do not discard repeat visits.
export const visitorIdentityStage = {
  $addFields: {
    visitorKey: {
      $let: {
        vars: { ip: { $replaceOne: { input: { $trim: { input: { $ifNull: ['$ip', ''] } } }, find: '::ffff:', replacement: '' } } },
        in: { $cond: [
          { $ne: ['$$ip', ''] },
          { $concat: ['ip:', '$$ip'] },
          { $concat: ['visitor:', { $ifNull: ['$visitorId', { $toString: '$_id' }] }] },
        ] },
      },
    },
  },
};
