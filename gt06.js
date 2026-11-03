/**
 * GT06 Protocol Parser
 * Protokol biner GPS tracker China (Concox, JimiIoT, dll)
 *
 * Format paket:
 *   7878 | LEN | MSG_TYPE | DATA... | CRC16(2) | 0D0A
 */
const getCrc16 = require('./crc16');

// Tipe pesan GT06
const MSG_TYPE = {
  0x01: 'login',
  0x12: 'location',
  0x13: 'status',
  0x15: 'string',
  0x16: 'alarm',
  0x1A: 'gps_lbs_status',
  0x1C: 'info_xmit',
  0x2A: 'lbs_phone',
  0x2C: 'lbs_extend',
  0x2D: 'lbs_status',
  0x8805: 'wifi_offline_location',
};

class Gt06 {
  constructor() {
    this.imei           = null;
    this.event          = null;
    this.lat            = null;
    this.lon            = null;
    this.speed          = null;
    this.course         = null;
    this.fixTime        = null;
    this.fixTimestamp   = null;
    this.satellites     = null;
    this.satellitesActive = null;
    this.gpsPositioned  = null;
    this.realTimeGps    = null;
    this.northLatitude  = null;
    this.eastLongitude  = null;
    this.mcc            = null;
    this.mnc            = null;
    this.lac            = null;
    this.cellId         = null;
    this.serialNumber   = null;
    this.errorCheck     = null;
    this.terminalInfo   = null;
    this.voltageLevel   = null;
    this.gsmSigStrength = null;
    this.expectsResponse = false;
    this.responseMsg    = null;
    this.msgBuffer      = [];
    this.msgBufferRaw   = [];
  }

  /**
   * Parse buffer masuk — bisa mengandung satu atau beberapa paket sekaligus
   */
  parse(buf) {
    // msgBufferRaw reset setiap parse() — hanya isi paket dari call ini
    this.msgBufferRaw = [];

    let offset = 0;
     while (offset < buf.length) {
      // Skip jika sisa buffer terlalu pendek untuk header
      if (offset + 2 > buf.length) break;
      // Validasi header 0x7878
      if (buf[offset] !== 0x78 || buf[offset + 1] !== 0x78) {
        break; // bukan throw — abaikan sisa buffer
      }

      // Struktur: 7878 | LEN(1) | MSGTYPE(1) | DATA(LEN-5) | CRC(2) | 0D0A(2)
      // LEN menghitung: MSGTYPE + DATA + CRC = (total isi setelah LEN sampai sebelum 0D0A)
      const len       = buf[offset + 2];           // jumlah byte dari MSGTYPE s/d akhir CRC
      const msgType   = buf[offset + 3];
      // Total panjang paket: 2(header) + 1(len) + len + 2(0D0A)
      const packetEnd = offset + 2 + 1 + len + 2;

      if (packetEnd > buf.length) break;           // paket belum lengkap

      // CRC: 2 byte sebelum 0D0A
      const crcPos   = packetEnd - 4;              // posisi CRC hi byte
      const crcInPkt = buf.slice(crcPos, crcPos + 2);

      // Data untuk CRC: dari LEN byte sampai sebelum CRC (termasuk LEN, MSGTYPE, DATA)
      const dataToCrc = buf.slice(offset + 2, crcPos);
      const crcCalc   = getCrc16(dataToCrc);
      const crcOk     = crcCalc[0] === crcInPkt[0] && crcCalc[1] === crcInPkt[1];

      // Raw paket
      const rawPacket = buf.slice(offset, packetEnd);
      this.msgBufferRaw.push(rawPacket);

      // Payload: byte setelah MSGTYPE sampai sebelum CRC
      const data   = buf.slice(offset + 4, crcPos);
      const parsed = this._parsePayload(msgType, data, crcInPkt);

      // Simpan ke msgBuffer (accumulate, tidak reset antar parse())
      const entry = Object.assign({}, parsed, {
        imei:      this.imei,
        event:     this.event ? Object.assign({}, this.event) : null,
        crcOk,
        rawPacket,
        parseTime: Date.now(),
      });
      this.msgBuffer.push(entry);

      offset = packetEnd;
    }
  }

