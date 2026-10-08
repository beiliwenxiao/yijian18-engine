/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/** 所有本地与未来远端 authority adapter 必须实现的唯一命令执行端口。 */
export class AuthorityPort {
  async execute(_command) {
    throw new Error('AuthorityPort.execute(command) must be implemented');
  }

  dispose() {}
}

export function assertAuthorityPort(port) {
  if (!port || typeof port.execute !== 'function') {
    throw new TypeError('AuthorityPort requires execute(command)');
  }
  return port;
}

/** 未来远端 adapter 的接口边界；当前交付不连接生产 transport。 */
export class RemoteAuthorityAdapter extends AuthorityPort {
  async execute(_command) {
    throw new Error('RemoteAuthorityAdapter is an interface; provide a loopback or future transport adapter');
  }
}

export default AuthorityPort;
