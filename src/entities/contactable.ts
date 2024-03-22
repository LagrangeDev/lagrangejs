import {
    BUF0,
    gzip,
    int32ip2str,
    lock,
    md5,
    NOOP,
    pipeline,
    randomInt,
    sha1,
    timestamp,
    unzip,
} from '../core/constants';
import { Client } from '../client';
import axios from 'axios';
import { Forwardable, ImageElem, JsonElem, Quotable, RecordElem, Sendable, VideoElem } from '../message/elements';
import { drop, ErrorCode } from '../errors';
import { Converter } from '../message/converter';
import * as pb from '../core/protobuf/index';
import { encode as silkEncode, getDuration as silkGetDuration } from '../core/silk';
import { randomBytes } from 'crypto';
import { EXT, Image } from '../message/image';
import { DownloadTransform, escapeXml, IS_WIN, md5Stream, sha1Stream, TMP_DIR, uuid } from '../common';
import { ForwardMessage } from '../message/message';
import { ApiRejection, LogLevel } from '../core';
import path from 'path';
import { CmdID, highwayUpload } from '../core/highway';
import { Encodable } from '../core/protobuf';
import fs from 'fs';
import { Readable } from 'stream';
import { exec } from 'child_process';

const request = axios.create();

export abstract class Contactable {
    public uin?: number;
    public uid?: string;
    public gid?: number;
    public info?: any;

    // 对方账号，可能是群号也可能是QQ号
    get target() {
        return this.uin || this.gid || this.c.uin;
    }

    get dm() {
        return !!this.uin;
    }

    protected constructor(readonly c: Client) {
        lock(this, 'c');
    }

    private _getRouting(file = false): pb.Encodable {
        return {
            1: this.gid ? null : { 1: this.uin, 2: this.uid }, // 私聊
            2: this.gid && !this.uin ? { 1: this.gid } : null, // 群聊
            3: this.gid && this.uin ? { 1: this.gid, 2: this.uin } : null, // 群临时会话
            15: file ? { 1: this.uin, 2: 4, 8: this.gid } : null,
        };
    }

    protected async _preprocess(content: Sendable, source?: Quotable) {
        try {
            if (!Array.isArray(content)) content = [content] as any;

            const converter = new Converter(content);
            await converter.convert(this);
            if (source) await converter.quote(source, this);
            return converter;
        } catch (e: any) {
            drop(ErrorCode.MessageBuilderError, e.message);
        }
    }

