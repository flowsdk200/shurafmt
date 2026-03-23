import { search } from '../../scrape/ytsearch.js'
import { yt1sdl } from '../../scrape/yt1s.js'
import { getBuffer, toAudio } from '../../src/utils/converter.js'

const sessions = new Map()

const cleanupSessions = () => {
    const now = Date.now()
    for (const [key, value] of sessions.entries()) {
        if (!value?.expiresAt || value.expiresAt <= now) {
            sessions.delete(key)
        }
    }
}

const sendAudioResult = async ({ sock, msg, react, useLimit, url }) => {
    await react('⏳')

    try {
        const res = await yt1sdl(url, { type: 'audio', audioQuality: '128' })
        const audioInfo = Array.isArray(res?.audio) ? res.audio.find((x) => x?.url) : null

        if (!audioInfo?.url) {
            await react('❌')
            return sock.sendMessage(msg.key.remoteJid, {
                text: '❌ Audio tidak tersedia untuk video ini.'
            }, { quoted: msg })
        }

        const raw = await getBuffer(audioInfo.url, { timeout: 120000, maxRedirects: 5 })
        const ext = String(audioInfo.format || 'mp3').toLowerCase()
        const converted = await toAudio(raw, ext)
        const audio = converted?.data || converted

        const channelName = String(res?.channel?.name || '-').trim()
        let thumbBuffer = null
        let thumbUrl = ''

        if (res?.thumbnail) {
            thumbUrl = res.thumbnail
            try {
                const tb = await getBuffer(res.thumbnail, { timeout: 15000, maxRedirects: 3 })
                if (Buffer.isBuffer(tb) && tb.length) thumbBuffer = tb
            } catch {}
        }

        await sock.sendMessage(msg.key.remoteJid, {
            audio,
            mimetype: 'audio/mpeg',
            fileName: `${res.title}.mp3`,
            ptt: false,
            ...(thumbBuffer || thumbUrl ? {
                contextInfo: {
                    externalAdReply: {
                        title: res.title,
                        body: channelName,
                        ...(thumbBuffer ? { thumbnail: thumbBuffer } : {}),
                        ...(thumbUrl ? { thumbnailUrl: thumbUrl } : {}),
                        mediaUrl: url,
                        sourceUrl: url,
                        mediaType: 1,
                        showAdAttribution: false,
                        renderLargerThumbnail: true
                    }
                }
            } : {})
        }, { quoted: msg })

        useLimit()
        await react('✅')
    } catch (err) {
        await react('❌')
        await sock.sendMessage(msg.key.remoteJid, {
            text: `❌ Error: ${err?.message}`
        }, { quoted: msg })
    }
}

const fmtViews = (v) => {
    const n = Number(String(v || '').replace(/[^0-9]/g, ''))
    if (!Number.isFinite(n) || n <= 0) return '-'
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(n)
}

export default {
    name: 'ytsearch',
    aliases: ['yts'],
    description: 'Cari video youtube',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit, sender }) => {
        cleanupSessions()
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} night changes`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const results = await search(q, 15)
            if (!results?.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil untuk: ${q}`
                }, { quoted: msg })
            }

            const lines = results.map((item, i) => (
                `${i + 1}. ${item.title}\n` +
                `• Channel: ${item.channel}\n` +
                `• Duration: ${item.duration}\n` +
                `• Views: ${fmtViews(item.views)}\n` +
                `• Link: ${item.url}`
            ))

            const firstThumb = results[0]?.thumbnail || results[0]?.thumbnailHD || ''
            const caption = `\`\`\`${lines.join('\n\n')}\`\`\`\n\nReply pesan ini dengan angka 1-${results.length} untuk download MP3.`

            let sent

            if (firstThumb) {
                sent = await sock.sendMessage(jid, {
                    image: { url: firstThumb },
                    caption
                }, { quoted: msg })
            } else {
                sent = await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            const messageId = sent?.key?.id
            if (messageId) {
                sessions.set(messageId, {
                    chatJid: jid,
                    sender: sender || msg.key.participant || msg.key.remoteJid,
                    results: results.map((item) => ({ url: item.url })),
                    expiresAt: Date.now() + (10 * 60 * 1000)
                })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    },

    onMessage: async ({ sock, msg, body, sender, contextInfo, react, useLimit }) => {
        cleanupSessions()

        const choice = Number.parseInt(String(body || '').trim(), 10)
        if (!Number.isInteger(choice)) return

        const stanzaId = String(contextInfo?.stanzaId || '').trim()
        if (!stanzaId) return

        const session = sessions.get(stanzaId)
        if (!session) return
        if (session.chatJid !== msg.key.remoteJid) return
        if (session.sender !== sender) return
        if (choice < 1 || choice > session.results.length) return

        const picked = session.results[choice - 1]
        if (!picked?.url) return

        sessions.delete(stanzaId)
        await sendAudioResult({ sock, msg, react, useLimit, url: picked.url })
    }
}
