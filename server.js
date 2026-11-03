/**
 * Server TCP untuk GPS Tracker GT06
 * Jalankan: node server.js
 */
const net  = require('net');
const fs   = require('fs');
const path = require('path');
const Gt06 = require('./gt06');

const PORT     = process.env.PORT || 5023;
const LOG_FILE = path.join(__dirname, 'gps_data.json');

// ── Simpan data ke file JSON ────────────────────────────────────────
function simpanData(record) {
  let data = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      data = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch (e) { data = []; }

  data.push(record);

  // Batasi 10.000 entri supaya file tidak terlalu besar
  if (data.length > 10000) data = data.slice(-10000);

  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

// ── Format tampilan log di console ─────────────────────────────────
function logKoneksi(label, addr, msg) {
  const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log(`[${waktu}] [${addr}] ${label}: ${msg}`);
}

// ── Buat TCP Server ─────────────────────────────────────────────────
const server = net.createServer((socket) => {
  const addr  = `${socket.remoteAddress}:${socket.remotePort}`;
  const gt06  = new Gt06();
  let buffer  = Buffer.alloc(0);

  logKoneksi('KONEK', addr, 'tracker terhubung');

  socket.on('data', (chunk) => {
    // Gabung buffer (bisa datang terpotong-potong)
     console.log('RAW:', chunk.toString('hex'));
    buffer = Buffer.concat([buffer, chunk]);

    try {
      gt06.parse(buffer);
      buffer = Buffer.alloc(0); // reset buffer setelah berhasil parse

      // Ambil pesan terakhir yang diparsing
      const lastMsg = gt06.msgBuffer[gt06.msgBuffer.length - 1];
      if (!lastMsg) return;

      const tipe = gt06.event ? gt06.event.string : 'unknown';

      // ── Balas ke tracker kalau diminta ─────────────────────────
      if (gt06.expectsResponse && gt06.responseMsg) {
        socket.write(gt06.responseMsg);
        logKoneksi('BALAS', addr, gt06.responseMsg.toString('hex'));
      }

      // ── Log dan simpan berdasarkan tipe ────────────────────────
      switch (tipe) {

        case 'login':
          logKoneksi('LOGIN', addr, `IMEI: ${gt06.imei}`);
          break;

        case 'location':
          logKoneksi('GPS', addr,
            `IMEI:${gt06.imei} | ` +
            `lat:${gt06.lat} lon:${gt06.lon} | ` +
            `spd:${gt06.speed}km/h | ` +
            `arah:${gt06.course}° | ` +
            `waktu:${gt06.fixTime}`
          );
          simpanData({
            waktu:     new Date().toISOString(),
            imei:      gt06.imei,
            lat:       gt06.lat,
            lon:       gt06.lon,
            speed:     gt06.speed,
            course:    gt06.course,
            fixTime:   gt06.fixTime,
            satellites: gt06.satellites,
            gpsOk:     gt06.gpsPositioned,
          });
          break;

        case 'status':
          logKoneksi('STATUS', addr,
            `IMEI:${gt06.imei} | ` +
            `voltase:${gt06.voltageLevel} | ` +
            `sinyal:${gt06.gsmSigStrength} | ` +
            `alarm:${gt06.terminalInfo ? gt06.terminalInfo.alarmType : '-'}`
          );
          break;

        default:
          logKoneksi('DATA', addr, `tipe:${tipe} hex:${chunk.toString('hex')}`);
      }

    } catch (err) {
      if (err && err.error) {
        logKoneksi('ERROR', addr, `${err.error} | hex: ${chunk.toString('hex')}`);
      } else {
        logKoneksi('ERROR', addr, err.message || JSON.stringify(err));
      }
      buffer = Buffer.alloc(0); // buang buffer rusak
    }
  });

  socket.on('end', () => {
    logKoneksi('PUTUS', addr, `IMEI: ${gt06.imei || 'belum login'}`);
  });

  socket.on('error', (err) => {
    logKoneksi('ERROR', addr, err.message);
  });

  // Timeout 5 menit tidak ada data → putus koneksi
  socket.setTimeout(300000);
  socket.on('timeout', () => {
    logKoneksi('TIMEOUT', addr, 'tidak ada data 5 menit, koneksi diputus');
    socket.destroy();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log(`  Server GPS GT06 berjalan di port ${PORT}`);
  console.log(`  Data disimpan ke: gps_data.json`);
  console.log('='.repeat(50));
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
});