    /**
     * 制作一条合并转发消息以备发送（制作一次可以到处发）
     * 需要注意的是，好友图片和群图片的内部格式不一样，对着群制作的转发消息中的图片，发给好友可能会裂图，反过来也一样
     * 支持4层套娃转发（PC仅显示3层）
     */
    async makeForwardMsg(msglist: Forwardable[] | Forwardable): Promise<JsonElem> {
        const _makeFake = async (forwardItem: Forwardable): Promise<[Uint8Array, string | undefined, string]> => {
            const converter = await new Converter(forwardItem.message, true).convert(this);
            return [
                pb.encode({
                    1: {
                        // res head
                        2: this.c.uid,
                        6: forwardItem.group_id
                            ? this.c.memberList.get(forwardItem.group_id!)?.get(forwardItem.user_id)?.uid
                            : this.c.friendList.get(forwardItem.user_id)?.uid,
                        7: {
                            6: forwardItem.nickname,
                        },
                        8: forwardItem.group_id
                            ? {
                                  1: forwardItem.group_id,
                                  4: this.c.memberList.get(forwardItem.group_id!)?.get(forwardItem.user_id)?.card || '',
                              }
                            : null,
                    },
                    2: {
                        // res content
                        1: forwardItem.group_id ? 82 : 529, // type
                        2: forwardItem.group_id ? null : 4, // subType
                        3: forwardItem.group_id ? null : 4, // divSeq
                        4: randomInt(100000000, 2147483647), // msg id
                        5: randomInt(1000000, 9999999), // seq
                        6: forwardItem.time || timestamp(), // time
                        7: 1,
                        8: 0,
                        9: 0,
                        15: {
                            // forwarder
                            3: forwardItem.group_id ? null : 2,
                            4: randomBytes(32).toString('base64'),
                            5: `https://q1.qlogo.cn/g?b=qq&nk=${forwardItem.user_id}&s=640`,
                        },
                    },
                    3: {
                        // res body
                        1: converter.rich,
                    },
                }),
                forwardItem.nickname || '',
                converter.brief,
            ];
        };
        const forwardList = Array.isArray(msglist) ? msglist : [msglist];
        const nodes = await Promise.all(forwardList.map(_makeFake)).catch(e => {
            this.c.emit('internal.verbose', e, LogLevel.Error);
            throw e;
        });
        const preview = nodes.slice(0, 4).map(([_, nickname = '', brief]) => {
            return {
                text: `${escapeXml(nickname)}: ${escapeXml(brief.slice(0, 50))}`,
            };
        });
        const compressed = await gzip(
            pb.encode({
                2: {
                    1: 'MultiMsg',
                    2: {
                        1: nodes.map(([node]) => node),
                    },
                },
            }),
        );
        const resid = await this._uploadMultiMsg(compressed);
        const json = {
            app: 'com.tencent.multimsg',
            config: { autosize: 1, forward: 1, round: 1, type: 'normal', width: 300 },
            desc: '[聊天记录]',
            extra: '',
            meta: {
                detail: {
                    news: preview,
                    resid: resid,
                    source: '群聊的聊天记录',
                    summary: `查看${forwardList.length}条转发消息`,
                    uniseq: uuid().toUpperCase(),
                },
            },
            prompt: '[聊天记录]',
            ver: '0.0.0.5',
            view: 'contact',
        };

        return {
            type: 'json',
            data: json,
        };
    }

    /** 下载并解析合并转发 */
    async getForwardMsg(resid: string, fileName: string = 'MultiMsg'): Promise<ForwardMessage[]> {
        const buf = await this._downloadMultiMsg(String(resid));
        return pb.decode(buf)[2]?.[2]?.[1]?.map((proto: pb.Proto) => new ForwardMessage(proto)) || [];
    }

    /** 上传一批图片以备发送(无数量限制)，理论上传一次所有群和好友都能发 */
    async uploadImages(imgs: Image[] | ImageElem[]) {
        this.c.logger.debug(`开始图片任务，共有${imgs.length}张图片`);
        const tasks: Promise<void>[] = [];
        for (let i = 0; i < imgs.length; i++) {
            if (!(imgs[i] instanceof Image))
                imgs[i] = new Image(imgs[i] as ImageElem, this.dm, path.join(this.c.directory, '../image'));
            tasks.push((imgs[i] as Image).task);
        }
        const res1 = (await Promise.allSettled(tasks)) as PromiseRejectedResult[];
        for (let i = 0; i < res1.length; i++) {
            if (res1[i].status === 'rejected')
                this.c.logger.warn(`图片${i + 1}失败, reason: ` + res1[i].reason?.message);
        }
        let n = 0;
        while (imgs.length > n) {
            let rsp = await this._requestUploadImage(imgs.slice(n, n + 20) as Image[]);
            if (Array.isArray(rsp)) rsp = [rsp];
            const tasks: Promise<any>[] = [];
            for (let i = n; i < imgs.length; ++i) {
                if (i >= n + 20) break;
                tasks.push(this._uploadImage(imgs[i] as Image, rsp[i % 20]));
            }
            const res2 = (await Promise.allSettled(tasks)) as PromiseRejectedResult[];
            for (let i = 0; i < res2.length; i++) {
                if (res2[i].status === 'rejected') {
                    res1[n + i] = res2[i];
                    this.c.logger.warn(`图片${n + i + 1}上传失败, reason: ` + res2[i].reason?.message);
                }
            }
            n += 20;
        }
        this.c.logger.debug(`图片任务结束`);
        return res1;
    }

