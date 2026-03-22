import axios from 'axios'
import mime from 'mime-types'
import { resolveGDriveDownload, isGDriveUrl } from '../../scrape/gdrive.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const getFilename = (disposition = '', fallback = 'file.bin') => {
    const utf8 = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
    if (utf8) return decodeURIComponent(utf8.replace(/(^"|"$)/g, '').trim())

    const quoted = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    if (quoted) return quoted.trim()

    const plain = disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]
    if (plain) return plain.replace(/(^"|"$)/g, '').trim()

    return fallback
}

export default {
    name: 'gdrive',
    aliases: ['gdrivedl', 'gddl', 'googledrive'],
    description: 'Download file dari Google Drive',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const url = String(text || '').trim()

        if (!url) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://drive.google.com/file/d/1ZwuYUEHSvbcfgD19YihT1D194JyP3Wki/view?usp=drivesdk`
            }, { quoted: msg })
        }

        if (!isGDriveUrl(url)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari google drive.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const resolved = await resolveGDriveDownload(url)

            const res = await axios.get(resolved.url, {
                responseType: 'stream',
                timeout: 120000,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: {
                    'User-Agent': UA,
                    Accept: '*/*',
                    Referer: 'https://drive.google.com/',
                    ...(resolved.cookies ? { Cookie: resolved.cookies } : {})
                }
            })

            const contentType = String(res.headers['content-type'] || '').toLowerCase()
            if (contentType.includes('text/html')) {
                res.data.destroy()
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ File tidak bisa diunduh. mungkin tidak public atau butuh izin'
                }, { quoted: msg })
            }

            const size = Number(res.headers['content-length'] || 0) || 0
            const max = 2 * 1024 * 1024 * 1024
            if (size && size > max) {
                res.data.destroy()
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ File terlalu besar (${(size / 1024 / 1024).toFixed(2)} MB)\n\n- Link direct:\n${resolved.url}`
                }, { quoted: msg })
            }

            const fileName = getFilename(String(res.headers['content-disposition'] || ''), `gdrive-${resolved.id}.bin`)
                .replace(/[\r\n\t]/g, ' ')
                .trim()
            const mimetype = mime.lookup(fileName) || res.headers['content-type'] || 'application/octet-stream'

            res.data.destroy()

            await sock.sendMessage(jid, {
                document: { url: resolved.url },
                fileName,
                mimetype
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (error) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${error?.message}`
            }, { quoted: msg })
        }
    }
}
