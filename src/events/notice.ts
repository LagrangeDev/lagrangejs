import { Client } from '@';
import { LogLevel, pb } from '../core';

export class NoticeEvent {
    constructor(c: Client, message: string) {
        c.emit('internal.verbose', message, LogLevel.Info);
    }
}

export class GroupMemberIncreaseEvent extends NoticeEvent {
    operator_id: string;
    member_id: string;
    group_id: number;
    constructor(c: Client, pb: pb.Proto) {
        const isInvite = pb[3] === pb[5];
        const group_id = pb[1];
        const groupInfo = c.groupList.get(group_id)!;
        super(c, `${isInvite ? `${pb[5]}邀请` : ''}${pb[3]}加入了群聊(${group_id})${groupInfo.group_name}`);
        this.operator_id = pb[5] || pb[3];
        this.member_id = pb[3];
        this.group_id = pb[1];
    }
}
export class GroupMemberDecreaseEvent extends NoticeEvent {
    operator_id: string;
    member_id: string;
    group_id: number;
    constructor(c: Client, pb: pb.Proto) {
        const isKick = pb[4] === 131;
        const group_id = pb[1];
        const groupInfo = c.groupList.get(group_id)!;
        super(
            c,
            `${isKick ? `${pb[5]}将` : ''}${pb[3]}${isKick ? '踢' : '退'}出了群聊(${group_id})${groupInfo.group_name}`,
        );
        this.operator_id = pb[5] || pb[3];
        this.member_id = pb[3];
        this.group_id = pb[1];
    }
}

export class GroupAdminChangeNotice extends NoticeEvent {
    admin: boolean;
    user_id?: number;
    uid: string;
    constructor(c: Client, pb: pb.Proto) {
        const admin = !!pb[4]?.[2];
        const uid = admin ? pb[4][2][1] : pb[4][1][1];
        const groupInfo = c.groupList.get(pb[1])!;
        super(c, `${uid}在群聊(${pb[1]})${groupInfo?.group_name}${admin ? '被添加为' : '被取消了'}管理`);
        this.admin = admin;
        this.uid = uid;
        const memberInfo = c.memberList.get(pb[1])?.getByUid(uid);
        if (memberInfo) this.user_id = memberInfo.user_id;
    }
}
// export class GroupMuteMemberEvent extends NoticeEvent {
//     operator_id: string;
//     user_id: number;
//     uid: string;
//     constructor(c: Client, pb: pb.Proto) {
//         const operator = pb[4];
//         const operatorInfo = c.memberList.get(pb[1])?.getByUid(operator);
//         super(c);
//     }
// }
