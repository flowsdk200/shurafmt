import fs from 'fs'
import os from 'os'
import path from 'path'
import vm from 'node:vm'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { gotScraping } from 'got-scraping'

const REQUEST_TIMEOUT = 30000
const MEDIA_TIMEOUT = 120000
const PAGE_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

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

const fetchPageState = async (videoPageUrl) => {
    const { statusCode, body } = await gotScraping(videoPageUrl, {
        throwHttpErrors: false,
        timeout: { request: REQUEST_TIMEOUT },
        retry: { limit: 0 },
        headers: PAGE_HEADERS
    })

    if (statusCode !== 200) throw new Error(`Bilibili HTTP ${statusCode}`)
    const html = String(body || '')
    if (!html.trim()) throw new Error('Halaman kosong')
    if (/access denied|captcha|just a moment|enable javascript|cloudflare/i.test(html)) {
        throw new Error('Halaman terproteksi/challenge')
    }

    const stateScript = extractInitialStateScript(html)
    if (!stateScript) throw new Error('State script tidak ditemukan')
    return evaluateState(stateScript)
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

const resolveStreams = (state) => {
    const player = state?.player || {}
    const dash = player?.playUrl?.dash || {}
    const options = Array.isArray(player?.playerQualityOptions) ? player.playerQualityOptions : []
    const videoTracks = Array.isArray(dash?.video) ? dash.video : []
    const selected = pickQualityOption(options)
    const preferredVideo = videoTracks
        .filter((x) => Number(x?.id) <= 32)
        .sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))[0]
    const matchedVideo = videoTracks.find((x) => Number(x?.id) === Number(selected?.value))
    const fallbackVideo = preferredVideo || videoTracks.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))[0]
    const videoUrl = cleanText(
        matchedVideo?.base_url ||
        matchedVideo?.baseUrl ||
        fallbackVideo?.base_url ||
        fallbackVideo?.baseUrl ||
        selected?.url ||
        ''
    )
    if (!videoUrl) throw new Error('Stream video tidak tersedia')

    const audioTracks = Array.isArray(dash?.audio) ? dash.audio : []
    const preferredAudioId =
        Number(selected?.audioQuality) ||
        Number(player?.currentAudioQuality) ||
        Number(fallbackVideo?.audio_quality) ||
        0
    const matchedAudio = audioTracks.find((x) => Number(x?.id) === preferredAudioId)
    const audio = matchedAudio || audioTracks.sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))[0] || null
    const audioUrl = cleanText(audio?.base_url || audio?.baseUrl || '')
    if (!audioUrl) throw new Error('Stream audio tidak tersedia')

    return {
        videoUrl,
        audioUrl,
        qualityLabel: cleanText(selected?.label || fallbackVideo?.id || '-') || '-'
    }
}

const fetchMediaBuffer = async (url, referer) => {
    const { statusCode, body } = await gotScraping(url, {
        throwHttpErrors: false,
        timeout: { request: MEDIA_TIMEOUT },
        retry: { limit: 1 },
        responseType: 'buffer',
        headers: {
            ...PAGE_HEADERS,
            accept: '*/*',
            origin: 'https://www.bilibili.tv',
            referer
        }
    })

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
        `\`\`\`× Title: ${title}\n` +
        `× Uploader: ${uploader}\n` +
        `× Duration: ${duration}\n` +
        `× Quality: ${qualityLabel}\n` +
        `× Views: ${views}\n` +
        `× Likes: ${likes}\n` +
        `× Followers: ${followers}\n` +
        `× Publish: ${published}`
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
            const state = await fetchPageState(sourceUrl)
            const streams = resolveStreams(state)
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

            await sock.sendMessage(jid, {
                video: videoMp4,
                mimetype: 'video/mp4',
                caption
            }, { quoted: msg })

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
