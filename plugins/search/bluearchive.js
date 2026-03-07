import axios from 'axios'
import { ffmpeg } from '../../src/utils/converter.js'

const API_BASE = 'https://api.dotgg.gg/bluearchive'
const IMAGE_BASE = 'https://images.dotgg.gg/bluearchive/characters'
const GUIDE_API = 'https://bluearchive.gg/wp-json/wp/v2/characterguides'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const REQUEST_TIMEOUT = 35000

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeInput = (text) => normalizeText(String(text || ''))

const decodeUrlComponentSafe = (value) => {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

const toSlug = (text) => normalizeText(text)
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const extractSlugFromUrl = (raw) => {
    const text = normalizeInput(raw)
    if (!/^https?:\/\//i.test(text)) return ''
    try {
        const u = new URL(text)
        if (!/(^|\.)bluearchive\.gg$/i.test(u.hostname)) return ''
        const m = u.pathname.match(/^\/characters\/([^/?#]+)/i)
        if (!m?.[1]) return ''
        return toSlug(decodeUrlComponentSafe(m[1]).replace(/-/g, '_'))
    } catch {
        return ''
    }
}

const ensureHttpImage = (imgPath) => {
    const raw = normalizeText(imgPath)
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    return `${IMAGE_BASE}/${raw.replace(/^\/+/, '')}`
}

const isVideoLikeUrl = (url) => /\.(mp4|webm|m3u8|mov)(\?|#|$)/i.test(String(url || ''))

const requestJSON = async (url, params = undefined) => {
    const { data, status } = await axios.get(url, {
        params,
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json,text/plain,*/*'
        },
        validateStatus: () => true
    })
    if (status !== 200) return null
    return data
}

const fetchImageBuffer = async (url) => {
    const target = normalizeText(url)
    if (!target || isVideoLikeUrl(target)) return null
    try {
        const res = await axios.get(target, {
            responseType: 'arraybuffer',
            timeout: REQUEST_TIMEOUT,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            },
            validateStatus: () => true
        })

        if (res.status !== 200) return null
        const contentType = normalizeText(res.headers?.['content-type']).toLowerCase()
        if (!contentType.startsWith('image/')) return null

        const buf = Buffer.from(res.data || [])
        if (!buf.length) return null
        return {
            buffer: buf,
            mime: contentType
        }
    } catch {
        return null
    }
}

const resolveImageBuffer = async (character) => {
    const candidates = [
        ensureHttpImage(character?.img),
        ensureHttpImage(character?.imgSmall)
    ].filter(Boolean)

    for (const url of candidates) {
        const data = await fetchImageBuffer(url)
        if (data) return data
    }
    return null
}

const normalizeImageForSend = async (imageData) => {
    if (!imageData?.buffer) return null
    const mime = normalizeText(imageData.mime).toLowerCase()

    if (mime.includes('webp')) {
        try {
            const converted = await ffmpeg(imageData.buffer, ['-vframes', '1'], 'webp', 'jpg')
            if (converted?.data?.length) {
                return {
                    buffer: converted.data,
                    mime: 'image/jpeg'
                }
            }
        } catch {
            return null
        }
    }

    if (!mime.startsWith('image/')) return null
    return {
        buffer: imageData.buffer,
        mime: mime || 'image/jpeg'
    }
}

const fetchCharacterBySlug = async (slug) => {
    const cleanSlug = toSlug(slug)
    if (!cleanSlug) return null
    const data = await requestJSON(`${API_BASE}/characters/${encodeURIComponent(cleanSlug)}`)
    if (!data || !normalizeText(data?.name)) return null
    return data
}

const fetchAllCharacters = async () => {
    const data = await requestJSON(`${API_BASE}/characters`)
    return Array.isArray(data) ? data : []
}

const scoreCandidate = (item, query, querySlug) => {
    const name = normalizeText(item?.name).toLowerCase()
    const url = normalizeText(item?.url).toLowerCase()
    let score = 0
    if (!name && !url) return score

    if (url === querySlug) score += 1000
    if (name === query.toLowerCase()) score += 900
    if (url === query.toLowerCase()) score += 850
    if (name.includes(query.toLowerCase())) score += 350
    if (url.includes(querySlug)) score += 300
    if (query.toLowerCase().includes(name)) score += 250
    if (querySlug && querySlug.includes(url)) score += 250

    return score
}

const resolveCharacter = async (rawQuery) => {
    const query = normalizeInput(rawQuery)
    const fromUrlSlug = extractSlugFromUrl(query)
    const querySlug = toSlug(query)

    const directCandidates = []
    if (fromUrlSlug) directCandidates.push(fromUrlSlug)
    if (querySlug && querySlug !== fromUrlSlug) directCandidates.push(querySlug)
    if (/^[a-z0-9_]+$/.test(query) && query.toLowerCase() !== querySlug) {
        directCandidates.push(query.toLowerCase())
    }

    for (const slug of directCandidates) {
        const direct = await fetchCharacterBySlug(slug)
        if (direct) return direct
    }

    const all = await fetchAllCharacters()
    if (!all.length) return null

    const ranked = all
        .map((item) => ({ item, score: scoreCandidate(item, query, querySlug) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)

    const best = ranked[0]?.item
    if (!best?.url) return null

    return fetchCharacterBySlug(best.url)
}

const fetchGuideMeta = async (slug) => {
    const rows = await requestJSON(GUIDE_API, {
        slug: toSlug(slug),
        per_page: 1
    })
    if (!Array.isArray(rows) || !rows.length) return null
    return {
        title: normalizeText(rows[0]?.title?.rendered || ''),
        link: normalizeText(rows[0]?.link || '')
    }
}

const stripSkillMarkup = (value) => normalizeText(String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\n\s*/g, ' ')
)

const paramRange = (value) => {
    const list = Array.isArray(value)
        ? value.map((x) => normalizeText(x)).filter(Boolean)
        : []
    if (!list.length) return '-'
    const first = list[0]
    const last = list[list.length - 1]
    return first === last ? first : `${first} -> ${last}`
}

const resolveSkillDescription = (skill) => {
    const desc = stripSkillMarkup(skill?.description || '')
    const params = Array.isArray(skill?.parameters) ? skill.parameters : []
    return stripSkillMarkup(desc.replace(/\{(\d+)\}/g, (_, rawIdx) => {
        const idx = Number(rawIdx) - 1
        if (!Number.isInteger(idx) || idx < 0) return '-'
        return paramRange(params[idx])
    }))
}

const formatNumber = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return '-'
    if (Number.isInteger(n)) return String(n)
    return n.toFixed(2).replace(/\.00$/, '')
}

const renderCaption = (character, guide) => {
    const profile = character?.profile || {}
    const weapon = character?.weapon || {}
    const skillprio = character?.skillprio || {}
    const skills = Array.isArray(character?.skills) ? character.skills : []

    const skillLines = skills.slice(0, 4).map((skill, idx) => {
        const costArr = Array.isArray(skill?.cost) ? skill.cost : []
        const cost = costArr.length ? costArr[0] : '-'
        return (
            `× Skill ${idx + 1}: ${normalizeText(skill?.name || '-')} (${normalizeText(skill?.type || '-')}, Cost: ${cost})\n` +
            `  Desc: ${resolveSkillDescription(skill)}`
        )
    })

    const guideTitle = normalizeText(guide?.title || '')
    const guideLink = normalizeText(guide?.link || '')

    const lines = [
        `BLUE ARCHIVE: ${normalizeText(character?.name || '-').toUpperCase()}`,
        '',
        `× URL Key: ${normalizeText(character?.url || '-')}`,
        `× Type: ${normalizeText(character?.type || '-')}`,
        `× Role: ${normalizeText(character?.role || '-')}`,
        `× Position: ${normalizeText(character?.position || '-')}`,
        `× Family Name: ${normalizeText(profile?.familyName || '-')}`,
        `× Age: ${normalizeText(profile?.age || '-')}`,
        `× Height: ${normalizeText(profile?.height || '-')}`,
        `× Hobby: ${normalizeText(profile?.hobby || '-')}`,
        `× School: ${normalizeText(profile?.school || '-')}`,
        `× Club: ${normalizeText(profile?.club || '-')}`,
        `× Weapon: ${normalizeText(profile?.weaponName || weapon?.name || '-')}`,
        `× Weapon Type: ${normalizeText(profile?.weaponType || weapon?.type || '-')}`,
        `× CV: ${normalizeText(profile?.CV || '-')}`,
        `× Bio: ${stripSkillMarkup(character?.bio || '-')}`,
        '',
        `× Weapon Name: ${normalizeText(weapon?.name || '-')}`,
        `× Weapon Desc: ${stripSkillMarkup(weapon?.desc || '-')}`,
        `× Weapon ATK: ${formatNumber(weapon?.attack)} (+${formatNumber(weapon?.attackAdd)})`,
        `× Weapon HP: ${formatNumber(weapon?.hp)} (+${formatNumber(weapon?.hpAdd)})`,
        `× Weapon HEAL: ${formatNumber(weapon?.heal)} (+${formatNumber(weapon?.healAdd)})`,
        ''
    ]

    if (skillLines.length) {
        lines.push(...skillLines)
        lines.push('')
    }

    lines.push(`× Skill Priority: ${normalizeText(skillprio?.['General Skill Priority'] || '-')}`)
    lines.push(`× Early-Mid Invest: ${normalizeText(skillprio?.['Early to Mid Game investments'] || '-')}`)
    lines.push(`× Pre UE40: ${normalizeText(skillprio?.['Recommended Investment pre UE40'] || '-')}`)
    lines.push(`× UE40: ${normalizeText(skillprio?.['Recommended Investment UE40'] || '-')}`)
    lines.push(`× Notes: ${normalizeText(skillprio?.Notes || '-')}`)

    if (normalizeText(skillprio?.['Additional Notes'])) {
        lines.push(`× Additional Notes: ${normalizeText(skillprio['Additional Notes'])}`)
    }

    if (guideTitle) lines.push(`× Guide Title: ${guideTitle}`)
    if (guideLink) lines.push(`× Guide Link: ${guideLink}`)
    lines.push(`× Link: https://bluearchive.gg/characters/${normalizeText(character?.url || '-')}`)

    return `\`\`\`${lines.join('\n')}\`\`\``
}

export default {
    name: 'bluearchive',
    aliases: ['ba'],
    description: 'Detail karakter blue archive dari bluearchive.gg',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = normalizeInput(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh:\n- ${prefix + command} hoshino`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const character = await resolveCharacter(query)
            if (!character) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Karakter ${query.toLowerCase()} tidak ditemukan`
                }, { quoted: msg })
            }

            const guide = await fetchGuideMeta(character.url)
            const rawImage = await resolveImageBuffer(character)
            const imagePayload = await normalizeImageForSend(rawImage)
            const caption = renderCaption(character, guide)

            if (imagePayload?.buffer) {
                await sock.sendMessage(jid, {
                    image: imagePayload.buffer,
                    mimetype: imagePayload.mime,
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
