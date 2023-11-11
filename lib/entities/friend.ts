import {User} from "./user";
import * as pb from "../core/protobuf";
import {drop} from "../errors";
import {Quotable, Sendable} from "../message/elements";
import {MessageRet} from "../events";

export class Friend extends User {
    async sendMsg(content: Sendable, source?: Quotable): Promise<MessageRet> {
        const { rich, brief } = await this._preprocess(content, source);
        return this._sendMsg({ 1: rich }, brief);
    }

    protected async _sendMsg(proto3: pb.Encodable, brief: string, file = false) {
        const seq = this.c.sig.seq + 1;
        const body = pb.encode({
            1: this._getRouting(file),
            2: {
                1: 1,
                2: 0,
                3: 0
            },
            3: proto3,
        });
        const payload = await this.c.sendUni("MessageSvc.PbSendMsg", body);
        const rsp = pb.decode(payload);
        if (rsp[1] !== 0) {
            this.c.logger.error(`failed to send: [Private: ${this.uid}] ${rsp[2]}(${rsp[1]})`);
            drop(rsp[1], rsp[2]);
        }
        this.c.logger.info(`succeed to send: [Private(${this.uid})] ` + brief);
        const time = rsp[3];
        return { seq, time }
    }

    private _getRouting(file = false): pb.Encodable {
        if (Reflect.has(this, "gid")) {
            return {} // TODO:
        }

        return file ? { 15: { 1: this.uid, 2: 4 } } : { 1: { 2: this.uid } };
    }
}