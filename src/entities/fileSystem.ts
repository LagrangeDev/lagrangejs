import { Group } from './group';
import * as pb from '../core/protobuf';
import { drop, ErrorCode } from '../errors';
import { randomBytes } from 'crypto';
import * as common from '../common';
import fs from 'fs';
import path from 'path';
import { highwayUpload } from '../core/highway';
import { Readable } from 'stream';
import { FileElem } from '../message/elements';

/** 群文件/目录共通属性 */
export interface GfsBaseStat {
    /** 文件/目录的id (目录以/开头) */
    fid: string;
    /** 父目录id */
    pid: string;
    /** 文件/目录名 */
    name: string;
    /** 创建该文件/目录的群员账号 */
    user_id: number;
    /** 创建时间 */
    create_time: number;
    /** 最近修改时间 */
    modify_time: number;
    /** 是否为目录 */
    is_dir: boolean;
}

/** 文件属性 */
export interface GfsFileStat extends GfsBaseStat {
    /** 文件大小 */
    size: number;
    busid: number;
    md5: string;
    sha1: string;
    /** 文件存在时间 */
    duration: number;
    /** 下载次数 */
    download_times: number;
}
/** 目录属性 */
export interface GfsDirStat extends GfsBaseStat {
    /** 目录包含的文件数 */
    file_count: number;
}

function checkRsp(rsp: pb.Proto) {
    if (!rsp[1]) return;
    drop(rsp[1], rsp[2]);
}

