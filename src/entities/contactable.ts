import {lock, timestamp} from "../core/constants";
import {Client} from "../client";
import {Quotable, Sendable} from "../message/elements";
import {drop, ErrorCode} from "../errors";
import path from "path";
import {Converter} from "../message/converter";
import * as pb from "../core/protobuf/index";
import {randomBytes} from "crypto";

export abstract class Contactable {
    public uin?: number
    public uid?: string
    public gid?: number

    private get dm() {
        return !!this.uid
    }

    protected constructor(protected readonly c: Client) {
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

            const converter = new Converter(content, {
                dm: this.dm,
                cachedir: path.join(this.c.directory, "../image"),
            });
            await converter.convert()
            return converter;
        }
        catch (e: any) {
            drop(ErrorCode.MessageBuilderError, e.message)
        }
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
    async sendLike(){
        const request = pb.encode({
            11: this.uid,
            12: 71,
            13: 1
        });

        const response = await this.c.sendOidbSvcTrpcTcp(0x7e5, 104, request);
        const packet = pb.decode(response);
        return !packet[3];
    }
}
