import * as PostalMime from 'postal-mime'
import * as mimeDb from 'mime-db'

import * as unzipit from 'unzipit'
import * as pako from 'pako'

import { XMLParser } from 'fast-xml-parser'

import {
  Env,
  Attachment,
  DmarcRecordRow,
  AlignmentType,
  DispositionType,
  DMARCResultType,
  PolicyOverrideType,
} from './types'

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    // 检查邮件是否被删除或为空
    console.log('=== 邮件接收检查 v2.0 ===')
    console.log('邮件对象存在:', !!message)
    console.log('邮件原始数据存在:', !!(message && message.raw))
    console.log('邮件原始数据大小:', message?.raw?.byteLength || 0, '字节')

    if (!message) {
      console.error('❌ 邮件对象完全不存在')
      await saveDeletedEmailRecord(env, '邮件对象不存在', 'message_null')
      return
    }

    if (!message.raw) {
      console.error('❌ 邮件原始数据为空')
      await saveDeletedEmailRecord(env, '邮件原始数据为空', 'raw_null')
      return
    }

    if (message.raw.byteLength === 0) {
      console.error('❌ 邮件原始数据大小为0')
      await saveDeletedEmailRecord(env, '邮件原始数据大小为0', 'raw_empty')
      return
    }

    console.log('✅ 邮件数据完整，开始处理')
    await handleEmail(message, env, ctx)
  },
}

