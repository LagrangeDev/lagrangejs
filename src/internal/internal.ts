import * as pb from "../core/protobuf";
import {Client} from "../client";
import {randomBytes} from "crypto";
import {MemberInfo} from "../entities";

export async function loadFriendList(this: Client) {
    const request = pb.encode({
        2: 300,
        4: 0,
        6: 1,
        10001: [
            {
                1: 1,
                2: {
                    1: [
                        103, // 个性签名
                        102, // 备注
                        20002 // 昵称
                    ]
                }
            },
            {
                1: 4,
                2: {
                    1: [100, 101, 102]
                }
            }],
        10002: [13578, 13579, 13573, 13572, 13568],
        10003: 4051
    });
    const response = await this.sendOidbSvcTrpcTcp(0xfd4, 1, request);
    const proto = pb.decode(response);
    for (let friend of proto[4][101]) {
        const infos: Record<number, string> = {}
        const infoPb: pb.Proto[] = friend[10001]?.[0]?.[2]?.[2] || []
        for (const info of infoPb) {
            infos[info[1]] = info[2].toString()
        }

        const uid: string = friend[1].toString();
        const uin: number = friend[3];

        const info = {
            user_id: uin,
            uid: uid,
            nickname: infos[2002],
            remark: infos[103],
            personal_sign: infos[102],
            class_id: 1
        };

        this.friendList.set(uin, Object.assign(this.friendList.get(uin) || {}, info))
    }
}

export async function loadGroupList(this: Client) {
    this.groupList.clear()
    return new Promise<void>((resolve) => {
        const getGroupList = async (proto: pb.Proto) => {
            if (proto[3] === 5) {
                for (let group of Array.isArray(proto[6]) ? proto[6] : [proto[6]]) {
                    const gid = group[1];

                    const info = {
                        "group_id": gid,
                        "group_name": group[9].toString(),
                        "member_count": 0,
                        "max_member_count": 0,
                        "owner_id": 0,
                        "admin_flag": false,
                        "last_join_time": 0,
                        "last_sent_time": 0,
                        "shutup_time_whole": 0,
                        "shutup_time_me": 0,
                        "create_time": 0,
                        "grade": 0,
                        "max_admin_count": 0,
                        "active_member_count": 0,
                        "update_time": 0
                    };
                    this.groupList.set(gid, Object.assign(this.groupList.get(gid) || {}, info));
                }
                this.off('internal.infoPush', getGroupList)
                resolve()
            }
        }
        this.on('internal.infoPush', getGroupList)
        infoSync.call(this)
    })
}

export async function loadGroupMemberList(this: Client, group_id: number) {
    let map=this.memberList.get(group_id)
    if(!map) {
        map=new Map<number, MemberInfo>()
        this.memberList.set(group_id,map)
    }
    map.clear()
    const getMemberList = async (group_id: number, token?: string) => {
        const result: pb.Proto[] = []
        const packet = pb.encode({
            1: group_id,
            2: 5,
            3: 2,
            4: {
                10: 1, // name
                11: 1, // card
                12: 1, // level
                100: 1, // join_time
                101: 1, // last_msg_time
                107: 1, // permission
            },
            15: token // token
        })
        const res = await this.sendOidbSvcTrpcTcp(0xfe7,3, packet)
        const payload = pb.decode(res)[4]
        const [list, next_token] = [payload[2],payload[15]]
        if (!list?.length) return []
        result.push(...list)
        if (next_token) result.push(...await getMemberList.call(this, group_id, next_token))
        return result
    }
    const rowList = await getMemberList.call(this, group_id)
    for (const row of rowList) {
        const [
            uid,
            user_id,
        ]=[
            row[1][2].toString(),
            row[1][4],
        ]
        map.set(uid,{
            group_id,
            user_id,
            uid,
        })
    }
}
export async function infoSync(this: Client) {

    const request = pb.encode({
        1: 143,
        2: randomBytes(4).readUInt32BE(),
        4: 2,
        5: 0,
        6: {
            1: Buffer.alloc(0),
            2: 0
        }
    });
    await this.writeUni("trpc.msg.register_proxy.RegisterProxy.SsoInfoSync", request);
}
