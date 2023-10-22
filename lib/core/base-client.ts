import { EventEmitter } from 'events';
import { randomBytes } from "crypto";
import { Readable } from "stream";
import {aesGcmDecrypt, aesGcmEncrypt, BUF0, BUF16, hide, lock, sha256, timestamp, trace, unzip} from "./constants";
import { AppInfo, DeviceInfo, generateDeviceInfo, getAppInfo, Platform } from "./device";
import {Encodable} from "./protobuf";
import {getRawTlv} from "./tlv";
import {LoginErrorCode} from "../errors";

import Network from "./network";
import Ecdh from "./ecdh";
import Writer from "./writer";

import * as pb from "./protobuf";
import * as tea from "./tea";
import * as tlv from "./tlv";


const FN_NEXT_SEQ = Symbol("FN_NEXT_SEQ");
const FN_SEND = Symbol("FN_SEND");
const HANDLERS = Symbol("HANDLERS");
const NET = Symbol("NET");
const ECDH256 = Symbol("ECDH256");
const ECDH192 = Symbol("ECDH192");
const IS_ONLINE = Symbol("IS_ONLINE");
const LOGIN_LOCK = Symbol("LOGIN_LOCK");
const HEARTBEAT = Symbol("HEARTBEAT");
const SSO_HEARTBEAT = Symbol("SSO_HEARTBEAT");
const EVENT_KICKOFF = Symbol("EVENT_KICKOFF");

export class ApiRejection {
    constructor(public code: number, public message = "unknown") {
        this.code = Number(this.code)
        this.message = this.message?.toString() || "unknown"
    }
}

export enum LogLevel {
    Fatal, Mark, Error, Warn, Info, Debug
}

export enum QrcodeResult {
    OtherError = 0,
    Timeout = 0x11,
    WaitingForScan = 0x30,
    WaitingForConfirm = 0x35,
    Canceled = 0x36,
}

export interface BaseClient {
    /** 收到二维码 */
    on(name: "internal.qrcode", listener: (this: this, qrcode: Buffer) => void): this

    /** 收到滑动验证码 */
    on(name: "internal.slider", listener: (this: this, url: string) => void): this

    /** 登录保护验证 */
    on(name: "internal.verify", listener: (this: this, url: string, phone: string) => void): this

    /** token过期(此时已掉线) */
    on(name: "internal.error.token", listener: (this: this) => void): this

    /** 网络错误 */
    on(name: "internal.error.network", listener: (this: this, code: number, message: string) => void): this;

    /** 密码登录相关错误 */
    on(name: "internal.error.login", listener: (this: this, code: number, message: string) => void): this;

    /** 扫码登录相关错误 */
    on(name: "internal.error.qrcode", listener: (this: this, code: QrcodeResult, message: string) => void): this;

    /** 登录成功 */
    on(name: "internal.online", listener: (this: this, token: Buffer, nickname: string, gender: number, age: number) => void): this;

    /** token更新 */
    on(name: "internal.token", listener: (this: this, token: Buffer) => void): this;

    /** 服务器强制下线 */
    on(name: "internal.kickoff", listener: (this: this, reason: string) => void): this;

    /** 业务包 */
    on(name: "internal.sso", listener: (this: this, cmd: string, payload: Buffer, seq: number) => void): this;

    /** 日志信息 */
    on(name: "internal.verbose", listener: (this: this, verbose: unknown, level: LogLevel) => void): this;

    on(name: string | symbol, listener: (this: this, ...args: any[]) => void): this;
}

export class BaseClient extends EventEmitter {

    private [IS_ONLINE] = false;
    private [LOGIN_LOCK] = false;
    private [ECDH256] = new Ecdh("exchange", false);
    private [ECDH192] = new Ecdh("wtlogin", true);
    private readonly [NET] = new Network();
    private readonly [HANDLERS] = new Map<number, (buf: Buffer) => void>();

    private [HEARTBEAT]: NodeJS.Timeout | undefined;
    private [SSO_HEARTBEAT]: NodeJS.Timeout | undefined;

