import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  BUF0,
  BUF16,
  hide,
  lock,
  md5,
  sha256,
  timestamp,
  trace,
  unzip,
} from './constants';
import { AppInfo, DeviceInfo, generateDeviceInfo, getAppInfo, Platform } from './device';
import { Encodable } from './protobuf';
import { getRawTlv } from './tlv';
import { LoginErrorCode } from '../errors';

import Network from './network';
import Ecdh from './ecdh';
import Writer from './writer';

import * as pb from './protobuf';
import * as tea from './tea';
import * as tlv from './tlv';
import { getSign } from './sign';

const FN_NEXT_SEQ = Symbol('FN_NEXT_SEQ');
const FN_SEND = Symbol('FN_SEND');
const HANDLERS = Symbol('HANDLERS');
const NET = Symbol('NET');
const ECDH256 = Symbol('ECDH256');
const ECDH192 = Symbol('ECDH192');
const IS_ONLINE = Symbol('IS_ONLINE');
const LOGIN_LOCK = Symbol('LOGIN_LOCK');
const HEARTBEAT = Symbol('HEARTBEAT');
const SSO_HEARTBEAT = Symbol('SSO_HEARTBEAT');
const EVENT_KICKOFF = Symbol('EVENT_KICKOFF');

export class ApiRejection {
  constructor(
    public code: number,
    public message = 'unknown',
  ) {
    this.code = Number(this.code);
    this.message = this.message?.toString() || 'unknown';
  }
}

export enum LogLevel {
  Fatal,
  Mark,
  Error,
  Warn,
  Info,
  Debug,
}

export enum QrcodeResult {
  Confirmed = 0,
  CodeExpired = 17,
  WaitingForScan = 48,
  WaitingForConfirm = 53,
  Canceled = 54,
}

export interface BaseClient {
  /** 收到二维码 */
  on(name: 'internal.qrcode', listener: (this: this, qrcode: Buffer) => void): this;

  /** 收到滑动验证码 */
  on(name: 'internal.slider', listener: (this: this, url: string) => void): this;

  /** 登录保护验证 */
  on(name: 'internal.verify', listener: (this: this, url: string, phone: string) => void): this;

  /** token过期(此时已掉线) */
  on(name: 'internal.error.token', listener: (this: this) => void): this;

  /** 网络错误 */
  on(name: 'internal.error.network', listener: (this: this, code: number, message: string) => void): this;

  /** 密码登录相关错误 */
  on(name: 'internal.error.login', listener: (this: this, code: number, message: string) => void): this;

  /** 扫码登录相关错误 */
  on(name: 'internal.error.qrcode', listener: (this: this, code: QrcodeResult, message: string) => void): this;

  /** 登录成功 */
  on(
    name: 'internal.online',
    listener: (this: this, token: Buffer, nickname: string, gender: number, age: number) => void,
  ): this;

  /** token更新 */
  on(name: 'internal.token', listener: (this: this, token: string) => void): this;

  /** 服务器强制下线 */
  on(name: 'internal.kickoff', listener: (this: this, reason: string) => void): this;

  /** 业务包 */
  on(name: 'internal.sso', listener: (this: this, cmd: string, payload: Buffer, seq: number) => void): this;

  /** 日志信息 */
  on(name: 'internal.verbose', listener: (this: this, verbose: unknown, level: LogLevel) => void): this;

  on(name: string | symbol, listener: (this: this, ...args: any[]) => void): this;
}

export class BaseClient extends EventEmitter {
  private [IS_ONLINE] = false;
  private [ECDH256] = new Ecdh('exchange', false);
  private [ECDH192] = new Ecdh('wtlogin', true);
  private readonly [NET] = new Network();
  private readonly [HANDLERS] = new Map<number, (buf: Buffer) => void>();

  private [LOGIN_LOCK] = false;
  private [HEARTBEAT]: NodeJS.Timeout | undefined;
  private [SSO_HEARTBEAT]: NodeJS.Timeout | undefined;

