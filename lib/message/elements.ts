/** TEXT (此元素可使用字符串代替) */
export interface TextElem {
    type: "text"
    text: string
}

/** AT */
export interface AtElem {
    type: "at"
    /** 在频道消息中该值为0 */
    qq: number | "all"
    /** 频道中的tiny_id */
    id?: string | "all"
    text?: string
    /** 假at */
    dummy?: boolean
}

/** 表情 */
export interface FaceElem {
    type: "face" | "sface"
    /** face为0~324，sface不明 */
    id: number
    text?: string
}

/** 原创表情 */
export interface BfaceElem {
    type: "bface"
    /** 暂时只能发收到的file */
    file: string
    text: string
}

/** 魔法表情 */
export interface MfaceElem {
    type: "rps" | "dice"
    id?: number
}

/** 图片 */
export interface ImageElem {
    type: "image"
    /**
     * @type {string} filepath such as "/tmp/1.jpg"
     * @type {Buffer} image buffer
     * @type {Readable} a readable stream of image
     */
    file: string | Buffer | import("stream").Readable
    /** 网络图片是否使用缓存 */
    cache?: boolean
    /** 流的超时时间，默认60(秒) */
    timeout?: number
    headers?: import("http").OutgoingHttpHeaders
    /** 这个参数只有在接收时有用 */
    url?: string
    /** 是否作为表情发送 */
    asface?: boolean
    /** 是否显示下载原图按钮 */
    origin?: boolean
}

/** 语音 */
export interface PttElem {
    type: "record"
    /**
     * support for raw silk and amr file
     * @type {string} filepath such as "/tmp/1.slk"
     * @type {Buffer} ptt buffer (silk or amr)
     */
    file: string | Buffer
    url?: string
    md5?: string
    size?: number
    seconds?: number
}

/** 视频 */
export interface VideoElem {
    type: "video"
    /**
     * need ffmpeg and ffprobe
     * @type {string} filepath such as "/tmp/1.mp4"
     */
    file: string
    name?: string
    fid?: string
    md5?: string
    size?: number
    seconds?: number
}

/** 地点分享 */
export interface LocationElem {
    type: "location"
    address: string
    lat: number
    lng: number
    name?: string
    id?: string
}

/** 链接分享 */
export interface ShareElem {
    type: "share"
    url: string
    title: string
    content?: string
    image?: string
}

/** JSON */
export interface JsonElem {
    type: "json"
    data: any
}

/** XML */
export interface XmlElem {
    type: "xml"
    data: string
    id?: number
}

/** 戳一戳 */
export interface PokeElem {
    type: "poke"
    /** 0~6 */
    id: number
    text?: string
}

/** 特殊 (官方客户端无法解析此消息) */
export interface MiraiElem {
    type: "mirai"
    data: string
}

/** 文件 (暂时只支持接收，发送请使用文件专用API) */
export interface FileElem {
    type: "file"
    name: string
    fid: string
    md5: string
    size: number
    duration: number
}

/** @deprecated @cqhttp 旧版引用回复(已弃用)，仅做一定程度的兼容 */
export interface ReplyElem {
    type: "reply"
    id: string
}

/** 可引用回复的消息 */
export interface Quotable {
    uin: number
    time: number
    seq: number
    /** 私聊回复必须 */
    rand: number
    /** 收到的引用回复永远是字符串 */
    message: Sendable
}

/** 可转发的消息 */
export interface Forwardable {
    uin: number,
    message: Sendable,
    nickname?: string,
    time?: number,
}

/** 可组合发送的元素 */
export type ChainElem = TextElem | FaceElem | BfaceElem | MfaceElem | ImageElem | AtElem | ReplyElem;

/** 注意：只有`ChainElem`中的元素可以组合发送，其他元素只能单独发送 */
export type MessageElem = TextElem | FaceElem | BfaceElem | MfaceElem | ImageElem | AtElem | ReplyElem
    | PttElem | VideoElem | JsonElem | XmlElem | LocationElem | ShareElem | FileElem;

/** 可通过sendMsg发送的类型集合 (字符串、元素对象，或它们的数组) */
export type Sendable = string | MessageElem | (string | MessageElem)[];