    readonly appInfo: AppInfo;
    readonly deviceInfo: DeviceInfo;
    readonly sig = {
        seq: randomBytes(4).readUInt32BE() & 0xfff,
        tgtgt: BUF0,
        tgt: BUF0,
        d2: BUF0,
        d2Key: BUF16,
        qrSig: BUF0,

        exchangeKey: BUF0,
        keySig: BUF0,
        cookies: "",
        unusualSig: BUF0,
        tempPwd: BUF0
    }

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
        remoteIp: "",
        remotePort: 0,
    }

    constructor(public readonly uin: number, public readonly uid?: string, p: Platform = Platform.Linux, guid?: string) {
        super();
        this.appInfo = getAppInfo(p);
        this.deviceInfo = generateDeviceInfo(guid ?? uin);

        this[NET].on("error", err => this.emit("internal.verbose", err.message, LogLevel.Error));
        this[NET].on("close", () => {
            this.statistics.remoteIp = "";
            this.statistics.remotePort = 0;
            this[NET].remoteAddress && this.emit("internal.verbose", `${this[NET].remoteAddress}:${this[NET].remotePort} closed`, LogLevel.Mark);
        });
        this[NET].on("connect2", () => {
            this.statistics.remoteIp = this[NET].remoteAddress as string;
            this.statistics.remotePort = this[NET].remotePort as number;
            this.emit("internal.verbose", `${this[NET].remoteAddress}:${this[NET].remotePort} connected`, LogLevel.Mark);
        });
        this[NET].on("packet", packetListener.bind(this));
        this[NET].on("lost", lostListener.bind(this));

        this.on("internal.online", onlineListener);
        this.on("internal.sso", ssoListener);

        lock(this, "uin");
        lock(this, "uid");
        lock(this, "appInfo");
        lock(this, "device");
        lock(this, "sig");
        lock(this, "statistics");
        hide(this, "heartbeat");
        hide(this, "interval");
        hide(this, "ssoInterval");
    }

    setRemoteServer(host?: string, port?: number) {
        if (host && port) {
            this[NET].host = host;
            this[NET].port = port;
            this[NET].autoSearch = false;
        }
        else {
            this[NET].autoSearch = true;
        }
    }

    isOnline() {
        return this[IS_ONLINE];
    }

    async logout(keepalive = false) {
        if (!keepalive && this[NET].connected) {
            this.terminate()
            await new Promise(resolve => this[NET].once("close", resolve))
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
            .writeBytes(t(0x1B, true))
            .writeBytes(t(0x1D, true))
            .writeBytes(t(0x33, true))
            .writeBytes(t(0x35, true))
            .writeBytes(t(0x66, true))
            .writeBytes(t(0xd1, true)).read();
        const packet = buildCode2dPacket.call(this, 0x31, body);

        this[FN_SEND](packet).then(payload => {
            payload = tea.decrypt(payload.slice(16, -1), this[ECDH192].shareKey);
            const stream = Readable.from(payload, {objectMode: false});
            stream.read(54);
            const retcode = stream.read(1)[0];
            const qrsig = stream.read(stream.read(2).readUInt16BE());
            stream.read(2);
            const t = readTlv(stream);
            if (!retcode && t[0x17]) {
                this.sig.qrSig = qrsig;
                this.emit("internal.qrcode", t[0x17]);
            }
            else {
                this.emit("internal.error.qrcode", retcode, "获取二维码失败，请重试");
            }
        }).catch(() => this.emit("internal.error.network", -2, "server is busy"));
    }

    async queryQrcodeResult() {
        let retcode = -1, uin, t106, t16a, t318, tgtgt
        if (!this.sig.qrSig.length)  return { retcode, uin, t106, t16a, t318, tgtgt }
        const body = new Writer()
            .writeTlv(this.sig.qrSig)
            .writeU64(0)
            .writeU32(0)
            .writeU8(0)
            .writeU16(0).read();
        const pkt = buildCode2dPacket.call(this, 0x12, body);

        try {
            let payload = await this[FN_SEND](pkt);
            payload = tea.decrypt(payload.slice(16, -1), this[ECDH192].shareKey);
            const stream = Readable.from(payload, { objectMode: false });
            stream.read(48);
            let len = stream.read(2).readUInt16BE();
            if (len > 0) {
                len--;
                if (stream.read(1)[0] === 2) {
                    stream.read(8);
                    len -= 8;
                }
                if (len > 0) stream.read(len);
            }
            stream.read(4)
            retcode = stream.read(1)[0]
            if (retcode === 0) {
                stream.read(4);
                uin = stream.read(4).readUInt32BE() as number;
                stream.read(6);
                const t = readTlv(stream);
                t106 = t[0x18];
                t16a = t[0x19];
                t318 = t[0x65];
                tgtgt = t[0x1e];
            }
        }
        catch {
        }
        return { retcode, uin, t106, t16a, t318, tgtgt };
    }

    async qrcodeLogin() {
        const { retcode, uin, t106, t16a, t318, tgtgt } = await this.queryQrcodeResult();
        if (retcode < 0) {
            this.emit("internal.error.network", -2, "server is busy");
        }
        else if (retcode === 0 && t106 && t16a && t318 && tgtgt) {

            const t = tlv.getPacker(this)
            const body = new Writer()
                .writeU16(0x106).writeTlv(t106)
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
                .writeU16(0x16a).writeTlv(t16a)
                .writeBytes(t(0x166))
                .writeBytes(t(0x521)).read();

            const login = buildLoginPacket.call(this, "wtlogin.login", body)
            const response = await this.sendUni("wtlogin.login", login);
        }
    }

    async keyExchange() {
        const plain1 = pb.encode({
            1: this.uin,
            2: this.deviceInfo.guid
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
        const gcmCalc2 = aesGcmEncrypt(hash, Buffer.from("e2733bf403149913cbf80c7a95168bd4ca6935ee53cd39764beebe2e007e3aee", "hex"))

        const packet = pb.encode({
            1: this[ECDH256].publicKey,
            2: 1,
            3: gcmCalc1,
            4: ts,
            5: gcmCalc2
        });

        const resp = await this.sendUni("trpc.login.ecdh.EcdhService.SsoKeyExchange", packet);
        const pbResp = pb.decode(resp);
        const shareKey = this[ECDH256].exchange(pbResp[3].toBuffer());
        const decrypted = aesGcmDecrypt(pbResp[1].toBuffer(), shareKey);
        const pbDecrypted = pb.decode(decrypted);

        this.sig.exchangeKey = pbDecrypted[1].toBuffer();
        this.sig.keySig = pbDecrypted[2].toBuffer();
    }

    async tokenLogin(token: Buffer) {
        if (!this.sig.keySig || !this.sig.exchangeKey) await this.keyExchange();

        const packet = buildNTLoginPacketBody.call(this, token);
        const response = await this.sendUni("trpc.login.ecdh.EcdhService.SsoNTLoginEasyLogin", packet);
        parseNTLoginPacketBody.call(this, response);
    }

    async passwordLogin(md5: Buffer) {
        if (!this.sig.keySig || !this.sig.exchangeKey) await this.keyExchange();

        const packet = buildNTLoginPacketBody.call(this, getRawTlv(this, 0x106, false, md5));
        const response = await this.sendUni("trpc.login.ecdh.EcdhService.SsoNTLoginPasswordLogin", packet);
        parseNTLoginPacketBody.call(this, response);
    }

    terminate() {
        this[IS_ONLINE] = false
        this[NET].destroy()
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
                    this[HANDLERS].set(seq, (payload) => {
                        clearTimeout(id);
                        this[HANDLERS].delete(seq);
                        resolve(payload);
                    });
                });
            });
        });
    }

    writeUni(cmd: string, body: Uint8Array, seq = 0) {
        this.statistics.sendPacketCount++
        this[NET].write(buildUniPacket.call(this, cmd, body, seq))
    }

    /** 发送一个业务包并等待返回 */
    async sendUni(cmd: string, body: Uint8Array, timeout = 5) {
        return this[FN_SEND](buildUniPacket.call(this, cmd, body), timeout);
    }
}

