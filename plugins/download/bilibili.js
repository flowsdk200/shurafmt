import fs from 'fs'
import os from 'os'
import path from 'path'
import vm from 'node:vm'
import { spawn } from 'child_process'
import axios from 'axios'
import ffmpegPath from 'ffmpeg-static'

const REQUEST_TIMEOUT = 30000
const MEDIA_TIMEOUT = 120000
const VIDEO_BUFFER_LIMIT = 100 * 1024 * 1024
const BILIBILI_COOKIE = [
    'bili_jct=25e909241987fa9506a3d693b6c4e069',
    'bsource=search_google',
    'DedeUserID=1356138176',
    'buvid4=B6DD3FBD-96EF-BC96-7638-AFCC4B6F240D38250-126030723-7gsfsI%2BICrpewyLLl%2BJnMQ%3D%3D',
    'buvid3=5d0bf8c9-5695-42f1-b43b-b649138e6ea927419infoc',
    'g_state=%7B%22i_l%22%3A0%2C%22i_ll%22%3A1772899037562%2C%22i_b%22%3A%22rQhJFo6gUmJ8HxIyoTXReP6FwKeQOqlY1259eDRB1r8%22%2C%22i_e%22%3A%7B%22enable_itp_optimization%22%3A0%7D%7D',
    'bstar-web-lang=id',
    'DedeUserID__ckMd5=7647cf0d704f76206aa5f0e1aee8c35c',
    'joy_jct=25e909241987fa9506a3d693b6c4e069',
    'mid=1356138176',
    'SESSDATA=52b20470%2C1788451069%2Cdfc33%2A3100c0'
].join('; ')