// 记录被删除的邮件
async function saveDeletedEmailRecord(env: Env, reason: string, type: string): Promise<void> {
  console.log('🔄 记录邮件删除事件...')

  const deletedEmailData = {
    type: 'deleted',
    from: '未知（邮件已删除）',
    to: '未知（邮件已删除）',
    subject: '邮件被删除',
    date: new Date(),
    errorMessage: reason,
    deleteType: type,
    deletedAt: new Date(),
    rawEmail: JSON.stringify({
      error: reason,
      type: type,
      timestamp: new Date().toISOString()
    })
  }

  try {
    await saveToUniCloud(deletedEmailData, env)
    console.log('✅ 删除事件记录成功')
  } catch (error) {
    console.error('❌ 删除事件记录失败:', error)
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEmail(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('=== 开始处理邮件 ===')
  console.log('邮件原始大小:', message.raw.byteLength, '字节')
  console.log('环境变量 UNICLOUD_URL:', env.UNICLOUD_URL || '未设置')

  const parser = new PostalMime.default()

  let email: any
  try {
    // parse email content
    const rawEmail = new Response(message.raw)
    email = await parser.parse(await rawEmail.arrayBuffer())
    console.log('✅ 邮件解析成功')
  } catch (parseError) {
    console.error('❌ 邮件解析失败:', parseError)
    await saveDeletedEmailRecord(env, `邮件解析失败: ${(parseError as Error).message}`, 'parse_failed')
    return
  }

  console.log('邮件解析完成:')
  console.log('- 发件人:', email.from?.text || '未知')
  console.log('- 收件人:', email.to?.map(addr => addr.text).join(', ') || '未知')
  console.log('- 主题:', email.subject || '(无主题)')
  console.log('- 附件数量:', email.attachments?.length || 0)
  console.log('- 邮件日期:', email.date || '未知')
  console.log('- 邮件ID:', email.messageId || '未知')

  // 检查邮件内容是否完整
  if (!email.from && !email.to && !email.subject) {
    console.error('❌ 邮件内容不完整，可能被截断或删除')
    await saveDeletedEmailRecord(env, '邮件内容不完整', 'content_incomplete')
    return
  }

  try {
    // 判断邮件类型并处理
    const isDmarc = isDmarcReport(email)
    console.log('邮件类型判断结果:', isDmarc ? 'DMARC报告' : '普通邮件')

    if (isDmarc) {
      console.log('✅ 识别为DMARC报告邮件')
      await processDmarcReport(email, env)
    } else {
      console.log('✅ 识别为普通邮件')
      await processRegularEmail(email, env)
    }
    console.log('=== 邮件处理完成 ===')
  } catch (error) {
    console.error('❌ 邮件处理失败:', error)
    console.error('错误详情:', (error as Error).message)
    console.error('错误堆栈:', (error as Error).stack)

    // 即使处理失败也保存基本邮件信息
    console.log('🔄 尝试保存基本邮件信息...')
    try {
      await saveBasicEmail(email, env, (error as Error).message)
      console.log('✅ 基本邮件信息保存成功')
    } catch (saveError) {
      console.error('❌ 基本邮件信息保存也失败:', saveError)
    }
  }
}

// 判断是否为DMARC报告
function isDmarcReport(email: any): boolean {
  console.log('开始判断邮件类型...')

  const subject = (email.subject || '').toLowerCase()
  const hasAttachment = email.attachments && email.attachments.length > 0

  console.log('- 邮件主题:', subject)
  console.log('- 是否有附件:', hasAttachment)

  if (!hasAttachment) {
    console.log('- 无附件，判断为普通邮件')
    return false
  }

  const dmarcKeywords = ['dmarc', 'report domain', 'aggregate report']
  const hasDmarcKeyword = dmarcKeywords.some(keyword => subject.includes(keyword))

  console.log('- 是否包含DMARC关键词:', hasDmarcKeyword)

  // 检查附件格式
  if (hasDmarcKeyword) {
    const attachment = email.attachments[0]
    const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''
    console.log('- 附件类型:', attachment.mimeType)
    console.log('- 附件扩展名:', extension)

    const supportedExtensions = ['gz', 'zip', 'xml']
    const isSupported = supportedExtensions.includes(extension)
    console.log('- 是否支持的格式:', isSupported)

    return isSupported
  }

  return false
}

// 处理DMARC报告
async function processDmarcReport(email: any, env: Env): Promise<void> {
  console.log('🔄 开始处理DMARC报告...')

  const attachment = email.attachments[0]
  console.log('附件信息:')
  console.log('- 文件名:', attachment.filename)
  console.log('- MIME类型:', attachment.mimeType)
  console.log('- 内容大小:', attachment.content?.length || 0, '字符')

  try {
    // 解析DMARC数据
    console.log('🔄 开始解析DMARC XML...')
    const reportJSON = await getDMARCReportXML(attachment)
    console.log('✅ DMARC XML解析成功')

    const report = getReportRows(reportJSON)
    console.log('✅ DMARC数据结构化完成，记录数:', report.length)

    // 准备保存数据
    const emailData = {
      type: 'dmarc',
      from: email.from?.text || '',
      to: email.to?.map((addr: any) => addr.text).join(', ') || '',
      subject: email.subject || '',
      date: email.date || new Date(),

      // DMARC特有数据
      reportId: reportJSON.feedback.report_metadata.report_id,
      orgName: reportJSON.feedback.report_metadata.org_name,
      domain: reportJSON.feedback.policy_published.domain,
      dateRange: {
        begin: new Date(parseInt(reportJSON.feedback.report_metadata.date_range.begin) * 1000),
        end: new Date(parseInt(reportJSON.feedback.report_metadata.date_range.end) * 1000)
      },
      records: report,
      rawXml: JSON.stringify(reportJSON),

      // 附件信息
      attachmentName: attachment.filename,
      attachmentContent: attachment.content,
      attachmentMimeType: attachment.mimeType
    }

    console.log('DMARC报告数据准备完成:')
    console.log('- 报告ID:', emailData.reportId)
    console.log('- 组织名:', emailData.orgName)
    console.log('- 域名:', emailData.domain)
    console.log('- 记录数量:', emailData.records.length)

    // 保存到UniCloud
    await saveToUniCloud(emailData, env)

    // 可选：仍然发送到Analytics Engine做备份分析
    if (env.DMARC_ANALYTICS) {
      console.log('🔄 发送到Analytics Engine...')
      await sendToAnalyticsEngine(env, report)
      console.log('✅ Analytics Engine保存完成')
    } else {
      console.log('ℹ️ 未配置Analytics Engine，跳过')
    }
  } catch (error) {
    console.error('❌ DMARC报告处理失败:', error)
    throw error
  }
}

// 处理普通邮件
async function processRegularEmail(email: any, env: Env): Promise<void> {
  console.log('🔄 开始处理普通邮件...')

  const emailData = {
    type: 'regular',
    from: email.from?.text || '',
    to: email.to?.map((addr: any) => addr.text).join(', ') || '',
    cc: email.cc?.map((addr: any) => addr.text).join(', ') || '',
    bcc: email.bcc?.map((addr: any) => addr.text).join(', ') || '',
    subject: email.subject || '',
    text: email.text || '',
    html: email.html || '',
    date: email.date || new Date(),
    messageId: email.messageId || '',

    // 附件信息
    attachments: email.attachments?.map((att: any) => ({
      filename: att.filename,
      mimeType: att.mimeType,
      content: att.content,
      size: att.content ? att.content.length : 0
    })) || []
  }

  console.log('普通邮件数据准备完成:')
  console.log('- 文本长度:', emailData.text?.length || 0, '字符')
  console.log('- HTML长度:', emailData.html?.length || 0, '字符')
  console.log('- 附件数量:', emailData.attachments.length)

  await saveToUniCloud(emailData, env)
}

// 保存基本邮件信息（处理失败时的备用方案）
async function saveBasicEmail(email: any, env: Env, errorMessage: string): Promise<void> {
  console.log('🔄 保存基本邮件信息（错误恢复）...')

  const emailData = {
    type: 'error',
    from: email.from?.text || '',
    to: email.to?.map((addr: any) => addr.text).join(', ') || '',
    subject: email.subject || '',
    date: email.date || new Date(),
    errorMessage: errorMessage,
    rawEmail: JSON.stringify(email)
  }

  console.log('错误邮件数据:')
  console.log('- 错误信息:', errorMessage)
  console.log('- 原始数据大小:', emailData.rawEmail.length, '字符')

  await saveToUniCloud(emailData, env)
}

// 保存到UniCloud
async function saveToUniCloud(emailData: any, env: Env): Promise<void> {
  console.log('🔄 开始调用UniCloud函数...')

  // 从环境变量获取UniCloud函数URL
  const unicloudUrl = env.UNICLOUD_URL || 'https://env-00jxt0xsffn5.dev-hz.cloudbasefunction.cn/POST_cloudflare_edukg_email'
  console.log('UniCloud URL:', unicloudUrl)

  const payload = {
    action: 'saveEmail',
    data: emailData
  }

  console.log('请求参数:')
  console.log('- Action:', payload.action)
  console.log('- 数据类型:', emailData.type)
  console.log('- 发件人:', emailData.from)
  console.log('- 收件人:', emailData.to)
  console.log('- 主题:', emailData.subject)

  // 将数据转换为Base64编码（如果包含二进制数据）
  const jsonString = JSON.stringify(payload)
  const needsBase64 = containsBinaryData(emailData)

  console.log('数据编码信息:')
  console.log('- JSON大小:', jsonString.length, '字符')
  console.log('- 需要Base64编码:', needsBase64)

  const requestBody = needsBase64 ? btoa(jsonString) : jsonString
  console.log('- 最终请求体大小:', requestBody.length, '字符')

  try {
    console.log('🔄 发送HTTP请求到UniCloud...')
    const startTime = Date.now()

    const response = await fetch(unicloudUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Is-Base64': needsBase64 ? 'true' : 'false'
      },
      body: requestBody
    })

    const endTime = Date.now()
    console.log('HTTP请求完成，耗时:', endTime - startTime, 'ms')
    console.log('响应状态:', response.status, response.statusText)
    console.log('响应头:', JSON.stringify([...response.headers.entries()]))

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ HTTP请求失败:')
      console.error('- 状态码:', response.status)
      console.error('- 状态文本:', response.statusText)
      console.error('- 响应内容:', errorText)
      throw new Error(`UniCloud保存失败: ${response.status} ${response.statusText}`)
    }

    const responseText = await response.text()
    console.log('响应内容:', responseText)

    let result
    try {
      result = JSON.parse(responseText)
    } catch (parseError) {
      console.error('❌ 响应JSON解析失败:', parseError)
      console.error('原始响应:', responseText)
      throw new Error('UniCloud响应格式错误')
    }

    console.log('UniCloud响应解析结果:', JSON.stringify(result, null, 2))

    if (!result.success) {
      console.error('❌ UniCloud返回业务错误:', result.error)
      throw new Error(`UniCloud返回错误: ${result.error}`)
    }

    console.log('✅ UniCloud保存成功:', result.message)
    if (result.emailId) {
      console.log('✅ 邮件ID:', result.emailId)
    }

  } catch (fetchError) {
    console.error('❌ 网络请求异常:', fetchError)
    console.error('错误类型:', fetchError.constructor.name)
    console.error('错误消息:', (fetchError as Error).message)
    throw fetchError
  }
}

