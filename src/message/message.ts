import { Forwardable, Quotable, Sendable, FileElem } from './elements';
import { parse, Parser } from './parser';
import * as pb from '../core/protobuf';
import { lock } from '@/core/constants';
import { parseFunString, GroupRole } from "@/common"

export function rand2uuid(rand: number) {
  return (16777216n << 32n) | BigInt(rand);
}

export function uuid2rand(uuid: bigint) {
  return Number(BigInt(uuid) & 0xffffffffn);
}

export abstract class Message implements Quotable, Forwardable {
  protected readonly parsed: Parser;
  post_type = "message" as "message"
  message: Sendable;
  rand: number;
  seq: number;
  time: number;
  user_id: number;
  uid: string;
  font: string;

  raw_message: string;
  source?: Quotable;

  static deserialize(serialized: Buffer) {
    const proto = pb.decode(serialized);
    switch (proto[2]) {
      default:
        return new PrivateMessage(proto);
    }
  }

  protected constructor(protected proto: pb.Proto) {
    this.proto = proto;
    const info = proto[1],
      head = proto[2],
      body = proto[3];
    this.user_id = info[1];
    this.uid = info[2].toString();
    this.time = head[6];
    this.seq = head[5];
    this.rand = proto[3]?.[1]?.[1]?.[3] || uuid2rand(head[7]);
    this.font = body[1]?.[1]?.[9]?.toString() || 'unknown';
    this.parsed = parse(body[1], head[2]);
    this.message = this.parsed.message as Sendable;
    this.raw_message = this.parsed.brief;

    if (this.parsed.quotation) {
      const q = this.parsed.quotation;
      this.source = {
        user_id: q[2],
        time: q[3],
        seq: q[1]?.[0] || q[1],
        rand: uuid2rand(q[8]?.[3] || 0),
        message: parse(Array.isArray(q[5]) ? q[5] : [q[5]]).brief,
      };
    }
  }

  toString() {
    return this.parsed.content;
  }
}

export class PrivateMessage extends Message {
  message_type = "private" as "private"
  sub_type = 'friend' as 'friend' | 'group' | 'temp' | 'self';

  /** 发送方账号 */
  from_id: number
  /** 接收方账号 */
  to_id: number
  /** 是否为自动回复 */
  auto_reply: boolean
  /** 发送方信息 */
  sender = {
    /** 账号 */
    user_id: 0,
    /** 昵称 */
    nickname: "",
  }

  constructor(proto: pb.Proto) {
    super(proto);
    const head = proto[1]
    this.from_id = this.sender.user_id = head[1]
    this.to_id = head[2]
    this.auto_reply = !!(proto[2] && proto[2][4])
    switch (head[3]) {
      case 529:
        if (head[4] === 4) {
          const trans = proto[3][2][1]
          if (trans[1] !== 0)
            throw new Error("unsupported message (ignore ok)")
          const elem = {
            type: "file",
            name: String(trans[5]),
            size: trans[6],
            md5: trans[4]?.toHex() || "",
            duration: trans[51] || 0,
            fid: String(trans[3]),
          } as FileElem
          this.message = [elem]
          this.raw_message = "[离线文件]"
          this.parsed.content = `{file:${elem.fid}}`
        } else {
          this.sub_type = this.from_id === this.to_id ? "self" : "friend"
          this.message = this.raw_message = this.parsed.content = proto[3][2]?.[6]?.[5]?.[1]?.[2]?.toString() || ""
        }
        break
    }
  }
}
export class TempMessage extends Message {
  message_type = "private" as "private"
  sub_type = 'temp' as 'friend' | 'group' | 'temp' | 'self';
  group_id: number;
  group_name: string;

  /** 发送方账号 */
  from_id: number
  /** 接收方账号 */
  to_id: number
  /** 是否为自动回复 */
  auto_reply: boolean
  /** 发送方信息 */
  sender = {
    /** 账号 */
    user_id: 0,
    /** 昵称 */
    nickname: "",
    /** 群号，当消息来自群聊时有效 */
    group_id: undefined as number | undefined,
  }

  constructor(proto: pb.Proto) {
    super(proto);
    const head = proto[1]
    this.from_id = this.sender.user_id = head[1]
    this.to_id = head[2]
    this.auto_reply = !!(proto[2] && proto[2][4])
    this.group_id = head[8][1];
    this.group_name = head[8][7].toString();
    this.sender.nickname = this.parsed.extra?.[1]?.toString() || ""
    this.sender.group_id = head[8]?.[4]
  }
}
export class GroupMessage extends Message {
  message_type = "group" as "group"
  sub_type = 'group' as 'friend' | 'group' | 'temp' | 'self';
  group_id: number;
  group_name: string;

  atme: boolean;
  atall: boolean;

  /** 发送方信息 */
  sender = {
    /** 账号 */
    user_id: 0,
    /** 昵称 */
    nickname: "",
    /** subId */
    sub_id: "",
    /** 名片 */
    card: "",
    /** 等级 */
    level: 0,
    /** 权限 */
    role: "member" as GroupRole,
    /** 头衔 */
    title: ""
  }

  constructor(proto: pb.Proto) {
    super(proto);

    this.group_id = proto[1][8][1];
    this.group_name = proto[1][8][7].toString();

    this.atme = this.parsed.atme;
    this.atall = this.parsed.atall;

    this.sender.user_id = proto[1][1]
    this.sender.sub_id = proto[1][11]
    const ext = this.parsed.extra
    if (!ext?.[2])
      this.sender.nickname = ext?.[1]?.toString() || ""
    else
      this.sender.nickname = this.sender.card = parseFunString(proto[1][8][4].toBuffer())
    if (ext?.[4])
      this.sender.role = ext[4] === 8 ? "owner" : "admin"
    this.sender.level = ext?.[3] || 0
    this.sender.title = ext?.[7]?.toString() || ""
  }
}

/** 一条转发消息 */
export class ForwardMessage implements Forwardable {
  private parsed: Parser;
  /** 账号 */
  user_id: number;
  /** 昵称 */
  nickname: string;
  /** 若转自群聊，则表示群号 */
  group_id?: number;
  /** 发送时间 */
  time: number;
  /** 发送序号 */
  seq: number;
  /** 消息内容 */
  message: Sendable;
  raw_message: string;

  /** 反序列化一条转发消息 */
  static deserialize(serialized: Buffer) {
    return new ForwardMessage(pb.decode(serialized));
  }

  constructor(protected proto: pb.Proto) {
    this.proto = proto;
    const head = proto[1];
    this.time = head[6] || 0;
    this.seq = head[5];
    this.user_id = head[1] || 0;
    this.nickname = head[14]?.toString() || head[9]?.[4]?.toString() || '';
    this.group_id = head[9]?.[1];
    this.parsed = parse(proto[3][1]);
    this.message = this.parsed.message as Sendable;
    this.raw_message = this.parsed.brief;
    lock(this, 'proto');
    lock(this, 'parsed');
  }

  /** 将转发消息序列化保存 */
  serialize() {
    return this.proto.toBuffer();
  }

  /** 以适合人类阅读的形式输出 */
  toString() {
    return this.parsed.content;
  }

  /** @deprecated 转换为CQ码 */
  toCqcode() {
    return '';
  }
}