  readonly platform: Platform;
  readonly appInfo: AppInfo;
  readonly deviceInfo: DeviceInfo;
  readonly sig = {
    seq: randomBytes(4).readUInt32BE() & 0xfff,
    tgtgt: BUF0,
    tgt: BUF0,
    d2: BUF0,
    d2Key: BUF16,
    qrSig: BUF0,
    signApiAddr: 'http://127.0.0.1:7458/api/sign',
    exchangeKey: BUF0,
    keySig: BUF0,
    cookies: '',
    unusualSig: BUF0,
    tempPwd: BUF0,
  };

  protected interval = 10;
  protected ssoInterval = 270;

  protected readonly statistics = {
    start_time: timestamp(),
    lockTimes: 0,
    recvPacketCount: 0,
    sendPacketCount: 0,
    lostPacketCount: 0,
    recvMsgCount: 0,
    sentMsgCount: 0,
    msgCountPerMin: 0,
    remoteIp: '',
    remotePort: 0,
  };

  public uid?: string;

  constructor(
    public readonly uin: number,
    uid?: string,
    p: Platform = Platform.Linux,
    guid?: string,
  ) {
    super();
    this.platform = p;
    this.uid = uid;
    this.appInfo = getAppInfo(p);
    this.deviceInfo = generateDeviceInfo(guid ?? uin);

    this[NET].on('error', err => this.emit('internal.verbose', err.message, LogLevel.Error));
    this[NET].on('close', () => {
      this.statistics.remoteIp = '';
      this.statistics.remotePort = 0;
      this[NET].remoteAddress &&
        this.emit('internal.verbose', `${this[NET].remoteAddress}:${this[NET].remotePort} closed`, LogLevel.Mark);
    });
    this[NET].on('connect2', () => {
      this.statistics.remoteIp = this[NET].remoteAddress as string;
      this.statistics.remotePort = this[NET].remotePort as number;
      this.emit('internal.verbose', `${this[NET].remoteAddress}:${this[NET].remotePort} connected`, LogLevel.Mark);
    });
    this[NET].on('packet', packetListener.bind(this));
    this[NET].on('lost', lostListener.bind(this));

    this.on('internal.online', onlineListener);
    this.on('internal.sso', ssoListener);

    lock(this, 'uin');
    lock(this, 'appInfo');
    lock(this, 'device');
    lock(this, 'sig');
    lock(this, 'statistics');
    hide(this, 'heartbeat');
    hide(this, 'interval');
    hide(this, 'ssoInterval');
  }

  setRemoteServer(host?: string, port?: number) {
    if (host && port) {
      this[NET].host = host;
      this[NET].port = port;
      this[NET].autoSearch = false;
    } else {
      this[NET].autoSearch = true;
    }
  }

  isOnline() {
    return this[IS_ONLINE];
  }

  async logout(keepalive = false) {
    if (!keepalive && this[NET].connected) {
      this.terminate();
      await new Promise(resolve => this[NET].once('close', resolve));
    }
  }

  async fetchQrcode() {
    const t = tlv.getPacker(this);
    const body = new Writer()
      .writeU16(0)
      .writeU64(0)
      .writeU8(0)
      .writeU16(7)
      .writeBytes(t(0x16, true))
      .writeBytes(t(0x1b, true))
      .writeBytes(t(0x1d, true))
      .writeBytes(t(0x33, true))
      .writeBytes(t(0x35, true))
      .writeBytes(t(0x66, true))
      .writeBytes(t(0xd1, true))
      .writeU8(0x03)
      .read();
    const packet = await buildCode2dPacket.call(this, 0x31, body);

    this[FN_SEND](packet)
      .then(payload => {
        payload = tea.decrypt(payload.slice(16, -1), this[ECDH192].shareKey);
        const stream = Readable.from(payload, { objectMode: false });
        stream.read(54);
        const retcode = stream.read(1)[0];
        const qrSig = stream.read(stream.read(2).readUInt16BE());
        stream.read(2);

        const t = readTlv(stream);
        if (!retcode && t[0x17]) {
          this.sig.qrSig = qrSig;
          this.emit('internal.qrcode', t[0x17]);
        } else {
          this.emit('internal.error.qrcode', retcode, '获取二维码失败，请重试');
        }
      })
      .catch(() => this.emit('internal.error.network', -2, 'server is busy'));
  }

