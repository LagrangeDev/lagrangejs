import { Socket } from "net"
import { BUF0, NOOP, timestamp } from "./constants"
import * as dns from "dns";

const default_host = "msfwifi.3g.qq.com"
const default_port = 8080
let update_time = 0
let searching: Promise<void> | undefined
let host_port: {[ip: string]: number} = { }

/**
 * @event connect2
 * @event packet
 * @event lost
 */
export default class Network extends Socket {
    host = default_host;
    port = default_port;
    autoSearch = true;
    connected = false;
    private buf = BUF0;

    constructor() {
        super();
        this.on("close", () => {
            this.buf = BUF0
            if (this.connected) {
                this.connected = false;
                delete host_port[this.host];
                this.resolve();
                this.emit("lost");
            }
        })

        this.on("data", (chunk) => {
            this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
            while (this.buf.length > 4) {
                let len = this.buf.readUInt32BE();
                if (this.buf.length >= len) {
                    const packet = this.buf.slice(4, len);
                    this.buf = this.buf.slice(len);
                    this.emit("packet", packet);
                }
                else {
                    break;
                }
            }
        })
    }

    join(cb = NOOP) {
        if (this.connecting) return;
        if (this.connected) return cb();
        this.resolve();
        this.removeAllListeners("connect");
        this.connect(this.port, this.host, () => {
            this.connected = true;
            this.emit("connect2");
            cb();
        })
    }

    private resolve() {
        if (!this.autoSearch) return;
        const iplist = Object.keys(host_port);
        if (iplist.length > 0) {
            this.host = iplist[0];
            this.port = host_port[this.host];
        }
        if (timestamp() - update_time >= 3600 && !searching) {
            searching = fetchServerList().then(map => {
                searching = undefined;
                const list = Object.keys(map).slice(0, 3);
                if (list[0] && list[1]) {
                    update_time = timestamp();
                    host_port = { };
                    host_port[list[0]] = map[list[0]];
                    host_port[list[1]] = map[list[1]];
                }
            }).catch(NOOP);
        }
    }
}

export async function fetchServerList() {
    const map: typeof host_port = { };
    dns.resolve4(default_host, (err, addresses) => {
        for (let address of (addresses||[])) {
            map[address] = 8080;
        }
    });

    return map;
}
