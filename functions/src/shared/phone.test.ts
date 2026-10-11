import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePhone, isValidPhone, normaliseSafaricomPhone, isSafaricomPhone } from './phone';

test('normalisePhone accepts local, 254 and +254 forms and returns the 0-prefixed number', () => {
  assert.equal(normalisePhone('0722123456'), '0722123456');
  assert.equal(normalisePhone('+254 722 123 456'), '0722123456');
  assert.equal(normalisePhone('254722123456'), '0722123456');
  assert.equal(normalisePhone('0722-123-456'), '0722123456');
  assert.equal(normalisePhone('0110123456'), '0110123456');
});

test('normalisePhone rejects empty, short, long and foreign numbers', () => {
  assert.equal(normalisePhone(''), null);
  assert.equal(normalisePhone('12345'), null);
  assert.equal(normalisePhone('07221234567'), null);
  assert.equal(normalisePhone('+447911123456'), null);
  assert.equal(isValidPhone('abc'), false);
});

test('Safaricom check only accepts published Safaricom prefixes', () => {
  assert.equal(isSafaricomPhone('0722123456'), true);
  assert.equal(isSafaricomPhone('0110123456'), true);
  assert.equal(isSafaricomPhone('0733123456'), false); // Airtel range
  assert.equal(normaliseSafaricomPhone('+254712345678'), '0712345678');
});
