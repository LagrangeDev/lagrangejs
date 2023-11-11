import {Contactable} from "./contactable";
import {Client} from "../client";
import {lock} from "../core/constants";
import {Sendable} from "../message/elements";
import {MessageRet} from "../events";
import {drop} from "../errors";
import * as pb from "../core/protobuf"
import {randomBytes} from "crypto";

export class Discuss extends Contactable {
    static as(this: Client, gid: number) {
        return new Discuss(this, Number(gid));
    }

    get group_id() {
        return this.gid;
    }

    protected constructor(c: Client, public readonly gid: number) {
        super(c);
        lock(this, "gid");
    }
    async sendMsg(content: Sendable): Promise<MessageRet> {
        const { rich, brief } = await this._preprocess(content);
        const body = pb.encode({
            1: { 2: { 1: this.gid } },
            2: {
                1: 1,
                2: 0,
                3: 0
            },
            3: { 1: rich },
            4: randomBytes(2).readUInt16BE(),
            5: randomBytes(4).readUInt32BE(),
        });
        const payload = await this.c.sendUni("MessageSvc.PbSendMsg", body);
        const rsp = pb.decode(payload);
        if (rsp[1] !== 0) {
            this.c.logger.error(`failed to send: [Discuss(${this.gid})] ${rsp[2]}(${rsp[1]})`);
            drop(rsp[1], rsp[2]);
        }
        this.c.logger.info(`succeed to send: [Discuss(${this.gid})] ` + brief);
        return {
            seq: 0,
            time: 0,
        };
    }
}