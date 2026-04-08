import axios from 'axios'
import { tikdownloader } from '../../scrape/savetik.js'
import { tiktok2 } from '../../scrape/tiktok.js'
import { toAudio } from '../../src/utils/converter.js'

const normalizeDlUrl = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith('//')) return `https:${raw}`
    if (raw.startsWith('/')) return `https://snaptik.cx${raw}`
    return raw
}

const normalizeTikResult = (result = {}) => {
    const normalized = { ...result }
    if (normalized.video) normalized.video = normalizeDlUrl(normalized.video)
    if (normalized.audio) normalized.audio = normalizeDlUrl(normalized.audio)
    if (!normalized.audio && normalized.audioUrl) normalized.audio = normalized.audioUrl
    if (normalized.audio) normalized.audio = normalizeDlUrl(normalized.audio)
    if (Array.isArray(normalized.images)) {
        normalized.images = normalized.images.map((item, index) => ({
            index: Number(item?.index || index + 1),
            url: normalizeDlUrl(item?.url)
        })).filter((item) => item.url)
    }
    return normalized
}

export default {
    name: 'tiktok',
    aliases: ['tt', 'tiktokmp3', 'ttmp3', 'tiktokslide', 'ttslide'],
    description: 'Download TikTok dan Douyin via SaveTik',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const url = String(text || '').match(/https?:\/\/(?:(?:vm|vt|www|m)\.)?tiktok\.com\/[^\s]+|https?:\/\/(?:(?:www|v)\.)?douyin\.com\/[^\s]+/i)?.[0]

        if (!url) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://vt.tiktok.com/ZSunPCVct/`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            let result
            let saveTikError = null

            try {
                result = normalizeTikResult(await tikdownloader(url))
            } catch (error) {
                saveTikError = error
            }

            if (!result) {
                const fallbackMode = String(command || '').toLowerCase().includes('mp3')
                    ? 'mp3'
                    : String(command || '').toLowerCase().includes('slide')
                        ? 'slide'
                        : ''

                try {
                    result = normalizeTikResult(await tiktok2(url, fallbackMode ? { mode: fallbackMode } : {}))
                } catch (fallbackError) {
                    const primaryMsg = saveTikError?.message || 'SaveTik gagal'
                    throw new Error(`${primaryMsg}; fallback gagal: ${fallbackError.message}`)
                }
            }

            const author = String(result.author || '-').trim() || '-'
            const captionText = String(result.caption || '').trim()
            const caption = author !== '-' && captionText
                ? `\`Author: ${author}\`\n\n${captionText}`
                : author !== '-'
                    ? `\`Author: ${author}\``
                    : captionText

            if (String(command || '').toLowerCase().includes('mp3')) {
                if (result.audio) {
                    try {
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
                    } catch (error) {
                        console.error('[tiktok] mp3 direct failed:', error.message)
                    }
                }

                const sourceVideo = result.video || result.renderVideo
                if (!sourceVideo) {
                    throw new Error('Audio TikTok tidak tersedia')
                }

                const { data } = await axios.get(sourceVideo, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                })
                const converted = await toAudio(Buffer.from(data), 'mp4')
                await sock.sendMessage(jid, {
                    audio: converted.data,
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg })

                useLimit()
                await react('✅')
                return
            }

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
