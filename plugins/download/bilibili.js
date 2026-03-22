import fs from 'fs'
import os from 'os'
import path from 'path'
import vm from 'node:vm'
import { spawn } from 'child_process'
import axios from 'axios'
import ffmpegPath from 'ffmpeg-static'
import HttpsProxyAgentPkg from 'https-proxy-agent'

const REQUEST_TIMEOUT = 30000
const MEDIA_TIMEOUT = 120000
const VIDEO_BUFFER_LIMIT = 100 * 1024 * 1024
const BILIBILI_API_V2 = 'https://api.bilibili.tv/intl/gateway/web/v2'
const BILIBILI_API_WEB = 'https://api.bilibili.tv/intl/gateway/web'
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

const { HttpsProxyAgent } = HttpsProxyAgentPkg

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const getBilibiliProxyUrl = () => cleanText(
    process.env.BILIBILI_HTTP_PROXY ||
    process.env.BILIBILI_PROXY ||
    process.env.DEDICATED_IP_HTTP_PROXY_1 ||
    ''
)

const createAxiosNetworkConfig = () => {
    const proxyUrl = getBilibiliProxyUrl()
    if (!proxyUrl) return {}

    const agent = new HttpsProxyAgent(proxyUrl)
    return {
        proxy: false,
        httpAgent: agent,
        httpsAgent: agent
    }
}

const sanitizeFileName = (value) => {
    const text = cleanText(value).replace(/[\\/:*?"<>|]+/g, '').trim()
    return text || 'bilibili-video'
}

const parseSource = (input) => {
    const text = cleanText(input)
    if (!text) return null

    if (!/^https?:\/\//i.test(text)) {
        const numeric = text.match(/^\d+$/)?.[0]
        return numeric ? {
            type: 'video',
            sourceUrl: `https://www.bilibili.tv/video/${numeric}`,
            aid: numeric,
            seasonId: '',
            epId: ''
        } : null
    }

    try {
        const parsed = new URL(text)
        if (!/(^|\.)bilibili\.tv$/i.test(parsed.hostname)) return null
        const videoMatch = parsed.pathname.match(/^\/(?:id\/)?video\/(\d+)/)
        const playMatch = parsed.pathname.match(/^\/(?:id\/)?play\/(\d+)(?:\/(\d+))?/)
        if (!videoMatch && !playMatch) return null
        parsed.search = ''
        parsed.hash = ''
        if (videoMatch) {
            return {
                type: 'video',
                sourceUrl: parsed.toString(),
                aid: videoMatch[1],
                seasonId: '',
                epId: ''
            }
        }
        return {
            type: 'play',
            sourceUrl: parsed.toString(),
            aid: '',
            seasonId: playMatch[1],
            epId: playMatch[2] || ''
        }
    } catch {
        return null
    }
}

const fetchApi = async (baseUrl, path, params = {}) => {
    const response = await axios.get(`${baseUrl}/${path}`, {
        params,
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: PAGE_HEADERS,
        ...createAxiosNetworkConfig()
    })
    if (response.status !== 200) {
        throw new Error(`Bilibili API HTTP ${response.status}`)
    }

    const payload = response.data
    const code = Number(payload?.code)
    if (code !== 0) {
        throw new Error(cleanText(payload?.message || payload?.msg || `Bilibili API code ${code}`) || `Bilibili API code ${code}`)
    }
    return payload?.data || {}
}

const fetchOgvSeasonInfo = async (seasonId) => {
    const data = await fetchApi(BILIBILI_API_V2, 'ogv/play/season_info', { season_id: seasonId })
    return data?.season || {}
}

const fetchOgvEpisodes = async (seasonId) => {
    const data = await fetchApi(BILIBILI_API_V2, 'ogv/play/episodes', { season_id: seasonId })
    return Array.isArray(data?.sections) ? data.sections : []
}

const resolveOgvEpisodeId = async (seasonId, epId = '') => {
    if (cleanText(epId)) return cleanText(epId)
    const season = await fetchOgvSeasonInfo(seasonId)
    const fallbackEpId = cleanText(season?.view_history?.episode_id || season?.first_episode?.episode_id)
    if (!fallbackEpId) throw new Error('Episode Bilibili tidak ditemukan')
    return fallbackEpId
}

const flattenOgvEpisodes = (sections = []) => sections
    .flatMap((section) => Array.isArray(section?.episodes) ? section.episodes : [])

const buildOgvPlayUrlParams = (epId) => ({
    ep_id: epId,
    platform: 'html5_a',
    qn: 64,
    type: 0,
    device: 'wap',
    tf: 0,
    s_locale: 'id_ID'
})

const normalizeIntlMediaUrl = (resource = {}) => {
    const primary = cleanText(resource?.url)
    if (primary) return primary
    const backup = Array.isArray(resource?.backup_url) ? resource.backup_url.find((x) => cleanText(x)) : ''
    return cleanText(backup || '')
}

const resolveOgvPlayStreams = (playurl = {}) => {
    const videoOptions = Array.isArray(playurl?.video) ? playurl.video : []
    const audioTracks = Array.isArray(playurl?.audio_resource) ? playurl.audio_resource : []

    const normalizedOptions = videoOptions
        .map((entry) => {
            const resource = entry?.video_resource || {}
            const quality = Number(resource?.quality) || 0
            const url = normalizeIntlMediaUrl(resource)
            return {
                id: quality,
                quality,
                url,
                audioQuality: Number(entry?.audio_quality) || 0,
                label: cleanText(entry?.stream_info?.desc_words || entry?.stream_info?.desc_text || ''),
                codecId: Number(resource?.codec_id) || 0
            }
        })
        .filter((entry) => entry.url && entry.codecId === 7)

    const selected = pickQualityOption(normalizedOptions.map((entry) => ({
        value: entry.quality,
        url: entry.url,
        label: entry.label,
        audioQuality: entry.audioQuality
    })))
    const fallbackVideo = normalizedOptions
        .filter((entry) => Number(entry.id) <= 32)
        .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))[0] || normalizedOptions[0] || null
    const matchedVideo = normalizedOptions.find((entry) => Number(entry.id) === Number(selected?.value)) || fallbackVideo
    const videoUrl = cleanText(matchedVideo?.url)
    if (!videoUrl) {
        throw new Error(`Stream video tidak tersedia | options=${normalizedOptions.length} dashVideo=0 selected=${Number(selected?.value) || 0} fallback=${Number(fallbackVideo?.id) || 0}`)
    }

    const preferredAudioId = Number(selected?.audioQuality) || Number(matchedVideo?.audioQuality) || 0
    const audio = audioTracks.find((entry) => Number(entry?.id) === preferredAudioId) ||
        [...audioTracks].sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))[0] ||
        null
    const audioUrl = normalizeIntlMediaUrl(audio)
    if (!audioUrl) {
        throw new Error(`Stream audio tidak tersedia | dashAudio=${audioTracks.length} preferredAudio=${preferredAudioId || 0}`)
    }

    return {
        videoUrl,
        audioUrl,
        qualityLabel: cleanText(selected?.label || matchedVideo?.label || '-') || '-',
        durationSeconds: Math.floor((Number(playurl?.duration) || 0) / 1000)
    }
}

