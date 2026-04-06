import { enhanceHd } from './hd.js'

const SCALE_MAP = {
    '1X': 1,
    '2X': 2,
    '4X': 4,
    '8X': 8
}

const parseScale = (options = {}) => {
    const typeLabel = String(options.type || options.scale || '2X').trim().toUpperCase()
    if (SCALE_MAP[typeLabel]) return { label: typeLabel, factor: SCALE_MAP[typeLabel] }

    const numeric = Number.parseInt(options.upscale || options.scale || 2, 10)
    if (Number.isFinite(numeric) && numeric > 0) {
        const factor = Math.min(8, Math.max(1, numeric))
        return { label: `${factor}X`, factor }
    }

    return { label: '2X', factor: 2 }
}

const ensureValidInput = (image) => {
    if (Buffer.isBuffer(image)) return
    const raw = String(image || '').trim()
    if (/^https?:\/\//i.test(raw)) return
    throw new Error('Input upscale harus berupa buffer gambar atau URL http/https.')
}

export const upscale = async (image, options = {}) => {
    ensureValidInput(image)

    const maxPoll = Math.max(1, Number.parseInt(options.maxPoll || 30, 10) || 30)
    const { label, factor } = parseScale(options)

    try {
        const result = await enhanceHd(image, {
            upscale: factor,
            maxPoll
        })

        const url = String(result?.url || '').trim()
        if (!/^https?:\/\//i.test(url)) {
            const err = new Error('Provider upscale tidak mengembalikan URL hasil yang valid.')
            err.status = 'FAILED'
            throw err
        }

        return {
            status: 'SUCCESS',
            predictionId: String(result?.taskId || ''),
            provider: result?.provider || 'ThinkYeah Enhance-HD',
            type: label,
            upscale: factor,
            url,
            raw: result?.raw || null
        }
    } catch (err) {
        const wrapped = new Error(err?.message || 'Upscale gagal.')
        wrapped.status = err?.status || 'ERROR'
        wrapped.details = err?.details || null
        throw wrapped
    }
}

export default {
    upscale
}
