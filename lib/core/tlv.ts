import { md5, BUF0 } from "./constants";

import Writer from "./writer";

import * as crypto from "crypto";
import * as tea from "./tea";
import * as pb from "./protobuf";


type BaseClient = import("./base-client").BaseClient

function packTlv(this: BaseClient, tag: number, qrCode: boolean = false, ...args: any[]) {
    const t = (qrCode ? qrMap : map)[tag].apply(this, args);

    const lbuf = Buffer.allocUnsafe(2); // write length
    lbuf.writeUInt16BE(t.readableLength);
    t.unshift(lbuf);

    const tbuf = Buffer.allocUnsafe(2); // write tag
    tbuf.writeUInt16BE(tag);
    t.unshift(tbuf);

    return t.read() as Buffer;
}

const map: { [tag: number]: (this: BaseClient, ...args: any[]) => Writer } = {
    0x18: function () {
        return new Writer()
            .writeU16(0) // ping ver
            .writeU32(5)
            .writeU32(0)
            .writeU32(8001) // app client ver
            .writeU32(this.uin)
            .writeU16(0)
            .writeU16(0);
    },
    0x100: function () {
        return new Writer()
            .writeU16(0) // db buf ver
            .writeU32(5) // sso ver, dont over 7
            .writeU32(this.appInfo.appId)
            .writeU32(this.appInfo.subAppId)
            .writeU32(this.appInfo.appClientVersion) // app client ver
            .writeU32(this.appInfo.mainSigMap);
    },
    0x106: function (md5pass: Buffer) {
        const body = new Writer()
            .writeU16(4) // tgtgt ver
            .writeBytes(crypto.randomBytes(4))
            .writeU32(0) // sso ver
            .writeU32(this.appInfo.appId)
            .writeU32(8001) // app client ver
            .writeU64(this.uin)
            .write32((Date.now() / 1000) & 0xffffffff)
            .writeBytes(Buffer.alloc(4)) // dummy ip
            .writeU8(1) // save password
            .writeBytes(md5pass)
            .writeBytes(this.sig.tgtgt)
            .writeU32(0)
            .writeU8(1) // guid available
            .writeBytes(this.deviceInfo.guid)
            .writeU32(0)
            .writeU32(1) // login type password
            .writeTlv(String(this.uin)).read();

        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(this.uin);
        const key = md5(Buffer.concat([md5pass, Buffer.alloc(4), buf]));
        return new Writer().writeBytes(tea.encrypt(body, key))
    },
    0x107: function () {
        return new Writer()
            .writeU16(1)    // pic type
            .writeU8(0)     // captcha type
            .writeU16(0x000D)    // pic size
            .writeU8(1);     // ret type
    },
    0x116: function () {
        return new Writer()
            .writeU8(0)
            .writeU32(12058620)
            .writeU32(this.appInfo.subSigMap) // sub sigmap
            .writeU8(0); // size of app id list
    },
    0x141: function () {
        return new Writer()
            .writeU32(7)
            .writeBytes("Unknown")
            .writeU32(0);
    },
    0x142: function () {
        return new Writer()
            .writeU16(0)
            .writeTlv(this.appInfo.packageName);
    },
    0x145: function () {
        return new Writer().writeBytes(this.deviceInfo.guid);
    },
    0x166: function () {
        return new Writer().writeU8(5);
    },
    0x177: function () {
        return new Writer()
            .writeU8(0x01)
            .writeU32(0)
            .writeTlv(this.appInfo.wtLoginSdk);
    },
    0x191: function () {
        return new Writer().writeU8(0);
    },
    0x318: function () {
        return new Writer();
    },
    0x521: function () {
        return new Writer()
            .writeU32(0x13) // product type
            .writeU16(7) // length
            .writeBytes("basicim");
    }
}

const qrMap: { [tag: number]: (this: BaseClient, ...args: any[]) => Writer } = {
    0x16: function () {
        return new Writer()
            .writeU32(0)
            .writeU32(this.appInfo.appId)
            .writeU32(this.appInfo.subAppId)
            .writeBytes(Buffer.from(this.deviceInfo.guid, "hex"))
            .writeTlv(this.appInfo.packageName)
            .writeTlv(this.appInfo.ptVersion)
            .writeTlv(this.appInfo.packageName)
    },
    0x1B: function () {
        return new Writer()
            .writeU32(0) // micro
            .writeU32(0) // version
            .writeU32(3) // size
            .writeU32(4) // margin
            .writeU32(72) // dpi
            .writeU32(2) // eclevel
            .writeU32(2) // hint
            .writeU16(0); // unknown
    },
    0x1D: function () {
        return new Writer()
            .writeU8(1)
            .writeU32(this.appInfo.mainSigMap) // misc bitmap
            .writeU32(0)
            .writeU8(0)
    },
    0x33: function () {
        return new Writer().writeBytes(Buffer.from(this.deviceInfo.guid, "hex"));
    },
    0x35: function () {
        return new Writer().writeU32(this.appInfo.ptOsVersion);
    },
    0x66: function () {
        return new Writer().writeU32(this.appInfo.ptOsVersion);
    },
    0xD1: function () {
        const buf = pb.encode({
            1: {
                1: this.appInfo.os,
                2: this.deviceInfo.deviceName
            },
            4: {
                6: 1
            }
        });
        return new Writer().writeBytes(buf);
    }
}

export function getPacker(c: BaseClient) {
    return packTlv.bind(c);
}

export function getRawTlv(c: BaseClient, tag: number, qrCode: boolean = false, ...args: any[]) {
    return (qrCode ? qrMap : map)[tag].apply(c, args).read();
}