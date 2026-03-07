import axios from 'axios'

const INIT_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=boq_assistant-bard-web-server_20250814.06_p1&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c'
const STREAM_URL = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20250729.06_p0&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c'
const BOOTSTRAP_PAYLOAD = 'f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&'

const DEFAULT_RESUME = ['', '', '', null, null, null, null, null, null, '']
const DEFAULT_LANG = ['id-ID']
const DEFAULT_INSTRUCTION = ''

const normalizeCookie = (raw) => {
    if (!raw || typeof raw !== 'string') return ''
    return raw
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .join('; ')
}

const parseJsonSafely = (value) => {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

const parseGeminiFrames = (data) => {
    if (typeof data !== 'string') return null

    const frames = Array.from(data.matchAll(/^\d+\n(.+?)\n/gm))
        .map((match) => match[1])
        .filter((frame) => frame && frame !== '[]')

    for (let i = frames.length - 1; i >= 0; i -= 1) {
        const frame = parseJsonSafely(frames[i])
        if (!Array.isArray(frame) || !frame[0]) continue

        const raw = frame?.[0]?.[2]
        const payload = parseJsonSafely(raw)
        if (!Array.isArray(payload)) continue

        const text = payload?.[4]?.[0]?.[1]?.[0]
        if (typeof text !== 'string' || !text.trim()) continue

        const safeResume = Array.isArray(payload[1]) ? payload[1] : []
        const newTurn = payload?.[4]?.[0]?.[0]
        const resumeArray = [...safeResume, ...(newTurn ? [newTurn] : [])]

        return {
            text: text.replace(/\*\*(.+?)\*\*/g, '*$1*'),
            resumeArray
        }
    }

    return null
}

const getCookie = async (previousCookie) => {
    if (previousCookie) return previousCookie

    try {
        const { headers } = await axios.post(INIT_URL, BOOTSTRAP_PAYLOAD, {
            headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            timeout: 20000,
            validateStatus: () => true
        })
        const raw = headers['set-cookie']
        if (!raw || !raw.length) return ''
        return normalizeCookie(String(raw[0] || ''))
    } catch {
        return ''
    }
}

export const gemini = async ({ message, instruction = DEFAULT_INSTRUCTION, sessionId = null }) => {
    if (!message) {
        throw new Error('Message is required.')
    }

    const trimmedMessage = String(message).trim()
    if (!trimmedMessage) throw new Error('Message is required.')

    let resumeArray = null
    let cookie = null
    let savedInstruction = instruction || DEFAULT_INSTRUCTION

    if (sessionId) {
        try {
            const sessionData = JSON.parse(Buffer.from(sessionId, 'base64').toString())
            resumeArray = sessionData.resumeArray || null
            cookie = sessionData.cookie || null
            savedInstruction = sessionData.instruction || instruction || DEFAULT_INSTRUCTION
        } catch {
            // sessionId rusak: lanjutkan dengan sesi baru.
        }
    }

    cookie = await getCookie(cookie)
    const requestBody = [
        [trimmedMessage, 0, null, null, null, null, 0], DEFAULT_LANG,
        resumeArray || DEFAULT_RESUME,
        null, null, null, [1], 1, null, null, 1, 0, null, null, null, null, null, [[0]], 1,
        null, null, null, null, null,
        ['', '', savedInstruction, null, null, null, null, null, 0, null, 1, null, null, null, []],
        null, null, 1, null, null, null, null, null, null, null,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 1, null, null, null, null, [1]
    ]

    const payload = [null, JSON.stringify(requestBody)]
    const form = new URLSearchParams({ 'f.req': JSON.stringify(payload) }).toString()

    const { data, status } = await axios.post(STREAM_URL, form, {
        headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-goog-ext-525001261-jspb': '[1,null,null,null,"9ec249fc9ad08861",null,null,null,[4]]',
            cookie
        },
        timeout: 30000,
        validateStatus: () => true
    })

    if (status >= 400) {
        throw new Error(`Gemini gagal merespon (${status}).`)
    }

    const parsed = parseGeminiFrames(data)
    if (!parsed) {
        throw new Error('Tidak bisa parse respon Gemini, format berubah atau tidak valid.')
    }

    const newSessionId = Buffer.from(
        JSON.stringify({
            resumeArray: parsed.resumeArray,
            cookie,
            instruction: savedInstruction
        })
    ).toString('base64')

    return {
        text: parsed.text,
        sessionId: newSessionId
    }
}

export default gemini
