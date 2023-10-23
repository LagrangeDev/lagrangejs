import {LoginErrorCode} from "./errors";
import { PrivateMessage } from "./message/message";
import {Sendable} from "./message/elements";

export interface MessageRet {
    seq: number
    time: number
}

export interface MessageEvent {
    /**
     * 快速回复
     * @param content
     * @param quote 引用这条消息(默认false)
     */
    reply(content: Sendable, quote?: boolean): Promise<MessageRet>;
}

export interface PrivateMessageEvent extends PrivateMessage, MessageEvent {
    /** 好友对象 */
}

export interface EventMap<T = any> {
    /** 收到二维码 */
    "system.login.qrcode": (this: T, event: { image: Buffer }) => void
    /** 收到滑动验证码 */
    "system.login.slider": (this: T, event: { url: string }) => void
    /** 设备锁验证事件 */
    "system.login.device": (this: T, event: { url: string, phone: string }) => void
    /** 登录遇到错误 */
    "system.login.error": (this: T, event: { code: LoginErrorCode | number, message: string }) => void
    /** 上线事件 */
    "system.online": (this: T, event: undefined) => void

    /**下线事件（网络原因，默认自动重连） */
    "system.offline.network": (this: T, event: { message: string }) => void
    /**下线事件（服务器踢） */
    "system.offline.kickoff": (this: T, event: { message: string }) => void
    "system.offline": (this: T, event: { message: string }) => void
}