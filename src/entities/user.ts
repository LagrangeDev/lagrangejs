import {Contactable} from "./contactable";
import {Client} from "../client";
import {lock} from "../core/constants";
import * as pb from "../core/protobuf";

export class User extends Contactable {
    get user_id() {
        return this.uin;
    }

    get avatar() {
        return `https://q1.qlogo.cn/g?b=qq&nk=${this.uin}&s=640`
    }
    protected constructor(c: Client,public readonly uin:number) {
        super(c);
        lock(this,'uin')
    }
    /** 返回作为好友的实例 */
    asFriend() {
        return this.c.pickFriend(this.uin);
    }
    /** 返回作为某群群员的实例 */
    asMember(gid: number) {
        return this.c.pickMember(gid, this.uin);
    }
    async sendLike(times=1){
        const request = pb.encode({
            11: this.uid,
            12: 71,
            13: Math.min(times,10)
        });

        const response = await this.c.sendOidbSvcTrpcTcp(0x7e5, 104, request);
        const packet = pb.decode(response);
        return !packet[3];
    }
}
export namespace User{
    export interface Info{
        user_id: number;
        uid: string;
        nickname: string;
    }
}