const PAGE_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    cookie: BILIBILI_COOKIE
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const sanitizeFileName = (value) => {
    const text = cleanText(value).replace(/[\\/:*?"<>|]+/g, '').trim()
    return text || 'bilibili-video'
}

const extractVideoUrl = (input) => {
    const text = cleanText(input)
    if (!text) return ''

    if (!/^https?:\/\//i.test(text)) {
        const numeric = text.match(/^\d+$/)?.[0]
        return numeric ? `https://www.bilibili.tv/video/${numeric}` : ''
    }

    try {
        const parsed = new URL(text)
        if (!/(^|\.)bilibili\.tv$/i.test(parsed.hostname)) return ''
        if (!/^\/(?:id\/)?video\/\d+/.test(parsed.pathname) && !/^\/(?:id\/)?play\/\d+(?:\/\d+)?/.test(parsed.pathname)) return ''
        parsed.search = ''
        parsed.hash = ''
        return parsed.toString()
    } catch {
        return ''
    }
}

const extractInitialStateScript = (html) => {
    const source = String(html || '')
    const marker = 'window.__initialState='
    const start = source.indexOf(marker)
    if (start < 0) return ''

    const end = source.indexOf('</script>', start)
    if (end < 0) return ''

    return source.slice(start, end).trim()
}

const evaluateState = (scriptText) => {
    const context = {
        window: {},
        Map,
        console: {
            log() {},
            warn() {},
            error() {}
        }
    }

    vm.createContext(context)
    vm.runInContext(String(scriptText || ''), context, { timeout: 6000 })
    return context.window?.__initialState || {}
}

const decodeJsString = (value) => {
    try {
        return JSON.parse(`"${String(value || '').replace(/"/g, '\\"')}"`)
    } catch {
        return String(value || '')
            .replace(/\\u002F/g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\\\/g, '\\')
    }
}

const splitTopLevelArgs = (input) => {
    const parts = []
    let current = ''
    let depthParen = 0
    let depthBracket = 0
    let depthBrace = 0
    let inString = false
    let quote = ''
    let escaped = false

    for (const char of String(input || '')) {
        current += char

        if (inString) {
            if (escaped) {
                escaped = false
                continue
            }
            if (char === '\\') {
                escaped = true
                continue
            }
            if (char === quote) {
                inString = false
                quote = ''
            }
            continue
        }

        if (char === '"' || char === '\'') {
            inString = true
            quote = char
            continue
        }

        if (char === '(') depthParen += 1
        else if (char === ')') depthParen -= 1
        else if (char === '[') depthBracket += 1
        else if (char === ']') depthBracket -= 1
        else if (char === '{') depthBrace += 1
        else if (char === '}') depthBrace -= 1
        else if (char === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
            parts.push(current.slice(0, -1).trim())
            current = ''
        }
    }

    if (current.trim()) parts.push(current.trim())
    return parts
}

const extractFallbackDashFromScript = (scriptText) => {
    const source = String(scriptText || '')
    if (!source) return { audio: [], video: [] }

    const stringVars = new Map()
    const numberVars = new Map()

    const headerMatch = source.match(/^window\.__initialState=\(function\((.*?)\)\{/s)
    const endIndex = source.lastIndexOf('))')
    const startArgsIndex = source.lastIndexOf('}(', endIndex)

    if (headerMatch && startArgsIndex > -1 && endIndex > startArgsIndex) {
        const params = headerMatch[1].split(',').map((x) => x.trim()).filter(Boolean)
        const argsRaw = source.slice(startArgsIndex + 2, endIndex)
        const args = splitTopLevelArgs(argsRaw)

        for (let i = 0; i < params.length; i += 1) {
            const key = params[i]
            const raw = String(args[i] || '').trim()
            if (!key || !raw) continue

            if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('\'') && raw.endsWith('\''))) {
                const decoded = decodeJsString(raw.slice(1, -1))
                if (decoded.includes('.m4s')) {
                    stringVars.set(key, decoded)
                }
                continue
            }

            if (/^\d{1,6}$/.test(raw)) {
                numberVars.set(key, Number(raw))
            }
        }
    }

    for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)(?:\[\d+\])?="(https:\\u002F\\u002F[^"]+?\.m4s[^"]*)"/g)) {
        if (!stringVars.has(match[1])) stringVars.set(match[1], decodeJsString(match[2]))
    }

    const pickSection = (from, to) => {
        const start = source.indexOf(from)
        if (start < 0) return ''
        const end = source.indexOf(to, start)
        if (end < 0) return ''
        return source.slice(start, end)
    }

    const audioSection = pickSection('audio:[', '],video:[')
    const videoSection = pickSection('video:[', '],errorCode:')

    const parseItems = (section) => {
        if (!section) return []
        const items = []
        const itemRegex = /base_url:([A-Za-z_$][\w$]*).*?(?:id:([A-Za-z_$][\w$]*|\d+))?/gs
        let order = 0
        for (const match of section.matchAll(itemRegex)) {
            const varName = match[1]
            const idRaw = match[2] || ''
            const baseUrl = cleanText(stringVars.get(varName) || '')
            const id = /^\d+$/.test(idRaw) ? Number(idRaw) : (numberVars.get(idRaw) || 0)
            if (baseUrl) {
                order += 1
                items.push({ id: id || order, base_url: baseUrl, baseUrl: baseUrl })
            }
        }
        return items
    }

    return {
        audio: parseItems(audioSection),
        video: parseItems(videoSection)
    }
}

const summarizeState = (state, sourceUrl = '') => {
    const player = state?.player || {}
    const dash = player?.playUrl?.dash || {}
    const options = Array.isArray(player?.playerQualityOptions) ? player.playerQualityOptions : []
    const videoTracks = Array.isArray(dash?.video) ? dash.video : []
    const audioTracks = Array.isArray(dash?.audio) ? dash.audio : []

    return {
        sourceUrl,
        title: cleanText(state?.ugc?.archive?.title || state?.share?.shareInfo?.title || ''),
        playerKeys: Object.keys(player || {}),
        playUrlKeys: Object.keys(player?.playUrl || {}),
        optionCount: options.length,
        optionSample: options.slice(0, 7).map((x) => ({
            value: Number(x?.value) || 0,
            label: cleanText(x?.label || ''),
            hasUrl: !!cleanText(x?.url),
            audioQuality: Number(x?.audioQuality) || 0
        })),
        dashVideoCount: videoTracks.length,
        dashVideoSample: videoTracks.slice(0, 7).map((x) => ({
            id: Number(x?.id) || 0,
            hasBaseUrl: !!cleanText(x?.base_url || x?.baseUrl),
            width: Number(x?.width) || 0,
            height: Number(x?.height) || 0
        })),
        dashAudioCount: audioTracks.length,
        dashAudioSample: audioTracks.slice(0, 5).map((x) => ({
            id: Number(x?.id) || 0,
            hasBaseUrl: !!cleanText(x?.base_url || x?.baseUrl)
        }))
    }
}

