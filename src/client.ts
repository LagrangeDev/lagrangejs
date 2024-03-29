import * as path from 'path';
import * as fs from 'fs';
import * as log4js from 'log4js';
import * as pb from './core/protobuf';

import { BaseClient, DeviceInfo, generateDeviceInfo, Platform } from './core';
import { EventMap } from './events';
import { md5 } from './core/constants';
import { bindInternalListeners } from './internal/listener';
import { Friend } from './entities/friend';
import { Group } from './entities/group';
import { GroupMember } from './entities/groupMember';
import { LoginErrorCode } from './errors';
import { UserMap } from '@/entities/user';
import { Sendable } from '@/message/elements';

export interface Client extends BaseClient {
    on<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this;

    on<S extends string | symbol>(
        event: S & Exclude<S, keyof EventMap>,
        listener: (this: this, ...args: any[]) => void,
    ): this;

    once<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this;

    once<S extends string | symbol>(
        event: S & Exclude<S, keyof EventMap>,
        listener: (this: this, ...args: any[]) => void,
    ): this;

    prependListener<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this;

    prependListener(event: string | symbol, listener: (this: this, ...args: any[]) => void): this;

    prependOnceListener<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this;

    prependOnceListener(event: string | symbol, listener: (this: this, ...args: any[]) => void): this;

    off<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this;

    off<S extends string | symbol>(
        event: S & Exclude<S, keyof EventMap>,
        listener: (this: this, ...args: any[]) => void,
    ): this;
}

export class Client extends BaseClient {
    readonly logger: Logger;
    readonly directory: string;
    readonly config: Required<Config>;
    readonly token: SavedToken;

    readonly friendList = new UserMap<number, Friend.Info>();
    readonly groupList = new Map<number, Group.Info>();
    readonly memberList = new Map<number, UserMap<number, GroupMember.Info>>();
    get cacheDir() {
        const dir = path.resolve(this.directory, '../image');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        return dir;
    }
    pickFriend = Friend.from.bind(this);
    pickGroup = Group.from.bind(this);
    pickMember = GroupMember.from.bind(this);

    constructor(uin: number, conf?: Config) {
        const config = {
            logLevel: 'info' as LogLevel,
            platform: Platform.Linux,
            autoServer: true,
            ignoreSelf: true,
            cacheMember: true,
            reConnInterval: 5,
            dataDirectory: path.join(process.cwd(), 'data'),
            ...conf,
        };

        const dir = createDataDir(config.dataDirectory, uin);
        const deviceFile = path.join(dir, `device-${uin}.json`);
        const tokenFile = path.join(dir, `token-${uin}.json`);
        let regenerate, device, token;
        try {
            device = require(deviceFile) as DeviceInfo;
            regenerate = false;
        } catch {
            device = generateDeviceInfo(uin);
            regenerate = true;
            fs.writeFileSync(deviceFile, JSON.stringify(device, null, 4));
        }

        try {
            token = require(tokenFile) as SavedToken;
        } catch {
            token = null;
        }
        super(uin, device, token?.Uid ?? '', config.platform);
        this.sig.signApiAddr = config.signApiAddr || this.sig.signApiAddr;
        this.logger = log4js.getLogger(`[${this.deviceInfo.deviceName}:${uin}]`);
        (this.logger as log4js.Logger).level = config.logLevel;
        if (regenerate) this.logger.mark('创建了新的设备文件：' + deviceFile);

        this.directory = dir;
        this.config = config as Required<Config>;
        this.token =
            token ??
            ({
                Uin: uin,
                Uid: '',
                PasswordMd5: '',
                Session: {
                    TempPassword: '',
                },
            } as SavedToken);

        bindInternalListeners.call(this);
        this.on('internal.verbose', (verbose, level) => {
            const list: Exclude<LogLevel, 'off'>[] = ['fatal', 'mark', 'error', 'warn', 'info', 'trace'];
            this.logger[list[level]](verbose);
        });

        if (!this.config.autoServer) this.setRemoteServer('msfwifi.3g.qq.com', 8080);
    }

