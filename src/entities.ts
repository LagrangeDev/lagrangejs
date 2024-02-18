export interface StrangerInfo {
    user_id: number;
    uid: string;
    nickname: string;
}

/** 好友资料 */
export interface FriendInfo extends StrangerInfo {
    remark: string;
    class_id: number;
}

export interface GroupInfo {
    group_id: number;
    group_name: string;
    member_count: number;
    max_member_count: number;
    owner_id: number;
    admin_flag: boolean;
    last_join_time: number;
    last_sent_time?: number;
    shutup_time_whole: number;
    shutup_time_me: number;
    create_time?: number;
    grade?: number;
    max_admin_count?: number;
    active_member_count?: number;
    update_time: number;
}

export interface MemberInfo {
    uid:string
    card?:string
    nickname?:string
    group_id: number;
    user_id: number;
}
