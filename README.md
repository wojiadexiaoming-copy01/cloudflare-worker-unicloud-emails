# Cloudflare Worker - 邮件管理系统

这是邮件管理系统的 Cloudflare Worker 部分，负责接收和处理所有类型的邮件。

## 功能特性

- 📧 **智能邮件分类**: 自动识别 DMARC 报告和普通邮件
- 🔄 **自动处理**: 邮件到达时自动触发处理流程
- 💾 **数据存储**: 将处理后的数据保存到 UniCloud 数据库
- 🛡️ **容错处理**: 处理失败的邮件也会保存基本信息
- 📊 **可选分析**: 支持 Analytics Engine 备份分析

## 支持的邮件类型

### 1. DMARC 报告 (`dmarc`)
- 自动解析 XML 报告内容
- 支持 `.gz`、`.zip`、`.xml` 格式附件
- 提取结构化的安全数据

### 2. 普通邮件 (`regular`)
- 保存完整的邮件内容
- 支持 HTML 和纯文本格式
- 保存附件信息

### 3. 错误邮件 (`error`)
- 处理失败时的备用保存
- 记录错误信息便于调试

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境
编辑 `wrangler.toml` 文件，设置你的 UniCloud 函数 URL：
```toml
[vars]
UNICLOUD_URL = "https://your-actual-unicloud-function-url"
```

### 3. 本地开发
```bash
npm run start
```

### 4. 部署到 Cloudflare
```bash
npm run deploy
```

## 配置说明

### 必需配置
- `UNICLOUD_URL`: UniCloud 云函数的 HTTP 触发 URL

### 可选配置
如果需要额外功能，可以取消注释：

```toml
# R2 对象存储（备份原始附件）
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-bucket-name"

# Analytics Engine（数据分析）
[[analytics_engine_datasets]]
binding = "DMARC_ANALYTICS"
dataset = "dmarc_reports"
```

## 邮件路由配置

在 Cloudflare Dashboard 中配置 Email Routing：

1. 进入域名管理 → 电子邮件 → 电子邮件路由
2. 添加路由规则：
   - **Catch-All** → 发送到 Worker → `email-management-worker`
   - 或配置特定地址 → 发送到 Worker → `email-management-worker`

## 数据流向

```
邮件发送 → Cloudflare Email Routing → Worker 处理 → UniCloud 存储
```

## 开发命令

```bash
# 本地开发
npm run start

# 部署到生产环境
npm run deploy

# 代码格式化
npm run pretty

# 代码检查
npm run lint

# 运行测试
npm test
```

## 监控和调试

### 查看 Worker 日志
```bash
npx wrangler tail
```

### 常见问题

1. **邮件处理失败**
   - 检查 UniCloud URL 是否正确
   - 验证网络连接
   - 查看 Worker 日志

2. **DMARC 报告解析失败**
   - 检查附件格式是否支持
   - 验证 XML 结构是否正确

3. **数据保存失败**
   - 检查 UniCloud 函数状态
   - 验证数据库权限

## 安全建议

- 定期更新依赖包
- 监控 Worker 执行日志
- 设置适当的错误告警
- 考虑添加访问控制

## 扩展功能

可以根据需要添加：
- 邮件转发功能
- 自动回复机制
- 垃圾邮件过滤
- 自定义处理规则

## 技术栈

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Email Parsing**: postal-mime
- **XML Processing**: fast-xml-parser
- **Compression**: pako, unzipit
- **Build Tool**: Wrangler