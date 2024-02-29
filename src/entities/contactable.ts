import {gzip, lock, randomInt, timestamp, unzip} from "../core/constants";
import {Client} from "../client";
import {Forwardable, JsonElem, Quotable, Sendable} from "../message/elements";
import {drop, ErrorCode} from "../errors";
import {Converter} from "../message/converter";
import * as pb from "../core/protobuf/index";
import {randomBytes} from "crypto";
import {EXT, Image} from "../message/image";
import {escapeXml, uuid} from "../common";
import {ForwardMessage} from "../message/message";
import {LogLevel} from "../core";

export abstract class Contactable {
    public uin?: number
    public uid?: string
    public gid?: number

    get dm() {
        return !!this.uid
    }

    protected constructor(readonly c: Client) {
        lock(this, "c")
    }

    private _getRouting(file = false): pb.Encodable {
        return {
            1: this.gid ? null : {1: this.uin, 2: this.uid},// 私聊
            2: this.gid && !this.uin ? {1: this.gid} : null, // 群聊
            3: this.gid && this.uin ? {1: this.gid, 2: this.uin} : null, // 群临时会话
            15: file ? {1: this.uin, 2: 4, 8: this.gid} : null
        }
    }

    protected async _preprocess(content: Sendable, source?: Quotable) {
        try {
            if (!Array.isArray(content)) content = [content] as any;

            const converter = new Converter(content);
            await converter.convert(this)
            if (source)
                await converter.quote(source,this)
            return converter;
        }
        catch (e: any) {
            drop(ErrorCode.MessageBuilderError, e.message)
        }
    }
    /**
     * 制作一条合并转发消息以备发送（制作一次可以到处发）
     * 需要注意的是，好友图片和群图片的内部格式不一样，对着群制作的转发消息中的图片，发给好友可能会裂图，反过来也一样
     * 支持4层套娃转发（PC仅显示3层）
     */
    async makeForwardMsg(msglist: Forwardable[] | Forwardable): Promise<JsonElem> {
        const _makeFake = async (forwardItem: Forwardable):Promise<[Uint8Array,string|undefined,string]> => {
            const converter = await new Converter(forwardItem.message).convert(this)
            return [
                pb.encode({
                    1: { // res head
                        2:this.c.uid,
                        6:forwardItem.group_id?this.c.memberList.get(forwardItem.group_id!)?.get(forwardItem.user_id)?.uid:
                            this.c.friendList.get(forwardItem.user_id)?.uid,
                        7:{
                            6:forwardItem.nickname
                        },
                        8:forwardItem.group_id?{
                            1:forwardItem.group_id,
                            4:this.c.memberList.get(forwardItem.group_id!)?.get(forwardItem.user_id)?.card||''
                        }:null
                    },
                    2: { // res content
                        1: forwardItem.group_id ? 82 : 529, // type
                        2: forwardItem.group_id ? null : 4, // subType
                        3: forwardItem.group_id ? null : 4, // divSeq
                        4: randomInt(100000000, 2147483647), // msg id
                        5: randomInt(1000000, 9999999), // seq
                        6: forwardItem.time || timestamp(), // time
                        7: 1, 8: 0, 9: 0,
                        15: { // forwarder
                            3: forwardItem.group_id ? null : 2,
                            4: randomBytes(32).toString('base64'),
                            5: `https://q1.qlogo.cn/g?b=qq&nk=${forwardItem.user_id}&s=640`
                        }
                    },
                    3: { // res body
                        1: converter.rich
                    }
                }),
                forwardItem.nickname||'',
                converter.brief
            ]
        }
        const forwardList=Array.isArray(msglist)?msglist:[msglist]
        const nodes = await Promise.all(forwardList.map(_makeFake)).catch(e=>{
            this.c.emit('internal.verbose', e, LogLevel.Error)
            throw e
        })
        const preview=nodes.slice(0,4).map(([_,nickname='',brief])=>{
            return {
                text:`${escapeXml(nickname)}: ${escapeXml(brief.slice(0, 50))}`
            }
        })
        const compressed = await gzip(pb.encode({
            2: {
                1: 'MultiMsg',
                2: {
                    1: nodes.map(([node])=>node)
                }
            }
        }))
        const resid = await this._uploadMultiMsg(compressed)
        const json = {
            "app": "com.tencent.multimsg",
            "config": {"autosize": 1, "forward": 1, "round": 1, "type": "normal", "width": 300},
            "desc": "[聊天记录]",
            "extra": "",
            "meta": {
                "detail": {
                    "news": preview,
                    "resid": resid,
                    "source": "群聊的聊天记录",
                    "summary": `查看${forwardList.length}条转发消息`,
                    "uniseq": uuid().toUpperCase()
                }
            },
            "prompt": "[聊天记录]",
            "ver": "0.0.0.5",
            "view": "contact"
        };

        return {
            type: "json",
            data: json
        };
    }
    /** 下载并解析合并转发 */
    async getForwardMsg(resid: string, fileName: string = "MultiMsg"):Promise<ForwardMessage[]> {
        const buf = await this._downloadMultiMsg(String(resid))
        return pb.decode(buf)[2]?.[2]?.[1]?.map((proto:pb.Proto)=>new ForwardMessage(proto))||[]
    }

