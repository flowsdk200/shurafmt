import axios from 'axios'
import { sendInteractive } from '../../src/utils/message.js'
import { setWpreadSession } from '../../src/utils/wpreadSession.js'

const STORY_API = 'https://www.wattpad.com/api/v3/stories/{storyId}'
const STORY_TEXT_API = 'https://www.wattpad.com/apiv2/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const COMMAND_PREFIX = '.wpread'
const REQUEST_TIMEOUT = 120000
const MAX_PART_PAGES = 20
const MAX_TEXT_LENGTH = 3800
const NEXT_PART_ID_PREFIX = 'wpr:'

const fmtCount = (value) => {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0
    if (!n) return '0'

    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.trunc(n))
}

const normalizeText = (value) => String(value || '').trim()

const toInteger = (value) => {
    const n = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 0
}

const decodeHtmlEntities = (value) => {
    const raw = normalizeText(value)
    if (!raw) return ''

    return raw
        .replace(/&#(x[a-fA-F0-9]+|\d+);/g, (_, code) => {
            const point = code.startsWith('x')
                ? Number.parseInt(code.slice(1), 16)
                : Number.parseInt(code, 10)
            return Number.isFinite(point) ? String.fromCodePoint(point) : ''
        })
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
}

const htmlToText = (value) => {
    const html = normalizeText(decodeHtmlEntities(value))
    if (!html) return ''

    return html
        .replace(/<\/(p|div|section|article|header|footer|h[1-6]|li)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s{2,}/g, ' ')
        .trim()
}

const splitCommandInput = (text) => {
    const raw = normalizeText(text)
    if (!raw) return { storyInput: '', partNumber: 1 }

    const tokens = raw.split(/\s+/).filter(Boolean)
    const storyInput = tokens[0] || ''

    let partNumber = 1
    const explicitPart = raw.match(/\bpart\s*(?:=|:)?\s*(\d+)\b/i)
    const positionalPart = tokens.slice(1).find((token) => /^\d+$/.test(token))

    partNumber = toInteger(explicitPart?.[1] || positionalPart || 1)
    if (!partNumber) partNumber = 1

    return { storyInput, partNumber }
}

const extractStoryId = (storyInput) => {
    const raw = normalizeText(storyInput)
    if (!raw) return null

    const numeric = raw.match(/^\d{4,}$/)
    if (numeric) return numeric[0]

    const storyMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?wattpad\.com\/story\/(\d+)(?:[-/].*)?/i)
    if (storyMatch?.[1]) return storyMatch[1]

    return null
}

const extractStoryUrl = (storyInput, storyId) => {
    const raw = normalizeText(storyInput)
    if (!raw) return `https://www.wattpad.com/story/${storyId}`
    if (/^https:\/\//i.test(raw)) return raw

    const id = extractStoryId(raw)
    return id ? `https://www.wattpad.com/story/${id}` : `https://www.wattpad.com/story/${storyId}`
}

const fetchStory = async (storyId) => {
    const endpoint = STORY_API.replace('{storyId}', encodeURIComponent(storyId))
    const { data } = await axios.get(endpoint, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json'
        }
    })

    if (!data || typeof data !== 'object') {
        throw new Error('Gagal ambil metadata story dari Wattpad.')
    }

    const parts = Array.isArray(data.parts) ? data.parts : []
    if (!parts.length) throw new Error('Story ini tidak memiliki part.')

    return {
        id: String(data.id || storyId),
        title: normalizeText(data.title || '-'),
        url: `https://www.wattpad.com/story/${data.id || storyId}`,
        author: normalizeText(data.user?.name || data.author || '-'),
        description: normalizeText(data.description || '-'),
        readCount: toInteger(data.readCount),
        voteCount: toInteger(data.voteCount),
        commentCount: toInteger(data.commentCount),
        partTotal: toInteger(data.partCount || parts.length),
        parts: parts.map((part, idx) => ({
            id: String(part.id || ''),
            index: idx + 1,
            title: normalizeText(part.title || `Part ${idx + 1}`),
            url: normalizeText(part.url || ''),
            readCount: toInteger(part.readCount),
            voteCount: toInteger(part.voteCount),
            commentCount: toInteger(part.commentCount)
        }))
    }
}