// 检查是否包含二进制数据
function containsBinaryData(emailData: any): boolean {
  const hasBinary = !!(emailData.attachmentContent ||
    (emailData.attachments && emailData.attachments.length > 0) ||
    emailData.rawXml)

  console.log('二进制数据检查:')
  console.log('- 有附件内容:', !!emailData.attachmentContent)
  console.log('- 有附件列表:', !!(emailData.attachments && emailData.attachments.length > 0))
  console.log('- 有XML数据:', !!emailData.rawXml)
  console.log('- 最终结果:', hasBinary)

  return hasBinary
}

async function getDMARCReportXML(attachment: Attachment) {
  console.log('🔄 开始解析DMARC附件...')

  let xml: any
  const xmlParser = new XMLParser()
  const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''

  console.log('附件解析信息:')
  console.log('- MIME类型:', attachment.mimeType)
  console.log('- 推断扩展名:', extension)

  try {
    switch (extension) {
      case 'gz':
        console.log('🔄 解压gzip格式...')
        xml = pako.inflate(new TextEncoder().encode(attachment.content as string), { to: 'string' })
        console.log('✅ gzip解压完成，XML长度:', xml.length)
        break

      case 'zip':
        console.log('🔄 解压zip格式...')
        xml = await getXMLFromZip(attachment.content)
        console.log('✅ zip解压完成，XML长度:', xml.length)
        break

      case 'xml':
        console.log('🔄 处理XML格式...')
        xml = await new Response(attachment.content).text()
        console.log('✅ XML读取完成，长度:', xml.length)
        break

      default:
        console.error('❌ 不支持的附件格式:', extension)
        throw new Error(`unknown extension: ${extension}`)
    }

    console.log('🔄 开始解析XML结构...')
    const result = await xmlParser.parse(xml)
    console.log('✅ XML解析完成')

    return result
  } catch (error) {
    console.error('❌ DMARC附件解析失败:', error)
    throw error
  }
}

