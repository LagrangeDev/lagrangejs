import * as fs from "fs";
import * as path from "path";
import { PNG } from "pngjs";
import {Client} from "../client";

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

function qrcodeListener(this: Client, image: Buffer) {
    const file = path.join(this.directory, "qrcode.png");
    fs.writeFile(file, image, () => {
        try {
            logQrcode(image);
        } catch { }
        this.logger.mark("二维码图片已保存到：" + file);
        this.emit("system.login.qrcode", { image });
    })
}

function sliderListener(this: Client, url: string) {
    this.logger.mark("收到滑动验证码，请访问以下地址完成滑动，并从网络响应中取出ticket输入：" + url);
    this.emit("system.login.slider", { url });
}

export function bindInternalListeners(this: Client) {
    this.on("internal.qrcode", qrcodeListener);
    this.on("internal.slider", sliderListener);
}
