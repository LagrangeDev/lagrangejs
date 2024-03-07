export enum MusicPlatform {
    qq = 'qq',
    netease = '163',
}

export interface MessageElemMap {
    text: {
        text: string;
    };
    at: {
        /** 在频道消息中该值为0 */
        qq: number | 'all';
        /** 频道中的`tiny_id` */
        id?: string | 'all';
        /** AT后跟的字符串，接收消息时有效 */
        text?: string;
    };
    face: {
        /** face为0~348，sface不明 */
        id: number;
        qlottie?: string;
        text?: string;
    };
    sface: {
        id: number;
        qlottie?: string;
        text?: string;
    };
    bface: {
        file: string;
        text?: string;
    };
    image: {
        /**
         * @type {string} filepath such as "/tmp/1.jpg"
         * @type {Buffer} image buffer
         * @type {Readable} a readable stream of image
         */
        file: string | Buffer | import('stream').Readable;
        /** 网络图片是否使用缓存 */
        cache?: boolean;
        /** 流的超时时间，默认60(秒) */
        timeout?: number;
        headers?: import('http').OutgoingHttpHeaders;
        /** 这个参数只有在接收时有用 */
        url?: string;
        /** 是否作为表情发送 */
        asface?: boolean;
        /** 是否显示下载原图按钮 */
        origin?: boolean;
    };
    record: {
        /**
         * support for raw silk and amr file
         * @type {string} filepath such as "/tmp/1.slk"
         * @type {Buffer} ptt buffer (silk or amr)
         */
        file: string | Buffer;
        url?: string;
        md5?: string;
        size?: number;
        seconds?: number;
    };
    video: {
        /**
         * need ffmpeg and ffprobe
         * @type {string} filepath such as "/tmp/1.mp4"
         */
        file: string;
        name?: string;
        fid?: string;
        md5?: string;
        size?: number;
        seconds?: number;
    };
    json: {
        res_id?: string;
        data: string | Record<string, any>;
    };
    xml: {
        data: string;
        id?: number;
    };
    poke: {
        /** 0~6 */
        id: number;
        text?: string;
    };
    dice: {
        /** 0~6 */
        id: number;
    };
    rps: {
        id: number;
    };
    music: {
        id: number;
        platform: MusicPlatform;
    };
    mirai: {
        data: string;
    };
    file: {
        name: string;
        fid: string;
        md5: string;
        size: number;
        duration: number;
    };
    reply: {
        id: string;
    };
    forward:
    | {
        m_resid: string;
        m_fileName: string;
        message: never;
    }
    | {
        m_resid?: never;
        m_fileName?: never;
        message: Forwardable | Forwardable[];
    };
}

/** 可引用回复的消息 */
export interface Quotable {
    user_id: number;
    time: number;
    seq: number;
    /** 私聊回复必须 */
    rand: number;
    /** 收到的引用回复永远是字符串 */
    message: Sendable;
}

/** 可转发的消息 */
export interface Forwardable {
    user_id: number;
    group_id?: number;
    message: Sendable;
    nickname?: string;
    time?: number;
}
type MessageElemType = keyof MessageElemMap;
// 消息元素
export type MessageElem<T extends MessageElemType = MessageElemType> = {
    type: T;
} & MessageElemMap[T];
// 可以发送的消息类型
export type TextElem = MessageElem<'text'>;
export type AtElem = MessageElem<'at'>;
export type FaceElem = MessageElem<'face' | 'sface'>;
export type BFaceElem = MessageElem<'bface'>;
export type ImageElem = MessageElem<'image'>;
export type VideoElem = MessageElem<'video'>;
export type RecordElem = MessageElem<'record'>;
export type FileElem = MessageElem<'file'>;
export type XmlElem = MessageElem<'xml'>;
export type JsonElem = MessageElem<'json'>;
// export type AppElem = MessageElem<"app">;
export type PokeElem = MessageElem<'poke'>;
export type DiceElem = MessageElem<'dice'>;
export type RpsElem = MessageElem<'rps'>;
export type MusicElem = MessageElem<'music'>;
export type ReplyElem = MessageElem<'reply'>;
export type ForwardElem = MessageElem<'forward'>;

// 重复组合的消息元素
type RepeatableCombineElem = TextElem | FaceElem | ImageElem | AtElem;
// 带回复的消息元素
type WithReply<T extends MessageElem> = T | [T] | [ReplyElem, T] | [ReplyElem, ...RepeatableCombineElem[]];
// 可发送的消息元素
export type Sendable =
    | string // 文本
    | RepeatableCombineElem
    | RepeatableCombineElem[] // 可重复组合的消息元素
    | WithReply<
        | BFaceElem // 原创表情消息元素
        | ForwardElem // 转发消息元素
        | PokeElem // 戳一戳消息元素
        | DiceElem // 掷骰子消息元素
        | VideoElem // 视频消息元素
        | RecordElem // 语音消息元素
        | FileElem // 文件消息元素
        | XmlElem // Xml消息元素
        | MusicElem // 音乐消息元素
        // | AppElem // 应用消息元素
        | JsonElem // Json消息元素
        | RpsElem // 猜拳消息元素
    >; // 带回复的消息元素
