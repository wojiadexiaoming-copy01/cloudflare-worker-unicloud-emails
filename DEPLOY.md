# Cloudflare Worker 部署指南

## 前置要求

1. **Cloudflare 账户**: 需要有 Cloudflare 账户并添加了你的域名
2. **Node.js**: 版本 16 或更高
3. **UniCloud 函数**: 已部署的 UniCloud 云函数用于数据存储

## 部署步骤

### 1. 准备工作

```bash
# 克隆或下载这个文件夹
cd cloudflare-worker

# 安装依赖
npm install
```

### 2. 配置 Wrangler

首次使用需要登录 Cloudflare：

```bash
npx wrangler login
```

这会打开浏览器进行授权。

### 3. 配置环境变量

编辑 `wrangler.toml` 文件：

```toml
name = "email-management-worker"  # 可以修改为你喜欢的名称
main = "src/index.ts"
compatibility_date = "2023-03-16"

[vars]
UNICLOUD_URL = "https://your-actual-unicloud-function-url"  # 替换为真实的 URL
```

### 4. 本地测试（可选）

```bash
# 启动本地开发服务器
npm run start
```

这会在本地启动一个测试环境，但邮件功能需要在生产环境才能正常工作。

### 5. 部署到 Cloudflare

```bash
# 部署 Worker
npm run deploy
```

成功后会显示类似信息：
```
✨ Success! Uploaded 1 files (x.xx sec)
✨ Uploaded email-management-worker (x.xx sec)
✨ Published email-management-worker
   https://email-management-worker.your-subdomain.workers.dev
```

### 6. 配置邮件路由

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 选择你的域名
3. 进入 **电子邮件** → **电子邮件路由**
4. 点击 **电子邮件 Workers** 标签
5. 点击 **创建** 按钮
6. 配置路由规则：

#### 选项 A: Catch-All（推荐）
- **自定义地址**: `Catch-All`
- **操作**: `发送到 Worker`
- **目标**: 选择你刚部署的 Worker（如 `email-management-worker`）

#### 选项 B: 特定地址
- **自定义地址**: 输入具体邮箱地址（如 `mail@yourdomain.com`）
- **操作**: `发送到 Worker`
- **目标**: 选择你刚部署的 Worker

### 7. 验证部署

发送测试邮件到配置的地址，然后：

1. **查看 Worker 日志**:
   ```bash
   npx wrangler tail
   ```

2. **检查 UniCloud 数据库**: 确认邮件数据已保存

3. **查看前端界面**: 如果已部署前端，检查邮件是否显示

## 配置选项

### 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `UNICLOUD_URL` | ✅ | UniCloud 云函数的 HTTP 触发 URL |

### 可选功能

如果需要启用额外功能，可以取消注释相应配置：

#### R2 对象存储
```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-bucket-name"
preview_bucket_name = "your-bucket-name"
```

需要先在 Cloudflare Dashboard 创建 R2 存储桶。

#### Analytics Engine
```toml
[[analytics_engine_datasets]]
binding = "DMARC_ANALYTICS"
dataset = "dmarc_reports"
```

需要先在 Cloudflare Dashboard 创建 Analytics Engine 数据集。

## 故障排除

### 1. 部署失败

**错误**: `Authentication error`
**解决**: 重新登录 Cloudflare
```bash
npx wrangler logout
npx wrangler login
```

**错误**: `Worker name already exists`
**解决**: 修改 `wrangler.toml` 中的 `name` 字段

### 2. 邮件处理失败

**检查步骤**:
1. 确认邮件路由配置正确
2. 检查 Worker 日志: `npx wrangler tail`
3. 验证 UniCloud URL 是否可访问
4. 确认 UniCloud 函数正常运行

### 3. 常见错误

**错误**: `UniCloud保存失败: 404`
**原因**: UniCloud URL 不正确
**解决**: 检查并更新 `wrangler.toml` 中的 `UNICLOUD_URL`

**错误**: `unknown extension: xxx`
**原因**: 邮件附件格式不支持
**解决**: 这是正常情况，系统会将其标记为普通邮件

## 更新部署

当代码有更新时：

```bash
# 拉取最新代码
git pull

# 重新部署
npm run deploy
```

## 监控和维护

### 查看使用情况
在 Cloudflare Dashboard 的 Workers 页面可以查看：
- 请求数量
- 执行时间
- 错误率
- 资源使用情况

### 设置告警
建议设置以下告警：
- Worker 执行失败率过高
- 响应时间过长
- 请求量异常

### 日志监控
```bash
# 实时查看日志
npx wrangler tail

# 查看特定时间段的日志
npx wrangler tail --since 1h
```

## 成本估算

### Cloudflare Workers
- **免费额度**: 100,000 请求/天
- **付费计划**: $5/月，包含 10,000,000 请求

### Email Routing
- **完全免费**: 无限制邮件转发

对于大多数个人和小型企业使用场景，免费额度完全够用。

## 安全建议

1. **定期更新依赖**: `npm audit` 检查安全漏洞
2. **监控异常**: 设置错误告警
3. **访问控制**: 考虑在 UniCloud 端添加访问验证
4. **数据备份**: 定期备份 UniCloud 数据库

## 下一步

部署完成后，你可以：
1. 部署前端界面查看邮件
2. 配置 DMARC 记录开始接收安全报告
3. 设置监控和告警
4. 根据需要扩展功能