async function getXMLFromZip(content: string | ArrayBuffer | Blob | unzipit.TypedArray | unzipit.Reader) {
  const { entries } = await unzipit.unzipRaw(content)
  console.log('ZIP文件条目数:', entries.length)

  if (entries.length === 0) {
    throw new Error('no entries in zip')
  }

  console.log('读取第一个条目:', entries[0].name)
  return await entries[0].text()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReportRows(report: any): DmarcRecordRow[] {
  console.log('🔄 开始结构化DMARC数据...')

  const reportMetadata = report.feedback.report_metadata
  const policyPublished = report.feedback.policy_published
  const records = Array.isArray(report.feedback.record) ? report.feedback.record : [report.feedback.record]

  console.log('DMARC报告结构:')
  console.log('- 报告ID:', reportMetadata?.report_id)
  console.log('- 组织名:', reportMetadata?.org_name)
  console.log('- 域名:', policyPublished?.domain)
  console.log('- 记录数量:', records?.length || 0)

  if (!report.feedback || !reportMetadata || !policyPublished || !records) {
    console.error('❌ DMARC报告结构无效')
    throw new Error('invalid xml')
  }

  const listEvents: DmarcRecordRow[] = []

  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    console.log(`处理记录 ${index + 1}/${records.length}:`, record.row?.source_ip)

    const reportRow: DmarcRecordRow = {
      reportMetadataReportId: reportMetadata.report_id.toString().replace('-', '_'),
      reportMetadataOrgName: reportMetadata.org_name || '',
      reportMetadataDateRangeBegin: parseInt(reportMetadata.date_range.begin) || 0,
      reportMetadataDateRangeEnd: parseInt(reportMetadata.date_range.end) || 0,
      reportMetadataError: JSON.stringify(reportMetadata.error) || '',

      policyPublishedDomain: policyPublished.domain || '',
      policyPublishedADKIM: AlignmentType[policyPublished.adkim as keyof typeof AlignmentType],
      policyPublishedASPF: AlignmentType[policyPublished.aspf as keyof typeof AlignmentType],
      policyPublishedP: DispositionType[policyPublished.p as keyof typeof DispositionType],
      policyPublishedSP: DispositionType[policyPublished.sp as keyof typeof DispositionType],
      policyPublishedPct: parseInt(policyPublished.pct) || 0,

      recordRowSourceIP: record.row.source_ip || '',

      recordRowCount: parseInt(record.row.count) || 0,
      recordRowPolicyEvaluatedDKIM: DMARCResultType[record.row.policy_evaluated.dkim as keyof typeof DMARCResultType],
      recordRowPolicyEvaluatedSPF: DMARCResultType[record.row.policy_evaluated.spf as keyof typeof DMARCResultType],
      recordRowPolicyEvaluatedDisposition:
        DispositionType[record.row.policy_evaluated.disposition as keyof typeof DispositionType],

      recordRowPolicyEvaluatedReasonType:
        PolicyOverrideType[record.row.policy_evaluated?.reason?.type as keyof typeof PolicyOverrideType],
      recordIdentifiersEnvelopeTo: record.identifiers.envelope_to || '',
      recordIdentifiersHeaderFrom: record.identifiers.header_from || '',
    }

    listEvents.push(reportRow)
  }

  console.log('✅ DMARC数据结构化完成，总记录数:', listEvents.length)
  return listEvents
}