  async queryQrcodeResult() {
    let retcode = -1,
      uin,
      t106,
      t16a,
      t318,
      tgtgt;
    if (!this.sig.qrSig.length) return { retcode, uin, t106, t16a, t318, tgtgt };

    const body = new Writer()
      .writeU16(this.sig.qrSig.length)
      .writeBytes(this.sig.qrSig)
      .writeU64(0)
      .writeU32(0)
      .writeU8(0)
      .writeU8(0x03)
      .read();
    const pkt = await buildCode2dPacket.call(this, 0x12, body);

    try {
      let payload = await this[FN_SEND](pkt);
      payload = tea.decrypt(payload.slice(16, -1), this[ECDH192].shareKey);
      const stream = Readable.from(payload, { objectMode: false });
      const length = stream.read(4).readUInt32BE();
      stream.read(4);
      const cmd = stream.read(2).readUInt16BE();
      stream.read(40);
      const appId = stream.read(4).readUInt32BE();
      retcode = stream.read(1)[0];
      if (retcode === 0) {
        stream.read(12);
        stream.read(2).readUInt16BE(); // tlvCount
        const t = readTlv(stream);
        t106 = t[0x18];
        t16a = t[0x19];
        tgtgt = t[0x1e];
        this.sig.tgtgt = tgtgt;
      }
    } catch {}
    return { retcode, uin, t106, t16a, tgtgt };
  }

  async qrcodeLogin() {
    if (this[LOGIN_LOCK]) return;

    const { retcode, uin, t106, t16a, tgtgt } = await this.queryQrcodeResult();
    if (retcode < 0) {
      this.emit('internal.error.network', -2, 'server is busy');
    } else if (retcode === 0 && t106 && t16a && tgtgt) {
      this[LOGIN_LOCK] = true;
      const t = tlv.getPacker(this);
      const body = new Writer()
        .writeU16(0x09) // Internal Command
        .writeU16(15) // tlv count
        .writeU16(0x106)
        .writeTlv(t106)
        .writeBytes(t(0x144))
        .writeBytes(t(0x116))
        .writeBytes(t(0x142))
        .writeBytes(t(0x145))
        .writeBytes(t(0x018))
        .writeBytes(t(0x141))
        .writeBytes(t(0x177))
        .writeBytes(t(0x191))
        .writeBytes(t(0x100))
        .writeBytes(t(0x107))
        .writeBytes(t(0x318))
        .writeU16(0x16a)
        .writeTlv(t16a)
        .writeBytes(t(0x166))
        .writeBytes(t(0x521))
        .read();

      const login = await buildLoginPacket.call(this, 'wtlogin.login', body);
      const response = await this[FN_SEND](login);
      await decodeLoginResponse.call(this, response);
    } else {
      let message;
      switch (retcode) {
        case QrcodeResult.CodeExpired:
          message = '二维码超时，请重新获取';
          break;
        case QrcodeResult.WaitingForScan:
          message = '二维码尚未扫描';
          break;
        case QrcodeResult.WaitingForConfirm:
          message = '二维码尚未确认';
          break;
        case QrcodeResult.Canceled:
          message = '二维码被取消，请重新获取';
          break;
        default:
          message = '扫码遇到未知错误，请重新获取';
          break;
      }
      this.sig.qrSig = BUF0;
      this.emit('internal.error.qrcode', retcode, message);
    }
  }

