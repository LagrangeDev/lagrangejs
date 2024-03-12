import * as pb from '../core/protobuf';
import { Image } from './image';
import {
    AtElem,
    BFaceElem,
    FaceElem,
    FileElem,
    ForwardElem,
    ImageElem,
    JsonElem,
    MessageElem,
    Quotable,
    RecordElem,
    ReplyElem,
    Sendable,
    TextElem,
    VideoElem,
    XmlElem,
    MarkdownElem,
    ButtonElem,
    RawElem,
} from './elements';
import { FACE_OLD_BUF, facemap } from './face';
import { deflateSync } from 'zlib';
import { Contactable } from '../entities/contactable';
import { escapeXml, uuid } from '../common';
import { rand2uuid } from './message';

const BUF1 = Buffer.from([1]);
type ConverterFn = (elem: MessageElem, contactable: Contactable) => Promise<void> | void;
export interface ConverterExt {
    /** 是否是私聊(default:false) */
    dm?: boolean;
    /** 网络图片缓存路径 */
    cachedir?: string;
    /** 群员列表(用于AT时查询card) */
    mlist?: Map<
        number,
        {
            card?: string;
            nickname?: string;
        }
    >;
}

export class Converter {
    is_chain = true;
    imgs: Image[] = [];
    elems: pb.Encodable[] = [];
    /** 用于最终发送 */
    rich: pb.Encodable = { 2: this.elems, 4: null };
    /** 长度(字符) */
    length = 0;
    /** 预览文字 */
    brief = '';

    public constructor(private content: Sendable) {}

    async convert(contactable: Contactable) {
        if (typeof this.content === 'string') {
            this._text(this.content);
        } else if (Array.isArray(this.content)) {
            await Promise.allSettled(this.content.map(item => this._convert(item, contactable)));
        } else {
            await this._convert(this.content, contactable);
        }

        if (!this.elems.length && !this.rich[4]) {
            throw new Error('empty message');
        }
        return this;
    }

    private async _convert(elem: MessageElem | string, contactable: Contactable) {
        if (typeof elem === 'string') {
            this._text(elem);
        } else if (Reflect.has(this, elem.type)) {
            const method = Reflect.get(this, elem.type) as ConverterFn;
            if (typeof method !== 'function') return;
            await method.apply(this, [elem, contactable]);
        }
    }

    private _text(text: string) {
        text = String(text); // force cast into string
        if (!text.length) return;

        this.elems.push({
            1: {
                1: text,
            },
        });
        this.length += text.length;
        this.brief += text;
    }

    private text(elem: TextElem) {
        this._text(elem.text);
    }

    /** 引用回复 */
    async quote(source: Quotable, contactable: Contactable) {
        const converter = await new Converter(source.message || '').convert(contactable);
        const elems = converter.elems;
        const tmp = this.brief;
        if (!contactable.dm) {
            this.at({ type: 'at', qq: source.user_id }, contactable);
            this.elems.unshift(this.elems.pop()!);
        }
        this.elems.unshift({
            45: {
                1: [source.seq],
                2: source.user_id,
                3: source.time,
                4: 1,
                5: elems,
                6: 0,
                8: {
                    3: rand2uuid(source.rand || 0),
                },
            },
        });
        this.brief = `[回复${this.brief.replace(tmp, '')}]` + tmp;
    }

    private at(elem: AtElem, contactable: Contactable) {
        let display;
        const { qq, id, text } = elem;

        if (qq === 'all') {
            display = '全体成员';
        } else {
            display = text || String(qq);

            if (!text) {
                const member = contactable.c.memberList.get(contactable.gid!)?.get(Number(qq));
                display = member?.card || member?.nickname || display;
            }
        }
        display = '@' + display;

        const reserve = pb.encode({
            // 不走有的没的的buffer了
            3: qq === 'all' ? 1 : 2,
            4: 0,
            5: 0,
            9: '', // TODO: Uid
        });

        this.elems.push({
            1: display,
            12: reserve,
        });
    }

    private face(elem: FaceElem) {
        let { id, text, qlottie } = elem;
        id = Number(id);
        if (id < 0 || id > 0xffff || isNaN(id)) {
            throw new Error('wrong face id: ' + id);
        }

        if (qlottie) {
            if (facemap[id]) {
                text = facemap[id];
            } else if (!text) {
                text = '/' + id;
            }
            if (!text.startsWith('/')) text = '/' + text;

            this.elems.push([
                {
                    53: {
                        1: 37,
                        2: {
                            1: '1',
                            2: qlottie,
                            3: id,
                            4: 1,
                            5: 1,
                            6: '',
                            7: text,
                            8: '',
                            9: 1,
                        },
                        3: 1,
                    },
                },
                {
                    1: {
                        1: text,
                        12: {
                            1: '[' + text.replace('/', '') + ']请使用最新版手机QQ体验新功能',
                        },
                    },
                },
                {
                    37: {
                        17: 21908,
                        19: {
                            15: 65536,
                            31: 0,
                            41: 0,
                        },
                    },
                },
            ]);
            return;
        }
        if (id <= 0xff) {
            const old = Buffer.allocUnsafe(2);
            old.writeUInt16BE(0x1441 + id);
            this.elems.push({
                2: {
                    1: id,
                    2: old,
                    11: FACE_OLD_BUF,
                },
            });
        } else {
            if (facemap[id]) {
                text = facemap[id];
            } else if (!text) {
                text = '/' + id;
            }

            this.elems.push({
                53: {
                    1: 33,
                    2: {
                        1: id,
                        2: text,
                        3: text,
                    },
                    3: 1,
                },
            });
        }
        this.brief += '[表情]';
    }

