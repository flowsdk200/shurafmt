import crypto from 'node:crypto'
import config from '../config.js'

const key = 'd4ab6d.tar.gz'
const r2 = config.r2
const endpoint = String(r2.endpoint).trim().replace(/\/+$/, '')
const bucket = String(r2.bucket).trim()
const query = `list-type=2&max-keys=5&prefix=${encodeURIComponent(key)}`
const url = `${endpoint}/${bucket}?${query}`

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key, data, encoding) => crypto.createHmac('sha256', key).update(data).digest(encoding)

const now = new Date()
const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
const dateStamp = amzDate.slice(0, 8)
const host = new URL(url).host
const payloadHash = sha256Hex('')

const canonicalHeaders =
  `host:${host}\n` +
  `x-amz-content-sha256:${payloadHash}\n` +
  `x-amz-date:${amzDate}\n`
const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
const canonicalRequest =
  `GET\n/${bucket}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

const credentialScope = `${dateStamp}/auto/s3/aws4_request`
const stringToSign =
  `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`

const kDate = hmac(`AWS4${r2.secretAccessKey}`, dateStamp)
const kRegion = hmac(kDate, 'auto')
const kService = hmac(kRegion, 's3')
const kSigning = hmac(kService, 'aws4_request')
const signature = hmac(kSigning, stringToSign, 'hex')

const authorization =
  `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${credentialScope}, ` +
  `SignedHeaders=${signedHeaders}, Signature=${signature}`

const res = await fetch(url, {
  method: 'GET',
  headers: {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: authorization
  }
})

const text = await res.text()
const exists = text.includes(`<Key>${key}</Key>`)
console.log(JSON.stringify({ status: res.status, exists }))
