/* UI 映射常量（非数据，仅用于展示，不依赖后端） */

/** 官网 / 功能页对外联系方式 */
export const SITE_CONTACT = {
  github: 'https://github.com/yonyong/Talos',
  githubLabel: 'GitHub',
  email: '2365878736@qq.com',
  mailto: 'mailto:2365878736@qq.com',
} as const

export const statusMeta: Record<string, { l: string; tone: 'ok' | 'warn' | 'err' | 'info' | 'prog' | 'mut' }> = {
  admitting: { l: '准入中', tone: 'mut' },
  admitted: { l: '已准入', tone: 'info' },
  rejected: { l: '已驳回', tone: 'err' },
  sorting: { l: '分拣中', tone: 'prog' },
  running: { l: '执行中', tone: 'prog' },
  blocked: { l: '阻塞', tone: 'warn' },
  reviewing: { l: '评审待决', tone: 'warn' },
  done: { l: '已验收', tone: 'ok' },
  closed: { l: '已关闭', tone: 'mut' },
}

/* 角色展示元数据（角色权限矩阵本身来自后端 /api/roles） */
export const ROLES = ['admin', 'pm', 'lead', 'dev', 'qa', 'guest'] as const

export const roleLabel: Record<string, string> = {
  admin: '管理员',
  pm: '产品',
  lead: '技术负责人',
  dev: '开发',
  qa: '测试',
  guest: '访客',
}

export const permLevelLabel: Record<string, string> = {
  full: '完整',
  part: '部分',
  none: '无',
}
