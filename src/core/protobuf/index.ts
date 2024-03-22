import pb from './protobuf.min.js';
import * as zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { lock } from '@/core/constants';

export interface Encodable {
    [tag: number]: any;
}

export class Proto implements Encodable {
    [tag: number]: any;

    get length() {
        return this.encoded.length;
    }

    constructor(private encoded: Buffer) {
        const assignObj = _decode(new pb.Reader(encoded));
        Object.assign(this, assignObj);
        lock(this, 'encoded');
    }

    toString() {
        return this.encoded.toString();
    }

    toHex() {
        return this.encoded.toString('hex');
    }

    toBase64() {
        return this.encoded.toString('base64');
    }

    toBuffer() {
        return this.encoded;
    }

    [Symbol.toPrimitive]() {
        return this.toString();
    }

    toJSON() {
        return Object.fromEntries(
            Object.keys(this)
                .filter(key => /^\d+$/.test(key))
                .map(key => {
                    let value = this[Number(key)];
                    if (typeof value === 'bigint') value = String(value) + 'u';
                    if (Buffer.isBuffer(value)) return [key, `protobuf://${value.toString('hex')}`];
                    return [key, value];
                }),
        );
    }

    save(prefix: string = '', fn: (pb: Proto) => any = pb => JSON.stringify(pb.toJSON(), null, 2)) {
        fs.writeFileSync(path.resolve(process.cwd(), 'data', `${prefix}.json`), fn(this), 'utf8');
    }
}

function _encode(writer: pb.Writer, tag: number, value: any) {
    if (value === null || value === undefined) return;
    let type = 2;
    if (typeof value === 'number') {
        type = Number.isInteger(value) ? 0 : 1;
    } else if (typeof value === 'string') {
        if (value.startsWith('zip://')) value = zlib.gzipSync(Buffer.from(value.substring(6)));
        else if (/^\d+u$/.test(value)) {
            const tmp = new pb.util.Long();
            const val = BigInt(value.substring(0, -1));
            tmp.unsigned = false;
            tmp.low = Number(val & 0xffffffffn);
            tmp.high = Number((val & 0xffffffff00000000n) >> 32n);
            value = tmp;
            type = 0;
        } else if (value.startsWith('protobuf://')) value = Buffer.from(value.substring(11), 'hex');
        else value = Buffer.from(value);
    } else if (value instanceof Uint8Array) {
        //
    } else if (value instanceof Proto) {
        value = value.toBuffer();
    } else if (typeof value === 'object') {
        value = encode(value);
    } else if (typeof value === 'bigint') {
        const tmp = new pb.util.Long();
        tmp.unsigned = false;
        tmp.low = Number(value & 0xffffffffn);
        tmp.high = Number((value & 0xffffffff00000000n) >> 32n);
        value = tmp;
        type = 0;
    } else {
        return;
    }
    const head = (tag << 3) | type;
    writer.uint32(head);
    switch (type) {
        case 0:
            if (value < 0) writer.sint64(value);
            else writer.int64(value);
            break;
        case 2:
            writer.bytes(value);
            break;
        case 1:
            writer.double(value);
            break;
    }
}

export function encode(obj: Encodable) {
    Reflect.setPrototypeOf(obj, null);
    const writer = new pb.Writer();
    for (const tag of Object.keys(obj).map(Number)) {
        const value = obj[tag];
        if (Array.isArray(value)) {
            for (let v of value) _encode(writer, tag, v);
        } else {
            _encode(writer, tag, value);
        }
    }
    return writer.finish();
}

function long2int(long: pb.Long) {
    if (long.high === 0) return long.low >>> 0;
    const bigint = (BigInt(long.high) << 32n) | (BigInt(long.low) & 0xffffffffn);
    const int = Number(bigint);
    return Number.isSafeInteger(int) ? int : bigint;
}
function _decode(reader: pb.Reader): Encodable {
    const result = {} as Encodable;
    while (reader.pos < reader.len) {
        const k = reader.uint32();
        const tag = k >> 3,
            type = k & 0b111;
        let value;
        switch (type) {
            case 0:
                value = long2int(reader.int64());
                break;
            case 1:
                value = long2int(reader.fixed64());
                break;
            case 2:
                value = Buffer.from(reader.bytes());
                try {
                    value = new Proto(value);
                    if (!Object.keys(value).length) throw new Error('empty proto');
                } catch (e) {
                    let temp: string | Buffer = value.toString(); // 先尝试转utf8，不成功再转hex
                    if (temp.includes('\x00')) {
                        if (value[0] == 0x78 && value[1] == 0x9c)
                            temp = `zip://${zlib.unzipSync(value as Buffer).toString()}`;
                        else temp = value as Buffer;
                    }
                    value = temp;
                }
                break;
            case 5:
                value = reader.fixed32();
                break;
            default:
                return null as any;
        }
        if (Array.isArray(result[tag])) {
            result[tag].push(value);
        } else if (Reflect.has(result, tag)) {
            result[tag] = [result[tag]];
            result[tag].push(value);
        } else {
            result[tag] = value;
        }
    }
    return result;
}
export function decode(encoded: Buffer): Proto {
    return new Proto(encoded);
}
