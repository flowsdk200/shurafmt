import { downloadBuffer, searchTracks } from '../../scrape/spotify.js'

export default {
    name: 'spotify',
    aliases: ['spdl'],
    description: 'Download lagu dari spotify link track',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} night changes\n- ${prefix + command} https://open.spotify.com/track/5iXzpQ8Tgvnts4HNlL0FHT`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            let targetUrl = q
            let duration = '-'

            if (!/spotify\.com\/track\//i.test(q)) {
                const candidates = await searchTracks(q, 2)
                if (!candidates.length) {
                    await react('❌')
                    return sock.sendMessage(jid, {
                        text: `❌ Tidak ditemukan hasil untuk: ${q}`
                    }, { quoted: msg })
                }

                const pickIndex = candidates.length === 1 ? 0 : Math.floor(Math.random() * 2)
                const picked = candidates[pickIndex] || candidates[0]
                targetUrl = picked.url
                duration = picked.durationFormatted || '-'
            }

            const data = await downloadBuffer(targetUrl)
            const title = String(data?.title || 'spotify track').trim()
            const artists = String(data?.artists || '-').trim()

            if (duration === '-') {
                try {
                    const candidates = await searchTracks(title, 10)
                    const sameId = candidates.find((x) => x?.id && data?.id && x.id === data.id)
                    const sameUrl = candidates.find((x) => x?.url && data?.id && String(x.url).includes(data.id))
                    const picked = sameId || sameUrl || candidates[0]
                    if (picked?.durationFormatted) duration = picked.durationFormatted
                } catch {}
            }

            await sock.sendMessage(jid, {
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
                            sourceUrl: targetUrl,
                            mediaUrl: targetUrl,
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
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
