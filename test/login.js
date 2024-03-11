const createClient = require("../lib/client.js").createClient;
const Platform = require("../lib/core/device.js").Platform;


const client = createClient(2936527279, {
    signApiAddr: "https://sign.libfekit.so/api/sign",
    logLevel: "trace",
    platform: Platform.Linux
});

client.login("2006wxjj");

client.on("system.login.slider", (event) => {
    console.log(event.url);
    process.stdin.once("data", (input) => {
        const raw = Buffer.from(input).toString().replace('\n', '');
        const ticket = raw.split("@")[0];
        const randStr = "@" + raw.split("@")[1];

        client.submitCaptcha(ticket, randStr);
    })
})