  async keyExchange() {
    const plain1 = pb.encode({
      1: this.uin,
      2: this.deviceInfo.guid,
    });
    const gcmCalc1 = aesGcmEncrypt(plain1, this[ECDH256].shareKey);

    const ts = timestamp();
    const plain2 = new Writer()
      .writeBytes(this[ECDH256].publicKey)
      .writeU32(1) // type
      .writeBytes(gcmCalc1)
      .writeU32(0) // const
      .writeU32(ts);
    const hash = sha256(plain2.read());
    const gcmCalc2 = aesGcmEncrypt(
      hash,
      Buffer.from('e2733bf403149913cbf80c7a95168bd4ca6935ee53cd39764beebe2e007e3aee', 'hex'),
    );

    const packet = pb.encode({
      1: this[ECDH256].publicKey,
      2: 1,
      3: gcmCalc1,
      4: ts,
      5: gcmCalc2,
    });

    const resp = await this.sendUni('trpc.login.ecdh.EcdhService.SsoKeyExchange', packet);
    const pbResp = pb.decode(resp);
    const shareKey = this[ECDH256].exchange(pbResp[3].toBuffer());
    const decrypted = aesGcmDecrypt(pbResp[1].toBuffer(), shareKey);
    const pbDecrypted = pb.decode(decrypted);

    this.sig.exchangeKey = pbDecrypted[1].toBuffer();
    this.sig.keySig = pbDecrypted[2].toBuffer();

    this.emit('internal.verbose', `key xchg successfully, session: ${pbDecrypted[3]}s`, LogLevel.Debug);
  }

  async tokenLogin(token: Buffer) {
    if (!this.sig.keySig.length || !this.sig.exchangeKey.length) await this.keyExchange();

    const packet = buildNTLoginPacketBody.call(this, token);
    const response = await this.sendUni('trpc.login.ecdh.EcdhService.SsoNTLoginEasyLogin', packet);
    decodeNTLoginResponse.call(this, response);
  }

  async passwordLogin(md5: Buffer) {
    if (!this.sig.keySig.length || !this.sig.exchangeKey.length) await this.keyExchange();

    const packet = buildNTLoginPacketBody.call(this, getRawTlv(this, 0x106, false, md5));
    const response = await this.sendUni('trpc.login.ecdh.EcdhService.SsoNTLoginPasswordLogin', packet);
    decodeNTLoginResponse.call(this, response);
  }

  terminate() {
    this[IS_ONLINE] = false;
    this[NET].destroy();
  }

  private [FN_NEXT_SEQ]() {
    if (++this.sig.seq >= 0x8000) this.sig.seq = 1;
    return this.sig.seq;
  }

  private [FN_SEND](pkt: Uint8Array, timeout = 5) {
    this.statistics.sendPacketCount++;
    const seq = this.sig.seq;
    return new Promise((resolve: (payload: Buffer) => void, reject) => {
      const id = setTimeout(() => {
        this[HANDLERS].delete(seq);
        this.statistics.lostPacketCount++;
        reject(new ApiRejection(-2, `packet timeout (${seq})`));
      }, timeout * 1000);

      this[NET].join(() => {
        this[NET].write(pkt, () => {
          this[HANDLERS].set(seq, payload => {
            clearTimeout(id);
            this[HANDLERS].delete(seq);
            resolve(payload);
          });
        });
      });
    });
  }

  async writeUni(cmd: string, body: Uint8Array, seq = 0) {
    this.statistics.sendPacketCount++;
    this[NET].write(await buildUniPacket.call(this, cmd, body, seq));
  }

  /** 发送一个业务包并等待返回 */
  async sendUni(cmd: string, body: Uint8Array, timeout = 5) {
    return this[FN_SEND](await buildUniPacket.call(this, cmd, body), timeout);
  }
}

function onlineListener(this: BaseClient) {
  if (!this.listenerCount(EVENT_KICKOFF)) {
    this.once(EVENT_KICKOFF, (msg: string) => {
      this[IS_ONLINE] = false;
      clearInterval(this[HEARTBEAT]);
      clearInterval(this[SSO_HEARTBEAT]);

      this.emit('internal.kickoff', msg);
    });
  }
}

function ssoListener(this: BaseClient, cmd: string, payload: Buffer, seq: number) {
  switch (cmd) {
    case 'trpc.qq_new_tech.status_svc.StatusService.KickNT': {
    }
  }
}

function lostListener(this: BaseClient) {
  clearInterval(this[HEARTBEAT]);
  clearInterval(this[SSO_HEARTBEAT]);

  if (this[IS_ONLINE]) {
    this[IS_ONLINE] = false;
    this.statistics.lockTimes++;
    setTimeout(register.bind(this), 50);
  }
}

