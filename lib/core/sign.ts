import {BaseClient} from "./base-client";
import axios from "axios";

export interface SignResult {
    "sign": string,
    "extra": string,
    "token": string
}

export async function getSign(this: BaseClient, cmd: string, seq: number, src: Buffer) {
    const params = {
        cmd: cmd,
        seq: seq,
        src: src.toString("hex")
    };
    const url = new URL("http://127.0.0.1:7458/api/sign").toString();
    const config = {
        params: params
    };
    const data = await axios.get(url, config);
    return data.data["value"] as SignResult;
}