import * as path from "path";
import * as fs from "fs";
import * as log4js from "log4js"

import {BaseClient, DeviceInfo, generateDeviceInfo, Platform} from "./core";
import {EventMap} from "./events";
import {md5, NOOP} from "./core/constants";
import {bindInternalListeners} from "./internal/listener";
import {FriendInfo, GroupInfo, MemberInfo} from "./entities";

export interface Client extends BaseClient {
    on<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this

    on<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: this, ...args: any[]) => void): this

    once<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this

    once<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: this, ...args: any[]) => void): this

    prependListener<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this

    prependListener(event: string | symbol, listener: (this: this, ...args: any[]) => void): this

    prependOnceListener<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this

    prependOnceListener(event: string | symbol, listener: (this: this, ...args: any[]) => void): this

    off<T extends keyof EventMap>(event: T, listener: EventMap<this>[T]): this

    off<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, listener: (this: this, ...args: any[]) => void): this
}

export class Client extends BaseClient {
    readonly logger: Logger;
    readonly directory: string;
    readonly config: Required<Config>;
    readonly token: SavedToken;

    readonly friendList = new Map<number, FriendInfo>();
    readonly groupList = new Map<number, GroupInfo>();
    readonly memberList = new Map<number, Map<number, MemberInfo>>()


    groupListCallback?: Function;

    constructor(uin: number, conf?: Config) {
        const config = {
            logLevel: "info" as LogLevel,
            platform: Platform.Linux,
            autoServer: true,
            ignoreSelf: true,
            reConnInterval: 5,
            dataDirectory: path.join(require?.main?.path || process.cwd(), "data"),
            ...conf,
        };

        const dir = createDataDir(config.dataDirectory, uin);
        const deviceFile = path.join(dir, `device-${uin}.json`);
        const tokenFile = path.join(dir, `token-${uin}.json`);
        let regenerate, device, token;
        try {
            device = require(deviceFile) as DeviceInfo;
            regenerate = false;
        }
        catch {
            device = generateDeviceInfo(uin);
            regenerate = true;
            fs.writeFileSync(deviceFile, JSON.stringify(device, null, 4));
        }

        try {
            token = require(tokenFile) as SavedToken;
        }
        catch {
            token = null;
        }
        super(uin, token?.Uid ?? "", config.platform);

        this.logger = log4js.getLogger(`[${this.deviceInfo.deviceName}:${uin}]`);
        (this.logger as log4js.Logger).level = config.logLevel;
        if (regenerate) this.logger.mark("创建了新的设备文件：" + deviceFile);
        if (!token) this.logger.mark("未找到token缓存, 使用扫码登录");

        this.directory = dir;
        this.config = config as Required<Config>;
        this.token = token ?? {
            Uin: uin,
            Uid: "",
            PasswordMd5: "",
            Session: {
                TempPassword: ""
            }
        } as SavedToken;

        bindInternalListeners.call(this);
        this.on("internal.verbose", (verbose, level) => {
            const list: Exclude<LogLevel, "off">[] = ["fatal", "mark", "error", "warn", "info", "trace"]
            this.logger[list[level]](verbose)
        });

        if (!this.config.autoServer) this.setRemoteServer("msfwifi.3g.qq.com", 8080);
    }

    async login(password?: string | Buffer) {
        if (password && password.length > 0) {
            let md5pass;
            if (typeof password === "string") md5pass = Buffer.from(password, "hex");
            else md5pass = password;
            if (md5pass.length !== 16) md5pass = md5(String(password));

            this.token.PasswordMd5 = md5pass.toString("hex");
        }
        try {
            return await this.tokenLogin(Buffer.from(this.token.Session.TempPassword, "base64")); // EasyLogin
        }
        catch(e) {
            if (this.token.PasswordMd5 && this.token.Uid) { // 检测Uid的目的是确保之前登陆过
                return await this.passwordLogin(Buffer.from(this.token.PasswordMd5, "hex"));
            }
            else {
                return await (this.sig.qrSig.length ? this.qrcodeLogin() : this.fetchQrcode());
            }
        }
    }
}

function createDataDir(dir: string, uin: number) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o755, recursive: true });
    const imgPath = path.join(dir, "image");
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
    logLevel?: LogLevel
    /** 1:Linux(Default) 2:MacOs 3:Windows*/
    platform?: Platform
    /** 群聊和频道中过滤自己的消息(默认true) */
    ignoreSelf?: boolean
    /** 数据存储文件夹，需要可写权限，默认主模块下的data文件夹 */
    dataDirectory?: string
    /**
     * 触发system.offline.network事件后的重新登录间隔秒数，默认5(秒)，不建议设置过低
     * 设置为0则不会自动重连，然后你可以监听此事件自己处理
     */
    reConnInterval?: number
    /** 自动选择最优服务器(默认true)，关闭后会一直使用`msfwifi.3g.qq.com:8080`进行连接 */
    autoServer?: boolean
}

export interface SavedToken {
    Uin: number,
    Uid: string,
    PasswordMd5: string,
    Session: {
        TempPassword: string
    }
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off";
export type Statistics = Client["statistics"];

export function createClient(uin: number, config?: Config) {
    if (isNaN(Number(uin))) throw new Error(uin + " is not an QQ account");
    return new Client(Number(uin), config);
}