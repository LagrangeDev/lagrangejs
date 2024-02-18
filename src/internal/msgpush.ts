import {Client} from "../client";
import { pb } from "../core";
import {GroupMessageEvent, PrivateMessageEvent} from "../events";

export function handlePrivateMsg(this: Client, proto: pb.Proto) {
    this.statistics.recvMsgCount++;
    const msg = new PrivateMessageEvent(this,proto)
    if (msg.rawMessage) {
        this.logger.info(`recv from: [Private: ${msg.user_id}(${msg.sub_type})] ` + msg);
        this.emit("message.private." + msg.sub_type, msg);
    }
}

export function handleGroupMsg(this: Client, proto: pb.Proto) {
    this.statistics.recvMsgCount++;
    const msg = new GroupMessageEvent(this,proto)
    if (msg.rawMessage) {
        this.logger.info(`recv from: [Group: ${msg.user_id}(${msg.group_id})] ` + msg);
        this.emit("message.group." + msg.sub_type, msg);
    }
}
