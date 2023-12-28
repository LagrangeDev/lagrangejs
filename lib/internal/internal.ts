import * as pb from "../core/protobuf";
import {Client} from "../client";
import {randomBytes} from "crypto";

export async function loadFriendList(this: Client) {
    const request = pb.encode({
        2: 300,
        4: 0,
        6: 1,
        10001: [ {
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
                    1: [ 100, 101, 102 ]
                }
            } ],
        10002: [ 13578, 13579, 13573, 13572, 13568 ],
        10003: 4051
    });
    const response = await this.sendOidbSvcTrpcTcp(0xfd4, 1, request);
    const proto = pb.decode(response);

    for (let friend of proto[4][101]) {
        const properties: pb.Proto[] = friend[10001][0][2][2];
        const uid: string = friend[1].toString();
        const uin: number = friend[3];

        const info = {
            user_id: uin,
            uid: uid,
            nickname: (properties.find(x => x[1] == 20002) as pb.Proto)[2].toString(),
            remark: "",
            class_id: 1
        };

        this.friendList.set(uin, Object.assign(this.friendList.get(uin) || {}, info))
    }
}

export async function loadGroupList(this: Client) {
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
    const promise = new Promise<void>((resolve, reject) => {
        this.groupListCallback = resolve;
    });
    await promise;
}