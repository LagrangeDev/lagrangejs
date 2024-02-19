import {User} from "./user";
import {drop, ErrorCode} from "../errors";
import {FileElem, Quotable, Sendable} from "../message/elements";
import {MessageRet} from "../events";
import {Client} from "../client";
import * as pb from '../core/protobuf'
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
        if(!friendInfo) throw new Error(`Friend(${uid}) not found`)
        let friend=friendCache.get(friendInfo)
        if(friend) return friend
        friendCache.set(friendInfo, friend =new Friend(this, uid))
        return friend
    }
    /**
     * 获取文件信息
     * @param fid 文件id
     * @param hash 文件hash
     */
    async getFileInfo(fid: string,hash?:string) {
        const body = pb.encode({
            14: {
                10: this.c.uin,
                20: fid,
                60:hash,
                601:0
            }
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0xe37,1200,
            body,
        );
        const rsp = pb.decode(payload)[14];
        if (rsp[10] !== 0) drop(ErrorCode.OfflineFileNotExists, rsp[20]);
        const obj = rsp[30];
        let url = String(obj[50]);
        if (!url.startsWith("http")) url = `http://${obj[20]}:${obj[40]}` + url;
        return {
            name: String(rsp[40][7]),
            fid: String(rsp[40][6]),
            md5: rsp[40][100].toHex(),
            size: rsp[40][3] as number,
            duration: rsp[40][4] as number,
            url,
        } as Omit<FileElem, "type"> & Record<"url", string>;
    }

    /**
     * 获取离线文件下载地址
     * @param fid 文件id
     */
    async getFileUrl(fid: string) {
        return (await this.getFileInfo(fid)).url;
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