// 上线
async function register(this: BaseClient) {
  try {
    const packet = pb.encode({
      1: this.deviceInfo.guid,
      2: 0,
      3: this.appInfo.currentVersion,
      4: 0,
      5: 2052, // locale id
      6: {
        1: this.deviceInfo.deviceName,
        2: this.appInfo.kernel,
        3: this.deviceInfo.systemKernel,
        4: '',
        5: this.appInfo.vendorOs,
      },
      7: false, // setMute
      8: false, // registerVendorType
      9: true, // regType
    });
    const response = await this.sendUni('trpc.qq_new_tech.status_svc.StatusService.Register', packet);
    const pbResponse = pb.decode(response);

    if (pbResponse[2].toString() === 'register success') {
      this[IS_ONLINE] = true;
      this[LOGIN_LOCK] = false;
      this[HEARTBEAT] = setInterval(async () => {
        // Heartbeat.Alive
      }, this.interval * 1000);

      this[SSO_HEARTBEAT] = setInterval(async () => {
        // trpc
        const ssoHeartBeat = pb.encode({ 1: 1 });
        await this.sendUni('trpc.qq_new_tech.status_svc.StatusService.SsoHeartBeat', ssoHeartBeat);
      }, this.ssoInterval * 1000);

      this.emit(
        'internal.token',
        JSON.stringify({
          Uin: this.uin,
          Uid: this.uid,
          PasswordMd5: '',
          Session: {
            TempPassword: this.sig.tempPwd.toString('base64'),
          },
        }),
      );
    } else {
      this.emit('internal.error.token');
    }
  } catch {
    this.emit('internal.error.network', -3, 'server is busy(register)');
  }
}

async function packetListener(this: BaseClient, pkt: Buffer) {
  this.statistics.recvPacketCount++;

  try {
    const flag = pkt.readUInt8(4);
    const encrypted = pkt.slice(pkt.readUInt32BE(6) + 6);
    let decrypted;
    switch (flag) {
      case 0:
        decrypted = encrypted;
        break;
      case 1:
        decrypted = tea.decrypt(encrypted, this.sig.d2Key);
        break;
      case 2:
        decrypted = tea.decrypt(encrypted, BUF16);
        break;
      default:
        this.emit('internal.error.token');
        throw new Error('unknown flag:' + flag);
    }
    const sso = await parseSso.call(this, decrypted);
    this.emit('internal.verbose', `recv:${sso.cmd} seq:${sso.seq}`, LogLevel.Debug);
    if (this[HANDLERS].has(sso.seq)) {
      this[HANDLERS].get(sso.seq)?.(sso.payload);
    } else {
      this.emit('internal.sso', sso.cmd, sso.payload, sso.seq);
    }
  } catch (e) {
    this.emit('internal.verbose', e, LogLevel.Error);
  }
}

async function parseSso(this: BaseClient, buf: Buffer) {
  const headlen = buf.readUInt32BE();
  const seq = buf.readInt32BE(4);
  const retcode = buf.readInt32BE(8);
  if (retcode !== 0) {
    this.emit('internal.error.token');
    throw new Error('unsuccessful retcode: ' + retcode);
  }
  let offset = buf.readUInt32BE(12) + 12;
  let len = buf.readUInt32BE(offset); // length of cmd
  const cmd = String(buf.slice(offset + 4, offset + len));
  offset += len;
  len = buf.readUInt32BE(offset); // length of session_id
  offset += len;
  const flag = buf.readInt32BE(offset);
  let payload;
  if (flag === 0) {
    payload = buf.slice(headlen + 4);
  } else if (flag === 1) {
    payload = await unzip(buf.slice(headlen + 4));
  } else if (flag === 8) {
    payload = buf.slice(headlen);
  } else {
    throw new Error('unknown compressed flag: ' + flag);
  }

  return { seq, cmd, payload };
}

function readTlv(r: Readable) {
  const t: { [tag: number]: Buffer } = {};
  while (r.readableLength > 2) {
    const k = r.read(2).readUInt16BE() as number;
    t[k] = r.read(r.read(2).readUInt16BE());
  }
  return t;
}