export class FileSystem {
    get c() {
        return this.group.c;
    }
    get gid() {
        return this.group.gid;
    }
    constructor(private group: Group) { }
    async df() {
        const [a, b] = await Promise.all([
            (async () => {
                const body = pb.encode({
                    4: {
                        1: this.gid,
                        2: 3,
                    },
                });
                const payload = await this.c.sendOidbSvcTrpcTcp(0x6d8, 3, body, true);
                const rsp = pb.decode(payload)[4] || {};
                const total = Number(rsp[4]) || 0,
                    used = Number(rsp[5]) || 0,
                    free = total - used;
                return {
                    /** 总空间 */
                    total,
                    /** 已使用的空间 */
                    used,
                    /** 剩余空间 */
                    free,
                };
            })(),
            (async () => {
                const body = pb.encode({
                    3: {
                        1: this.gid,
                        2: 2,
                    },
                });
                const payload = await this.c.sendOidbSvcTrpcTcp(0x6d8, 2, body, true);
                const rsp = pb.decode(payload)[3];
                const file_count = Number(rsp[4]),
                    max_file_count = Number(rsp[6]);
                return {
                    /** 文件数 */
                    file_count,
                    /** 文件数量上限 */
                    max_file_count,
                };
            })(),
        ]);
        return Object.assign(a, b);
    }
    private async _resolve(fid: string) {
        const body = pb.encode({
            1: {
                1: this.gid,
                2: 0,
                4: String(fid),
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d8, 0, body);
        const rsp = pb.decode(payload)[1];
        checkRsp(rsp);
        return genGfsFileStat(rsp[4]);
    }
    /**
     * 获取文件或目录属性
     * @param fid 目标文件id
     */
    async stat(fid: string) {
        try {
            return await this._resolve(fid);
        } catch (e) {
            const files = await this.dir('/');
            for (const file of files) {
                if (!file.is_dir) break;
                if (file.fid === fid) return file;
            }
            throw e;
        }
    }
    /**
     * 列出`pid`目录下的所有文件和目录
     * @param pid 目标目录，默认为根目录，即`"/"`
     * @param start @todo 未知参数
     * @param limit 文件/目录上限，超过此上限就停止获取，默认`100`
     * @returns 文件和目录列表
     */
    async dir(pid = '/', start = 0, limit = 100) {
        const body = pb.encode({
            2: {
                1: this.gid,
                2: 1,
                3: String(pid),
                5: Number(limit) || 100,
                13: Number(start) || 0,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d8, 1, body);
        const rsp = pb.decode(payload)[2];
        checkRsp(rsp);
        const arr: (GfsDirStat | GfsFileStat)[] = [];
        if (!rsp[5]) return arr;
        const files = Array.isArray(rsp[5]) ? rsp[5] : [rsp[5]];
        for (const file of files) {
            if (file[3]) arr.push(genGfsFileStat(file[3]));
            else if (file[2]) arr.push(genGfsDirStat(file[2]));
        }
        return arr;
    }

    /** {@link dir} 的别名 */
    ls(pid = '/', start = 0, limit = 100) {
        return this.dir(pid, start, limit);
    }
    /** 创建目录(只能在根目录下创建) */
    async mkdir(name: string) {
        const body = pb.encode({
            1: {
                1: this.gid,
                2: 0,
                3: '/',
                4: String(name),
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d7, 0, body);
        const rsp = pb.decode(payload)[1];
        checkRsp(rsp);
        return genGfsDirStat(rsp[4]);
    }

    /** 删除文件/目录(删除目录会删除下面的所有文件) */
    async rm(fid: string) {
        fid = String(fid);
        let rsp;
        if (!fid.startsWith('/')) {
            //rm file
            const file = await this._resolve(fid);
            const body = pb.encode({
                4: {
                    1: this.gid,
                    2: 3,
                    3: file.busid,
                    4: file.pid,
                    5: file.fid,
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp(0x6d6, 3, body);
            rsp = payload[4];
        } else {
            //rm dir
            const body = pb.encode({
                2: {
                    1: this.gid,
                    2: 1,
                    3: String(fid),
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp(0x6d7, 1, body);
            rsp = pb.decode(payload)[2];
        }
        checkRsp(rsp);
    }

    /**
     * 重命名文件/目录
     * @param fid 文件id
     * @param name 新命名
     */
    async rename(fid: string, name: string) {
        fid = String(fid);
        let rsp;
        if (!fid.startsWith('/')) {
            //rename file
            const file = await this._resolve(fid);
            const body = pb.encode({
                5: {
                    1: this.gid,
                    2: 4,
                    3: file.busid,
                    4: file.fid,
                    5: file.pid,
                    6: String(name),
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp(0x6d6, 4, body);
            rsp = payload[5];
        } else {
            //rename dir
            const body = pb.encode({
                3: {
                    1: this.gid,
                    2: 2,
                    3: String(fid),
                    4: String(name),
                },
            });
            const payload = await this.c.sendOidbSvcTrpcTcp(0x6d7, 2, body);
            rsp = pb.decode(payload)[3];
        }
        checkRsp(rsp);
    }

    /**
     * 移动文件
     * @param fid 要移动的文件id
     * @param pid 目标目录id
     */
    async mv(fid: string, pid: string) {
        const file = await this._resolve(fid);
        const body = pb.encode({
            6: {
                1: this.gid,
                2: 5,
                3: file.busid,
                4: file.fid,
                5: file.pid,
                6: String(pid),
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d6, 5, body, true);
        const rsp = pb.decode(payload)[6];
        checkRsp(rsp);
    }

    private async _feed(fid: string, busid: number) {
        const body = pb.encode({
            5: {
                1: this.gid,
                2: 4,
                3: {
                    1: busid,
                    2: fid,
                    3: randomBytes(4).readInt32BE(),
                    5: 1,
                },
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d9, 4, body);
        let rsp = pb.decode(payload)[5];
        checkRsp(rsp);
        rsp = rsp[4];
        checkRsp(rsp);
        return await this._resolve(rsp[3]);
    }

    /**
     * 上传一个文件
     * @param file `string`表示从该本地文件路径上传，`Buffer`表示直接上传这段内容
     * @param pid 上传的目标目录id，默认根目录
     * @param name 上传的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 上传的文件属性
     */
    async upload(file: string | Buffer | Uint8Array, pid = '/', name?: string, callback?: (percentage: string) => void) {
        let size, md5, sha1;
        if (file instanceof Uint8Array) {
            if (!Buffer.isBuffer(file)) file = Buffer.from(file);
            size = file.length;
            (md5 = common.md5(file)), (sha1 = common.sha1(file));
            name = name ? String(name) : 'file' + md5.toString('hex');
        } else {
            file = String(file);
            size = (await fs.promises.stat(file)).size;
            [md5, sha1] = await common.fileHash(file);
            name = name ? String(name) : path.basename(file);
        }
        const body = pb.encode({
            1: {
                1: this.gid,
                2: 0,
                3: 102,
                4: 5,
                5: String(pid),
                6: name,
                7: '/storage/emulated/0/Pictures/files/s/' + name,
                8: size,
                9: sha1,
                11: md5,
                15: 1,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d6, 0, body, true);
        const rsp = pb.decode(payload)[1];
        checkRsp(rsp);
        if (!rsp[10]) {
            const ext = pb.encode({
                1: 100,
                2: 1,
                3: 0,
                100: {
                    100: {
                        1: rsp[6],
                        100: this.c.uin,
                        200: this.gid,
                        400: this.gid,
                    },
                    200: {
                        100: size,
                        200: md5,
                        300: sha1,
                        600: rsp[7],
                        700: rsp[9],
                    },
                    300: {
                        100: 2,
                        200: String(this.c.appInfo.subAppId),
                        300: 2,
                        400: '9e9c09dc',
                        600: 4,
                    },
                    400: {
                        100: name,
                    },
                    500: {
                        200: {
                            1: {
                                1: 1,
                                2: rsp[12],
                            },
                            2: rsp[14],
                        },
                    },
                },
            });
            await highwayUpload.call(
                this.c,
                Buffer.isBuffer(file)
                    ? Readable.from(file, { objectMode: false })
                    : fs.createReadStream(String(file), { highWaterMark: 1024 * 256 }),
                {
                    cmdid: 71,
                    callback,
                    md5,
                    size,
                    ext,
                },
            );
        }
        return await this._feed(String(rsp[7]), rsp[6]);
    }

    /**
     * 将文件转发到当前群
     * @param stat 另一个群中的文件属性
     * @param pid 转发的目标目录，默认根目录
     * @param name 转发后的文件名，默认不变
     * @returns 转发的文件在当前群的属性
     */
    async forward(stat: GfsFileStat, pid = '/', name?: string) {
        const body = pb.encode({
            1: {
                1: this.gid,
                2: 3,
                3: 102,
                4: 5,
                5: String(pid),
                6: String(name || stat.name),
                7: '/storage/emulated/0/Pictures/files/s/' + (name || stat.name),
                8: Number(stat.size),
                9: Buffer.from(stat.sha1, 'hex'),
                11: Buffer.from(stat.md5, 'hex'),
                15: 1,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d6, 0, body, true);
        const rsp = pb.decode(payload)[1];
        checkRsp(rsp);
        if (!rsp[10]) drop(ErrorCode.GroupFileNotExists, '文件不存在，无法被转发');
        return await this._feed(String(rsp[7]), rsp[6]);
    }

    /**
     * 将离线(私聊)文件转发到当前群
     * @param fid 私聊文件fid
     * @param name 转发后的文件名，默认不变
     * @returns 转发的文件在当前群的属性
     */
    async forwardOfflineFile(fid: string, name?: string) {
        const stat = await this.c.pickFriend(this.c.uin).getFileInfo(fid);
        const body = pb.encode({
            1: 60100,
            2: 0,
            101: 3,
            102: 103,
            90000: {
                10: this.gid,
                30: 102,
                40: this.c.uin,
                50: stat.size,
                60: String(name || stat.name),
                80: fid,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0xe37, 60100, body);
        const rsp = pb.decode(payload)[90000];
        if (rsp[10] !== 0) drop(ErrorCode.OfflineFileNotExists, '文件不存在，无法被转发');
        return await this._feed(String(rsp[30]), rsp[50]);
    }

    /**
     * 获取文件下载地址
     * @param fid 文件id
     */
    async download(fid: string) {
        const file = await this._resolve(fid);
        const body = pb.encode({
            3: {
                1: this.gid,
                2: 2,
                3: file.busid,
                4: file.fid,
            },
        });
        const payload = await this.c.sendOidbSvcTrpcTcp(0x6d6, 2, body, true);
        const rsp = pb.decode(payload)[3];
        checkRsp(rsp);
        return {
            name: file.name,
            url: encodeURI(`http://${rsp[4]}/ftn_handler/${rsp[6].toHex()}/?fname=${file.name}`),
            size: file.size,
            md5: file.md5,
            duration: file.duration,
            fid: file.fid,
        } as Omit<FileElem, 'type'> & { url: string };
    }
}

function genGfsDirStat(file: pb.Proto): GfsDirStat {
    return {
        fid: String(file[1]),
        pid: String(file[2]),
        name: String(file[3]),
        create_time: file[4],
        modify_time: file[5],
        user_id: file[6],
        file_count: file[8] || 0,
        is_dir: true,
    };
}

function genGfsFileStat(file: pb.Proto): GfsFileStat {
    const stat = {
        fid: String(file[1]),
        pid: String(file[16]),
        name: String(file[2]),
        busid: file[4],
        size: file[5],
        md5: file[12].toHex(),
        sha1: file[10].toHex(),
        create_time: file[6],
        duration: file[7],
        modify_time: file[8],
        user_id: file[15],
        download_times: file[9],
        is_dir: false,
    };
    if (stat.fid.startsWith('/')) stat.fid = stat.fid.slice(1);
    return stat;
}
