import axios from 'axios'
import * as cheerio from 'cheerio'
import mime from 'mime-types'

/** Ambil URL pertama dari teks */
const extractUrl = (text) =>
    String(text || '').trim().match(/https?:\/\/[^\s]+/i)?.[0] ?? ''

/** Encode URL agar aman dikirim ke axios */
const normalizeUrl = (url) => encodeURI(String(url || '').trim())

/** Jadikan URL relatif menjadi absolut */
const absolutize = (url, base) => {
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('//')) return `https:${url}`
    try { return new URL(url, base).href } catch { return '' }
}

/** Parse HTML → ambil direct download URL */
const getDownloadUrl = (html, finalUrl) => {
    const $ = cheerio.load(html)

    const fromDom =
        $('#downloadButton').attr('href') ||
        $('a[aria-label="Download file"]').attr('href') ||
        $('a.popsok').attr('href')

    if (fromDom) return absolutize(fromDom, finalUrl)

    const match =
        html.match(/href=["'](https:\/\/download[^"']+)["']/i) ||
        html.match(/"(https:\/\/download[^"]+)"/i)

    return match ? match[1].trim() : ''
}

/** Parse HTML → ambil nama file */
const getFileName = (html) => {
    const $ = cheerio.load(html)
    const raw =
        $('div.filename').first().text().trim() ||
        $('title').first().text().trim() ||
        'downloaded_file'
    return raw.replace(/^MediaFire\s*[-–]\s*/i, '').trim()
}


export default {
    name: 'mediafire',
    aliases: ['mf'],
    description: 'Download file dari link mediafire',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!text) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.mediafire.com/file/6d6ve1st4p1c7m5/Busybox-NDK_v1.36.1.zip/file`
            }, { quoted: msg })
        }

        const rawUrl = extractUrl(text)

        if (!rawUrl || !/mediafire\.com|mfi\.re/i.test(rawUrl)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari mediafire.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const response = await axios.get(normalizeUrl(rawUrl), {
                timeout: 30000,
                maxRedirects: 10,
                validateStatus: () => true,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
                }
            })

            const html = String(response.data || '')
            const finalUrl = response.request?.res?.responseUrl || normalizeUrl(rawUrl)

            const isInvalid =
                response.status >= 400 ||
                /error\.php\?errno=/i.test(finalUrl) ||
                /The key you provided for file download was invalid/i.test(html)

            if (isInvalid) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Link tidak ditemukan atau sudah tidak valid.'
                }, { quoted: msg })
            }

            const directLink = getDownloadUrl(html, finalUrl)

            if (!directLink) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Gagal mendapatkan link download. file mungkin diproteksi password atau link sudah mampus.'
                }, { quoted: msg })
            }

            const fileName = getFileName(html)
            const mimetype = mime.lookup(fileName) || 'application/octet-stream'

            await sock.sendMessage(jid, {
                document: { url: directLink },
                fileName,
                mimetype
            }, { quoted: msg })

            useLimit()
            await react('✅')

        } catch (err) {
            await react('❌')
            return sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
