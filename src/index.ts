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
    await handleEmail(message, env, ctx)
  },
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEmail(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const parser = new PostalMime.default()

  // parse email content
  const rawEmail = new Response(message.raw)
  const email = await parser.parse(await rawEmail.arrayBuffer())

  try {
    // 判断邮件类型并处理
    if (isDmarcReport(email)) {
      console.log('处理DMARC报告邮件')
      await processDmarcReport(email, env)
    } else {
      console.log('处理普通邮件')
      await processRegularEmail(email, env)
    }
  } catch (error) {
    console.error('邮件处理失败:', error)
    // 即使处理失败也保存基本邮件信息
    await saveBasicEmail(email, env, (error as Error).message)
  }
}

// 判断是否为DMARC报告
function isDmarcReport(email: any): boolean {
  const subject = (email.subject || '').toLowerCase()
  const hasAttachment = email.attachments && email.attachments.length > 0
  
  if (!hasAttachment) return false
  
  const dmarcKeywords = ['dmarc', 'report domain', 'aggregate report']
  const hasDmarcKeyword = dmarcKeywords.some(keyword => subject.includes(keyword))
  
  // 检查附件格式
  if (hasDmarcKeyword) {
    const attachment = email.attachments[0]
    const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''
    return ['gz', 'zip', 'xml'].includes(extension)
  }
  
  return false
}

// 处理DMARC报告
async function processDmarcReport(email: any, env: Env): Promise<void> {
  const attachment = email.attachments[0]

  // 解析DMARC数据
  const reportJSON = await getDMARCReportXML(attachment)
  const report = getReportRows(reportJSON)

  // 保存到UniCloud
  await saveToUniCloud({
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
  }, env)

  // 可选：仍然发送到Analytics Engine做备份分析
  if (env.DMARC_ANALYTICS) {
    await sendToAnalyticsEngine(env, report)
  }
}

// 处理普通邮件
async function processRegularEmail(email: any, env: Env): Promise<void> {
  await saveToUniCloud({
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
  }, env)
}

// 保存基本邮件信息（处理失败时的备用方案）
async function saveBasicEmail(email: any, env: Env, errorMessage: string): Promise<void> {
  try {
    await saveToUniCloud({
      type: 'error',
      from: email.from?.text || '',
      to: email.to?.map((addr: any) => addr.text).join(', ') || '',
      subject: email.subject || '',
      date: email.date || new Date(),
      errorMessage: errorMessage,
      rawEmail: JSON.stringify(email)
    }, env)
  } catch (saveError) {
    console.error('保存基本邮件信息也失败了:', saveError)
  }
}

// 保存到UniCloud
async function saveToUniCloud(emailData: any, env: Env): Promise<void> {
  // 从环境变量获取UniCloud函数URL
  const unicloudUrl = env.UNICLOUD_URL || 'https://env-00jxt0xsffn5.dev-hz.cloudbasefunction.cn/POST_cloudflare_edukg_email'
  
  const payload = {
    action: 'saveEmail',
    data: emailData
  }
  
  // 将数据转换为Base64编码（如果包含二进制数据）
  const jsonString = JSON.stringify(payload)
  const needsBase64 = containsBinaryData(emailData)
  
  const requestBody = needsBase64 ? btoa(jsonString) : jsonString
  
  const response = await fetch(unicloudUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Is-Base64': needsBase64 ? 'true' : 'false'
    },
    body: requestBody
  })
  
  if (!response.ok) {
    throw new Error(`UniCloud保存失败: ${response.status} ${response.statusText}`)
  }
  
  const result = await response.json()
  if (!result.success) {
    throw new Error(`UniCloud返回错误: ${result.error}`)
  }
  
  console.log('邮件保存成功:', result.message)
}

// 检查是否包含二进制数据
function containsBinaryData(emailData: any): boolean {
  // 检查是否有附件内容或其他二进制数据
  return !!(emailData.attachmentContent || 
           (emailData.attachments && emailData.attachments.length > 0) ||
           emailData.rawXml)
}

async function getDMARCReportXML(attachment: Attachment) {
  let xml
  const xmlParser = new XMLParser()
  const extension = mimeDb[attachment.mimeType]?.extensions?.[0] || ''

  switch (extension) {
    case 'gz':
      xml = pako.inflate(new TextEncoder().encode(attachment.content as string), { to: 'string' })
      break

    case 'zip':
      xml = await getXMLFromZip(attachment.content)
      break

    case 'xml':
      xml = await new Response(attachment.content).text()
      break

    default:
      throw new Error(`unknown extension: ${extension}`)
  }

  return await xmlParser.parse(xml)
}

async function getXMLFromZip(content: string | ArrayBuffer | Blob | unzipit.TypedArray | unzipit.Reader) {
  const { entries } = await unzipit.unzipRaw(content)
  if (entries.length === 0) {
    return new Error('no entries in zip')
  }

  return await entries[0].text()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getReportRows(report: any): DmarcRecordRow[] {
  const reportMetadata = report.feedback.report_metadata
  const policyPublished = report.feedback.policy_published
  const records = Array.isArray(report.feedback.record) ? report.feedback.record : [report.feedback.record]

  if (!report.feedback || !reportMetadata || !policyPublished || !records) {
    throw new Error('invalid xml')
  }

  const listEvents: DmarcRecordRow[] = []

  for (let index = 0; index < records.length; index++) {
    const record = records[index]

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

  return listEvents
}

async function sendToAnalyticsEngine(env: Env, reportRows: DmarcRecordRow[]) {
  if (!env.DMARC_ANALYTICS) {
    return
  }

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
}