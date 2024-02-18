import {Forwardable, Quotable, Sendable} from "./elements";
import {parse, Parser} from "./parser";
import * as pb from "../core/protobuf";

export function rand2uuid(rand: number) {
    return 16777216n << 32n | BigInt(rand)
}

export function uuid2rand(uuid: bigint) {
    return Number(BigInt(uuid) & 0xffffffffn)
}

export abstract class Message implements Quotable, Forwardable {
    protected readonly parsed: Parser
    message: Sendable;
    rand: number;
    seq: number;
    time: number;
    uin: number;
    uid: string;
    font: string;

    rawMessage: string
    source?: Quotable;

    static deserialize(serialized: Buffer) {
        const proto = pb.decode(serialized);
        switch (proto[2]) {
            default:
                return new PrivateMessage(proto);
        }
    }

    protected constructor(protected proto: pb.Proto) {
        this.proto = proto;
        const info = proto[1], head = proto[2], body = proto[3];
        this.uin = info[1];
        this.uid = info[2].toString();
        this.time = head[6];
        this.seq = head[5];
        this.rand = proto[3]?.[1]?.[1]?.[3] || uuid2rand(head[7]);
        this.font = body[1]?.[1]?.[9]?.toString() || "unknown";
        this.parsed = parse(body[1], head[2]);
        this.message = this.parsed.message;
        this.rawMessage = this.parsed.brief;

        if (this.parsed.quotation) {
            const q = this.parsed.quotation;
            this.source = {
                uin: q[2],
                time: q[3],
                seq: q[1]?.[0] || q[1],
                rand: uuid2rand(q[8]?.[3] || 0),
                message: parse(Array.isArray(q[5]) ? q[5] : [q[5]]).brief,
            };
        }
    }

    toString() {
        return this.parsed.content
    }
}

export class PrivateMessage extends Message {
    sub_type = "friend" as "friend" | "group" | "other" | "self"

    constructor(proto: pb.Proto) {
        super(proto);
    }
}

export class GroupMessage extends Message {
    sub_type = "group" as "friend" | "group" | "other" | "self";
    group_id: number;
    group_name: string;

    atme: boolean;
    atall: boolean;

    constructor(proto: pb.Proto) {
        super(proto);

        this.group_id = proto[1][8][1];
        this.group_name = proto[1][8][7].toString();

        this.atme = this.parsed.atme;
        this.atall = this.parsed.atall;
    }
}