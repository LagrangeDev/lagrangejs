import { Worker, MessageChannel, isMainThread, parentPort } from 'worker_threads';
import {
    decode as silkDecode,
    encode as silkEncode,
    getDuration as silkGetDuration,
    decodeResult,
    encodeResult,
} from 'silk-wasm';
import fs from 'fs';

if (!isMainThread && parentPort) {
    parentPort.once('message', val => {
        const data = val.data;
        const port = val.port;
        const input = data.input || Buffer.alloc(0);
        if (data.file) fs.unlink(data.file, () => { });
        switch (data.type) {
            case 'encode':
                silkEncode(input, data.sampleRate).then(ret => {
                    port.postMessage(ret);
                    port.close();
                });
                break;
            case 'decode':
                silkDecode(input, data.sampleRate).then(ret => {
                    port.postMessage(ret);
                    port.close();
                });
                break;
            case 'getDuration':
                port.postMessage(silkGetDuration(input, data.frameMs));
                port.close();
                break;
            default:
                port.postMessage({ data: null });
                port.close();
        }
    });
}

function postMessage(data: any): Promise<decodeResult | encodeResult | number | any> {
    const worker = new Worker(__filename);
    const subChannel = new MessageChannel();
    const port = subChannel.port2;
    return new Promise(resolve => {
        port.once('message', ret => {
            port.close();
            worker.terminate();
            resolve(ret);
        });
        worker.postMessage({ port: subChannel.port1, data: data }, [subChannel.port1]);
    });
}

function file(input: Buffer | Uint8Array | string) {
    if (typeof input === 'string') {
        input = fs.readFileSync(input);
    }
    return input;
}

export function encode(input: Buffer | Uint8Array | string, sampleRate: number): Promise<encodeResult> {
    return postMessage({ type: 'encode', input: file(input), sampleRate });
}

export function decode(input: Buffer | Uint8Array | string, sampleRate: number): Promise<decodeResult> {
    return postMessage({ type: 'decode', input: file(input), sampleRate });
}

export function getDuration(input: Buffer | Uint8Array | string, frameMs?: number): Promise<number> {
    return postMessage({ type: 'getDuration', input: file(input), frameMs });
}
