import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://www.apkmirror.com'
const SEARCH_URL =
    `${BASE_URL}/?post_type=app_release&searchtype=apk&bundles%5B%5D=apkm_bundles&bundles%5B%5D=apk_files&s={query}`
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toAbsoluteUrl = (link) => {
    const raw = clean(link)
    if (!raw) return '-'
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith('//')) return `https:${raw}`
    return `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`
}

const parseInfoValue = ($info, label) => {
    if (!$info || !$info.length) return '-'

    const target = clean(label).toLowerCase()
    const normalizeLabel = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')

    const matchesLabel = (rawLabel, targetLabel) => {
        const normalized = normalizeLabel(rawLabel)
        if (targetLabel === 'downloads') {
            return normalized.includes('download')
        }
        if (targetLabel === 'file size') {
            return normalized.includes('file') && normalized.includes('size')
        }
        if (targetLabel === 'uploaded') {
            return normalized === 'uploaded' || normalized === 'upload'
        }
        if (targetLabel === 'version') {
            return normalized === 'version' || normalized === 'app version'
        }
        return normalized === targetLabel
    }

    const lines = clean($info.text()).split('\n').map((line) => clean(line)).filter(Boolean)
    for (const line of lines) {
        const match = line.match(/^([A-Za-z][A-Za-z0-9\s/+.-]*):\s*(.*?)(?=\s+[A-Za-z][A-Za-z0-9\s/+.-]*:\s*|$)/)
        if (!match) continue
        const key = clean(match[1]).toLowerCase()
        const value = clean(match[2])
        if (matchesLabel(key, target)) {
            return value || '-'
        }
    }

    const flattened = clean($info.text())
    const textPairs = flattened.match(/([A-Za-z][A-Za-z0-9\s/+.-]*:\s*.*?)(?=\s+[A-Za-z][A-Za-z0-9\s/+.-]*:\s*|$)/g) || []
    for (const pair of textPairs) {
        const sep = pair.indexOf(':')
        if (sep < 0) continue
        const rawKey = pair.slice(0, sep)
        const rawValue = pair.slice(sep + 1)
        if (!rawKey || !rawValue) continue
        if (matchesLabel(rawKey, target)) {
            return clean(rawValue) || '-'
        }
    }

    if (target === 'downloads') {
        const fallback = flattened.match(/(downloads?)\s*[:\-]?\s*([0-9][0-9.,]*\s*[kKmMbB]?)\b/i) ||
            flattened.match(/([0-9][0-9.,]*\s*[kKmMbB]?)\s*(?:(?:total|total\s*)?downloads?)\b/i)
        const value = clean((fallback?.[2] || fallback?.[1] || ''))
        if (value) return value
    }

    if (target === 'file size') {
        const fallback = flattened.match(/(?:file\s*size|size)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:KB|MB|GB|TB|Kb|kB|mb|Mb|tb|Gb))/i)
        if (fallback?.[1]) return fallback[1]
    }

    if (target === 'uploaded') {
        const fallback = flattened.match(/(?:uploaded|upload|released|release)\s*[:\-]?\s*([^|,\n]+(?:\d{4})?[^|,\n]*)/i)
        if (fallback?.[1]) return clean(fallback[1])
    }

    if (target === 'version') {
        const fallback = flattened.match(/(?:app\s*version|version)\s*[:\-]?\s*([^|,\n]+)/i)
        if (fallback?.[1]) return fallback[1]
    }

    return '-'
}

const parseSearchPage = (html) => {
    const $ = cheerio.load(html)
    const items = []

    $('div.appRow').each((_, row) => {
        const $row = $(row)
        const title = clean($row.find('h5.appRowTitle a').first().text())
        if (!title) return

        const titleHref = $row.find('h5.appRowTitle a').first().attr('href')
        const apkUrl = toAbsoluteUrl($row.find('a.downloadLink').first().attr('href') || titleHref)
        const devPath = clean($row.find('a.byDeveloper').first().text()).replace(/^by\s+/i, '') || '-'
        let infoSlide = $row.find('div.infoSlide')

        if (!infoSlide.length) {
            infoSlide = $row.closest('div').next('div.infoSlide')
        }
        if (!infoSlide.length) {
            infoSlide = $row.parent().children('div.infoSlide').first()
        }
        if (!infoSlide.length) {
            let candidate = $row
            for (let i = 0; i < 3; i += 1) {
                candidate = candidate.parent()
                if (!candidate?.length) break
                const nextInfo = candidate.next('div.appRowInfo').add(candidate.next('div.infoSlide'))
                if (nextInfo.length) {
                    infoSlide = nextInfo
                    break
                }
            }
        }

        const publish = parseInfoValue(infoSlide, 'uploaded')
        const version = parseInfoValue(infoSlide, 'version')
        const downloads = parseInfoValue(infoSlide, 'downloads')
        const fileSize = parseInfoValue(infoSlide, 'file size')

        let packageName = '-'
        let appUrl = '-'
        if (titleHref) {
            const parts = titleHref.split('/').filter(Boolean)
            const idx = parts.indexOf('apk')
            if (idx >= 0 && parts[idx + 1] && parts[idx + 2]) {
                packageName = parts[idx + 2]
                appUrl = toAbsoluteUrl(`/${parts.slice(0, idx + 3).join('/')}/`)
            }
        }

        if (items.length < MAX_RESULTS) {
            items.push({
                title,
                package: packageName,
                developer: devPath,
                version: version === '-' ? '-' : version,
                publish: publish === '-' ? '-' : publish,
                downloads: downloads === '-' ? '-' : downloads,
                appUrl,
                apkUrl,
                desc: `${title} by ${devPath} (${fileSize === '-' ? 'size unknown' : fileSize})`,
            })
        }
    })

    return items
}

const formatRows = (items) => items
    .map((item, idx) => (
        `${idx + 1}. ${item.title}\n` +
        `× Package: ${item.package}\n` +
        `× Developer: ${item.developer}\n` +
        `× Version: ${item.version}\n` +
        `× Publish: ${item.publish}\n` +
        `× Downloads: ${item.downloads}\n` +
        `× APK: ${item.apkUrl}\n` +
        `× Desc: ${item.desc}`
    ))
    .join('\n\n')

export default {
    name: 'apkmirror',
    aliases: ['apkm'],
    description: 'Cari APK di APKMirror',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = clean(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} whatsapp`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const searchUrl = SEARCH_URL.replace('{query}', encodeURIComponent(query))
            const { data } = await axios.get(searchUrl, {
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'APKUpdater-v3.0.3',
                    'Accept-Language': 'en-US,en;q=0.9',
                    Referer: BASE_URL
                },
                validateStatus: () => true
            })

            if (!data || typeof data !== 'string') {
                throw new Error('❌ Response dari server tidak valid')
            }

            const items = parseSearchPage(data)
            if (!items.length) {
                if (/just a moment|enable JavaScript and cookies|security verification/i.test(String(data))) {
                    await react('❌')
                    return sock.sendMessage(jid, {
                        text: '❌ Gagal akses apkmirror (cloudflare challenge)'
                    }, { quoted: msg })
                }

                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil APKMirror untuk: ${query}`
                }, { quoted: msg })
            }

            const body = `\`\`\`${formatRows(items, query)}\`\`\``
            await sock.sendMessage(jid, { text: body }, { quoted: msg })

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
