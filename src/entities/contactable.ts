import {lock, timestamp} from "../core/constants";
import {Client} from "../client";
import {Quotable, Sendable} from "../message/elements";
import {drop, ErrorCode} from "../errors";
import path from "path";
import {Converter} from "../message/converter";
import * as pb from "../core/protobuf/index";
import {randomBytes} from "crypto";
import {EXT, Image} from "../message/image";

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
            if (!Array.isArray(content)) content = [content];

            const converter = new Converter(content);
            await converter.convert(this)
            return converter;
        }
        catch (e: any) {
            drop(ErrorCode.MessageBuilderError, e.message)
        }
    }
    async uploadImage(img:Image){
        // todo: uploadImg
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
    protected async _sendMsg(proto3: pb.Encodable, file = false) {
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
