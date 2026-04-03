import { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { AccountProxy } from '../interface/Account';
declare class AxiosClient {
    private instance;
    private account;
    constructor(account: AccountProxy);
    private getAgentForProxy;
    request(config: AxiosRequestConfig, bypassProxy?: boolean): Promise<AxiosResponse>;
}
export default AxiosClient;
//# sourceMappingURL=Axios.d.ts.map