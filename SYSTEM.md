# 张崇会火锅 - 新春抽奖系统

> 系统版本: v50 | 部署平台: Google Apps Script | 状态: **已上线运行中**

## 文件结构

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/Code.js` | ~1460 | 后端逻辑 (所有 API 函数) |
| `src/Admin.html` | ~1280 | 桌面版管理后台 |
| `src/Mobile.html` | ~605 | 移动端管理界面 |
| `src/Lottery.html` | ~548 | 用户抽奖页面 |
| `src/appsscript.json` | 10 | Apps Script 配置 |

## 部署信息

- **Deployment ID**: `AKfycbzTxymBxmmliLWpOdg-lh-Ev6tDKyjEf91wgTaDAtxx0gtEsZZrsL9rL9AFv7-XaySlew`
- **Script ID**: `1FwYVuGWWPM4MjfRpgD7Ph587XYWkbkyaYzXL5jRh7bC4izxeXwFXA2W8`
- **clasp PATH**: `export PATH="/c/Program Files/nodejs:$PATH"`
- **GitHub**: `itsecure00-wq/LDS` 分支 `musing-hypatia`
- **抽奖短链**: `tinyurl.com/HuiHotpotPermasJaya`

### 部署命令

```bash
export PATH="/c/Program Files/nodejs:$PATH"
cd "C:\Users\Pei Shee\.claude-worktrees\LDS\musing-hypatia"
npx clasp push
npx clasp deploy --deploymentId AKfycbzTxymBxmmliLWpOdg-lh-Ev6tDKyjEf91wgTaDAtxx0gtEsZZrsL9rL9AFv7-XaySlew --description "vXX: description"
```

### URL 路由

| 路由参数 | 页面 |
|----------|------|
| (默认) | Lottery.html 抽奖页 |
| `?page=admin` | Admin.html 管理后台 |
| `?page=mobile` | Mobile.html 移动管理 |

---

## 数据表结构 (Google Sheets)

### Sheet 常量 (SH 对象)

```
奖品配置 | 用户数据 | 中奖记录 | 邀请记录 | 员工账号 | 操作日志
```

### 奖品配置 (11列)

| 奖品ID | 名称 | 图标 | 总库存 | 已发 | 剩余 | 权重 | 价值 | 大奖 | 状态 | 格子位置 |
|--------|------|------|--------|------|------|------|------|------|------|----------|

### 用户数据 (15列)

| 用户ID | 手机 | 姓名 | 邮箱 | 注册时间 | 积分 | 积分过期 | 总积分 | 邀请码 | 邀请人 | 邀请数 | 总抽奖 | 今日抽 | 最后抽奖 | 状态 |
|--------|------|------|------|----------|------|----------|--------|--------|--------|--------|--------|--------|----------|------|

### 中奖记录 (14列)

| 记录ID | 时间 | 用户ID | 手机 | 姓名 | 奖品 | 验证码 | 有效期 | WA状态 | WA时间 | 核销状态 | 核销时间 | 核销员 | 备注 |
|--------|------|--------|------|------|------|--------|--------|--------|--------|----------|----------|--------|------|

### 邀请记录 (8列)

| 邀请ID | 时间 | 邀请人手机 | 邀请人姓名 | 被邀请人手机 | 被邀请人姓名 | 获得积分 | 状态 |
|--------|------|------------|------------|--------------|--------------|----------|------|

### 员工账号 (8列)

| 员工ID | 姓名 | 账号 | 密码(SHA-256) | 角色 | 状态 | 创建时间 | 最后登录 |
|--------|------|------|---------------|------|------|----------|----------|

### 操作日志 (6列)

| 日志ID | 时间 | 操作员 | 角色 | 动作 | 详情 |
|--------|------|--------|------|------|------|

---

## 权限控制

| 功能 | Boss | Admin | Manager | Staff |
|------|:----:|:-----:|:-------:|:-----:|
| 统计面板 | O | O | X | X |
| 验票核销 | O | O | O | O |
| 中奖记录 | O | O | O | O |
| WhatsApp 发送 | O | O | O | X |
| 奖品配置 | O | O | X | X |
| 音乐设置 | O | O | X | X |
| 员工管理 | O | O | X | X |
| 查询用户 | O | O | O | X |
| 压力测试 | O | O | X | X |

Mobile.html 底部导航:
- Staff: 只看到 **验票 + 查询**, 隐藏 WhatsApp
- Manager/Admin/Boss: 看到全部 3 个 Tab

---

## 关键常量

```
APP_VERSION        = v50
SESSION_EXPIRY     = 2小时 (CacheService TTL 7200秒)
LOGIN_MAX_ATTEMPTS = 5次失败锁定15分钟
POINTS_EXPIRY      = 30天
PRIZE_EXPIRY       = 30天 (验证码有效期)
MAX_DRAWS_PER_DAY  = 3次
INVITE_POINTS      = 1分
REGISTER_POINTS    = 1分
LOTTERY_COST       = 1分
```

---

## 核心业务流程

### 抽奖流程
```
用户输入手机 → 注册/登录 → 检查积分>=1 → 检查今日<3次
→ LockService 获取锁 → 扣积分 → 权重随机选奖 → 检查库存
→ 扣库存 → 生成验证码(ZCH+6位) → 写入中奖记录 → 释放锁
→ 前端动画(顺时针3圈+定位) → 显示结果+QR码
```

### 核销流程
```
管理员输入/扫描验证码 → queryCode 查询 → 显示状态
→ 确认核销 → verifyCode(code, sessionToken) → 服务端验证权限
→ 更新核销状态+时间+核销员 → 记录日志
```

### WhatsApp 发送流程
```
选择待发送记录 → sendWhatsAppByCode(code, token)
→ 验证 Manager+ 权限 → 更新 WA 状态 → 构建纯文本消息(无 emoji)
→ 返回 wa.me?text=... 链接 → 打开 WhatsApp → 手动点发送
```

> **注意**: wa.me URL 不支持 emoji (encodeURIComponent 会导致乱码), 模板只用纯文本 + WhatsApp 格式 (`*bold*`)

### 邀请流程
```
用户A分享链接(ref=邀请码) → 用户B注册时携带 ref
→ 验证邀请码 → 检查B未被邀请过 → A获1积分 → 记录邀请
```

---

## 安全特性

1. **SHA-256 密码哈希** — 旧明文密码登录时自动升级
2. **登录频率限制** — 5次失败锁定15分钟
3. **Session Token** — CacheService 2小时过期
4. **LockService** — 抽奖并发控制 (防超发)
5. **XSS 防护** — 所有输出 HTML 转义 (`esc()` 函数)
6. **权限校验** — 服务端验证 sessionToken + 角色
7. **手机号验证** — 60/65 前缀格式校验
8. **防重复邀请** — 检查邀请记录表

---

## 自动触发器

| 时间 | 函数 | 说明 |
|------|------|------|
| 每日 3:00 | `backupData()` | 自动备份到 Google Drive |
| 每日 9:00 | `sendExpiryReminders()` | 7天内到期提醒 |

---

## ID 格式规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 用户 | U + 8位UUID | U1a2b3c4d |
| 奖品 | P + 6位UUID | P001 |
| 记录 | R + 8位UUID | R5e6f7g8h |
| 邀请 | I + 8位UUID | I9a0b1c2d |
| 员工 | S + 6位UUID | S001 |
| 日志 | L + 8位UUID | L3e4f5g6h |
| 验证码 | ZCH + 6位数字 | ZCH123456 |
| 邀请码 | 6位大写字母数字 | ABC123 |

---

## 技术依赖

### 前端库
- `html5-qrcode v2.3.4` — QR 扫码 (Admin + Mobile)
- `qrcodejs v1.0.0` — QR 码生成 (Lottery)

### Google Apps Script 服务
- SpreadsheetApp, LockService, CacheService, Utilities
- HtmlService, ScriptApp, DriveApp, UrlFetchApp

---

## 手机号格式

| 国家 | 输入 | 存储 |
|------|------|------|
| 马来西亚 | 0123456789 | 60123456789 |
| 新加坡 | 91234567 | 6591234567 |

---

## 测试数据识别

- 测试用户手机: `60199` 开头 (旧: `6090` 开头)
- 测试中奖记录: WA 状态 = `测试`
- 清理函数: `cleanTestData()`

---

## 版本历史

| 版本 | 部署 | 说明 |
|------|------|------|
| v50 | @62 | 修复手机版权限 + 刷新保持登录 |
| v49 | @59 | 新增 Mobile.html 移动管理端 |
| v48 | @52 | 修复 registerUser cachedRecords |
| v47 | @51 | 系统审计10项优化 (SHA-256, 频率限制等) |

---

*文档更新: 2026-02-12 | 系统状态: 已上线*
