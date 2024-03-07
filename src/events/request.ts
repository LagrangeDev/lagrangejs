export interface RequestEvent {
    approve(): Promise<boolean>;
    reject(reason?: string): Promise<boolean>;
}
