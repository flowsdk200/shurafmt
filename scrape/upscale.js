import axios from 'axios'
import crypto from 'crypto'
import FormData from 'form-data'

const UPSCALE_CONFIG = {
    platform: 'upscale.media',
    apiBaseUrl: 'https://api.pixelbin.io/service/public/transformation',
    apiSignBasePath: '/service/public/transformation',
    predictionPath: '/v1.0/predictions/sr/upscale',
    predictionSignatureKey: 'A4nzUYcDOZ'
}

const DEFAULT_HEADERS = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeUrl(value) {
    const input = String(value || '').trim()
    if (!/^https?:\/\//i.test(input)) {
        throw new Error('Upscale.media anon flow hanya menerima URL gambar publik.')
    }

    const url = new URL(input)
    if (!/^https?:$/.test(url.protocol)) {
        throw new Error('URL gambar tidak valid.')
    }

    return url.toString()
}

function normalizeBuffer(value) {
    if (Buffer.isBuffer(value)) return value
    if (value instanceof Uint8Array) return Buffer.from(value)
    if (value instanceof ArrayBuffer) return Buffer.from(value)
    return null
}

function makeClientId() {
    return `um-${crypto.randomUUID()}`
}

function makeIsoTimestamp() {
    return new Date().toISOString()
}

function encodeParam(value) {
    return Buffer.from(value).toString('base64')
}

function signUpscalePrediction({ path, method = 'POST', isoTimestamp, clientId }) {
    const payload = `${String(method || 'POST').toUpperCase()}${encodeURI(path)}${isoTimestamp}${clientId}`
    return crypto
        .createHmac('sha256', UPSCALE_CONFIG.predictionSignatureKey)
        .update(payload)
        .digest('hex')
}

function buildPredictionHeaders({ path, clientId, isoTimestamp }) {
    return {
        ...DEFAULT_HEADERS,
        'pixb-cl-id': clientId,
        'x-ebg-param': encodeParam(isoTimestamp),
        'x-ebg-signature': signUpscalePrediction({ path, isoTimestamp, clientId })
    }
}

function getSignedPath(path) {
    return `${UPSCALE_CONFIG.apiSignBasePath}${path}`
}

function normalizeUpscaleType(value) {
    if (!value) return null
    const input = String(value).trim().toUpperCase()
    const map = {
        '1': '1X',
        '1X': '1X',
        '2': '2X',
        '2X': '2X',
        '4': '4X',
        '4X': '4X',
        '8': '8X',
        '8X': '8X'
    }

    const type = map[input]
    if (!type) {
        throw new Error('Type upscale tidak valid. Gunakan 1X, 2X, 4X, atau 8X.')
    }

    return type
}

function extractPredictionId(payload) {
    const directId = payload?._id || payload?.predictionId || payload?.id
    if (directId) return directId

    const getUrl = payload?.urls?.get
    if (!getUrl) return ''

    try {
        const pathname = new URL(getUrl).pathname
        return pathname.split('/').filter(Boolean).pop() || ''
    } catch {
        return ''
    }
}

function pickOutputUrl(payload) {
    const output = payload?.output
    if (Array.isArray(output) && output[0]) return output[0]
    if (typeof output === 'string' && output) return output
    if (payload?.result?.url) return payload.result.url
    if (payload?.url) return payload.url
    return ''
}

function makeAxiosErrorMessage(error) {
    const data = error?.response?.data
    if (data?.message && data?.code) {
        return `${data.message} (${data.code})`
    }
    if (data?.message) return data.message
    if (typeof data === 'string' && data.trim()) return data.trim()
    return error.message || 'Request upscale gagal.'
}

async function uploadBufferToCatbox(buffer, options = {}) {
    const fileBuffer = normalizeBuffer(buffer)
    if (!fileBuffer?.length) {
        throw new Error('Buffer gambar tidak valid.')
    }

    const form = new FormData()
    form.append('reqtype', 'fileupload')
    form.append('fileToUpload', fileBuffer, {
        filename: String(options.filename || 'upscale-input.jpg'),
        contentType: options.contentType || 'image/jpeg'
    })

    try {
        const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: Number(options.uploadTimeout || 120000),
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        })

        const url = String(data || '').trim()
        if (!/^https?:\/\//i.test(url)) {
            throw new Error(url || 'Upload Catbox gagal.')
        }

        return url
    } catch (error) {
        throw new Error(makeAxiosErrorMessage(error))
    }
}