    async uploadRecord(record: RecordElem, transcoding?: boolean) {
        this.c.logger.debug('开始语音任务');
        if (typeof record.file === 'string' && record.file.startsWith('protobuf://')) return record;
        record.file = await getPttBuffer(record.file, transcoding, this.c.config.ffmpegPath || 'ffmpeg');
        if (!record.seconds && String(record.file.subarray(0, 7)).includes('SILK')) {
            record.seconds = Math.ceil(((await silkGetDuration(record.file)) || 0) / 1000);
        }
        const hash = md5(record.file);
        const sha = sha1(record.file);
        const resp1 = await this._requestUploadPpt(record, hash, sha);
        const ext: Encodable = {
            1: resp1[2][6][1][1][2].toString(), // file uuid
            2: resp1[2][1]?.toString(),
            5: {
                1: resp1[2][3].map((x: pb.Proto) => ({
                    1: {
                        1: 1,
                        2: int32ip2str(x[1]),
                    },
                    2: x[2],
                })),
            },
            6: resp1[2][6][1],
            10: 1024 * 1024,
            11: {
                1: sha,
            },
        };
        await highwayUpload.call(this.c, Readable.from(record.file), {
            cmdid: this.dm ? CmdID.DmPtt : CmdID.GroupPtt,
            md5: hash,
            size: record.file.length,
            ticket: await this.c.fetchHighwayTicket(),
            ext: pb.encode(ext),
        });
        this.c.logger.debug('结束语音任务');
        return {
            type: 'record',
            file: 'protobuf://' + Buffer.from(pb.encode(ext)).toString('base64'),
        } as RecordElem;
    }

    async uploadVideo(elem: VideoElem) {
        this.c.logger.debug('开始视频任务');
        let { file, temp = false } = elem;
        if (file instanceof Buffer || file.startsWith('base64://')) {
            file = await this._saveFileToTmpDir(file);
            temp = true;
        } else if (file.startsWith('protobuf://')) {
            return elem;
        } else if (file.startsWith('https://') || file.startsWith('http://')) {
            file = await this._downloadFileToTmpDir(file);
            temp = true;
        }
        file = file.replace(/^file:\/{2}/, '');
        IS_WIN && file.startsWith('/') && (file = file.slice(1));
        const thumb = path.join(TMP_DIR, uuid());
        await new Promise((resolve, reject) => {
            exec(
                `${this.c.config.ffmpegPath || 'ffmpeg'} -y -i "${file}" -f image2 -frames:v 1 "${thumb}"`,
                (error, stdout, stderr) => {
                    this.c.logger.debug('ffmpeg output: ' + stdout + stderr);
                    fs.stat(thumb, err => {
                        if (err) reject(new ApiRejection(ErrorCode.FFmpegVideoThumbError, 'ffmpeg获取视频图像帧失败'));
                        else resolve(undefined);
                    });
                },
            );
        });
        const [width, height, seconds] = await new Promise<number[]>(resolve => {
            exec(`${this.c.config.ffprobePath || 'ffprobe'} -i "${file}" -show_streams`, (error, stdout, stderr) => {
                const lines = (stdout || stderr || '').split('\n');
                let width: number = 1280,
                    height: number = 720,
                    seconds: number = 120;
                for (const line of lines) {
                    if (line.startsWith('width=')) {
                        width = parseInt(line.slice(6));
                    } else if (line.startsWith('height=')) {
                        height = parseInt(line.slice(7));
                    } else if (line.startsWith('duration=')) {
                        seconds = parseInt(line.slice(9));
                        break;
                    }
                }
                resolve([width, height, seconds]);
            });
        });
        const readable = fs.createReadStream(file);
        const md5video = await md5Stream(readable);
        const sha1video = await sha1Stream(readable);
        const md5thumb = await md5Stream(fs.createReadStream(thumb));
        const sha1thumb = await sha1Stream(fs.createReadStream(thumb));
        const videosize = (await fs.promises.stat(file)).size;
        const thumbsize = (await fs.promises.stat(thumb)).size;

        const resp1 = await this._requestUploadVideo(
            {
                seconds,
                md5: md5video.toString('hex'),
                sha1: sha1video,
                size: videosize,
            },
            {
                thumb,
                width,
                height,
                md5: md5thumb.toString('hex'),
                sha1: sha1thumb,
                size: thumbsize,
            },
        );
        const ext: Encodable = {
            1: resp1[2][6][1][1][2].toString(), // file uuid
            2: resp1[2][1]?.toString(),
            5: {
                1: resp1[2][3].map((x: pb.Proto) => ({
                    1: {
                        1: 1,
                        2: int32ip2str(x[1]),
                    },
                    2: x[2],
                })),
            },
            6: resp1[2][6][1],
            10: 1024 * 1024,
            11: {
                1: sha1video,
            },
        };
        await highwayUpload
            .call(this.c, readable, {
                cmdid: this.dm ? CmdID.DmVideo : CmdID.GroupVideo,
                md5: md5video,
                size: videosize,
                ticket: await this.c.fetchHighwayTicket(),
                ext: pb.encode(ext),
            })
            .finally(() => {
                if (temp) fs.unlink(file, NOOP);
            });
        this.c.logger.debug('结束视频任务');
        return {
            type: 'video',
            file: 'protobuf://' + Buffer.from(pb.encode(ext)).toString('base64'),
        } as VideoElem;
    }

