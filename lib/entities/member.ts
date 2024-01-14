import { User } from "./user";
import {Client} from "../client";
import {lock} from "../core/constants";
import * as pb from "../core/protobuf"

export class Member extends User {

    protected constructor(c: Client, public readonly gid: number) {
        super(c);
        lock(this, "gid");
    }

    async mute(duration: number) {
        const body = pb.encode({
            1: this.gid,
            2: 1,
            3: {
                1: this.uid,
                2: duration
            }
        });
        const packet = await this.c.sendOidbSvcTrpcTcp(0x1253, 1, body);
        const rsp = pb.decode(packet);
        return !rsp[3];
    }

    async kickGroupMember(rejectAddition: boolean) {
        const body = pb.encode({
            1: this.gid,
            3: this.uid,
            4: rejectAddition,
            5: ""
        });
        const packet = await this.c.sendOidbSvcTrpcTcp(0x8a0, 1, body);
        const rsp = pb.decode(packet);
        return !rsp[3];
    }

    async setGroupAdmin(isAdmin: boolean) {
        const body = pb.encode({
            1: this.gid,
            2: this.uid,
            3: isAdmin
        });
        const packet = await this.c.sendOidbSvcTrpcTcp(0x8a0, 1, body);
        const rsp = pb.decode(packet);
        return !rsp[3];
    }

    async renameGroupMember(targetName: string) {
        const body = pb.encode({
            1: this.gid,
            3: {
                1: this.uid,
                8: targetName
            }
        });
        const packet = await this.c.sendOidbSvcTrpcTcp(0x8a0, 1, body);
        const rsp = pb.decode(packet);
        return !rsp[3];
    }
}