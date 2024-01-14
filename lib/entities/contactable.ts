import {lock} from "../core/constants";
import {Client} from "../client";
import {Quotable, Sendable} from "../message/elements";
import {drop, ErrorCode} from "../errors";
import path from "path";
import {Converter} from "../message/converter";
import * as pb from "../core/protobuf/index";

export abstract class Contactable {
    public uin?: number
    public uid?: string

    private get dm() {
        return !!this.uid
    }

    protected constructor(protected readonly c: Client) {
        lock(this, "c")
    }

    protected async _preprocess(content: Sendable, source?: Quotable) {
        try {
            if (!Array.isArray(content)) content = [content];

            const converter = new Converter(content, {
                dm: this.dm,
                cachedir: path.join(this.c.directory, "../image"),
            });
            return converter;
        }
        catch (e: any) {
            drop(ErrorCode.MessageBuilderError, e.message)
        }
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