    async uploadImage(img:Image){
        // todo: uploadImg
    }

    /** 上传合并转发 */
    private async _uploadMultiMsg(compressed: Buffer): Promise<string> {
        const info = pb.encode({
            2: {
                1: 3,
                2: {2: String(this.gid) || this.uid},
                3: this.gid,
                4: compressed
            },
            15: {
                1: 4, 2: 1, 3: 3, 4: 0
            }
        })
        const result = await this.c.sendUni('trpc.group.long_msg_interface.MsgService.SsoSendLongMsg', info)
        const proto=pb.decode(result)
        return proto[2][3].toString()
    }
    /** 下载合并转发 */
    private async _downloadMultiMsg(resid: string) {
        const body = pb.encode({
            1:{
                1: {
                    1:this.uid
                },
                2: resid,
                3: true
            },
            15:{
                1:2,2:0,3:0,4:0
            }
        });
        const payload = await this.c.sendUni("trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg", body)

        return unzip(pb.decode(payload)[1][4].toBuffer())
    }
    // 取私聊图片fid
    private async _offPicUp(imgs: Image[]) {
        const req: pb.Encodable[] = []
        for (const img of imgs) {
            req.push({
                1: this.c.uin,
                3: 1,
                4: img.md5,
                5: img.size,
                6: `${img.md5.toString("hex")}.${EXT[img.type]||'jpg'}`,
                7: 2,
                8: 8,
                9: 0,
                10: 0,
                11: 0, //retry
                12: 8, //bu
                13: img.origin ? 1 : 0,
                14: img.width,
                15: img.height,
                16: img.type,
                17: this.c.appInfo.currentVersion,
                22: 0,
                25:this.uid,
            })
        }
        const body = pb.encode({
            1: 1,
            2: req,
            3: 10
        })
        const payload = await this.c.sendUni("LongConn.OffPicUp", body)
        return pb.decode(payload)[2] as pb.Proto | pb.Proto[]
    }

    // 取群聊图片fid
    private async _groupPicUp(imgs: Image[]) {
        const req = []
        for (const img of imgs) {
            req.push({
                1: this.gid,
                2: this.c.uin,
                3: 1,
                4: img.md5,
                5: img.size,
                6: `${img.md5.toString("hex")}.${EXT[img.type]||'jpg'}`,
                7: 2,
                8: 8,
                9: 212, //bu
                10: img.width,
                11: img.height,
                12: img.type,
                13: this.c.appInfo.currentVersion,
                16: img.origin ? 1 : 0,
                19: 0,
            })
        }
        const body = pb.encode({
            1: 3,
            2: 1,
            3: req,
        })
        const payload = await this.c.sendUni("ImgStore.GroupPicUp", body)
        return pb.decode(payload)[3]
    }

    /**
     * 发送消息
     * @param proto3 {pb.Encodable}
     * @param file {boolean}
     * @protected
     */
    protected async _sendMsg(proto3: pb.Encodable, file: boolean = false) {
        const seq = this.c.sig.seq + 1;
        const body = pb.encode({
            1: this._getRouting(file),
            2: {
                1: 1,
                2: 0,
                3: 0
            },
            3: proto3,
            4: seq,
            5: this.gid?randomBytes(4).readUInt32BE():undefined,
            12: this.gid ? null : {1: timestamp()}
        });
        const payload = await this.c.sendUni("MessageSvc.PbSendMsg", body);
        return pb.decode(payload)
    }
}