function onlineListener(this: BaseClient) {
    if (!this.listenerCount(EVENT_KICKOFF)) {
        this.once(EVENT_KICKOFF, (msg: string) => {
            this[IS_ONLINE] = false;
            clearInterval(this[HEARTBEAT]);
            clearInterval(this[SSO_HEARTBEAT]);

            this.emit("internal.kickoff", msg);
        })
    }
}

function ssoListener(this: BaseClient, cmd: string, payload: Buffer, seq: number) {

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
                4: "",
                5: this.appInfo.vendorOs
            },
            7: false, // setMute
            8: false, // registerVendorType
            9: true // regType
        });
        const response = await this.sendUni("trpc.qq_new_tech.status_svc.StatusService.Register", packet);
        const pbResponse = pb.decode(response);

        if (pbResponse[2] === "success") {
            this[IS_ONLINE] = true;
            this[HEARTBEAT] = setInterval(async () => { // Heartbeat.Alive

            }, this.interval * 1000);

            this[SSO_HEARTBEAT] = setInterval(async() => { // trpc
                const ssoHeartBeat = pb.encode({ 1: 1 });
                await this.sendUni("trpc.qq_new_tech.status_svc.StatusService.SsoHeartBeat", ssoHeartBeat);
            }, this.ssoInterval * 1000);
        }
        else {
            this.emit("internal.error.token");
        }
    }
    catch {
        this.emit("internal.error.network", -3, "server is busy(register)")
    }
}

