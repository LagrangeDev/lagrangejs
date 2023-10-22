import {Client} from "../client";
import {PrivateMessage} from "../message/message";
import { pb } from "../core";
import {PrivateMessageEvent} from "../events";

export function handlePrivateMsg(this: Client, proto: pb.Proto) {
    this.statistics.recvMsgCount++;
    const msg = new PrivateMessage(proto) as PrivateMessageEvent
    if (msg.rawMessage) {
        this.logger.info(`recv from: [Private: ${msg.uin}(${msg.sub_type})] ` + msg);
        this.emit("message.private." + msg.sub_type, msg);
    }
}