const fetchPageState = async (videoPageUrl) => {
    const response = await axios.get(videoPageUrl, {
        headers: PAGE_HEADERS,
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        maxRedirects: 5,
        responseType: 'text'
    })
    const statusCode = response.status
    const body = response.data

    if (statusCode !== 200) throw new Error(`Bilibili HTTP ${statusCode}`)
    const html = String(body || '')
    if (!html.trim()) throw new Error('Halaman kosong')
    if (/access denied|captcha|just a moment|enable javascript|cloudflare/i.test(html)) {
        throw new Error('Halaman terproteksi/challenge')
    }

    const stateScript = extractInitialStateScript(html)
    if (!stateScript) throw new Error('State script tidak ditemukan')
    const state = evaluateState(stateScript)
    const fallbackDash = extractFallbackDashFromScript(stateScript)
    return { state, fallbackDash }
}

const pickQualityOption = (options = []) => {
    const valid = options.filter((x) => x && cleanText(x.url))
    if (!valid.length) return null

    const preferred = valid
        .filter((x) => Number(x.value) <= 32)
        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))

    if (preferred.length) return preferred[0]
    return valid.sort((a, b) => (Number(a.value) || 0) - (Number(b.value) || 0))[0]
}

const resolveStreams = (state, fallbackDash = { audio: [], video: [] }) => {
    const player = state?.player || {}
    const dash = player?.playUrl?.dash || {}
    const options = Array.isArray(player?.playerQualityOptions) ? player.playerQualityOptions : []
    const videoTracks = Array.isArray(dash?.video) && dash.video.length ? dash.video : (Array.isArray(fallbackDash?.video) ? fallbackDash.video : [])
    const selected = pickQualityOption(options)
    const preferredVideo = selected
        ? videoTracks
            .filter((x) => Number(x?.id) <= 32)
            .sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))[0]
        : null
    const matchedVideo = selected ? videoTracks.find((x) => Number(x?.id) === Number(selected?.value)) : null
    const fallbackVideo = matchedVideo || preferredVideo || videoTracks[0] || null
    const videoUrl = cleanText(
        matchedVideo?.base_url ||
        matchedVideo?.baseUrl ||
        fallbackVideo?.base_url ||
        fallbackVideo?.baseUrl ||
        selected?.url ||
        ''
    )
    if (!videoUrl) {
        throw new Error(
            `Stream video tidak tersedia | options=${options.length} dashVideo=${videoTracks.length} selected=${Number(selected?.value) || 0} fallback=${Number(fallbackVideo?.id) || 0}`
        )
    }

    const audioTracks = Array.isArray(dash?.audio) && dash.audio.length ? dash.audio : (Array.isArray(fallbackDash?.audio) ? fallbackDash.audio : [])
    const preferredAudioId =
        Number(selected?.audioQuality) ||
        Number(player?.currentAudioQuality) ||
        Number(fallbackVideo?.audio_quality) ||
        0
    const matchedAudio = audioTracks.find((x) => Number(x?.id) === preferredAudioId)
    const audio = matchedAudio || audioTracks.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))[0] || null
    const audioUrl = cleanText(audio?.base_url || audio?.baseUrl || '')
    if (!audioUrl) {
        throw new Error(
            `Stream audio tidak tersedia | dashAudio=${audioTracks.length} preferredAudio=${preferredAudioId || 0}`
        )
    }

    return {
        videoUrl,
        audioUrl,
        qualityLabel: cleanText(selected?.label || '-') || '-'
    }
}