async function packetListener(this: BaseClient, pkt: Buffer) {
    this.statistics.recvPacketCount++;
    this[LOGIN_LOCK] = false;

    try {
        const flag = pkt.readUInt8(4);
        const encrypted = pkt.slice(pkt.readUInt32BE(6) + 6);
        let decrypted;
        switch (flag) {
            case 0:
                decrypted = encrypted;
                break
            case 1:
                decrypted = tea.decrypt(encrypted, this.sig.d2Key);
                break
            case 2:
                decrypted = tea.decrypt(encrypted, BUF16);
                break
            default:
                this.emit("internal.error.token");
                throw new Error("unknown flag:" + flag);
        }
        const sso = await parseSso.call(this, decrypted);
        this.emit("internal.verbose", `recv:${sso.cmd} seq:${sso.seq}`, LogLevel.Debug);
        if (this[HANDLERS].has(sso.seq)) {
            this[HANDLERS].get(sso.seq)?.(sso.payload);
        }
        else {
            this.emit("internal.sso", sso.cmd, sso.payload, sso.seq);
        }
    }
    catch (e) {
        this.emit("internal.verbose", e, LogLevel.Error);
    }
}

async function parseSso(this: BaseClient, buf: Buffer) {
    const headlen = buf.readUInt32BE();
    const seq = buf.readInt32BE(4);
    const retcode = buf.readInt32BE(8);
    if (retcode !== 0) {
        this.emit("internal.error.token");
        throw new Error("unsuccessful retcode: " + retcode);
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
    }
    else if (flag === 1) {
        payload = await unzip(buf.slice(headlen + 4));
    }
    else if (flag === 8) {
        payload = buf.slice(headlen);
    }
    else {
        throw new Error("unknown compressed flag: " + flag);
    }

    return { seq, cmd, payload }
}

function readTlv(r: Readable) {
    const t: { [tag: number]: Buffer } = { };
    while (r.readableLength > 2) {
        const k = r.read(2).readUInt16BE() as number;
        t[k] = r.read(r.read(2).readUInt16BE());
    }
    return t;
}