async function sendToAnalyticsEngine(env: Env, reportRows: DmarcRecordRow[]) {
  if (!env.DMARC_ANALYTICS) {
    return
  }

  console.log('🔄 发送到Analytics Engine，记录数:', reportRows.length)

  reportRows.forEach((recordRow, index) => {
    const blobs: string[] = []
    const doubles: number[] = []
    const indexes: string[] = []

    indexes.push(encodeURI(`${recordRow.reportMetadataReportId}-${index}`).slice(0, 32)) // max size 32 bytes

    blobs.push(recordRow.reportMetadataReportId)
    blobs.push(recordRow.reportMetadataOrgName)
    doubles.push(recordRow.reportMetadataDateRangeBegin)
    doubles.push(recordRow.reportMetadataDateRangeEnd)
    blobs.push(recordRow.reportMetadataError)

    blobs.push(recordRow.policyPublishedDomain)
    doubles.push(recordRow.policyPublishedADKIM)
    doubles.push(recordRow.policyPublishedASPF)
    doubles.push(recordRow.policyPublishedP)
    doubles.push(recordRow.policyPublishedSP)
    doubles.push(recordRow.policyPublishedPct)

    blobs.push(recordRow.recordRowSourceIP)
    doubles.push(recordRow.recordRowCount)
    doubles.push(recordRow.recordRowPolicyEvaluatedDKIM)
    doubles.push(recordRow.recordRowPolicyEvaluatedSPF)
    doubles.push(recordRow.recordRowPolicyEvaluatedDisposition)
    doubles.push(recordRow.recordRowPolicyEvaluatedReasonType)
    blobs.push(recordRow.recordIdentifiersEnvelopeTo)
    blobs.push(recordRow.recordIdentifiersHeaderFrom)

    env.DMARC_ANALYTICS.writeDataPoint({
      blobs: blobs,
      doubles: doubles,
      indexes: indexes,
    })
  })

  console.log('✅ Analytics Engine数据写入完成')
}
// 记录邮
件删除事件
async function saveDeletedEmailRecord(env: Env, reason: string, type: string): Promise<void> {
  console.log('🔄 记录邮件删除事件...')
  console.log('删除原因:', reason)
  console.log('删除类型:', type)

  try {
    const deletedEmailData = {
      type: 'deleted',
      from: '未知',
      to: '未知',
      subject: '邮件已删除',
      date: new Date(),
      errorMessage: reason,
      deleteType: type,
      deletedAt: new Date(),
      rawEmail: `邮件删除记录 - ${reason}`
    }

    await saveToUniCloud(deletedEmailData, env)
    console.log('✅ 邮件删除事件记录成功')
  } catch (error) {
    console.error('❌ 记录邮件删除事件失败:', error)
  }
}