async function buildUniPacket(this: BaseClient, cmd: string, body: Uint8Array, seq: number = 0) {
  seq = seq || this[FN_NEXT_SEQ]();
  this.emit('internal.verbose', `send:${cmd} seq:${seq}`, LogLevel.Debug);

  let head;
  const sign = await getSign.call(this, cmd, seq, Buffer.from(body));
  if (sign) {
    head = pb.encode({
      15: trace(),
      16: this.uid,
      24: {
        1: Buffer.from(sign.sign, 'hex'),
        2: Buffer.from(sign.token, 'hex'),
        3: Buffer.from(sign.extra, 'hex'),
      },
    });
  } else {
    head = pb.encode({
      15: trace(),
      16: this.uid,
    });
  }

  const ssoHeader = new Writer()
    .writeU32(seq)
    .writeU32(this.appInfo.subAppId)
    .writeU32(2052) // locale id
    .writeBytes(Buffer.from('020000000000000000000000', 'hex'))
    .writeWithLength(this.sig.tgt)
    .writeWithLength(cmd)
    .writeWithLength(BUF0) // unknown
    .writeWithLength(this.deviceInfo.guid)
    .writeWithLength(BUF0) // unknown
    .writeU16(this.appInfo.currentVersion.length + 2) // withPrefix + Uint32
    .writeBytes(this.appInfo.currentVersion)
    .writeWithLength(head)
    .read();

  const ssoPacket = new Writer().writeWithLength(ssoHeader).writeWithLength(body).read();
  const encrypted = tea.encrypt(ssoPacket, this.sig.d2Key);

  const service = new Writer()
    .writeU32(12) // Service Type 12
    .writeU8(this.sig.d2.length == 0 ? 2 : 1)
    .writeWithLength(this.sig.d2)
    .writeU8(0)
    .writeWithLength(this.uin.toString())
    .writeBytes(encrypted)
    .read();

  return new Writer().writeWithLength(service).read();
}

type wtlogin = 'wtlogin.login' | 'wtlogin.trans_emp';

function buildCode2dPacket(this: BaseClient, cmdid: number, body: Buffer) {
  body = new Writer()
    .writeU8(0)
    .writeU16(53 + body.length)
    .writeU32(this.appInfo.appId)
    .writeU32(0x72)
    .writeBytes(Buffer.alloc(3))
    .writeU32(timestamp())
    .writeU8(0x02) // packetstart

    .writeU16(49 + body.length)
    .writeU16(cmdid)
    .writeBytes(Buffer.alloc(21))
    .writeU8(3)
    .writeU32(50)
    .writeBytes(Buffer.alloc(14))
    .writeU32(this.appInfo.appId)
    .writeBytes(body)
    .read();

  return buildLoginPacket.call(this, 'wtlogin.trans_emp', body);
}

function buildLoginPacket(this: BaseClient, cmd: wtlogin, body: Buffer) {
  const encrypted = tea.encrypt(body, this[ECDH192].shareKey);

  const writer = new Writer()
    .writeU16(8001) // ver
    .writeU16(cmd == 'wtlogin.login' ? 2064 : 2066)
    .writeU16(0) // dummy sequence
    .writeU32(this.uin)
    .writeU8(3) // extVer
    .writeU8(135) // cmdVer
    .writeU32(0)
    .writeU8(19)
    .writeU16(0) // insid
    .writeU16(this.appInfo.appClientVersion)
    .writeU32(0) // retryTime
    .writeU8(1)
    .writeU8(1)
    .writeBytes(BUF16)
    .writeU16(0x102)
    .writeU16(this[ECDH192].publicKey.length)
    .writeBytes(this[ECDH192].publicKey)
    .writeBytes(encrypted)
    .writeU8(3)
    .read();

  const frame = new Writer()
    .writeU8(2)
    .writeU16(writer.length + 2 + 1)
    .writeBytes(writer)
    .read();

  return buildUniPacket.call(this, cmd, frame);
}