  /**
   * Parse payload berdasarkan tipe pesan
   */
  _parsePayload(msgType, data, crcBytes) {
    this.event = {
      number: msgType,
      string: MSG_TYPE[msgType] || 'unknown',
    };
    this.errorCheck  = (crcBytes[0] << 8) | crcBytes[1];
    this.expectsResponse = false;
    this.responseMsg = undefined;

    switch (msgType) {

      // ── LOGIN ──────────────────────────────────────────────────
      case 0x01: {
        // data: IMEI(8 byte BCD) + serial(2 byte)
        let imeiStr = '';
        for (let i = 0; i < 8; i++) {
          imeiStr += data[i].toString(16).padStart(2, '0');
        }
        // BCD: hilangkan leading 0 pertama kalau ada
        this.imei         = parseInt(imeiStr, 10);
        this.serialNumber = (data[8] << 8) | data[9];

        // Balas ke tracker
        this.expectsResponse = true;
        this.responseMsg = this._buildResponse(msgType, this.serialNumber);
        return { imei: this.imei, serialNumber: this.serialNumber };
      }

      // ── LOCATION ──────────────────────────────────────────────
      case 0x12: {
        // Datetime: YY MM DD HH mm SS (6 byte)
        const yy = data[0], mo = data[1], dd = data[2];
        const hh = data[3], mi = data[4], ss = data[5];
        const dt = new Date(Date.UTC(2000 + yy, mo - 1, dd, hh, mi, ss));
        this.fixTime      = dt.toISOString();
        this.fixTimestamp = Math.floor(dt.getTime() / 1000);

        // GPS Info byte
        const gpsInfo = data[6];
        this.satellites       = gpsInfo & 0x0f;
        this.satellitesActive = (gpsInfo >> 4) & 0x0f;

        // Latitude & Longitude (4 byte masing-masing, dalam menit * 30000)
        const latRaw = ((data[7] << 24) | (data[8] << 16) | (data[9] << 8) | data[10]) >>> 0;
        const lonRaw = ((data[11] << 24) | (data[12] << 16) | (data[13] << 8) | data[14]) >>> 0;
        this.lat = Math.round((latRaw / 30000.0 / 60.0) * 1000000) / 1000000;
        this.lon = Math.round((lonRaw / 30000.0 / 60.0) * 1000000) / 1000000;

        // Speed (1 byte, km/h)
        this.speed     = data[15];
        this.speedUnit = 'km/h';

        // Course & flags (2 byte)
        const courseFlags = (data[16] << 8) | data[17];
        this.realTimeGps    = !!(courseFlags & 0x2000);
        this.gpsPositioned  = !!(courseFlags & 0x1000);
        this.eastLongitude  = !!(courseFlags & 0x0800);
        this.northLatitude  = !!(courseFlags & 0x0400);
        this.course         = courseFlags & 0x03ff;

        // bit10=northLatitude: 1=north(+), 0=south(-)
        // bit11=eastLongitude: 0=east(+), 1=west(-) — bit maknanya terbalik dari lat
        if (!this.northLatitude) this.lat = -this.lat;
        if (this.eastLongitude) this.lon = -this.lon;

        // MCC, MNC, LAC, Cell ID
        this.mcc    = (data[18] << 8) | data[19];
        this.mnc    = data[20];
        this.lac    = (data[21] << 8) | data[22];
        this.cellId = (data[23] << 8) | data[24];

        // Serial number (2 byte terakhir sebelum CRC)
        this.serialNumber = (data[25] << 8) | data[26];

        this.expectsResponse = false;
        // responseMsg tetap undefined (sudah diset di awal _parsePayload)

        return {
          fixTime: this.fixTime, fixTimestamp: this.fixTimestamp,
          lat: this.lat, lon: this.lon,
          speed: this.speed, speedUnit: this.speedUnit,
          course: this.course,
          satellites: this.satellites, satellitesActive: this.satellitesActive,
          realTimeGps: this.realTimeGps, gpsPositioned: this.gpsPositioned,
          northLatitude: this.northLatitude, eastLongitude: this.eastLongitude,
          mcc: this.mcc, mnc: this.mnc, lac: this.lac, cellId: this.cellId,
          serialNr: this.serialNumber,
        };
      }

      // ── STATUS / HEARTBEAT ────────────────────────────────────
      case 0x13: {
        // Terminal Info (1 byte)
        // bit0: status | bit1-3: alarm type | bit4: relay | bit5: ignition | bit6: gpsTracking | bit7: charging
        const ti = data[0];
        this.terminalInfo = {
          status:      !!(ti & 0x01),
          alarmType:   this._alarmType((ti >> 1) & 0x07),
          relayState:  !!(ti & 0x10),
          ignition:    !!(ti & 0x20),
          gpsTracking: !!(ti & 0x40),
          charging:    !!(ti & 0x80),
        };

        // Voltage level (1 byte)
        const vl = data[1];
        this.voltageLevel = ['no power', 'extremely low', 'very low', 'low', 'medium', 'high', 'very high'][vl] || 'unknown';

        // GSM signal (1 byte): 0=no signal, 1=weak, 2=moderate, 3=good, 4=strong
        const gs = data[2];
        this.gsmSigStrength = ['no signal', 'weak signal', 'moderate signal', 'good signal', 'strong signal'][gs] || 'unknown';

        // Serial number
        this.serialNumber = (data[3] << 8) | data[4];

        this.expectsResponse = true;
        this.responseMsg = this._buildResponse(msgType, this.serialNumber);

        return {
          terminalInfo: this.terminalInfo,
          voltageLevel: this.voltageLevel,
          gsmSigStrength: this.gsmSigStrength,
        };
      }

      default:
        return { raw: data.toString('hex') };
    }
  }

  /**
   * Bangun paket respons ke tracker
   * Format: 7878 05 MSG_TYPE SN_HI SN_LO CRC 0D0A
   */
  _buildResponse(msgType, serialNumber) {
    // Protokol GT06: ACK response selalu pakai serial 0x00 0x01 (konvensi protokol)
    const crcData = Buffer.from([0x05, msgType, 0x00, 0x01]);
    const crc = getCrc16(crcData);
    return Buffer.from([0x78, 0x78, 0x05, msgType, 0x00, 0x01, crc[0], crc[1], 0x0d, 0x0a]);
  }

  _alarmType(bits) {
    const types = ['normal', 'shock alarm', 'power cut', 'low battery', 'sos', 'overspeed'];
    return types[bits] || 'unknown';
  }

  clearMsgBuffer() {
    this.msgBuffer    = [];
    this.msgBufferRaw = [];
  }
}

module.exports = Gt06;