function applyPredictionOptions(form, options = {}) {
    const type = normalizeUpscaleType(options.type || options.scale)
    if (type) {
        form.append('input.type', type)
    }

    if (options.targetSize) {
        form.append('input.target_size', String(options.targetSize))
    }

    if (typeof options.retention === 'string' && options.retention.trim()) {
        form.append('retention', options.retention.trim())
        return
    }

    form.append('retention', '1d')
}

function getPredictionPath(predictionId) {
    const id = String(predictionId || '').trim()
    if (!id) throw new Error('Prediction ID tidak valid.')
    return `/v1.0/predictions/${id}`
}

function getUpscaleRuntimeConfig() {
    return { ...UPSCALE_CONFIG }
}

async function resolveUpscaleInput(input, options = {}) {
    if (typeof input === 'string') {
        return normalizeUrl(input)
    }

    const buffer = normalizeBuffer(input)
    if (buffer) {
        return uploadBufferToCatbox(buffer, options)
    }

    throw new Error('Input upscale harus berupa URL publik atau Buffer gambar.')
}

async function startUpscaleFromUrl(imageUrl, options = {}) {
    const url = await resolveUpscaleInput(imageUrl, options)
    const clientId = String(options.clientId || '').trim() || makeClientId()
    const isoTimestamp = String(options.isoTimestamp || '').trim() || makeIsoTimestamp()
    const predictionPath = UPSCALE_CONFIG.predictionPath
    const form = new FormData()

    form.append('input.fileType', 'image')
    form.append('input.image', url)
    applyPredictionOptions(form, options)

    try {
        const res = await axios.post(`${UPSCALE_CONFIG.apiBaseUrl}${predictionPath}`, form, {
            headers: {
                ...form.getHeaders(),
                ...buildPredictionHeaders({ path: getSignedPath(predictionPath), clientId, isoTimestamp })
            },
            timeout: Number(options.timeout || 120000)
        })

        const data = res?.data || {}
        return {
            clientId,
            isoTimestamp,
            predictionId: extractPredictionId(data),
            status: data?.status || '',
            url: data?.urls?.get || '',
            raw: data
        }
    } catch (error) {
        throw new Error(makeAxiosErrorMessage(error))
    }
}

async function getUpscalePrediction(predictionId, options = {}) {
    const predictionPath = getPredictionPath(predictionId)

    try {
        const res = await axios.get(`${UPSCALE_CONFIG.apiBaseUrl}${predictionPath}`, {
            headers: DEFAULT_HEADERS,
            timeout: Number(options.timeout || 60000)
        })

        const data = res?.data || {}
        return {
            predictionId: extractPredictionId(data) || String(predictionId),
            status: data?.status || '',
            output: pickOutputUrl(data),
            raw: data
        }
    } catch (error) {
        throw new Error(makeAxiosErrorMessage(error))
    }
}

async function waitUpscalePrediction(predictionId, options = {}) {
    const maxPoll = Number(options.maxPoll || 40)
    const intervalMs = Number(options.intervalMs || 2000)

    for (let i = 0; i < maxPoll; i += 1) {
        const current = await getUpscalePrediction(predictionId, options)

        if (current.status === 'SUCCESS') {
            if (!current.output) {
                throw new Error('URL hasil upscale tidak ditemukan.')
            }

            return current
        }

        if (['FAILED', 'FAILURE', 'ERROR', 'CANCELLED'].includes(current.status)) {
            throw new Error(`Upscale gagal dengan status ${current.status}.`)
        }

        await sleep(intervalMs)
    }

    throw new Error('Timeout menunggu hasil upscale.')
}

async function upscaleFromUrl(imageUrl, options = {}) {
    const started = await startUpscaleFromUrl(imageUrl, options)
    if (!started.predictionId) {
        throw new Error('Prediction ID tidak ditemukan.')
    }

    const finished = await waitUpscalePrediction(started.predictionId, options)
    return {
        provider: 'Upscale.media',
        imageUrl: normalizeUrl(imageUrl),
        predictionId: started.predictionId,
        status: finished.status,
        url: finished.output,
        start: started.raw,
        raw: finished.raw
    }
}

async function startUpscale(input, options = {}) {
    return startUpscaleFromUrl(input, options)
}

async function upscale(input, options = {}) {
    return upscaleFromUrl(input, options)
}

export {
    buildPredictionHeaders,
    getUpscalePrediction,
    getUpscaleRuntimeConfig,
    resolveUpscaleInput,
    signUpscalePrediction,
    startUpscale,
    startUpscaleFromUrl,
    uploadBufferToCatbox,
    upscale,
    upscaleFromUrl,
    waitUpscalePrediction
}