/** cridential type could be Tlv106**/
function buildNTLoginPacketBody(this: BaseClient, credential: Buffer) {
  const proto: Encodable = {
    1: {
      1: {
        1: this.uin.toString(),
      },
      2: {
        1: this.appInfo.os,
        2: this.deviceInfo.deviceName,
        3: this.appInfo.NTLoginType,
        4: Buffer.from(this.deviceInfo.guid, 'hex'),
      },
      3: {
        1: this.deviceInfo.kernelVersion,
        2: this.appInfo.appId,
        3: this.appInfo.packageName,
      },
    },
    2: {
      1: credential,
    },
  };
  if (this.sig.cookies !== '') proto[1][5][1] = this.sig.cookies;

  return pb.encode({
    1: this.sig.keySig,
    3: aesGcmEncrypt(pb.encode(proto), this.sig.exchangeKey),
    4: 1,
  });
}

function decodeNTLoginResponse(this: BaseClient, encrypted: Buffer): LoginErrorCode {
  const rawPb = pb.decode(encrypted);
  const decrypted = aesGcmDecrypt(rawPb[3].toBuffer(), this.sig.exchangeKey);
  const inner = pb.decode(decrypted);

  if (inner[2][1]) {
    this.sig.tgt = inner[2][1][4].toBuffer();
    this.sig.d2 = inner[2][1][5].toBuffer();
    this.sig.d2Key = inner[2][1][6].toBuffer();
    this.sig.tempPwd = inner[2][1][3].toBuffer();

    register.call(this).then(() => {
      if (this[IS_ONLINE]) {
        this.emit('internal.online', this.sig.tempPwd, '', 0, 0);
      }
    });
  } else {
    this.sig.unusualSig = inner[2][3][2].toBuffer();
    this.sig.cookies = inner[1][5][1].toString();
  }

  try {
    return Number(inner[1][4][1] ?? 0);
  } catch {
    return 0;
  }
}

function decodeT119(this: BaseClient, t119: Buffer) {
  const r = Readable.from(tea.decrypt(t119, this.sig.tgtgt), { objectMode: false });
  r.read(2);
  const t = readTlv(r);
  this.sig.tgt = t[0x10a] || this.sig.tgt;
  this.sig.d2 = t[0x143] ? t[0x143] : this.sig.d2;
  this.sig.d2Key = t[0x305] || this.sig.d2Key;
  this.sig.tgtgt = md5(this.sig.d2Key);
  this.sig.tempPwd = t[0x106];
  this.uid = pb.decode(t[0x543])[9][11][1].toString();

  const token = t[0x106];
  const age = t[0x11a].slice(2, 3).readUInt8();
  const gender = t[0x11a].slice(3, 4).readUInt8();
  const nickname = String(t[0x11a].slice(5));
  return { token, nickname, gender, age };
}

async function decodeLoginResponse(this: BaseClient, payload: Buffer) {
  payload = tea.decrypt(payload.slice(16, payload.length - 1), this[ECDH192].shareKey);
  const r = Readable.from(payload, { objectMode: false });
  r.read(2);
  const type = r.read(1).readUInt8() as number;
  r.read(2);
  const t = readTlv(r);

  if (type === 0) {
    const { token, nickname, gender, age } = decodeT119.call(this, t[0x119]);
    await register.call(this).then(() => {
      if (this[IS_ONLINE]) {
        this.emit('internal.online', token, nickname, gender, age);
        return true;
      }
    });
  }

  if (t[0x149]) {
    const stream = Readable.from(t[0x149], { objectMode: false });
    stream.read(2);
    const title = stream.read(stream.read(2).readUInt16BE()).toString();
    const content = stream.read(stream.read(2).readUInt16BE()).toString();
    return this.emit('internal.error.login', type, `[${title}]${content}`);
  }

  if (t[0x146]) {
    const stream = Readable.from(t[0x146], { objectMode: false });
    const version = stream.read(4);
    const title = stream.read(stream.read(2).readUInt16BE()).toString();
    const content = stream.read(stream.read(2).readUInt16BE()).toString();
    return this.emit('internal.error.login', type, `[${title}]${content}`);
  }

  this.emit('internal.error.login', type, `[登陆失败]未知错误`);
  return false;
}
