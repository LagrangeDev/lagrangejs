import {ECDH, createECDH } from "crypto"
import { md5 } from "./constants"

const OICQ_PUBLIC_KEY_256 = Buffer.from("049D1423332735980EDABE7E9EA451B3395B6F35250DB8FC56F25889F628CBAE3E8E73077914071EEEBC108F4E0170057792BB17AA303AF652313D17C1AC815E79", "hex")
const OICQ_PUBLIC_KEY_192 = Buffer.from("04928D8850673088B343264E0C6BACB8496D697799F37211DEB25BB73906CB089FEA9639B4E0260498B51A992D50813DA8", "hex")

export default class Ecdh {
    private ecdh: ECDH;
    public publicKey: Buffer;
    public shareKey: Buffer;

    constructor(type: 'wtlogin' | 'exchange', private compress: boolean) {
        this.ecdh = createECDH(type === "wtlogin" ? "secp192k1" : "prime256v1");

        const serverPub = type === "wtlogin" ? OICQ_PUBLIC_KEY_192 : OICQ_PUBLIC_KEY_256;
        this.publicKey = this.ecdh.generateKeys();
        this.shareKey = this.ecdh.computeSecret(serverPub);

        if (compress) {
            this.shareKey = md5(this.shareKey).slice(0, 16);
        }
    }

    exchange(bobPublic: Buffer) {
        this.shareKey = this.ecdh.computeSecret(bobPublic);

        if (this.compress) {
            this.shareKey = md5(this.shareKey).slice(0, 16);
        }

        return this.shareKey;
    }
}