const fetchPartText = async (partId) => {
    const fragments = []
    let lastFragment = ''

    for (let page = 1; page <= MAX_PART_PAGES; page += 1) {
        const { data } = await axios.get(STORY_TEXT_API, {
            params: {
                m: 'storytext',
                id: partId,
                page
            },
            timeout: REQUEST_TIMEOUT,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        })

        const html = typeof data === 'string' ? data : String(data || '')
        const fragment = htmlToText(html)
        if (!fragment || fragment === lastFragment) break

        fragments.push(fragment)
        lastFragment = fragment
    }

    return fragments.join('\n\n').trim()
}

const splitToChunks = (text, maxLength = MAX_TEXT_LENGTH) => {
    const value = normalizeText(text)
    if (!value) return ['']

    const out = []
    let remaining = value

    while (remaining.length > maxLength) {
        let chunk = remaining.slice(0, maxLength)
        let cutPoint = chunk.lastIndexOf('\n')

        if (cutPoint < 0) cutPoint = chunk.lastIndexOf(' ')
        if (cutPoint <= 0) cutPoint = maxLength

        chunk = remaining.slice(0, cutPoint).trimEnd()
        if (!chunk) {
            chunk = remaining.slice(0, maxLength)
            remaining = remaining.slice(maxLength)
        } else {
            remaining = remaining.slice(chunk.length).trimStart()
        }

        out.push(chunk)
    }

    if (remaining) out.push(remaining)

    return out
}

const buildHeader = (story, part) => {
    const total = Math.max(story.partTotal, story.parts.length)
    return (
        `\`\`\`× Title: ${story.title}\n` +
        `× Author: ${story.author}\n` +
        `× Part: ${part.index}/${total}\n` +
        `× Part title: ${part.title}\n` +
        `× Read: ${fmtCount(part.readCount)}\n` +
        `× Vote: ${fmtCount(part.voteCount)}\n` +
        `× Comment: ${fmtCount(part.commentCount)}\n\n\`\`\``
    )
}

const buildPartMessage = (story, part, partText) => {
    if (!partText) {
        return `${buildHeader(story, part)}\n\n❌ Tidak bisa mengambil isi part saat ini. Silakan coba lagi beberapa saat.`
    }

    return `${buildHeader(story, part)}\n\n${partText}`
}

export default {
    name: 'wpread',
    aliases: ['wattpadread'],
    description: 'Baca cerpen/story dari wattpad dengan part dan next panel',
    execute: async ({ sock, msg, text, prefix, command, sender, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const { storyInput, partNumber } = splitCommandInput(text)

        if (!storyInput) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n` +
                    `- ${prefix + command} https://www.wattpad.com/story/363765364-indonesian-horror-story`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const storyId = extractStoryId(storyInput)
            if (!storyId) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Format tidak valid. gunakan link wattpad\n\n` +
                        `Contoh:\n- ${prefix + command} https://www.wattpad.com/story/363765364-indonesian-horror-story`
                }, { quoted: msg })
            }

            const story = await fetchStory(storyId)
            const totalParts = story.parts.length
            const selectedIndex = Math.min(Math.max(toInteger(partNumber), 1), totalParts) - 1
            const selectedPart = story.parts[selectedIndex]

            if (!selectedPart?.id) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Part ${Math.min(Math.max(toInteger(partNumber), 1), totalParts)} tidak ditemukan.`
                }, { quoted: msg })
            }

            const storyUrl = extractStoryUrl(storyInput, storyId)
            const partText = await fetchPartText(selectedPart.id)

            const message = buildPartMessage({
                ...story,
                url: storyUrl
            }, selectedPart, partText)

            const hasNextPart = selectedPart.index < totalParts
            const chunks = splitToChunks(message)

            await setWpreadSession(jid, sender, {
                storyId: story.id,
                part: selectedPart.index,
                totalParts
            })

            await sock.sendMessage(jid, { text: chunks.join('\n') }, { quoted: msg })

            if (hasNextPart) {
                await sendInteractive(sock, jid, {
                    title: 'Lanjut part berikutnya?',
                    footer: `NEXT PANEL (${selectedPart.index + 1}/${totalParts})`,
                    buttons: [{
                        id: `${NEXT_PART_ID_PREFIX}${story.id}:${selectedPart.index + 1}`,
                        text: 'NEXT PANEL'
                    }]
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
