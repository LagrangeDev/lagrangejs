import { Sendable } from '../message/elements';
import { GroupMessage, PrivateMessage, TempMessage } from '../message/message';
import { pb } from '../core';
import { Client } from '..';

export interface MessageRet {
    seq: number;
    time: number;
}

export interface MessageEvent {
    /**
     * 快速回复
     * @param content
     * @param quote 引用这条消息(默认false)
     */
    reply(content: Sendable, quote?: boolean): Promise<MessageRet>;
}

export class PrivateMessageEvent extends PrivateMessage implements MessageEvent {
    #c: Client;
    constructor(c: Client, pb: pb.Proto) {
        super(pb);
        this.#c = c;
    }
    /** 好友对象 */
    get friend() {
        return this.#c.pickFriend(this.user_id);
    }
    reply(content: Sendable, quote?: boolean): Promise<MessageRet> {
        return this.friend.sendMsg(content, quote ? this : undefined);
    }
}
export class TempMessageEvent extends TempMessage implements MessageEvent {
    #c: Client;
    constructor(c: Client, pb: pb.Proto) {
        super(pb);
        this.#c = c;
    }

    get group() {
        return this.#c.pickGroup(this.group_id);
    }

    reply(content: Sendable, quote?: boolean): Promise<MessageRet> {
        return this.group.pickMember(this.user_id)!.sendMsg(content, quote ? this : undefined);
    }
}
export class GroupMessageEvent extends GroupMessage implements MessageEvent {
    #c: Client;
    constructor(c: Client, pb: pb.Proto) {
        super(pb);
        this.#c = c;
    }

    /** 群对象 */
    get group() {
        return this.#c.pickGroup(this.group_id);
    }

    get member() {
        return this.group.pickMember(this.user_id);
    }

    recall() {
        return this.group.recallMsg(this.seq);
    }

    reply(content: Sendable, quote?: boolean): Promise<MessageRet> {
        return this.group.sendMsg(content, quote ? this : undefined);
    }
}
