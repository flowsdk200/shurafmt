const CHANNEL_LINK_RE = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([0-9A-Za-z]+)/i

const parseChannelInput = (raw = '') => {
    const input = String(raw || '').trim()
    if (!input) return null

    const linkMatch = input.match(CHANNEL_LINK_RE)
    if (linkMatch?.[1]) return { type: 'invite', key: linkMatch[1] }

    const token = input.split(/\s+/)[0]
    if (token.endsWith('@newsletter')) return { type: 'jid', key: token.toLowerCase() }
    if (/^\d{10,20}$/.test(token)) return { type: 'jid', key: `${token}@newsletter` }
    if (/^[0-9A-Za-z]{10,64}$/.test(token)) return { type: 'invite', key: token }
    return null
}

const normalizeNewsletterJid = (value) => {
    const s = String(value || '').trim().toLowerCase()
    if (!s) return ''
    return s.endsWith('@newsletter') ? s : `${s}@newsletter`
}

const toNumber = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

const formatTime = (v) => {
    const n = toNumber(v)
    if (n === null) return '-'
    const ms = n < 1e12 ? n * 1000 : n
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

const pickText = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v || null
    if (typeof v === 'object' && typeof v.text === 'string') return v.text || null
    return null
}

const mergeMetadata = (a, b) => ({
    ...(a || {}),
    ...(b || {}),
    thread_metadata: {
        ...((a && a.thread_metadata) || {}),
        ...((b && b.thread_metadata) || {})
    }
})

const cleanObject = (obj) => {
    if (obj === null || obj === undefined || obj === '') return undefined
    if (Array.isArray(obj)) {
        const arr = obj.map(cleanObject).filter((v) => v !== undefined)
        return arr.length ? arr : undefined
    }
    if (typeof obj !== 'object') return obj

    const out = {}
    for (const [k, v] of Object.entries(obj)) {
        const cleaned = cleanObject(v)
        if (cleaned === undefined) continue
        if (typeof cleaned === 'object' && !Array.isArray(cleaned) && !Object.keys(cleaned).length) continue
        out[k] = cleaned
    }
    return Object.keys(out).length ? out : undefined
}

export default {
    name: 'idch',
    aliases: ['cekidch', 'channelid'],
    description: 'Cek ID channel/newsletter dari link + tampilkan metadata',
    execute: async ({ sock, msg, text, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid
        const parsed = parseChannelInput(text)

        if (!parsed) {
            return sock.sendMessage(jid, {
                text: `Gunakan: ${prefix + command} <link channel>`
            }, { quoted: msg })
        }

        let metadata
        try {
            const primary = await sock.newsletterMetadata(parsed.type, parsed.key)
            if (!primary) {
                return sock.sendMessage(jid, {
                    text: '❌ Channel/newsletter tidak ditemukan atau tidak bisa diakses.'
                }, { quoted: msg })
            }

            metadata = primary
            const jidKey = primary?.id ? normalizeNewsletterJid(primary.id) : null
            if (jidKey) {
                const byJid = await sock.newsletterMetadata('jid', jidKey).catch(() => null)
                if (byJid) metadata = mergeMetadata(primary, byJid)
            }
        } catch (err) {
            return sock.sendMessage(jid, {
                text: `❌ Gagal ambil metadata channel: ${err?.message || err}`
            }, { quoted: msg })
        }

        const thread = metadata.thread_metadata || {}
        const newsletterJid = metadata.id
            ? normalizeNewsletterJid(metadata.id)
            : (parsed.type === 'jid' ? normalizeNewsletterJid(parsed.key) : '-')
        const newsletterId = newsletterJid.endsWith('@newsletter') ? newsletterJid.replace('@newsletter', '') : null
        const resolvedName = metadata.name || pickText(thread.name) || null
        const resolvedDescription = metadata.description || pickText(thread.description) || null
        const resolvedInvite = metadata.invite || thread.invite || (parsed.type === 'invite' ? parsed.key : null)
        const resolvedSubscribers = metadata.subscribers ?? toNumber(thread.subscribers_count)
        const resolvedVerification = metadata.verification || thread.verification || null
        const resolvedCreationTime = toNumber(metadata.creation_time ?? thread.creation_time)
        const resolvedMuteState = metadata.mute_state || metadata?.viewer_metadata?.mute || null
        const resolvedPicture = metadata.picture || (thread.preview?.direct_path ? {
            directPath: thread.preview.direct_path,
            id: thread.preview.id,
            type: thread.preview.type || 'PREVIEW'
        } : null)
        const resolvedReactionCodes = (Array.isArray(metadata.reaction_codes) && metadata.reaction_codes.length)
            ? metadata.reaction_codes
            : (thread?.settings?.reaction_codes?.value ? [{ code: String(thread.settings.reaction_codes.value), count: 0 }] : [])
        const inviteLink = resolvedInvite ? `https://whatsapp.com/channel/${resolvedInvite}` : '-'

        useLimit()
        return sock.sendMessage(jid, {
            text:
                `• JID: ${newsletterJid}\n` +
                `• Name: ${resolvedName || '-'}\n` +
                `• Subscribers: ${resolvedSubscribers ?? '-'}\n` +
                `• Created: ${formatTime(resolvedCreationTime)}`
        }, { quoted: msg })
    }
}
