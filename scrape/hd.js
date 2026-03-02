import axios from 'axios'
import crypto from 'crypto'

const BASE_URL = 'https://aiapi.thinkyeah.com'
const HEADERS = {
    Host: 'aiapi.thinkyeah.com',
    accept: 'application/json',
    'content-type': 'application/json; charset=utf-8',
    'accept-encoding': 'gzip',
    'user-agent': 'okhttp/4.11.0'
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeIdentity() {
    return {
        adid: crypto.randomUUID(),
        dcid: crypto.randomUUID(),
        is_pro_user: 'false',
        region: 'ID',
        language: 'in',
        app_version_code: '2310',
        package_name: 'photoeditor.photocut.background.eraser.collagemaker.cutout',
        purchase_token: '',
        firebase_user_id: crypto.randomBytes(16).toString('hex'),
        is_internal_user: 'false'
    }
}

async function toBase64(image) {
    if (Buffer.isBuffer(image)) return image.toString('base64')
    const url = String(image || '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('URL gambar tidak valid.')
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000
    })
    return Buffer.from(res.data).toString('base64')
}

async function injectTask(base64Data, identity, upscale = 2) {
    const payload = {
        upscale: String(upscale),
        'is_upscale ': 'true',
        model: 'default',
        imagedata: base64Data
    }

    const res = await axios.post(`${BASE_URL}/api/enhance/async`, payload, {
        headers: HEADERS,
        params: { ...identity, request_id: crypto.randomUUID() },
        timeout: 60000
    })

    const taskId = res?.data?.data?.task_id
    if (!taskId) {
        throw new Error('Task enhance tidak berhasil dibuat.')
    }
    return taskId
}

function pickResultUrl(result) {
    return result?.result_url || result?.url || result?.output_url || ''
}

async function waitTask(taskId, identity, maxPoll = 30) {
    for (let i = 0; i < maxPoll; i += 1) {
        const res = await axios.get(`${BASE_URL}/api/task/query`, {
            headers: HEADERS,
            params: { ...identity, task_id: taskId },
            timeout: 60000
        })

        const data = res?.data?.data || {}
        if (data.status === 'success') {
            const url = pickResultUrl(data.result || {})
            if (!url) throw new Error('URL hasil enhance tidak ditemukan.')
            return {
                status: data.status,
                result: data.result || {},
                url
            }
        }

        if (data.status === 'fail') {
            throw new Error('Task enhance gagal di server.')
        }

        await sleep(1500)
    }

    throw new Error('Timeout menunggu hasil enhance.')
}

async function enhanceHd(image, options = {}) {
    const upscale = Number(options.upscale || 2)
    const maxPoll = Number(options.maxPoll || 30)
    const identity = makeIdentity()
    const base64Data = await toBase64(image)
    const taskId = await injectTask(base64Data, identity, upscale)
    const done = await waitTask(taskId, identity, maxPoll)

    return {
        provider: 'ThinkYeah Enhance-HD',
        taskId,
        upscale,
        url: done.url,
        raw: done.result
    }
}

export { enhanceHd }
