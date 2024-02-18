import * as pb from "../core/protobuf";
import {AtElem, BfaceElem, FaceElem, FileElem, ImageElem, JsonElem, MessageElem,
    PttElem, ReplyElem, Sendable, TextElem, VideoElem, XmlElem} from "./elements";
import {FACE_OLD_BUF, facemap} from "./face";
import {deflateSync} from "zlib";

const BUF1 = Buffer.from([1]);

export interface ConverterExt {
    /** 是否是私聊(default:false) */
    dm?: boolean,
    /** 网络图片缓存路径 */
    cachedir?: string,
    /** 群员列表(用于AT时查询card) */
    mlist?: Map<number, {
        card?: string
        nickname?: string
    }>
}

export class Converter {
    is_chain = true
    elems: pb.Encodable[] = []
    /** 用于最终发送 */
    rich: pb.Encodable = { 2: this.elems, 4: null }
    /** 长度(字符) */
    length = 0
    /** 预览文字 */
    brief = ""
    tasks:Promise<void>[]=[]
    public constructor(content: Sendable, private ext?: ConverterExt) {
        if (typeof content === "string") {
            this._text(content);
        }
        else if (Array.isArray(content)) {
            for (let elem of content) {
                this._convert(elem);
            }
        }
        else {
            this._convert(content);
        }

        if (!this.elems.length && !this.rich[4]) {
            throw new Error("empty message");
        }
    }
    async convert(){
        return Promise.allSettled(this.tasks)
    }
    private _convert(elem: MessageElem | string) {
        if (typeof elem === "string") {
            this._text(elem);
        }
        else if (Reflect.has(this, elem.type)) {
            this.tasks.push(Promise.resolve().then(async() =>await this[elem.type](elem as any)));
        }
    }

    private _text(text: string) {
        text = String(text); // force cast into string
        if (!text.length) return;

        this.elems.push({
            1: {
                1: text,
            }
        });
        this.length += text.length;
        this.brief += text;
    }

    private text(elem: TextElem) {
        this._text(elem.text);
    }

    private at(elem: AtElem) {
        let display;
        let { qq, id, text, dummy } = elem;

        if (qq === "all") {
            display = "全体成员";
        }
        else {
            display = text || String(qq);

            if (!text) {
                const member = this.ext?.mlist?.get(Number(qq));
                display = member?.card || member?.nickname || display;
            }
        }
        display = "@" + display;
        if (dummy) return this._text(display);

        const reserve = pb.encode({ // 不走有的没的的buffer了
            3: qq === "all" ? 1 : 2,
            4: 0,
            5: 0,
            9: "" // TODO: Uid
        });

        this.elems.push({
            1: display,
            12: reserve
        });
    }

    private face(elem: FaceElem) {
        let { id, text } = elem;
        id = Number(id);
        if (id < 0 || id > 0xffff || isNaN(id)) {
            throw new Error("wrong face id: " + id)
        }

        if (id <= 0xff) {
            const old = Buffer.allocUnsafe(2);
            old.writeUInt16BE(0x1441 + id);
            this.elems.push({
                2: {
                    1: id,
                    2: old,
                    11: FACE_OLD_BUF
                }
            });
        }
        else {
            if (facemap[id]) {
                text = facemap[id];
            }
            else if (!text) {
                text = "/" + id;
            }

            this.elems.push({
                53: {
                    1: 33,
                    2: {
                        1: id,
                        2: text,
                        3: text
                    },
                    3: 1
                }
            });
        }
        this.brief += "[表情]";
    }

    private sface(elem: FaceElem) {
        let { id, text } = elem;
        if (!text) text = String(id);

        text = `[${text}]`;
        this.elems.push({
            34: {
                1: Number(id),
                2: 1,
            }
        });
        this._text(text);
    }

    private bface(elem: BfaceElem, magic?: Buffer) {
        let { file, text } = elem;
        if (!text) text = "原创表情";
        text = "[" + String(text).slice(0, 5) + "]";
        const o = {
            1: text,
            2: 6,
            3: 1,
            4: Buffer.from(file.slice(0, 32), "hex"),
            5: parseInt(file.slice(64)),
            6: 3,
            7: Buffer.from(file.slice(32, 64), "hex"),
            9: 0,
            10: 200,
            11: 200,
            12: magic || null
        }
        this.elems.push({ 6: o });
        this._text(text);
    }

    private async image(elem: ImageElem) {
        this.brief += "[图片]";
    }

    private async reply(elem: ReplyElem) {
    }

    private async record(elem: PttElem) {
        this.brief += "[语音]";
        this.is_chain = false;
    }

    private async video(elem: VideoElem) {
        this.brief += "[视频]";
        this.is_chain = false;
    }
    private json(elem: JsonElem) {
        this.elems.push({
            51: {
                1: Buffer.concat([BUF1, deflateSync(typeof elem.data === "string" ? elem.data : JSON.stringify(elem.data))])
            }
        });
        this.brief += "[json消息]";
        this.is_chain = false;
    }

    private xml(elem: XmlElem) {
        this.elems.push({
            12: {
                1: Buffer.concat([BUF1, deflateSync(elem.data)]),
                2: elem.id as number > 0 ? elem.id : 60,
            }
        });
        this.brief += "[xml消息]";
        this.is_chain = false;
    }

    private file(elem: FileElem) {
        throw new Error("暂不支持发送或转发file元素，请调用文件相关API完成该操作");
    }
}
