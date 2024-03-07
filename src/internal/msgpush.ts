import { Client } from '../client';
import { pb } from '../core';
import { GroupMessageEvent, PrivateMessageEvent, TempMessageEvent } from '../events/message';

export function handlePrivateMsg(this: Client, proto: pb.Proto) {
  this.statistics.recvMsgCount++;
  const msg = new PrivateMessageEvent(this, proto);
  if (msg.raw_message) {
    this.logger.info(`recv from: [Private: ${msg.user_id}(${msg.sub_type})] ` + msg);
    this.em('message.private.' + msg.sub_type, msg);
  }
}

export function handleTempMsg(this: Client, proto: pb.Proto) {
  this.statistics.recvMsgCount++;
  const msg = new TempMessageEvent(this, proto);
  if (msg.raw_message) {
    this.logger.info(`recv from: [Temp: ${msg.user_id} of Group(${msg.group_id})] ` + msg);
    this.em('message.private.' + msg.sub_type, msg);
  }
}

export function handleGroupMsg(this: Client, proto: pb.Proto) {
  this.statistics.recvMsgCount++;
  const msg = new GroupMessageEvent(this, proto);
  if (msg.raw_message) {
    this.logger.info(`recv from: [Group: ${msg.user_id}(${msg.group_id})] ` + msg);
    this.em('message.group.normal', msg);
  }
}
