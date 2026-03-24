import axios from 'axios'
import { tikdownloader } from '../../scrape/tikdownloader.js'

export default {
    name: 'tiktok',
    aliases: ['tt', 'tiktokmp3', 'ttmp3', 'tiktokstory', 'ttstory', 'tiktokslide', 'ttslide'],
    description: 'Download tiktok via MusicalDown',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const url = String(text || '').match(/https?:\/\/(vm\.|vt\.|www\.|m\.)?tiktok\.com\/[^\s]+/i)?.[0]

        if (!url) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://vt.tiktok.com/ZSunPCVct/`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await tikdownloader(url)
            const author = String(result.author || '-').trim() || '-'
            const captionText = String(result.caption || '').trim()
            const caption = captionText
                ? `\`Author: ${author}\`

${captionText}`
                : `\`Author: ${author}\``

            if (result.type === 'photo') {
                const mediaBuffers = await Promise.all(result.images.map(async (item) => {
                    const { data } = await axios.get(item.url, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    })

                    return Buffer.from(data)
                }))
                const albumItems = mediaBuffers.map((buffer, index) => ({
                    image: buffer,
                    ...(index === 0 ? { caption } : {})
                }))

                await sock.sendMessage(jid, { albumMessage: albumItems }, { quoted: msg })

                if (result.audio) {
                    const { data } = await axios.get(result.audio, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    })
                    const audio = Buffer.from(data)
                    await sock.sendMessage(jid, {
                        audio,
                        mimetype: 'audio/mpeg',
                        ptt: false
                    }, { quoted: msg })
                }

                useLimit()
                await react('✅')
                return
            }

            if (String(command || '').toLowerCase().includes('mp3')) {
                if (!result.audio) {
                    throw new Error('Audio TikTok tidak tersedia')
                }

                const { data } = await axios.get(result.audio, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                })
                const audio = Buffer.from(data)
                await sock.sendMessage(jid, {
                    audio,
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg })

                useLimit()
                await react('✅')
                return
            }

            const { data } = await axios.get(result.video, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })
            const video = Buffer.from(data)
            await sock.sendMessage(jid, {
                video,
                caption,
                mimetype: 'video/mp4'
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (error) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error download tiktok: ${error.message}`
            }, { quoted: msg })
        }
    }
}