    #createMediaUploadPb(media_type: 'image' | 'ppt' | 'video', files: pb.Encodable[]) {
        const req_id = media_type === 'image' ? 1 : media_type === 'ppt' ? 4 : 3;
        const bussness_type = media_type === 'image' ? 1 : media_type == 'ppt' ? 3 : 2;
        return {
            1: {
                // head
                1: {
                    1: req_id, //req id
                    2: 100, //command
                },
                // scene
                2: {
                    101: 2, //req type
                    102: bussness_type, //business type
                    200: 2, // scene type 1:c2c 2:group
                    202: {
                        1: this.dm ? 2 : this.gid, // account type
                        2: this.dm ? this.c.uid : undefined, // account id
                    },
                },
                // client
                3: { 1: 2 }, // agent type
            },
            // body
            2: {
                // files
                1: files,
                2: true, // try fast
                3: false, //srv send
                4: randomInt(),
                5: 2,
                // ext biz
                6: {
                    // img
                    1:
                        media_type === 'image'
                            ? {
                                  12: Buffer.from(
                                      '0800180020004a00500062009201009a0100aa010c080012001800200028003a00',
                                      'hex',
                                  ),
                              }
                            : BUF0,
                    // video
                    2:
                        media_type === 'video'
                            ? {
                                  3: Buffer.from('800100', 'hex'),
                              }
                            : BUF0,
                    // ppt
                    3: {
                        11: media_type === 'ppt' ? Buffer.from([0x08, 0x00, 0x38, 0x00]) : BUF0,
                        12: BUF0,
                        13:
                            media_type === 'ppt'
                                ? Buffer.from([
                                      0x9a, 0x01, 0x0b, 0xaa, 0x03, 0x08, 0x08, 0x04, 0x12, 0x04, 0x00, 0x00, 0x00,
                                      0x00,
                                  ])
                                : BUF0,
                    },
                },
                7: 0,
                8: false,
            },
        };
    }

    private async _uploadImage(img: Image, rsp: pb.Proto) {
        if (!img.readable || !rsp[2][1]) {
            img.deleteCacheFile();
            return;
        }
        const ext: Encodable = {
            1: rsp[2][6][1][1][2].toString(),
            2: rsp[2][1]?.toString(),
            5: {
                1: rsp[2][3].map((x: pb.Proto) => ({
                    1: {
                        1: 1,
                        2: int32ip2str(x[1]),
                    },
                    2: x[2],
                })),
            },
            6: rsp[2][6][1],
            10: 1024 * 1024,
            11: {
                1: img.sha1.toString('hex'),
            },
        };

        return highwayUpload
            .call(this.c, img.readable, {
                cmdid: this.dm ? CmdID.DmImage : CmdID.GroupImage,
                md5: img.md5,
                size: img.size,
                ticket: await this.c.fetchHighwayTicket(),
                ext: pb.encode(ext),
            })
            .finally(img.deleteTmpFile.bind(img));
    }

    private async _requestUploadImage(imgs: Image[]) {
        const body: pb.Encodable = this.#createMediaUploadPb(
            'image',
            imgs.map(img => {
                return {
                    1: {
                        1: img.size,
                        2: img.md5.toString('hex'),
                        3: img.sha1.toString('hex'),
                        4: img.md5.toString('hex') + '.' + EXT[img.type],
                        5: {
                            1: 1,
                            2: 1001,
                            3: 0,
                            4: 0,
                        },
                        6: img.width,
                        7: img.height,
                        8: 0,
                        9: 1,
                    },
                    2: 0,
                };
            }),
        );
        const raw = await this.c.sendOidbSvcTrpcTcp(this.dm ? 0x11c5 : 0x11c4, 100, pb.encode(body), true);
        const resp = pb.decode(raw);

        for (const img of imgs) {
            img.msgInfo = resp[4][2][6];
            img.proto = resp[4][2][8];
        }

        return resp[4];
    }

    private async _requestUploadPpt(record: RecordElem, hash: Buffer, sha: Buffer, transcoding = false) {
        if (!Buffer.isBuffer(record.file)) record.file = await getPttBuffer(record.file, transcoding);
        const codec = String(record.file.subarray(0, 7)).includes('SILK') || !transcoding ? 1 : 0;
        const body: pb.Encodable = this.#createMediaUploadPb('ppt', [
            {
                1: {
                    1: record.file.length,
                    2: hash,
                    3: sha,
                    4: hash + (codec ? '.slk' : '.amr'),
                    5: {
                        1: 3,
                        2: 0,
                        3: 0,
                        4: 1,
                    },
                    6: 0,
                    7: 0,
                    8: record.seconds,
                    9: 0,
                },
                2: 0,
            },
        ]);
        const raw = await this.c.sendOidbSvcTrpcTcp(this.dm ? 0x126d : 0x126e, 100, pb.encode(body), true);
        const rsp = pb.decode(raw);
        return rsp[4];
    }

    private async _requestUploadVideo(videoInfo: Record<string, any>, thumbInfo: Record<string, any>) {
        const body: pb.Encodable = this.#createMediaUploadPb('ppt', [
            {
                1: {
                    1: videoInfo.size.length,
                    2: videoInfo.md5,
                    3: videoInfo.sha1 || '',
                    4: videoInfo.md5 + '.mp4',
                    5: {
                        1: 2,
                        2: 0,
                        3: 0,
                        4: 0,
                    },
                    6: 0,
                    7: 0,
                    8: videoInfo.seconds,
                    9: 0,
                },
                2: 0,
            },
            {
                1: {
                    1: thumbInfo.size.length,
                    2: thumbInfo.md5,
                    3: thumbInfo.sha1 || '',
                    4: thumbInfo.md5 + '.jpg',
                    5: {
                        1: 1,
                        2: 0,
                        3: 0,
                        4: 0,
                    },
                    6: thumbInfo.width,
                    7: thumbInfo.height,
                    8: 0,
                    9: 0,
                },
                2: 100,
            },
        ]);
        const raw = await this.c.sendOidbSvcTrpcTcp(this.dm ? 0x11e9 : 0x11ea, 100, pb.encode(body), true);
        const rsp = pb.decode(raw);
        return rsp[4];
    }

    async _uploadLongMsg(elems: pb.Encodable | pb.Encodable[]) {
        const compressed = await gzip(
            pb.encode({
                2: {
                    1: 'MultiMsg',
                    2: {
                        1: {
                            1: {
                                // res head
                                2: this.c.uid,
                                6: this.dm ? this.c.uid : this.uid,
                                7: {
                                    6: this.dm ? this.c.friendList.get(this.target)?.nickname : '',
                                },
                                8: this.dm
                                    ? null
                                    : {
                                          1: this.target,
                                          4: '',
                                      },
                            },
                            2: {
                                // res content
                                1: this.dm ? 529 : 82, // type
                                2: this.dm ? 4 : null, // subType
                                3: this.dm ? 4 : null, // divSeq
                                4: randomInt(100000000, 2147483647), // msg id
                                5: randomInt(1000000, 9999999), // seq
                                6: timestamp(), // time
                                7: 1,
                                8: 0,
                                9: 0,
                                15: {
                                    // forwarder
                                    3: this.dm ? 2 : null,
                                    4: randomBytes(32).toString('base64'),
                                    5: `https://q1.qlogo.cn/g?b=qq&nk=${this.dm ? this.target : this.c.uin}&s=640`,
                                },
                            },
                            3: {
                                1: {
                                    2: elems,
                                    4: null,
                                },
                            },
                        },
                    },
                },
            }),
        );
        return await this._uploadMultiMsg(compressed);
    }

    /** 上传合并转发 */
    private async _uploadMultiMsg(compressed: Buffer): Promise<string> {
        const body = pb.encode({
            2: {
                1: this.dm ? 1 : 3,
                2: {
                    2: this.target,
                },
                4: compressed,
            },
            15: {
                1: 4,
                2: 2,
                3: 9,
                4: 0,
            },
        });
        const payload = await this.c.sendUni('trpc.group.long_msg_interface.MsgService.SsoSendLongMsg', body);
        const rsp = pb.decode(payload)?.[2];
        if (!rsp?.[3])
            drop(
                rsp?.[1],
                rsp?.[2]?.toString() || 'unknown trpc.group.long_msg_interface.MsgService.SsoSendLongMsg error',
            );
        return rsp[3].toString() as string;
    }

    /** 下载合并转发 */
    private async _downloadMultiMsg(resid: string) {
        const body = pb.encode({
            1: {
                1: {
                    2: this.target,
                },
                2: resid,
                3: this.dm ? 1 : 3,
            },
            15: {
                1: 2,
                2: 2,
                3: 9,
                4: 0,
            },
        });
        const payload = await this.c.sendUni('trpc.group.long_msg_interface.MsgService.SsoRecvLongMsg', body);

        return unzip(pb.decode(payload)[1][4].toBuffer());
    }

    /**
     * 发送消息
     * @param proto3 {pb.Encodable}
     * @param file {boolean}
     * @protected
     */
    protected async _sendMsg(proto3: pb.Encodable, file: boolean = false) {
        const seq = this.c.sig.seq + 1;
        const body = pb.encode({
            1: this._getRouting(file),
            2: {
                1: 1,
                2: 0,
                3: 0,
            },
            3: proto3,
            4: seq,
            5: this.gid ? randomBytes(4).readUInt32BE() : undefined,
            12: this.gid ? null : { 1: timestamp() },
        });
        const payload = await this.c.sendUni('MessageSvc.PbSendMsg', body);
        return pb.decode(payload);
    }

    private async _downloadFileToTmpDir(url: string, headers?: any) {
        const savePath = path.join(TMP_DIR, uuid());
        let readable = (
            await axios.get(url, {
                headers,
                responseType: 'stream',
            })
        ).data as Readable;
        readable = readable.pipe(new DownloadTransform());
        await pipeline(readable, fs.createWriteStream(savePath));
        return savePath;
    }

    private async _saveFileToTmpDir(file: string | Buffer) {
        const buf = file instanceof Buffer ? file : Buffer.from(file.slice(9), 'base64');
        const savePath = path.join(TMP_DIR, uuid());
        await fs.promises.writeFile(savePath, buf);
        return savePath;
    }
}

