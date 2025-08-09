# 邮件删除检测测试指南

## 🔍 **邮件删除检测功能**

现在 Worker 会检测以下几种邮件删除情况：

### **1. 邮件对象不存在** (`message_null`)
```javascript
if (!message) {
  console.error('❌ 邮件对象完全不存在')
  await saveDeletedEmailRecord(env, '邮件对象不存在', 'message_null')
}
```

### **2. 邮件原始数据为空** (`raw_null`)
```javascript
if (!message.raw) {
  console.error('❌ 邮件原始数据为空')
  await saveDeletedEmailRecord(env, '邮件原始数据为空', 'raw_null')
}
```

### **3. 邮件原始数据大小为0** (`raw_empty`)
```javascript
if (message.raw.byteLength === 0) {
  console.error('❌ 邮件原始数据大小为0')
  await saveDeletedEmailRecord(env, '邮件原始数据大小为0', 'raw_empty')
}
```

## 📊 **日志输出示例**

### **正常邮件处理**
```
=== 邮件接收检查 ===
邮件对象存在: true
邮件原始数据存在: true
邮件原始数据大小: 1234 字节
✅ 邮件数据完整，开始处理
=== 开始处理邮件 ===
...
```

### **邮件被删除的情况**
```
=== 邮件接收检查 ===
邮件对象存在: true
邮件原始数据存在: false
邮件原始数据大小: 0 字节
❌ 邮件原始数据为空
🔄 记录邮件删除事件...
删除原因: 邮件原始数据为空
删除类型: raw_null
🔄 开始调用UniCloud函数...
✅ 邮件删除事件记录成功
```

## 🗄️ **数据库记录**

删除事件会在数据库中创建一条记录：

```json
{
  "emailId": "generated_hash",
  "type": "deleted",
  "from": "未知",
  "to": "未知", 
  "subject": "邮件已删除",
  "errorMessage": "邮件原始数据为空",
  "deleteType": "raw_null",
  "deletedAt": "2025-01-08T14:27:06.393Z",
  "rawEmail": "邮件删除记录 - 邮件原始数据为空",
  "createdAt": "2025-01-08T14:27:06.393Z"
}
```

## 🧪 **测试步骤**

### **1. 部署更新的代码**
```bash
cd cloudflare-worker-unicloud-emails
git add .
git commit -m "Add email deletion detection"
git push
```

### **2. 发送测试邮件**
发送邮件到你的域名地址，观察日志。

### **3. 查看实时日志**
在 Cloudflare Workers 页面查看实时日志，应该能看到：
- 邮件接收检查过程
- 删除检测结果
- UniCloud 调用详情

### **4. 检查数据库**
在 UniCloud 控制台查看 `emails` 集合，应该能看到：
- 正常邮件记录 (`type: 'regular'` 或 `'dmarc'`)
- 删除事件记录 (`type: 'deleted'`)

## 🔧 **故障排除**

### **如果看不到删除检测日志**
1. 确认代码已正确部署
2. 检查 Worker 是否正常运行
3. 验证邮件路由配置

### **如果删除记录没有保存到数据库**
1. 检查 UniCloud 函数是否正常
2. 验证网络连接
3. 查看 UniCloud 函数日志

## 📈 **预期结果**

现在你应该能够：
- ✅ 看到每封邮件的接收状态
- ✅ 识别被删除的邮件
- ✅ 记录删除事件到数据库
- ✅ 通过前端界面查看删除记录

**这样你就能清楚知道邮件是否被自动删除，以及删除的具体原因！** 🎉