const fetchMediaBuffer = async (url, referer) => {
    const response = await axios.get(url, {
        timeout: MEDIA_TIMEOUT,
        validateStatus: () => true,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        headers: {
            ...PAGE_HEADERS,
            accept: '*/*',
            origin: 'https://www.bilibili.tv',
            referer
        }
    })
    const statusCode = response.status
    const body = response.data

    if (statusCode !== 200) throw new Error(`Media HTTP ${statusCode}`)
    const buf = Buffer.from(body || [])
    if (!buf.length) throw new Error('Media kosong')
    return buf
}

const runFfmpeg = (args) => new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args)
    let stderr = ''

    proc.stderr.on('data', (chunk) => {
        stderr += String(chunk || '')
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
        if (code === 0) return resolve()
        return reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`))
    })
})

const mergeDash = async (videoBuffer, audioBuffer) => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bili-dl-'))
    const videoPath = path.join(tmpDir, 'video.m4s')
    const audioPath = path.join(tmpDir, 'audio.m4s')
    const outputPath = path.join(tmpDir, 'output.mp4')

    try {
        await fs.promises.writeFile(videoPath, videoBuffer)
        await fs.promises.writeFile(audioPath, audioBuffer)

        try {
            await runFfmpeg(['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', outputPath])
        } catch {
            await runFfmpeg(['-y', '-i', videoPath, '-i', audioPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', outputPath])
        }

        return await fs.promises.readFile(outputPath)
    } finally {
        await Promise.all([
            fs.promises.rm(videoPath, { force: true }),
            fs.promises.rm(audioPath, { force: true }),
            fs.promises.rm(outputPath, { force: true })
        ]).catch(() => null)
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => null)
    }
}

const formatDuration = (seconds) => {
    const total = Math.max(0, Number(seconds) || 0)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = Math.floor(total % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
}

const buildCaption = ({ archive, shareInfo, qualityLabel, sourceUrl }) => {
    const titleRaw = cleanText(archive?.title || shareInfo?.title || '-')
    const title = titleRaw.replace(/\s*\|\s*bilibili$/i, '') || '-'
    const uploader = cleanText(archive?.uploader?.name || '-')
    const uploaderId = cleanText(archive?.uploader?.mid || '-')
    const views = cleanText(archive?.stat?.views || '-')
    const likes = cleanText(archive?.stat?.like_count || '-')
    const followers = cleanText(archive?.stat?.followers || '-')
    const duration = formatDuration(archive?.duration)
    const published = cleanText(archive?.formatted_pub_date || archive?.pub_date || '-')

    return (
        `\`\`\`• Title: ${title}\n` +
        `• Duration: ${duration}\n` +
        `• Quality: ${qualityLabel}\`\`\``
    )
}

export default {
    name: 'bilibilidl',
    aliases: ['bvidl', 'bilidl'],
    description: 'Download video Bilibili TV (video + audio)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const sourceUrl = extractVideoUrl(text)

        if (!sourceUrl) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.bilibili.tv/video/4791938539323393`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { state, fallbackDash } = await fetchPageState(sourceUrl)
            const streams = resolveStreams(state, fallbackDash)
            const [videoDash, audioDash] = await Promise.all([
                fetchMediaBuffer(streams.videoUrl, sourceUrl),
                fetchMediaBuffer(streams.audioUrl, sourceUrl)
            ])
            const videoMp4 = await mergeDash(videoDash, audioDash)

            const archive = state?.ugc?.archive || {}
            const shareInfo = state?.share?.shareInfo || {}
            const caption = buildCaption({
                archive,
                shareInfo,
                qualityLabel: streams.qualityLabel,
                sourceUrl
            })

            if (videoMp4.length > VIDEO_BUFFER_LIMIT) {
                await sock.sendMessage(jid, {
                    document: videoMp4,
                    mimetype: 'video/mp4',
                    fileName: `${sanitizeFileName(archive?.title || shareInfo?.title || 'bilibili-video')}.mp4`,
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    video: videoMp4,
                    mimetype: 'video/mp4',
                    caption
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