export async function getPttBuffer(file: string | Buffer, transcoding = true, ffmpeg = 'ffmpeg'): Promise<Buffer> {
    if (file instanceof Buffer || file.startsWith('base64://')) {
        // Buffer或base64
        const buf = file instanceof Buffer ? file : Buffer.from(file.slice(9), 'base64');
        const head = buf.slice(0, 7).toString();
        if (head.includes('SILK') || head.includes('AMR') || !transcoding) {
            return buf;
        } else {
            const tmpfile = path.join(TMP_DIR, uuid());
            await fs.promises.writeFile(tmpfile, buf);
            return audioTrans(tmpfile, ffmpeg, true);
        }
    } else if (file.startsWith('http://') || file.startsWith('https://')) {
        // 网络文件
        const readable = (await request.get(file, { responseType: 'stream' })).data as Readable;
        const tmpfile = path.join(TMP_DIR, uuid());
        await pipeline(readable.pipe(new DownloadTransform()), fs.createWriteStream(tmpfile));
        const head = await read7Bytes(tmpfile);
        if (head.includes('SILK') || head.includes('AMR') || !transcoding) {
            const buf = await fs.promises.readFile(tmpfile);
            fs.unlink(tmpfile, NOOP);
            return buf;
        } else {
            return audioTrans(tmpfile, ffmpeg, true);
        }
    } else {
        // 本地文件
        file = String(file).replace(/^file:\/{2}/, '');
        IS_WIN && file.startsWith('/') && (file = file.slice(1));
        const head = await read7Bytes(file);
        if (head.includes('SILK') || head.includes('AMR') || !transcoding) {
            return fs.promises.readFile(file);
        } else {
            return audioTrans(file, ffmpeg);
        }
    }
}

