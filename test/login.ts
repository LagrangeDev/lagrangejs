import {Config, createClient} from "../lib";
import {Platform} from "../lib/core";

const account = 147258369;
const config: Config = {
    autoServer: true,
    logLevel: "trace",
    platform: Platform.Linux
}
const client = createClient(account, config);

client.on("system.login.qrcode", function (e) {
    //扫码后按回车登录
    process.stdin.once("data", async () => {
        await this.login();
    });
}).login();