    /** emit an event */
    em(name = '', data?: any) {
        data = Object.defineProperty(data || {}, 'self_id', {
            value: this.uin,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        while (true) {
            this.emit(name, data);
            const i = name.lastIndexOf('.');
            if (i === -1) break;
            name = name.slice(0, i);
        }
    }

    async login(password?: string | Buffer) {
        if (password && password.length > 0) {
            let md5pass;
            if (typeof password === 'string') md5pass = Buffer.from(password, 'hex');
            else md5pass = password;
            if (md5pass.length !== 16) md5pass = md5(String(password));

            this.token.PasswordMd5 = md5pass.toString('hex');
        }

        if (this.token.Session.TempPassword)
            try {
                const code = await this.tokenLogin(Buffer.from(this.token.Session.TempPassword, 'base64')); // EasyLogin
                if (!code) return code;
            } catch (e) {
                /* empty */
            }

        if (this.token.PasswordMd5 && this.token.Uid) {
            // 检测Uid的目的是确保之前登陆过
            return await this.passwordLogin(Buffer.from(this.token.PasswordMd5, 'hex'));
        } else {
            return await (this.sig.qrSig.length ? this.qrcodeLogin() : this.fetchQrcode());
        }

        return LoginErrorCode.UnusualVerify;
    }

    async fetchClientKey() {
        const response = await this.sendOidbSvcTrpcTcp(0x102a, 1, new Uint8Array(), false);
        const packet = pb.decode(response);

        return packet[4][3].toString();
    }

    async fetchCookies(domains: string[]) {
        const proto = pb.encode({ 1: domains });
        const response = await this.sendOidbSvcTrpcTcp(0x102a, 0, proto, false);
        const packet = pb.decode(response);

        const cookies: string[] = [];
        for (let cookie of packet[1]) cookies.push(cookie[2].toString());

        return cookies;
    }

    async fetchHighwayTicket() {
        const body = pb.encode({
            1281: {
                1: this.uin,
                2: 0,
                3: 16,
                4: 1,
                6: 3,
                7: 5,
            },
        });
        const payload = await this.sendUni('HttpConn.0x6ff_501', body);
        const rsp = pb.decode(payload)[1281];
        return rsp[1].toBuffer();
    }

    sendOidbSvcTrpcTcp(cmd: number, subCmd: number, buffer: Uint8Array, isUid = false, isAfter = false) {
        const command = `OidbSvcTrpcTcp.0x${cmd.toString(16)}_${subCmd}`;

        const result = pb.encode({
            1: cmd,
            2: subCmd,
            4: buffer,
            7: isAfter
                ? {
                      1: 0,
                      2: [],
                      3: this.appInfo.subAppId,
                  }
                : null,
            12: isUid,
        });
        return this.sendUni(command, result);
    }
}

function createDataDir(dir: string, uin: number) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o755, recursive: true });
    const imgPath = path.join(dir, 'image');
    const uinPath = path.join(dir, String(uin));
    if (!fs.existsSync(imgPath)) fs.mkdirSync(imgPath);
    if (!fs.existsSync(uinPath)) fs.mkdirSync(uinPath, { mode: 0o755 });
    return uinPath;
}

export interface Logger {
    trace(msg: any, ...args: any[]): any;
    debug(msg: any, ...args: any[]): any;
    info(msg: any, ...args: any[]): any;
    warn(msg: any, ...args: any[]): any;
    error(msg: any, ...args: any[]): any;
    fatal(msg: any, ...args: any[]): any;
    mark(msg: any, ...args: any[]): any;
}

export interface Config {
    /** 日志等级，默认info (打印日志会降低性能，若消息量巨大建议修改此参数) */
    logLevel?: LogLevel;
    /** 1:Linux(Default) 2:MacOs 3:Windows*/
    platform?: Platform;
    /** 群聊和频道中过滤自己的消息(默认true) */
    ignoreSelf?: boolean;
    cacheMember?: boolean;
    /** 数据存储文件夹，需要可写权限，默认主模块下的data文件夹 */
    dataDirectory?: string;
    /**
     * 触发system.offline.network事件后的重新登录间隔秒数，默认5(秒)，不建议设置过低
     * 设置为0则不会自动重连，然后你可以监听此事件自己处理
     */
    reConnInterval?: number;
    /** 自动选择最优服务器(默认true)，关闭后会一直使用`msfwifi.3g.qq.com:8080`进行连接 */
    autoServer?: boolean;
    /** 签名API地址 */
    signApiAddr?: string;
    /** ffmpeg */
    ffmpegPath?: string;
    ffprobePath?: string;
}

export interface SavedToken {
    Uin: number;
    Uid: string;
    PasswordMd5: string;
    Session: {
        TempPassword: string;
    };
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'mark' | 'off';
export type Statistics = Client['statistics'];

export function createClient(uin: number, config?: Config) {
    if (isNaN(Number(uin))) throw new Error(uin + ' is not an QQ account');
    return new Client(Number(uin), config);
}
