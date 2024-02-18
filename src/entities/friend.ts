import {User} from "./user";
import {drop} from "../errors";
import {Quotable, Sendable} from "../message/elements";
import {MessageRet} from "../events";
import {Client} from "../client";
import {FriendInfo} from "../entities";
import {hide, lock} from "../core/constants";
const friendCache:WeakMap<FriendInfo,Friend>=new WeakMap<FriendInfo,Friend>();
export class Friend extends User {

    protected constructor(c: Client, uin: number) {
        super(c,uin);
        this.uid=c.friendList.get(uin)?.uid
        lock(this, "uid");
        hide(this, "_info");
    }
    static from(this:Client, uid: number){
        const friendInfo=this.friendList.get(uid)
        if(!friendInfo) throw new Error('Friend not found')
        let friend=friendCache.get(friendInfo)
        if(friend) return friend
        friendCache.set(friendInfo, friend =new Friend(this, uid))
        return friend
    }
    async sendMsg(content: Sendable, source?: Quotable): Promise<MessageRet> {
        const { rich, brief } = await this._preprocess(content, source);
        const seq = this.c.sig.seq + 1;
        const rsp =await this._sendMsg({ 1: rich })
        if (rsp[1] !== 0) {
            this.c.logger.error(`failed to send: [Private: ${this.uin}] ${rsp[2]}(${rsp[1]})`);
            drop(rsp[1], rsp[2]);
        }
        this.c.logger.info(`succeed to send: [Private(${this.uin})] ` + brief);
        const time = rsp[3];
        return { seq, time }
    }



}
