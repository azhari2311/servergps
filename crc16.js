/**
 * CRC16-X25
 * Dipakai oleh protokol GT06 GPS tracker
 * Polynomial: 0x1021, Init: 0xFFFF, RefIn: true, RefOut: true, XorOut: 0xFFFF
 */
function reflect(val, bits) {
  return parseInt(
    ('0'.repeat(bits) + val.toString(2)).slice(-bits).split('').reverse().join(''),
    2
  );
}

function getCrc16(buffer) {
  let crc = 0xffff;
  for (let i = 0; i < buffer.length; i++) {
    const b = reflect(buffer[i], 8);
    crc ^= (b << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  crc = reflect(crc, 16);
  crc = (crc ^ 0xffff) & 0xffff;

  const result = Buffer.alloc(2);
  result[0] = (crc >> 8) & 0xff;
  result[1] = crc & 0xff;
  return result;
}

module.exports = getCrc16;
