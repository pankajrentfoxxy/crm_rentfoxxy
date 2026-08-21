import { matchesAsset, normalizeScan } from './assetMatch';

const asset = { ttspl_id: 'TTSPL-04412', serial_number: '5CD1234ABC' };

test('normalises hyphens and spaces', () => {
  expect(normalizeScan('ttspl-04412')).toBe('TTSPL04412');
  expect(matchesAsset('ttspl-04412', asset)).toBe(true);
  expect(matchesAsset('TTSPL 04412', asset)).toBe(true);
  expect(matchesAsset('TTSPL04412', asset)).toBe(true);
  expect(matchesAsset('TTSPL-04455', asset)).toBe(false);
});
