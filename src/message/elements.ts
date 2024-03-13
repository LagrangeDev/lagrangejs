import * as pb from '../core/protobuf';
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
    markdown: {
        content: string;
    };
    keyboard: {
        /** 机器人appid */
        appid: number;
        /** rows 数组的每个元素表示每一行按钮 */
        rows: Button[][];
    };
    raw: {
        data: string | pb.Encodable | pb.Encodable[];
    };
}

export interface Button {
    /** 按钮ID：在一个keyboard消息内设置唯一 */
    id?: string;
    render_data: {
        /** 按钮上的文字 */
        label: string;
        /** 点击后按钮的上文字 */
        visited_label: string;
        /** 按钮样式：0 灰色线框，1 蓝色线框 */
        style: number;
    };
    action: {
        /** 设置 0 跳转按钮：http 或 小程序 客户端识别 scheme，设置 1 回调按钮：回调后台接口, data 传给后台，设置 2 指令按钮：自动在输入框插入 @bot data */
        type: number;
        permission: {
            /** 0 指定用户可操作，1 仅管理者可操作，2 所有人可操作，3 指定身份组可操作（仅频道可用） */
            type: number;
            /** 有权限的用户 id 的列表 */
            specify_user_ids?: Array<string>;
            /** 有权限的身份组 id 的列表（仅频道可用） */
            specify_role_ids?: Array<string>;
        };
        /** 操作相关的数据 */
        data: string;
        /** 指令按钮可用，指令是否带引用回复本消息，默认 false。支持版本 8983 */
        reply?: boolean;
        /** 指令按钮可用，点击按钮后直接自动发送 data，默认 false。支持版本 8983 */
        enter?: boolean;
        /** 本字段仅在指令按钮下有效，设置后后会忽略 action.enter 配置。
    设置为 1 时 ，点击按钮自动唤起启手Q选图器，其他值暂无效果。
    （仅支持手机端版本 8983+ 的单聊场景，桌面端不支持） */
        anchor?: number;
        /** 客户端不支持本action的时候，弹出的toast文案 */
        unsupport_tips: string;
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
export type MarkdownElem = MessageElem<'markdown'>;
export type KeyboardElem = MessageElem<'keyboard'>;
export type RawElem = MessageElem<'raw'>;

// 重复组合的消息元素
type RepeatableCombineElem = string | TextElem | FaceElem | ImageElem | AtElem | MarkdownElem | KeyboardElem | RawElem;
// 带回复的消息元素
type WithReply<T extends MessageElem> = T | [T] | [ReplyElem, T] | [ReplyElem, ...RepeatableCombineElem[]];
// 可发送的消息元素
export type Sendable =
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
