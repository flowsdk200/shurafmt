import crypto from 'crypto'
import config from './config.js'

const r2 = config.r2 || {}
const endpoint = String(r2.endpoint || '').trim().replace(/\/+$/, '')
const bucket = String(r2.bucket || '').trim()
const accessKeyId = String(r2.accessKeyId || '').trim()
const secretAccessKey = String(r2.secretAccessKey || '').trim()

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error('R2 config incomplete')
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key, data, encoding) => crypto.createHmac('sha256', key).update(data).digest(encoding)
const encodeQuery = (value) =>
  encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const decodeXml = (value) =>
  String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const signRequest = ({ method, canonicalUri, canonicalQueryString, payloadHash }) => {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(endpoint).host

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest =
    `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, 'auto')
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = hmac(kSigning, stringToSign, 'hex')

  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}

const listAllKeys = async () => {
  const keys = []
  let token = ''

  while (true) {
    const params = token
      ? [
          ['continuation-token', token],
          ['list-type', '2']
        ]
      : [['list-type', '2']]

    params.sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])))
    const canonicalQueryString = params.map(([k, v]) => `${encodeQuery(k)}=${encodeQuery(v)}`).join('&')
    const canonicalUri = `/${bucket}`
    const payloadHash = sha256Hex('')
    const headers = signRequest({ method: 'GET', canonicalUri, canonicalQueryString, payloadHash })
    const url = `${endpoint}${canonicalUri}?${canonicalQueryString}`

    const res = await fetch(url, { method: 'GET', headers })
    const xml = await res.text()
    if (!res.ok) throw new Error(`List failed ${res.status}: ${xml.slice(0, 300)}`)

    const matches = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)]
    for (const m of matches) {
      const key = decodeXml(m[1] || '')
      if (key) keys.push(key)
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    const nextRaw = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || ''
    if (!truncated || !nextRaw) break
    token = decodeXml(nextRaw)
  }

  return keys
}

const deleteObject = async (key) => {
  const encodedKey = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const canonicalUri = `/${bucket}/${encodedKey}`
  const payloadHash = sha256Hex('')
  const headers = signRequest({ method: 'DELETE', canonicalUri, canonicalQueryString: '', payloadHash })
  const url = `${endpoint}${canonicalUri}`
  const res = await fetch(url, { method: 'DELETE', headers })

  if (res.ok || res.status === 404) return { ok: true, status: res.status }
  const body = await res.text().catch(() => '')
  return { ok: false, status: res.status, error: body.slice(0, 240) }
}

const run = async () => {
  const keys = await listAllKeys()
  let deleted = 0
  const failed = []

  for (const key of keys) {
    const result = await deleteObject(key)
    if (result.ok) deleted += 1
    else failed.push({ key, ...result })
  }

  console.log(`total=${keys.length}`)
  console.log(`deleted=${deleted}`)
  console.log(`failed=${failed.length}`)
  if (failed.length) console.log(JSON.stringify(failed.slice(0, 10), null, 2))
}

await run()
