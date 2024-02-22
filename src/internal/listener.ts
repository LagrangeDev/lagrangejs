import * as fs from "fs";
import * as path from "path";
import * as pb from "../core/protobuf";
import { PNG } from "pngjs";
import {Client} from "../client";
import {handleGroupMsg, handlePrivateMsg, handleTempMsg} from "./msgpush";
import {loadFriendList, loadGroupList} from "./internal";
import {Group} from "../entities/group";
import {GroupAdminChangeNotice} from "../events/notice";

async function msgPushListener(this: Client, payload: Buffer) {
    const proto = pb.decode(payload);
    this.logger.trace(`recv: MsgPush type: ${proto[1][2][1]}`);

    switch (proto[1][2][1]) {
        case 82: // group msg
            handleGroupMsg.call(this, proto[1])
            break;
        case 529: // private file
        case 208: // private record
        case 166: // friend msg
            handlePrivateMsg.call(this, proto[1]);
            break;
        case 141:
            handleTempMsg.call(this,proto[1])
        case 84: // group request join notice
        case 525: // group request invite notice
            if(proto[1][3]?.[2]) break
        case 87: // group invite notice
            if(proto[1][3]?.[2]){

                break;
            }
        case 44: // group admin change
            if(proto[1][3]?.[2]){
                const event=new GroupAdminChangeNotice(this,proto[1][3][2])
                this.em('notice.group.admin_change',event)
                break
            }
        case 33: // group member increase
        case 34: // group member decrease
        case 0x210: // friend request
            if(proto[1][2][2]!==226) break;
        case 0x2dc:
            if(proto[1][2][2]===17) { // group recall
            }
            else if(proto[1][2][2]===12) { // group mute

            }

    }
}

async function kickListener(this: Client, payload: Buffer) {
    const proto = pb.decode(payload);
    const msg = proto[4] ? `[${proto[4]}]${proto[3]}` : `[${proto[1]}]${proto[2]}`;
    this.emit(Symbol("EVENT_KICKOFF"), msg);
}

async function syncPushListener(this: Client, payload: Buffer) {

    this.emit('internal.infoPush',pb.decode(payload))
}

const events = {
    "trpc.msg.olpush.OlPushService.MsgPush": msgPushListener,
    "trpc.qq_new_tech.status_svc.StatusService.KickNT": kickListener,
    "trpc.msg.register_proxy.RegisterProxy.InfoSyncPush": syncPushListener
};

/** 事件总线, 在这里捕获奇怪的错误 */
async function eventsListener(this: Client, cmd: string, payload: Buffer, seq: number) {
    try {
        await Reflect.get(events, cmd)?.call(this, payload, seq);
    }
    catch (e) {
        this.logger.trace(e);
    }
}


function logQrcode(img: Buffer) {
    const png = PNG.sync.read(img);
    const color_reset = "\x1b[0m";
    const color_fg_blk = "\x1b[30m";
    const color_bg_blk = "\x1b[40m";
    const color_fg_wht = "\x1b[37m";
    const color_bg_wht = "\x1b[47m";
    for (let i = 36; i < png.height * 4 - 36; i += 24) {
        let line = "";
        for (let j = 36; j < png.width * 4 - 36; j += 12) {
            let r0 = png.data[i * png.width + j];
            let r1 = png.data[i * png.width + j + (png.width * 4 * 3)];
            let bgcolor = (r0 == 255) ? color_bg_wht : color_bg_blk;
            let fgcolor = (r1 == 255) ? color_fg_wht : color_fg_blk;
            line += `${fgcolor + bgcolor}\u2584`;
        }
        console.log(line + color_reset);
    }
    console.log(`${color_fg_blk + color_bg_wht}       请使用 手机QQ 扫描二维码        ${color_reset}`);
    console.log(`${color_fg_blk + color_bg_wht}                                       ${color_reset}`);
}

async function onlineListener(this: Client, token: Buffer, nickname: string, gender: number, age: number) {
    this.logger.mark(`Welcome, ${nickname} ! 正在加载资源...`);
    await Promise.allSettled([
        loadFriendList.call(this),// 好友列表
        loadGroupList.call(this),// 群列表
    ]);
    if(this.config.cacheMember){
        for(const [gid] of this.groupList){
            Group.fetchMember.call(this,gid)
        }
    }
    this.logger.mark(`加载了${this.friendList.size}个好友，${this.groupList.size}个群`);
    this.em("system.online");
}

function qrcodeListener(this: Client, image: Buffer) {
    const file = path.join(this.directory, "qrcode.png");
    fs.writeFile(file, image, () => {
        try {
            logQrcode(image);
        } catch { }
        this.logger.mark("二维码图片已保存到：" + file);
        this.em("system.login.qrcode", { image });
    })
}

function sliderListener(this: Client, url: string) {
    this.logger.mark("收到滑动验证码，请访问以下地址完成滑动，并从网络响应中取出ticket输入：" + url);
    this.em("system.login.slider", { url });
}

function tokenUpdatedListener(this: Client, token: string) {
    fs.writeFileSync(path.join(this.directory, `token-${this.uin}.json`), token);
}

function kickoffListener(this: Client, message: string) {
    this.logger.warn(message);
    this.terminate();
    this.em("system.offline.kickoff", { message });
}

export function bindInternalListeners(this: Client) {
    this.on("internal.online", onlineListener)
    this.on("internal.kickoff", kickoffListener);
    this.on("internal.token", tokenUpdatedListener);
    this.on("internal.qrcode", qrcodeListener);
    this.on("internal.slider", sliderListener);
    this.on("internal.sso", eventsListener);
}
