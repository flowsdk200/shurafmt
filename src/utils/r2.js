import crypto from 'crypto'
import path from 'path'
import mime from 'mime-types'
import { fileTypeFromBuffer } from 'file-type'
import config from '../../config.js'

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key, data, encoding) => crypto.createHmac('sha256', key).update(data).digest(encoding)
const randomId = (len = 6) => crypto.randomBytes(Math.max(4, len)).toString('hex').slice(0, len)
const encodePath = (value) => value.split('/').map((segment) => encodeURIComponent(segment)).join('/')

const getR2Config = () => {
    const base = config.r2 && typeof config.r2 === 'object' ? config.r2 : {}
    const runtime = global.r2 && typeof global.r2 === 'object' ? global.r2 : {}
    const merged = { ...base, ...runtime }

    return {
        endpoint: String(merged.endpoint || '').trim().replace(/\/+$/, ''),
        accessKeyId: String(merged.accessKeyId || '').trim(),
        secretAccessKey: String(merged.secretAccessKey || '').trim(),
        bucket: String(merged.bucket || '').trim(),
        publicBaseUrl: String(merged.publicBaseUrl || '').trim().replace(/\/+$/, ''),
        prefix: String(merged.prefix || '').trim().replace(/^\/+|\/+$/g, ''),
        idLength: Number.parseInt(merged.idLength, 10) || 6
    }
}

const ensureR2Config = () => {
    const r2 = getR2Config()
    if (!r2.endpoint || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
        throw new Error('Konfigurasi R2 belum lengkap.')
    }
    return r2
}

const signRequest = ({ method, url, body, accessKeyId, secretAccessKey }) => {
    const parsed = new URL(url)
    const host = parsed.host
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = sha256Hex(body || '')
    const canonicalUri = parsed.pathname
    const canonicalHeaders =
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest =
        `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`
    const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
    const kRegion = hmac(kDate, 'auto')
    const kService = hmac(kRegion, 's3')
    const kSigning = hmac(kService, 'aws4_request')
    const signature = hmac(kSigning, stringToSign, 'hex')
    const authorization =
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`

    return {
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorization
    }
}

const buildObjectKey = async (buffer, filename = 'file.bin') => {
    const r2 = ensureR2Config()
    const detected = await fileTypeFromBuffer(buffer).catch(() => null)
    const ext = detected?.ext || path.extname(filename).replace(/^\./, '') || mime.extension(mime.lookup(filename) || '') || 'bin'
    const objectName = `${randomId(r2.idLength)}.${ext}`
    return r2.prefix ? `${r2.prefix}/${objectName}` : objectName
}

export const uploadToR2 = async (buffer, { filename = 'file.bin', contentType = '' } = {}) => {
    const r2 = ensureR2Config()
    const objectKey = await buildObjectKey(buffer, filename)
    const url = `${r2.endpoint}/${r2.bucket}/${encodePath(objectKey)}`
    const mimetype = contentType || mime.lookup(filename) || 'application/octet-stream'
    const signedHeaders = signRequest({
        method: 'PUT',
        url,
        body: buffer,
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey
    })

    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            ...signedHeaders,
            'content-type': mimetype,
            'content-length': String(buffer.length)
        },
        body: buffer
    })

    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Upload R2 gagal (${res.status}): ${text || res.statusText}`)
    }

    const publicUrl = r2.publicBaseUrl
        ? `${r2.publicBaseUrl}/${objectKey}`
        : url

    return {
        key: objectKey,
        url: publicUrl,
        size: buffer.length,
        mimetype
    }
}

export const deleteFromR2 = async (objectKey) => {
    const r2 = ensureR2Config()
    const key = String(objectKey || '').trim().replace(/^\/+/, '')
    if (!key) return false
    const url = `${r2.endpoint}/${r2.bucket}/${encodePath(key)}`
    const signedHeaders = signRequest({
        method: 'DELETE',
        url,
        body: '',
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey
    })

    const res = await fetch(url, {
        method: 'DELETE',
        headers: signedHeaders
    })

    if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => '')
        throw new Error(`Delete R2 gagal (${res.status}): ${text || res.statusText}`)
    }

    return true
}
