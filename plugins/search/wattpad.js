import axios from 'axios'

const SEARCH_URL = 'https://www.wattpad.com/v4/search/stories'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10

const normalizeText = (value) => String(value || '').trim()

const toNumber = (value) => {
    const num = Number(String(value || '').replace(/[^\d.-]/g, ''))
    return Number.isFinite(num) ? num : 0
}

const formatNumber = (value) => {
    const num = toNumber(value)
    if (!num) return '0'

    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.trunc(num))
}

const escapeMarkdown = (value) =>
    normalizeText(value).replace(/[`~]/g, '')

const clampLimit = (raw) => {
    const input = toNumber(raw)
    return Math.min(MAX_LIMIT, input > 0 ? input : 1)
}

const parseLimit = (text) => {
    const match = normalizeText(text).match(/limit=(\d+)/i)
    if (!match) return { limit: DEFAULT_LIMIT, query: normalizeText(text) }
    return {
        limit: clampLimit(match[1]),
        query: normalizeText(normalizeText(text).replace(/(^|\s)limit=\d+\s*/gi, ' '))
    }
}

const truncate = (value, maxLength) => {
    const raw = normalizeText(value)
    if (raw.length <= maxLength) return raw
    return `${raw.slice(0, maxLength - 3)}...`
}

const buildCategoryNames = (story, categoryMap) => {
    if (!story?.categories || !Array.isArray(story.categories)) return '-'
    const names = story.categories
        .map((id) => categoryMap.get(String(id)))
        .filter(Boolean)
    return names.length ? names.join(', ') : '-'
}

const buildResultLine = (story, idx, categoryMap, keepShortDesc = false) => {
    const title = escapeMarkdown(story.title || '-')
    const author = escapeMarkdown(story.user?.name || '-')
    const categories = buildCategoryNames(story, categoryMap)
    const description = truncate(story.description || '-', keepShortDesc ? 80 : 140)
    const reads = formatNumber(story.readCount)
    const votes = formatNumber(story.voteCount)
    const comments = formatNumber(story.commentCount)
    const part = toNumber(story.numParts)
    const updated = story.lastPublishedPart?.createDate || '-'

    return (
        `${idx}. ${title}\n` +
        `× Author: ${author}\n` +
        `× Category: ${categories}\n` +
        `× Part: ${part || '-'} part\n` +
        `× Read: ${reads}\n` +
        `× Vote: ${votes}\n` +
        `× Comment: ${comments}\n` +
        `× Update: ${updated}\n` +
        `× Mature: ${story.mature ? 'yes' : 'no'}\n` +
        `× Link: ${story.url || '-'}\n` +
        `× Description: ${description}`
    )
}

const formatStoryCaption = (query, total, stories, categoryMap) => {
    if (!stories.length) {
        return `\`\`\`WATTPAD SEARCH: ${escapeMarkdown(query)}\n❌ Tidak ada hasil valid.\`\`\``
    }

    const detail = stories
        .map((story, idx) => buildResultLine(story, idx + 1, categoryMap, false))
        .join('\n\n')

    return (
        `\`\`\`${detail}\`\`\``
    )
}

export default {
    name: 'wattpad',
    aliases: ['wp'],
    description: 'Cari cerita di wattpad',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const raw = normalizeText(text)
        const { query, limit } = parseLimit(raw)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} horror`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { data } = await axios.get(SEARCH_URL, {
                params: {
                    query,
                    limit
                },
                timeout: 25000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Accept: 'application/json'
                }
            })

            const stories = Array.isArray(data?.stories) ? data.stories : []
            const total = toNumber(data?.total)

            if (!stories.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil wattpad untuk: ${query}`
                }, { quoted: msg })
            }

            const first = stories[0]
            const categoryMap = new Map()
            if (Array.isArray(data?.categories)) {
                for (const c of data.categories) {
                    if (c?.id && c?.name) categoryMap.set(String(c.id), c.name)
                }
            }

            const selectedStories = stories.slice(0, limit)
            const caption = formatStoryCaption(query, total, selectedStories, categoryMap)
            const imageUrl = first.cover

            const sendPayload = imageUrl
                ? { image: { url: imageUrl }, caption }
                : { text: caption }

            await sock.sendMessage(jid, sendPayload, { quoted: msg })

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
