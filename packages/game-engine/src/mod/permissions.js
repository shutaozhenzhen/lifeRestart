/**
 * Mod 权限常量（无 Node 依赖，供前端/引擎共享）
 */

// #PERMISSION_LABELS
// 权限中文说明。
export const PERMISSION_LABELS = {
  ai: '访问 AI 服务',
  network: '网络请求',
  storage: '本地存储',
  hooks: '注册游戏钩子',
}

// #VALID_PERMISSIONS
// 合法权限集合。
export const VALID_PERMISSIONS = ['ai', 'network', 'storage', 'hooks']