    private async forward(elem: ForwardElem, contactable: Contactable) {
        if (elem.m_resid) {
            const forwardList = await contactable.getForwardMsg(elem.m_resid, elem.m_fileName);
            if (!forwardList) return;
            return this.json({
                type: 'json',
                data: {
                    app: 'com.tencent.multimsg',
                    config: { autosize: 1, forward: 1, round: 1, type: 'normal', width: 300 },
                    desc: '[聊天记录]',
                    extra: '',
                    meta: {
                        detail: {
                            news: forwardList.slice(0, 4).map(item => {
                                return {
                                    text: `${escapeXml(item.nickname)}: ${escapeXml(item.raw_message.slice(0, 50))}`,
                                };
                            }),
                            resid: elem.m_resid,
                            source: '群聊的聊天记录',
                            summary: `查看${forwardList.length}条转发消息`,
                            uniseq: uuid().toUpperCase(),
                        },
                    },
                    prompt: '[聊天记录]',
                    ver: '0.0.0.5',
                    view: 'contact',
                },
            });
        }
        return this.json(await contactable.makeForwardMsg(elem.message));
    }

    private sface(elem: FaceElem) {
        let { id, text } = elem;
        if (!text) text = String(id);

        text = `[${text}]`;
        this.elems.push({
            34: {
                1: Number(id),
                2: 1,
            },
        });
        this._text(text);
    }

    private bface(elem: BFaceElem) {
        let { file, text } = elem;
        if (!text) text = '原创表情';
        text = '[' + String(text).slice(0, 5) + ']';
        const o = {
            1: text,
            2: 6,
            3: 1,
            4: Buffer.from(file.slice(0, 32), 'hex'),
            5: parseInt(file.slice(64)),
            6: 3,
            7: Buffer.from(file.slice(32, 64), 'hex'),
            9: 0,
            10: 200,
            11: 200,
        };
        this.elems.push({ 6: o });
        this._text(text);
    }

    private async image(elem: ImageElem, contactable: Contactable) {
        const img = new Image(elem, contactable.dm, contactable.c.cacheDir);
        await contactable.uploadImages([img]);

        const compat = img.compatElems;
        const msgInfo = img.commonElems;

        this.imgs.push(img);
        this.elems.push(contactable.dm ? { 4: compat } : { 8: compat });
        this.elems.push({
            53: {
                1: 48,
                2: msgInfo,
                3: 10,
            },
        });
        this.brief += '[图片]';
    }

    private async reply(elem: ReplyElem) {}

    private async record(elem: RecordElem) {
        this.brief += '[语音]';
        this.is_chain = false;
    }

    private async video(elem: VideoElem) {
        this.brief += '[视频]';
        this.is_chain = false;
    }

    private json(elem: JsonElem) {
        this.elems.push({
            51: {
                1: Buffer.concat([
                    BUF1,
                    deflateSync(typeof elem.data === 'string' ? elem.data : JSON.stringify(elem.data)),
                ]),
            },
        });
        this.brief += '[json消息]';
        this.is_chain = false;
    }

    private xml(elem: XmlElem) {
        this.elems.push({
            12: {
                1: Buffer.concat([BUF1, deflateSync(elem.data)]),
                2: (elem.id as number) > 0 ? elem.id : 60,
            },
        });
        this.brief += '[xml消息]';
        this.is_chain = false;
    }

    private file(elem: FileElem) {
        throw new Error('暂不支持发送或转发file元素，请调用文件相关API完成该操作');
    }

    private async markdown(elem: MarkdownElem, contactable: Contactable) {
        const { content } = elem;
        this.elems.push({
            37: {
                6: 1,
                7: await contactable._uploadLongMsg([
                    {
                        53: {
                            1: 45,
                            2: {
                                1: content,
                            },
                            3: 1,
                        },
                    },
                ]),
            },
        });
        this.brief += '[markdown消息]';
    }

    private async button(elem: ButtonElem, contactable: Contactable) {
        const { content } = elem;
        const _content = {
            1: {
                1: content.rows.map(row => {
                    return {
                        1: row.buttons.map(button => {
                            return {
                                1: button.id,
                                2: {
                                    1: button.render_data.label,
                                    2: button.render_data.visited_label,
                                    3: button.render_data.style,
                                },
                                3: {
                                    1: button.action.type,
                                    2: {
                                        1: button.action.permission.type,
                                        2: button.action.permission.specify_role_ids,
                                        3: button.action.permission.specify_user_ids,
                                    },
                                    4: button.action.unsupport_tips,
                                    5: button.action.data,
                                    7: button.action.reply ? 1 : 0,
                                    8: button.action.enter ? 1 : 0,
                                },
                            };
                        }),
                    };
                }),
                2: content.appid,
            },
        };
        this.elems.push({
            37: {
                6: 1,
                7: await contactable._uploadLongMsg([
                    {
                        53: {
                            1: 46,
                            2: _content,
                            3: 1,
                        },
                    },
                ]),
            },
        });
        this.brief += '[button消息]';
    }

    private raw(elem: RawElem) {
        let data = elem.data;
        if (typeof data === 'string' && data.startsWith('protobuf://')) {
            data = Buffer.from(data.replace('protobuf://', ''), 'base64');
            this.elems.push(data);
        } else {
            if (!Array.isArray(data)) data = [data];
            this.elems.push(...data);
        }
        this.brief += '[原始消息]';
    }
}
