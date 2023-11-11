import {Contactable} from "./contactable";
import {Client} from "../client";

export class User extends Contactable {
    protected constructor(c: Client) {
        super(c);
    }
}
