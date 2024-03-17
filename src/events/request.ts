import { Client } from '@';
import { LogLevel } from '@/core';
import { Proto } from '@/core/protobuf';

export class RequestEvent {
    constructor(c: Client, message: string) {
        c.emit('internal.verbose', message, LogLevel.Info);
    }
}
export class GroupJoinRequestEvent extends RequestEvent {
    constructor(c: Client, proto: Proto) {
        const group_id = proto[1];
        const groupInfo = c.groupList.get(group_id)!;
        super(c, `${proto[3]} 申请加入 群聊(${proto[1]})${groupInfo.group_name}`);
    }
}
export class GroupInviteRequestEvent extends RequestEvent {
    constructor(c: Client, proto: Proto) {
        const group_id = proto[1];
        const groupInfo = c.groupList.get(group_id)!;
        const inner = proto[2]?.[1] || {};
        super(c, `${inner[6]} 邀请${inner[5]}加入 群聊(${proto[1]})${groupInfo.group_name}`);
    }
}