function buildUniPacket(this: BaseClient, cmd: string, body: Uint8Array, seq: number = 0) {
    seq = seq || this[FN_NEXT_SEQ]();
    this.emit("internal.verbose", `send:${cmd} seq:${seq}`, LogLevel.Debug)

    const headSign = pb.encode({
        15: trace(),
        16: this.uid,
        24: {
            1: Buffer.alloc(20), // TODO: Sign
            3: {
                2: this.appInfo.packageSign
            } // TODO: Extra
        }
    });

    const ssoHeader = new Writer()
        .writeU32(seq)
        .writeU32(this.appInfo.subAppId)
        .writeU32(2052) // locale id
        .writeBytes(Buffer.from("020000000000000000000000", "hex"))
        .writeWithLength(this.sig.tgt)
        .writeWithLength(cmd)
        .writeWithLength(BUF0) // unknown
        .writeWithLength(this.deviceInfo.guid)
        .writeWithLength(BUF0) // unknown
        .writeU16(this.appInfo.currentVersion.length + 2) // withPrefix + Uint32
        .writeBytes(this.appInfo.currentVersion)
        .writeWithLength(headSign).read();

    const ssoPacket = new Writer()
        .writeWithLength(ssoHeader)
        .writeWithLength(body).read();
    const encrypted = tea.encrypt(ssoPacket, this.sig.d2Key);

    const service = new Writer()
        .writeU32(12) // Service Type 12
        .writeU8(this.sig.d2.length == 0 ? 2 : 1)
        .writeWithLength(this.sig.d2)
        .writeU8(0)
        .writeWithLength(this.uin.toString())
        .writeBytes(encrypted).read();

    return new Writer().writeWithLength(service).read();
}

type wtlogin = "wtlogin.login" | "wtlogin.trans_emp";

function buildCode2dPacket(this: BaseClient, cmdid: number, body: Buffer) {
    body = new Writer()
        .writeU8(0)
        .writeU16(53 + body.length)
        .writeU32(this.appInfo.appId)
        .writeU32(0x72)
        .writeBytes(Buffer.alloc(3))
        .writeU32(timestamp())
        .writeU8(0x02) // packetstart

        .writeU16(44 + body.length)
        .writeU16(cmdid)
        .writeBytes(Buffer.alloc(21))
        .writeU8(3)
        .writeU32(50)
        .writeBytes(Buffer.alloc(11))
        .writeU32(this.appInfo.appId)
        .writeBytes(body).read();

    return buildLoginPacket.call(this, "wtlogin.trans_emp", body);
}

function buildLoginPacket(this: BaseClient, cmd: wtlogin, body: Buffer) {
    this[FN_NEXT_SEQ]();
    this.emit("internal.verbose", `send:${cmd} seq:${this.sig.seq}`, LogLevel.Debug);

    return buildUniPacket.call(this, cmd, body);
}

/** cridential type could be Tlv106**/
function buildNTLoginPacketBody(this: BaseClient, credential: Buffer) {
    const proto: Encodable = {
        1: {
            1: {
                1: this.uin.toString()
            },
            2: {
                1: this.appInfo.os,
                2: this.deviceInfo.deviceName,
                3: this.appInfo.NTLoginType,
                4: Buffer.from(this.deviceInfo.guid, "hex")
            },
            3: {
                1: this.deviceInfo.kernelVersion,
                2: this.appInfo.appId,
                3: this.appInfo.packageName
            }
        },
        2: credential
    };
    if (this.sig.cookies !== "") proto[1][5][1] = this.sig.cookies;

    return pb.encode({
        1: this.sig.keySig,
        3: aesGcmEncrypt(pb.encode(proto), this.sig.exchangeKey),
        4: 3
    });
}

function parseNTLoginPacketBody(this: BaseClient, encrypted: Buffer): LoginErrorCode {
    const rawPb = pb.decode(encrypted);
    const inner = pb.decode(aesGcmDecrypt(rawPb[3].toBuffer(), this.sig.exchangeKey));

    if (inner[2][1]) {
        this.sig.tgt = inner[2][1][4];
        this.sig.d2 = inner[2][1][5];
        this.sig.d2Key = inner[2][1][6];
        this.sig.tempPwd = inner[2][1][3].toBuffer();
    }
    else {
        this.sig.unusualSig = inner[2][3][2];
        this.sig.cookies = inner[1][5][1];
    }

    return Number(inner[1][4][1] ?? 0);
}