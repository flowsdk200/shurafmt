import { downloadBuffer, searchTracks } from '../../scrape/spotify.js'

const sessions = new Map()

const cleanupSessions = () => {
    const now = Date.now()
    for (const [key, value] of sessions.entries()) {
        if (!value?.expiresAt || value.expiresAt <= now) {
            sessions.delete(key)
        }
    }
}

const sendTrack = async ({ sock, msg, react, useLimit, url }) => {
    await react('⏳')

    try {
        const data = await downloadBuffer(url)
        const title = String(data?.title || 'spotify track').trim()
        const artists = String(data?.artists || '-').trim()
        const duration = String(data?.durationFormatted || '-').trim()

        await sock.sendMessage(msg.key.remoteJid, {
            audio: data.audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
            ptt: false,
            ...(data?.coverBuffer ? {
                contextInfo: {
                    externalAdReply: {
                        title,
                        body: `${artists} • ${duration}`,
                        thumbnail: data.coverBuffer,
                        sourceUrl: url,
                        mediaUrl: url,
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
            text: `❌ Error: ${err.message}`
        }, { quoted: msg })
    }
}

export default {
    name: 'spotifysearch',
    aliases: ['sps', 'spsearch'],
    description: 'Cari lagu Spotify',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
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
            const results = await searchTracks(q, 15)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil untuk: ${q}`
                }, { quoted: msg })
            }

            const lines = results.map((item, i) => (
                `${i + 1}. ${item.title}\n` +
                `• Artist: ${item.artists || '-'}\n` +
                `• Duration: ${item.durationFormatted || '-'}\n` +
                `• Link: ${item.url || '-'}`
            ))

            const thumb = results[0]?.image || ''
            const caption = `\`\`\`${lines.join('\n\n')}\`\`\`\n\n\n\`\`\`⚠️ Reply pesan ini dengan angka 1-${results.length} untuk download MP3.\`\`\``
            let sent

            if (thumb) {
                sent = await sock.sendMessage(jid, {
                    image: { url: thumb },
                    caption
                }, { quoted: msg })
            } else {
                sent = await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            const messageId = sent?.key?.id
            if (messageId) {
                sessions.set(messageId, {
                    chatJid: jid,
                    results: results.map((item) => ({ url: item.url })),
                    processing: false,
                    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
                })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal mencari Spotify: ${err.message}`
            }, { quoted: msg })
        }
    },

    onMessage: async ({ sock, msg, body, contextInfo, react, useLimit }) => {
        cleanupSessions()

        const choice = Number.parseInt(String(body || '').trim(), 10)
        if (!Number.isInteger(choice)) return

        const stanzaId = String(contextInfo?.stanzaId || '').trim()
        if (!stanzaId) return

        const session = sessions.get(stanzaId)
        if (!session) return
        if (session.chatJid !== msg.key.remoteJid) return
        if (choice < 1 || choice > session.results.length) return
        if (session.processing) return

        const picked = session.results[choice - 1]
        if (!picked?.url) return

        session.processing = true

        try {
            await sendTrack({ sock, msg, react, useLimit, url: picked.url })
        } finally {
            const current = sessions.get(stanzaId)
            if (current) current.processing = false
        }
    }
}
