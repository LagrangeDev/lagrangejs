import {Client} from "../client";
import {GroupMessage, PrivateMessage} from "../message/message";
import { pb } from "../core";
import {GroupMessageEvent, PrivateMessageEvent} from "../events";

export function handlePrivateMsg(this: Client, proto: pb.Proto) {
    this.statistics.recvMsgCount++;
    const msg = new PrivateMessage(proto) as PrivateMessageEvent
    if (msg.rawMessage) {
        this.logger.info(`recv from: [Private: ${msg.uin}(${msg.sub_type})] ` + msg);
        this.emit("message.private." + msg.sub_type, msg);
    }
}

export function handleGroupMsg(this: Client, proto: pb.Proto) {
    this.statistics.recvMsgCount++;
    const msg = new GroupMessage(proto) as GroupMessageEvent
    if (msg.rawMessage) {
        this.logger.info(`recv from: [Group: ${msg.uin}(${msg.group_id})] ` + msg);
        this.emit("message.group." + msg.sub_type, msg);
    }
}