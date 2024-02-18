import {Contactable} from "./contactable";
import {Client} from "../client";
import {lock} from "../core/constants";
import {Quotable, Sendable} from "../message/elements";
import {MessageRet} from "../events";
import {drop} from "../errors";
import * as pb from "../core/protobuf"
import {randomBytes} from "crypto";
import {Member} from "./member";
import {GroupInfo} from "../entities";
const groupCacheMap:Map<GroupInfo,Group>=new Map<GroupInfo,Group>();
export class Group extends Contactable {
    static as(this: Client, gid: number) {
        return new Group(this, Number(gid));
    }
    static from(this: Client,gid: number){
        const groupInfo=this.groupList.get(gid)
        if(!groupInfo) throw new Error("Group not found")
        let group=groupCacheMap.get(groupInfo)
        if(group) return group
        groupCacheMap.set(groupInfo,group=new Group(this,gid))
        return group
    }
    pickMember=Member.from.bind(this.c,this.gid)
    get group_id() {
        return this.gid;
    }

    protected constructor(c: Client, public readonly gid: number) {
        super(c);
        lock(this, "gid");
    }

    async sendMsg(content: Sendable,source?:Quotable): Promise<MessageRet> {
        const { rich, brief } = await this._preprocess(content,source);
        const seq = this.c.sig.seq + 1;
        const rsp = await this._sendMsg({ 1: rich })
        if (rsp[1] !== 0) {
            this.c.logger.error(`failed to send: [Temp(${this.uin})Of Group(${this.gid})] ${rsp[2]}(${rsp[1]})`);
            drop(rsp[1], rsp[2]);
        }
        this.c.logger.info(`succeed to send: [Temp(${this.uin})Of Group(${this.gid})] ` + brief);
        const time = rsp[3];
        return { seq, time }
    }
    async recallMsg(seq:number){
        const result = await this.c.sendUni("trpc.msg.msg_svc.MsgService.SsoGroupRecallMsg", pb.encode({
            1: 1,
            2: this.gid,
            3: {1: seq, 3: 0},
            4: {1: 0}
        }))
        const proto=pb.decode(result)
        return !!proto[3]
    }
    async renameGroup(targetName: string) {
        const body = pb.encode({
            1: this.group_id,
            2: {
                3: targetName
            }
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x89a, 15, body);
        const rsp = pb.decode(payload);
        return !rsp[3];
    }

    async remarkGroup(targetRemark: string){
        const body = pb.encode({
            1: this.group_id,
            3: targetRemark
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0xf16, 1, body);
        const rsp = pb.decode(payload);
        return !rsp[3];
    }

    async globalMute(isEnable: boolean) {
        const body = pb.encode({
            1: this.group_id,
            2: {
                17: isEnable ? 0 : -1
            }
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x89a, 0, body);
        const rsp = pb.decode(payload);
        return !rsp[3];
    }

    async leaveGroup() {
        const body = pb.encode({
            1: this.group_id
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x1097, 1, body);
        const rsp = pb.decode(payload);
        return !rsp[3];
    }

    async transfer(target: Member) {
        const body = pb.encode({
            1: this.group_id,
            2: this.c.uid,
            3: target.uid
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x89e, 0, body);
        const rsp = pb.decode(payload);
        return !rsp[3];
    }

    private async _fetchMembers() {
        let token: string | null = null;
        if (!this.c.memberList.has(this.gid)) this.c.memberList.set(this.gid, new Map);

        try {
            while (true) {
                const request = pb.encode({
                    1: this.gid,
                    2: 5,
                    3: 2,
                    4: {
                        10: true,
                        11: true,
                        12: true,
                        100: true,
                        101: true,
                        107: true
                    },
                    15: token
                });
                const response = await this.c.sendOidbSvcTrpcTcp(0xfe7, 3, request);
                const proto = pb.decode(response);

                const list = this.c.memberList.get(this.gid)!
                for (let member of proto[4][2]) {
                    const uin = member[1][4]
                    let info = {
                        "group_id": this.gid,
                        "user_id": uin
                    }
                    info = Object.assign(list.get(uin) || { }, info)
                }

                if (proto[15]) {
                    token = proto[15];
                }
                else {
                    break;
                }
            }
        }
        catch {
            this.c.logger.error("加载群员列表超时");
        }
    }
}