const fetchOgvPlayback = async (source) => {
    const season = await fetchOgvSeasonInfo(source.seasonId)
    const episodeId = await resolveOgvEpisodeId(source.seasonId, source.epId)
    const sections = await fetchOgvEpisodes(source.seasonId)
    const episodes = flattenOgvEpisodes(sections)
    const episode = episodes.find((item) => cleanText(item?.episode_id) === episodeId) || {}

    let streams = null

    try {
        const playData = await fetchApi(BILIBILI_API_WEB, 'playurl', buildOgvPlayUrlParams(episodeId))
        const playurl = playData?.playurl || {}
        streams = resolveOgvPlayStreams(playurl)
    } catch (err) {
        const { state, fallbackDash } = await fetchPageState(source.sourceUrl)
        const resolved = resolveStreams(state, fallbackDash)
        streams = {
            videoUrl: resolved.videoUrl,
            audioUrl: resolved.audioUrl,
            qualityLabel: resolved.qualityLabel,
            durationSeconds: Math.floor((Number(state?.ogv?.epInfo?.duration) || Number(state?.player?.playUrl?.timelength) || 0) / 1000)
        }

        if (!streams.videoUrl || !streams.audioUrl) {
            throw err
        }
    }

    const titleBits = [
        cleanText(season?.title),
        cleanText(episode?.title_display || episode?.short_title_display)
    ].filter(Boolean)

    return {
        title: cleanText(titleBits.join(' - ') || season?.title || episode?.title_display || 'bilibili-video'),
        durationSeconds: streams.durationSeconds,
        qualityLabel: streams.qualityLabel,
        videoUrl: streams.videoUrl,
        audioUrl: streams.audioUrl,
        fileName: `${sanitizeFileName(titleBits.join(' - ') || season?.title || 'bilibili-video')}.mp4`
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
        responseType: 'text',
        ...createAxiosNetworkConfig()
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
        },
        ...createAxiosNetworkConfig()
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

const buildCaption = ({ title, durationSeconds, qualityLabel }) => {
    return (
        `\`\`\`• Title: ${cleanText(title || '-').replace(/\s*\|\s*bilibili$/i, '') || '-'}\n` +
        `• Duration: ${formatDuration(durationSeconds)}\n` +
        `• Quality: ${qualityLabel}\`\`\``
    )
}

export default {
    name: 'bilibilidl',
    aliases: ['bvidl', 'bilidl'],
    description: 'Download video Bilibili TV (video + audio)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const source = parseSource(text)

        if (!source) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.bilibili.tv/video/4791938539323393`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            let title = 'bilibili-video'
            let durationSeconds = 0
            let qualityLabel = '-'
            let fileName = 'bilibili-video.mp4'
            let videoUrl = ''
            let audioUrl = ''

            if (source.type === 'play') {
                const playback = await fetchOgvPlayback(source)
                title = playback.title
                durationSeconds = playback.durationSeconds
                qualityLabel = playback.qualityLabel
                fileName = playback.fileName
                videoUrl = playback.videoUrl
                audioUrl = playback.audioUrl
            } else {
                const { state, fallbackDash } = await fetchPageState(source.sourceUrl)
                const streams = resolveStreams(state, fallbackDash)
                const archive = state?.ugc?.archive || {}
                const shareInfo = state?.share?.shareInfo || {}
                title = cleanText(archive?.title || shareInfo?.title || 'bilibili-video')
                durationSeconds = Number(archive?.duration) || 0
                qualityLabel = streams.qualityLabel
                fileName = `${sanitizeFileName(title)}.mp4`
                videoUrl = streams.videoUrl
                audioUrl = streams.audioUrl
            }

            const [videoDash, audioDash] = await Promise.all([
                fetchMediaBuffer(videoUrl, source.sourceUrl),
                fetchMediaBuffer(audioUrl, source.sourceUrl)
            ])
            const videoMp4 = await mergeDash(videoDash, audioDash)

            const caption = buildCaption({
                title,
                durationSeconds,
                qualityLabel
            })

            if (videoMp4.length > VIDEO_BUFFER_LIMIT) {
                await sock.sendMessage(jid, {
                    document: videoMp4,
                    mimetype: 'video/mp4',
                    fileName,
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