function audioTransSlik(file: string, ffmpeg = 'ffmpeg', temp = false) {
    return new Promise((resolve, reject) => {
        const tmpfile = path.join(TMP_DIR, uuid());
        exec(
            `${ffmpeg} -y -i "${file}" -f s16le -ar 24000 -ac 1 -fs 31457280 "${tmpfile}"`,
            async (error, stdout, stderr) => {
                try {
                    const pcm = await fs.promises.readFile(tmpfile);
                    try {
                        const slik = (await silkEncode(pcm, 24000)).data;
                        resolve(Buffer.from(slik));
                    } catch {
                        reject(
                            new ApiRejection(
                                ErrorCode.FFmpegPttTransError,
                                '音频转码到silk失败，请确认你的ffmpeg可以处理此转换',
                            ),
                        );
                    }
                } catch {
                    reject(
                        new ApiRejection(
                            ErrorCode.FFmpegPttTransError,
                            '音频转码到pcm失败，请确认你的ffmpeg可以处理此转换',
                        ),
                    );
                } finally {
                    fs.unlink(tmpfile, NOOP);
                    if (temp) fs.unlink(file, NOOP);
                }
            },
        );
    });
}

function audioTrans(file: string, ffmpeg = 'ffmpeg', temp = false): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
        try {
            const slik = await audioTransSlik(file, ffmpeg, temp);
            resolve(slik as Buffer);
            return;
        } catch {}
        const tmpfile = path.join(TMP_DIR, uuid());
        exec(`${ffmpeg} -y -i "${file}" -ac 1 -ar 8000 -f amr "${tmpfile}"`, async (error, stdout, stderr) => {
            try {
                const amr = await fs.promises.readFile(tmpfile);
                resolve(amr);
            } catch {
                reject(
                    new ApiRejection(
                        ErrorCode.FFmpegPttTransError,
                        '音频转码到amr失败，请确认你的ffmpeg可以处理此转换',
                    ),
                );
            } finally {
                fs.unlink(tmpfile, NOOP);
                if (temp) fs.unlink(file, NOOP);
            }
        });
    });
}

async function read7Bytes(file: string) {
    const fd = await fs.promises.open(file, 'r');
    const buf = (await fd.read(Buffer.alloc(7), 0, 7, 0)).buffer;
    fd.close();
    return buf;
}
