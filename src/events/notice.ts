import { Client } from '../client';
import { pb } from '../core';

export interface NoticeEvent {
    operator?: number;
}

export class GroupMemberIncreaseEvent implements NoticeEvent {
    constructor(c: Client, pb: pb.Proto) { }
}

export class GroupAdminChangeNotice implements NoticeEvent {
    admin: boolean;
    operator?: number;
    user_id?: number;
    uid: string;
    constructor(c: Client, pb: pb.Proto) {
        this.admin = !!pb[4]?.[2];
        this.uid = this.admin ? pb[4][2][1] : pb[4][1][1];
        console.log(pb.toJSON());
    }
}
