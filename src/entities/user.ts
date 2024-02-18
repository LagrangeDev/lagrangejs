import {Contactable} from "./contactable";
import {Client} from "../client";
import {lock} from "../core/constants";

export class User extends Contactable {
    protected constructor(c: Client,public readonly uin:number) {
        super(c);
        lock(this,'uin')
    }
}
